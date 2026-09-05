import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { apiKeys, applicationSettings, auditEvents, attachments, backupJobs, budgetReservationFunders, budgetReservations, chats, chatShares, exportJobs, managementTokens, poolInvitations, poolMembers, pools, queuedMessages, responses, sessions, users, workspaceLeases } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { parseAuthSettings } from '../settings/application-settings.js'
import { activePoolMembers, activePoolMembership, dissolveSingletonPool, publishPoolChanges } from '../pools/service.js'
import { publishSessionRevocation, requestCancellation } from '../responses/events.js'
import { maintenanceQueue } from '../jobs.js'
import { releaseBudget } from '../accounting/service.js'
import { getBlobStore } from '../storage/index.js'
import { workspaceControllerRequest } from '../agent/controller-http.js'
import { cancelAccountBilling } from './stripe-deletion.js'
import { redis } from '../redis.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// All administrative removal/demotion paths use the same lock, including the DB guard.
export async function lockAccountAdministration(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('account-administration'))`)
}

export async function acceptAccountDeletion(userId: string): Promise<void> {
  const peers = await db.transaction(async (tx) => {
    await lockAccountAdministration(tx)
    const [setting] = await tx.select().from(applicationSettings).where(eq(applicationSettings.key, 'auth'))
    if (!parseAuthSettings(setting?.value).accountDeletionEnabled) {
      throw new AppError(403, 'account_deletion_disabled', 'Account deletion is disabled by the instance administrator.')
    }
    const membership = await activePoolMembership(tx, userId)
    if (membership) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pool:${membership.pool.id}`}))`)
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update')
    if (!user || user.deletionRequestedAt) return []
    if (user.role === 'admin' && !user.blocked) {
      const [other] = await tx.select({ id: users.id }).from(users).where(and(
        ne(users.id, userId), eq(users.role, 'admin'), eq(users.blocked, false), isNull(users.deletionRequestedAt),
      )).limit(1)
      if (!other) throw new AppError(409, 'last_admin', 'Appoint another unblocked administrator before deleting your account.')
    }
    const members = membership ? await activePoolMembers(tx, membership.pool.id) : []
    if (membership?.pool.ownerUserId === userId && members.length > 1) {
      throw new AppError(409, 'pool_owner_transfer_required', 'Transfer Pool ownership to another member before deleting your account.')
    }
    const now = new Date()
    await tx.update(users).set({ deletionRequestedAt: now, deletionError: null, blocked: true, updatedAt: now }).where(eq(users.id, userId))
    await tx.delete(sessions).where(eq(sessions.userId, userId))
    await tx.update(apiKeys).set({ status: 'disabled', disabledAt: now }).where(eq(apiKeys.userId, userId))
    await tx.update(managementTokens).set({ revokedAt: now }).where(eq(managementTokens.userId, userId))
    await tx.update(chatShares).set({ revokedAt: now }).where(eq(chatShares.userId, userId))
    await tx.update(chats).set({ deletedAt: now, updatedAt: now }).where(eq(chats.userId, userId))
    await tx.delete(queuedMessages).where(eq(queuedMessages.userId, userId))
    await tx.update(poolMembers).set({ leftAt: now }).where(and(eq(poolMembers.userId, userId), isNull(poolMembers.leftAt)))
    await tx.update(poolInvitations).set({ status: 'canceled', respondedAt: now, updatedAt: now }).where(and(eq(poolInvitations.inviteeUserId, userId), eq(poolInvitations.status, 'pending')))
    const dissolved = membership ? await dissolveSingletonPool(tx, membership.pool.id) : []
    await tx.insert(auditEvents).values({ id: newId(), action: 'account.deletion.requested', targetType: 'user', targetId: userId })
    return [...new Set([...members.map((row) => row.user.id), ...dissolved])].filter((id) => id !== userId)
  })
  // Acceptance is durable even when Redis is unavailable. Periodic maintenance recovers it.
  const dispatch = Promise.allSettled([
    publishSessionRevocation(userId),
    publishPoolChanges(peers),
    maintenanceQueue.add('delete-account', { type: 'delete-account', payload: { userId } }, {
      jobId: `delete-account-${userId}`, attempts: 10, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true,
    }),
  ])
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([dispatch, new Promise<void>((resolve) => { timer = setTimeout(resolve, 1_000) })])
  } finally { if (timer) clearTimeout(timer) }
}

export async function deleteAccountData(userId: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  if (!user?.deletionRequestedAt) return
  try {
    const responseRows = await db.select().from(responses).where(eq(responses.userId, userId))
    for (const response of responseRows) {
      if (['queued', 'in_progress'].includes(response.status)) {
        await requestCancellation(response.id)
        if (response.status === 'queued') {
          const claimed = await db.update(responses).set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(responses.id, response.id), eq(responses.status, 'queued'))).returning({ id: responses.id })
          if (claimed.length) await releaseBudget(response.id)
        }
      }
    }
    for (const response of responseRows) {
      if (['cancelled', 'failed'].includes(response.status)) await releaseBudget(response.id)
    }
    await cancelAccountBilling(userId)
    const [running] = await db.select({ id: responses.id }).from(responses)
      .where(and(eq(responses.userId, userId), inArray(responses.status, ['queued', 'in_progress']))).limit(1)
    if (running) throw new Error('Waiting for running requests to stop.')
    const [funding] = await db.select({ id: budgetReservations.id }).from(budgetReservationFunders)
      .innerJoin(budgetReservations, eq(budgetReservations.id, budgetReservationFunders.reservationId))
      .where(and(eq(budgetReservationFunders.userId, userId), eq(budgetReservations.status, 'pending'))).limit(1)
    if (funding) throw new Error('Waiting for existing Pool contributions to settle.')
    const leases = await db.select().from(workspaceLeases).where(eq(workspaceLeases.userId, userId))
    for (const lease of leases) {
      if (lease.controllerLeaseId) {
        const result = await workspaceControllerRequest(`/v1/leases/${lease.controllerLeaseId}`, { method: 'DELETE', signal: AbortSignal.timeout(10_000) })
        if (!result.ok && result.status !== 404) throw new Error(`Workspace cleanup failed (${result.status}).`)
      }
    }
    // Signed upload URLs remain valid for 15 minutes. Wait for them to expire before the final blob sweep.
    if (Date.now() - user.deletionRequestedAt.getTime() < 16 * 60_000) {
      throw new Error('Waiting for outstanding upload URLs to expire before final cleanup.')
    }
    const files = await db.select({ key: attachments.objectKey }).from(attachments).where(eq(attachments.userId, userId))
    const exports = await db.select().from(exportJobs).where(eq(exportJobs.userId, userId))
    const keys = new Set<string>(files.map((file) => file.key))
    if (user.avatarObjectKey) keys.add(user.avatarObjectKey)
    for (const job of exports) keys.add(job.objectKey ?? `exports/${userId}/${job.id}`)
    for (const key of keys) await getBlobStore().delete(key)
    for (const response of responseRows) await redis.del(`pulpo:response:${response.id}:events`, `pulpo:response:${response.id}:cancel`)
    await db.transaction(async (tx) => {
      await tx.delete(budgetReservationFunders).where(eq(budgetReservationFunders.userId, userId))
      await tx.delete(pools).where(eq(pools.ownerUserId, userId))
      // Backup archives belong to the instance retention policy, not the account.
      await tx.update(backupJobs).set({ userId: null }).where(eq(backupJobs.userId, userId))
      await tx.delete(users).where(and(eq(users.id, userId), isNotNull(users.deletionRequestedAt)))
      await tx.insert(auditEvents).values({ id: newId(), action: 'account.deletion.completed', targetType: 'user', targetId: userId })
    })
  } catch (error) {
    await db.update(users).set({ deletionError: error instanceof Error ? error.message.slice(0, 1000) : 'Account cleanup failed' }).where(eq(users.id, userId))
    throw error
  }
}

export async function resumeAccountDeletions(): Promise<void> {
  const pending = await db.select({ id: users.id }).from(users).where(isNotNull(users.deletionRequestedAt))
  for (const user of pending) {
    // One failure must not prevent other accounts from being cleaned up.
    await deleteAccountData(user.id).catch(() => undefined)
  }
}
