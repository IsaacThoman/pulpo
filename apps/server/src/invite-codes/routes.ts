import { and, desc, eq, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { FastifyInstance } from 'fastify'
import { createInviteCodesInputSchema, redeemInviteCodeInputSchema } from '@pulpo/contracts'
import { requireAdmin, requireUser, serializeUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { auditEvents, inviteCodes, users } from '../database/schema.js'
import { notFound, unauthorized } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { publishStateChange } from '../responses/events.js'
import {
  assertInviteCodesEnabled,
  createOwnedInviteCode,
  createPoolInviteCodes,
  redeemInviteCode,
  serializeAdminInviteCode,
  serializeInviteCode,
} from './service.js'

const ownerUsers = alias(users, 'invite_code_owners')
const redeemedUsers = alias(users, 'invite_code_redeemers')

export async function registerInviteCodeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/invite-codes/redeem', async (request) => {
    if (!request.user) throw unauthorized()
    await assertInviteCodesEnabled()
    const input = redeemInviteCodeInputSchema.parse(request.body)
    const updated = await redeemInviteCode(request.user.id, input.code)
    await publishStateChange({ userId: updated.id, revision: updated.stateRevision })
    return { user: serializeUser(updated) }
  })

  app.get('/api/invite-codes', async (request) => {
    const user = requireUser(request)
    await assertInviteCodesEnabled()
    const [owner, codes] = await Promise.all([
      db.select({ inviteCodeQuota: users.inviteCodeQuota }).from(users).where(eq(users.id, user.id)).limit(1),
      db.select().from(inviteCodes)
        .where(and(eq(inviteCodes.ownerUserId, user.id), isNull(inviteCodes.revokedAt)))
        .orderBy(desc(inviteCodes.createdAt)),
    ])
    const unused = codes.filter((code) => !code.redeemedByUserId)
    return {
      quota: owner[0]?.inviteCodeQuota ?? 0,
      used: codes.length,
      codes: unused.map(serializeInviteCode),
    }
  })

  app.post('/api/invite-codes', async (request, reply) => {
    const user = requireUser(request)
    await assertInviteCodesEnabled()
    const created = await createOwnedInviteCode(user.id)
    await db.insert(auditEvents).values({
      id: newId(), actorUserId: user.id, action: 'invite_code.create', targetType: 'invite_code', targetId: created.id,
    })
    reply.code(201)
    return serializeInviteCode(created)
  })

  app.delete('/api/invite-codes/:id', async (request, reply) => {
    const user = requireUser(request)
    await assertInviteCodesEnabled()
    const { id } = request.params as { id: string }
    const [updated] = await db.update(inviteCodes).set({ revokedAt: new Date() })
      .where(and(
        eq(inviteCodes.id, id),
        eq(inviteCodes.ownerUserId, user.id),
        isNull(inviteCodes.revokedAt),
        isNull(inviteCodes.redeemedByUserId),
      ))
      .returning({ id: inviteCodes.id })
    if (!updated) throw notFound('Invite code')
    await db.insert(auditEvents).values({
      id: newId(), actorUserId: user.id, action: 'invite_code.revoke', targetType: 'invite_code', targetId: id,
    })
    reply.code(204).send()
  })

  app.get('/api/admin/invite-codes', async (request) => {
    requireAdmin(request)
    const rows = await db.select({
      invite: inviteCodes,
      ownerUsername: ownerUsers.username,
      redeemedByUsername: redeemedUsers.username,
    }).from(inviteCodes)
      .leftJoin(ownerUsers, eq(inviteCodes.ownerUserId, ownerUsers.id))
      .leftJoin(redeemedUsers, eq(inviteCodes.redeemedByUserId, redeemedUsers.id))
      .orderBy(desc(inviteCodes.createdAt))
    return {
      data: rows.map((row) => serializeAdminInviteCode(row.invite, row.ownerUsername, row.redeemedByUsername)),
    }
  })

  app.post('/api/admin/invite-codes', async (request, reply) => {
    const admin = requireAdmin(request)
    const input = createInviteCodesInputSchema.parse(request.body ?? {})
    const created = await createPoolInviteCodes(admin.id, input.count)
    await db.insert(auditEvents).values(created.map((code) => ({
      id: newId(), actorUserId: admin.id, action: 'invite_code.create', targetType: 'invite_code', targetId: code.id,
    })))
    reply.code(201)
    return { data: created.map((code) => serializeAdminInviteCode(code, null, null)) }
  })

  app.delete('/api/admin/invite-codes/:id', async (request, reply) => {
    const admin = requireAdmin(request)
    const { id } = request.params as { id: string }
    const [updated] = await db.update(inviteCodes).set({ revokedAt: new Date() })
      .where(and(eq(inviteCodes.id, id), isNull(inviteCodes.revokedAt), isNull(inviteCodes.redeemedByUserId)))
      .returning({ id: inviteCodes.id })
    if (!updated) throw notFound('Invite code')
    await db.insert(auditEvents).values({
      id: newId(), actorUserId: admin.id, action: 'invite_code.revoke', targetType: 'invite_code', targetId: id,
    })
    reply.code(204).send()
  })
}
