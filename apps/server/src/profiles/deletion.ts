import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { attachments, chats, chatShares, dataProfiles, queuedMessages, responses, users, workspaceLeases } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { maintenanceQueue } from '../jobs.js'
import { requestCancellation } from '../responses/events.js'
import { releaseBudget } from '../accounting/service.js'
import { workspaceControllerRequest } from '../agent/controller-http.js'
import { getBlobStore } from '../storage/index.js'
import { redis } from '../redis.js'
import { withProfile } from './context.js'

export async function acceptProfileDeletion(userId: string, profileId: string, name: unknown): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialize creation/default changes and concurrent deletions for this owner.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update')
    const rows = await tx.select().from(dataProfiles).where(and(eq(dataProfiles.userId, userId), isNull(dataProfiles.deletionRequestedAt))).orderBy(asc(dataProfiles.createdAt), asc(dataProfiles.id))
    const target = rows.find((row) => row.id === profileId)
    if (!target) throw new AppError(404, 'profile_unavailable', 'This profile is no longer available')
    if (rows.length === 1) throw new AppError(409, 'last_profile', 'Keep at least one profile')
    if (name !== target.name) throw new AppError(400, 'profile_name_required', 'Enter the profile name to confirm deletion')
    const now = new Date()
    await tx.update(dataProfiles).set({ isDefault: false, deletionRequestedAt: now, updatedAt: now }).where(eq(dataProfiles.id, profileId))
    if (target.isDefault) await tx.update(dataProfiles).set({ isDefault: true }).where(eq(dataProfiles.id, rows.find((row) => row.id !== profileId)!.id))
    await tx.update(chatShares).set({ revokedAt: now }).where(eq(chatShares.profileId, profileId))
    await tx.update(chats).set({ deletedAt: now, updatedAt: now }).where(eq(chats.profileId, profileId))
    await tx.delete(queuedMessages).where(eq(queuedMessages.profileId, profileId))
  })
  const active = await db.select({ id: responses.id }).from(responses).where(and(eq(responses.profileId, profileId), inArray(responses.status, ['queued', 'in_progress'])))
  await Promise.all(active.map((response) => requestCancellation(response.id).catch(() => undefined)))
  // Periodic cleanup also finds the durable marker if queue dispatch fails.
  await maintenanceQueue.add('delete-profile', { type: 'delete-profile', payload: { userId, profileId } }, {
    jobId: `delete-profile-${profileId}`, attempts: 20, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true,
  }).catch(() => undefined)
}

export async function deleteProfileData(profileId: string): Promise<void> {
  return withProfile(undefined, async () => {
    const [profile] = await db.select().from(dataProfiles).where(and(eq(dataProfiles.id, profileId), isNotNull(dataProfiles.deletionRequestedAt)))
    if (!profile) return
    try {
      const active = await db.select().from(responses).where(and(eq(responses.profileId, profileId), inArray(responses.status, ['queued', 'in_progress'])))
      for (const response of active) {
        await requestCancellation(response.id)
        if (response.status === 'queued') {
          const stopped = await db.update(responses).set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() }).where(and(eq(responses.id, response.id), eq(responses.status, 'queued'))).returning()
          if (stopped.length) await releaseBudget(response.id)
        }
      }
      const [running] = await db.select({ id: responses.id }).from(responses).where(and(eq(responses.profileId, profileId), inArray(responses.status, ['queued', 'in_progress'])))
      if (running) throw new Error('Waiting for running responses to stop')
      const leases = await db.select().from(workspaceLeases).where(eq(workspaceLeases.profileId, profileId))
      for (const lease of leases) if (lease.controllerLeaseId) {
        const result = await workspaceControllerRequest(`/v1/leases/${lease.controllerLeaseId}`, { method: 'DELETE', signal: AbortSignal.timeout(10_000) })
        if (!result.ok && result.status !== 404) throw new Error('Workspace cleanup failed')
      }
      if (Date.now() - profile.deletionRequestedAt!.getTime() < 16 * 60_000) throw new Error('Waiting for outstanding upload URLs to expire')
      const files = await db.select({ key: attachments.objectKey }).from(attachments).where(eq(attachments.profileId, profileId))
      for (const file of files) await getBlobStore().delete(file.key)
      const records = await db.select({ id: responses.id }).from(responses).where(eq(responses.profileId, profileId))
      for (const record of records) await redis.del(`pulpo:response:${record.id}:events`, `pulpo:response:${record.id}:cancel`)
      await db.transaction(async (tx) => {
        // Response children cascade; financial usage/ledger rows retain their
        // account ownership and their existing ON DELETE SET NULL behavior.
        for (const table of ['user_memory_document_revisions', 'user_memory_documents', 'chat_turn_embeddings', 'shelf_operations', 'shelved_drafts', 'composer_drafts', 'chat_import_sources', 'idempotency_records', 'workspace_leases', 'chat_shares', 'queued_messages', 'responses', 'attachments', 'chats', 'folders', 'user_preferences']) {
          await tx.execute(sql`delete from ${sql.identifier(table)} where profile_id = ${profileId}::uuid`)
        }
        await tx.delete(dataProfiles).where(eq(dataProfiles.id, profileId))
      })
    } catch (error) {
      await db.update(dataProfiles).set({ deletionError: error instanceof Error ? error.message.slice(0, 1000) : 'Cleanup failed' }).where(eq(dataProfiles.id, profileId))
      throw error
    }
  })
}

export async function resumeProfileDeletions(): Promise<void> {
  const rows = await db.select({ id: dataProfiles.id }).from(dataProfiles).where(isNotNull(dataProfiles.deletionRequestedAt))
  for (const row of rows) await deleteProfileData(row.id).catch(() => undefined)
}
