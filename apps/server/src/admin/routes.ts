import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { usernameSchema } from '@pulpo/contracts'
import { createPasswordHash, requireAdmin } from '../auth/service.js'
import { clearTwoFactor, hasTwoFactor, verifySecondFactor } from '../auth/two-factor.js'
import { db } from '../database/client.js'
import { apiKeys, applicationSettings, attachments, auditEvents, billingAccounts, creditLedger, managementTokens, passwordCredentials, passwordResetTokens, sessions, usageEvents, users, userTotpCredentials } from '../database/schema.js'
import { newUserStorageLimit, refreshStorageLimit } from '../billing/storage-entitlements.js'
import { hashToken, randomToken } from '../lib/crypto.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { sendTwoFactorResetNotice } from '../lib/mail.js'
import { publishStateChange } from '../responses/events.js'
import { parseAuthSettings } from '../settings/application-settings.js'
import { profileAvatarUrl } from '../profile/service.js'
import { insertNewAccountPreferences } from '../settings/new-account-defaults.js'
import {
  bumpAccountRevisions,
  friendPeerIds,
  publishScopedStateChanges,
} from '../friends/sync.js'
import { poolPeerIds } from '../pools/service.js'
import { apiKeyOwnerCanSpend } from '../api-keys/access.js'

const patchUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.email().optional(),
  password: z.string().min(8).max(1_000).optional(),
  role: z.enum(['pending', 'user', 'admin']).optional(),
  blocked: z.boolean().optional(),
  balanceMicros: z.number().int().nonnegative().optional(),
  storageLimitBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  username: usernameSchema.optional(),
  profileColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  inviteCodeQuota: z.number().int().nonnegative().max(1_000).optional(),
})

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/admin/users', async (request, reply) => {
    const admin = requireAdmin(request)
    const input = z.object({
      name: z.string().trim().min(1).max(120), username: usernameSchema, email: z.email(), password: z.string().min(8).max(1_000),
      role: z.enum(['pending', 'user', 'admin']).default('user'), balanceMicros: z.number().int().nonnegative().optional(),
      storageLimitBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    }).parse(request.body)
    const id = newId()
    await db.transaction(async (tx) => {
      const [setting] = await tx.select({ value: applicationSettings.value }).from(applicationSettings).where(eq(applicationSettings.key, 'auth')).limit(1)
      const authSettings = parseAuthSettings(setting?.value)
      const balanceMicros = input.balanceMicros ?? authSettings.defaultBalanceMicros
      const storageLimitBytes = input.storageLimitBytes ?? await newUserStorageLimit(tx)
      await tx.insert(users).values({ id, name: input.name, username: input.username, email: input.email, role: input.role, balanceMicros, storageLimitBytes })
      if (input.storageLimitBytes !== undefined) {
        await tx.insert(billingAccounts).values({ userId: id, storageLimitOverrideBytes: input.storageLimitBytes })
      }
      await tx.insert(passwordCredentials).values({ userId: id, passwordHash: await createPasswordHash(input.password) })
      await insertNewAccountPreferences(tx, id, authSettings)
      await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'user.create', targetType: 'user', targetId: id })
    })
    const [created] = await db.select().from(users).where(eq(users.id, id)).limit(1)
    reply.code(201)
    return created
  })

  app.get('/api/admin/users', async (request) => {
    requireAdmin(request)
    const rows = await db.select({
      user: users,
      calls: sql<number>`count(${usageEvents.id})::int`,
      spentMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
      lastActiveAt: sql<Date | null>`(
        select max(${sessions.lastSeenAt})
        from ${sessions}
        where ${sessions.userId} = ${users.id}
      )`,
      storageBytes: sql<number>`(
        select coalesce(sum(${attachments.sizeBytes}), 0)::bigint
        from ${attachments}
        where ${attachments.userId} = ${users.id}
          and ${attachments.status} in ('pending', 'ready')
      )`,
      twoFactorEnabled: sql<boolean>`exists (
        select 1 from ${userTotpCredentials}
        where ${userTotpCredentials.userId} = ${users.id}
      )`,
    }).from(users).leftJoin(usageEvents, eq(usageEvents.userId, users.id)).groupBy(users.id).orderBy(desc(users.createdAt))
    return { data: rows.map((row) => {
      const { avatarObjectKey: _avatarObjectKey, ...publicUser } = row.user
      return {
        ...row,
        user: { ...publicUser, avatarUrl: profileAvatarUrl(row.user) },
        calls: Number(row.calls), spentMicros: Number(row.spentMicros), storageBytes: Number(row.storageBytes),
      }
    }) }
  })

  app.patch('/api/admin/users/:id', async (request) => {
    const admin = requireAdmin(request)
    const { id } = request.params as { id: string }
    const patch = patchUserSchema.parse(request.body)
    if (id === admin.id && (patch.blocked || (patch.role && patch.role !== 'admin'))) {
      throw new AppError(409, 'cannot_demote_self', 'You cannot block or demote your own administrator account')
    }
    const friendVisibleChanged = [
      patch.name,
      patch.username,
      patch.profileColor,
      patch.blocked,
      patch.role,
      patch.balanceMicros,
    ].some((value) => value !== undefined)
    const relatedChanges = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(users).where(eq(users.id, id)).limit(1)
      if (!current) throw notFound('User')
      const balanceChanged = patch.balanceMicros !== undefined && patch.balanceMicros !== current.balanceMicros
      const { password, ...userPatch } = patch
      const [updated] = await tx.update(users).set({
        ...userPatch,
        stateRevision: sql`${users.stateRevision} + 1`,
        updatedAt: new Date(),
      }).where(eq(users.id, id)).returning()
      if (balanceChanged) {
        await tx.insert(creditLedger).values({
          id: newId(), userId: id, type: 'admin_adjustment',
          amountMicros: patch.balanceMicros! - current.balanceMicros,
          balanceAfterMicros: patch.balanceMicros!, metadata: { actorUserId: admin.id },
        })
      }
      if (patch.storageLimitBytes !== undefined) {
        await tx.insert(billingAccounts).values({ userId: id, storageLimitOverrideBytes: patch.storageLimitBytes })
          .onConflictDoUpdate({ target: billingAccounts.userId, set: { storageLimitOverrideBytes: patch.storageLimitBytes, updatedAt: new Date() } })
        await refreshStorageLimit(tx, id)
      }
      if (updated!.blocked) {
        await tx.delete(sessions).where(eq(sessions.userId, id))
        await tx.update(managementTokens).set({ revokedAt: new Date() }).where(and(eq(managementTokens.userId, id), isNull(managementTokens.revokedAt)))
      }
      if (!apiKeyOwnerCanSpend(updated!)) {
        await tx.update(apiKeys).set({ status: 'revoked', revokedAt: new Date() }).where(and(eq(apiKeys.userId, id), ne(apiKeys.status, 'revoked')))
      }
      if (password) {
        const passwordHash = await createPasswordHash(password)
        await tx.insert(passwordCredentials).values({ userId: id, passwordHash })
          .onConflictDoUpdate({ target: passwordCredentials.userId, set: { passwordHash } })
        await tx.delete(sessions).where(eq(sessions.userId, id))
      }
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'user.update', targetType: 'user', targetId: id,
        metadata: { ...userPatch, ...(password ? { passwordChanged: true } : {}) },
      })
      const friendChanges = friendVisibleChanged ? await bumpAccountRevisions(tx, await friendPeerIds(tx, id)) : []
      const poolChanges = balanceChanged ? await bumpAccountRevisions(tx, await poolPeerIds(tx, id)) : []
      return { friendChanges, poolChanges }
    })
    const [updated] = await db.select().from(users).where(eq(users.id, id)).limit(1)
    await publishStateChange({ userId: id, revision: updated!.stateRevision })
    await publishScopedStateChanges(relatedChanges.friendChanges, ['friends'])
    await publishScopedStateChanges(relatedChanges.poolChanges, ['pool', 'usage', 'billing'])
    return updated
  })

  app.post('/api/admin/users/:id/reset-link', async (request) => {
    const admin = requireAdmin(request)
    const { id } = request.params as { id: string }
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1)
    if (!target) throw notFound('User')
    const token = randomToken(32)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1_000)
    await db.insert(passwordResetTokens).values({ id: newId(), userId: id, tokenHash: hashToken(token), expiresAt })
    await db.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'password_reset.create', targetType: 'user', targetId: id })
    return { token, expiresAt: expiresAt.toISOString() }
  })

  app.post('/api/admin/users/:id/two-factor/reset', async (request, reply) => {
    const admin = requireAdmin(request)
    const { id } = request.params as { id: string }
    const input = z.object({
      verificationCode: z.string().trim().min(6).max(32).optional(),
    }).parse(request.body ?? {})
    if (id === admin.id) {
      throw new AppError(409, 'cannot_reset_own_two_factor', 'You cannot reset your own two-factor authentication')
    }
    const [target] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, id)).limit(1)
    if (!target) throw notFound('User')
    if (!(await hasTwoFactor(id))) {
      throw new AppError(409, 'two_factor_not_enabled', 'Two-factor authentication is not enabled for this account')
    }
    if (await hasTwoFactor(admin.id)) {
      if (!input.verificationCode) {
        throw new AppError(400, 'two_factor_code_required', 'Enter your authenticator or recovery code')
      }
      await verifySecondFactor(admin.id, input.verificationCode)
    }
    await db.transaction(async (tx) => {
      await clearTwoFactor(id, tx)
      await tx.delete(sessions).where(eq(sessions.userId, id))
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'user.two_factor.admin_reset', targetType: 'user', targetId: id,
      })
    })
    await sendTwoFactorResetNotice(target.email).catch(() => {
      request.log.error('Two-factor reset email delivery failed')
    })
    reply.code(204).send()
  })

  app.delete('/api/admin/users/:id', async (request, reply) => {
    const admin = requireAdmin(request)
    const { id } = request.params as { id: string }
    if (id === admin.id) throw new AppError(409, 'cannot_delete_self', 'You cannot delete your own account')
    const deleted = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id })
    if (!deleted.length) throw notFound('User')
    reply.code(204).send()
  })

  app.get('/api/admin/audit-events', async (request) => {
    requireAdmin(request)
    return { data: await db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(500) }
  })
}
