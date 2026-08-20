import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { friendships, poolInvitations, poolMembers, pools, users } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { publicFriendProfile } from '../profile/service.js'
import { activePoolMembers, activePoolMembership, pendingFundingByUser, publishPoolChanges } from './service.js'

const disclosureSchema = z.object({ userId: z.uuid(), balanceDisclosureAccepted: z.literal(true) })

async function lockPool(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], poolId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pool:${poolId}`}))`)
}

async function acceptedFriends(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], left: string, right: string) {
  const [a, b] = left < right ? [left, right] : [right, left]
  const [row] = await tx.select({ id: friendships.id }).from(friendships).where(and(
    eq(friendships.userAId, a), eq(friendships.userBId, b), eq(friendships.status, 'accepted'),
  )).limit(1)
  return Boolean(row)
}

export async function registerPoolRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pools/me', async (request) => {
    const user = requireUser(request)
    const membership = await db.transaction((tx) => activePoolMembership(tx, user.id))
    const incoming = await db.select().from(poolInvitations).where(and(
      eq(poolInvitations.inviteeUserId, user.id), eq(poolInvitations.status, 'pending'),
    ))
    const outgoing = membership ? await db.select().from(poolInvitations).where(and(
      eq(poolInvitations.poolId, membership.pool.id), eq(poolInvitations.status, 'pending'),
    )) : []
    const allInvitations = [...incoming, ...outgoing]
    const profileIds = [...new Set(allInvitations.flatMap((row) => [row.inviterUserId, row.inviteeUserId]))]
    const profiles = profileIds.length ? await db.select().from(users).where(inArray(users.id, profileIds)) : []
    const byId = new Map(profiles.map((row) => [row.id, row]))
    const memberCounts = new Map<string, number>()
    for (const poolId of new Set(allInvitations.map((row) => row.poolId))) {
      const [count] = await db.select({ value: sql<number>`count(*)::int` }).from(poolMembers)
        .where(and(eq(poolMembers.poolId, poolId), isNull(poolMembers.leftAt)))
      memberCounts.set(poolId, Number(count?.value ?? 0))
    }
    const invitation = (row: typeof poolInvitations.$inferSelect) => ({
      id: row.id, poolId: row.poolId,
      inviter: publicFriendProfile(byId.get(row.inviterUserId)!),
      invitee: publicFriendProfile(byId.get(row.inviteeUserId)!),
      memberCount: memberCounts.get(row.poolId) ?? 1,
      createdAt: row.createdAt.toISOString(),
    })
    if (!membership) return { accountBalanceMicros: user.balanceMicros, pool: null, incomingInvitations: incoming.map(invitation) }
    const members = await db.transaction((tx) => activePoolMembers(tx, membership.pool.id))
    const reserved = await db.transaction((tx) => pendingFundingByUser(tx, members.map((row) => row.user.id)))
    return {
      accountBalanceMicros: user.balanceMicros,
      pool: {
        id: membership.pool.id,
        ownerUserId: membership.pool.ownerUserId,
        pooledBalanceMicros: members.reduce((sum, row) => sum + row.user.balanceMicros, 0),
        members: members.map((row) => ({
          profile: publicFriendProfile(row.user), contributionBalanceMicros: row.user.balanceMicros,
          reservedMicros: reserved.get(row.user.id) ?? 0, joinedAt: row.member.joinedAt.toISOString(),
          owner: row.user.id === membership.pool.ownerUserId,
        })),
        pendingInvitations: outgoing.map(invitation),
      },
      incomingInvitations: [],
    }
  })

  app.post('/api/pools/invitations', async (request, reply) => {
    const user = requireUser(request)
    const input = disclosureSchema.parse(request.body)
    if (input.userId === user.id) throw new AppError(409, 'cannot_invite_self', 'You cannot invite yourself')
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pool-user:${user.id}`}))`)
      if (!await acceptedFriends(tx, user.id, input.userId)) throw new AppError(409, 'pool_invitee_not_friend', 'Only accepted friends can be invited')
      if (await activePoolMembership(tx, input.userId)) throw new AppError(409, 'pool_invitee_already_member', 'This friend is already in a Pool')
      let membership = await activePoolMembership(tx, user.id)
      if (!membership) {
        const poolId = newId()
        const [pool] = await tx.insert(pools).values({ id: poolId, ownerUserId: user.id }).returning()
        await tx.insert(poolMembers).values({ id: newId(), poolId, userId: user.id })
        membership = { pool: pool!, member: { id: '', poolId, userId: user.id, joinedAt: new Date(), leftAt: null } }
      }
      await lockPool(tx, membership.pool.id)
      if (membership.pool.ownerUserId !== user.id) throw new AppError(403, 'pool_owner_required', 'Only the Pool owner can invite members')
      const [[memberCount], [inviteCount]] = await Promise.all([
        tx.select({ value: sql<number>`count(*)::int` }).from(poolMembers).where(and(eq(poolMembers.poolId, membership.pool.id), isNull(poolMembers.leftAt))),
        tx.select({ value: sql<number>`count(*)::int` }).from(poolInvitations).where(and(eq(poolInvitations.poolId, membership.pool.id), eq(poolInvitations.status, 'pending'))),
      ])
      if (Number(memberCount?.value ?? 0) + Number(inviteCount?.value ?? 0) >= 6) throw new AppError(409, 'pool_full', 'This Pool already has six members or reserved seats')
      const [created] = await tx.insert(poolInvitations).values({
        id: newId(), poolId: membership.pool.id, inviterUserId: user.id, inviteeUserId: input.userId,
        inviterDisclosureAcceptedAt: new Date(),
      }).returning()
      return { created: created!, affected: [user.id, input.userId] }
    })
    await publishPoolChanges(result.affected)
    reply.code(201)
    return { id: result.created.id }
  })

  app.post('/api/pools/invitations/:id/accept', async (request) => {
    const user = requireUser(request)
    z.object({ balanceDisclosureAccepted: z.literal(true) }).parse(request.body)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const affected = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pool-user:${user.id}`}))`)
      const [invite] = await tx.select().from(poolInvitations).where(and(eq(poolInvitations.id, id), eq(poolInvitations.inviteeUserId, user.id), eq(poolInvitations.status, 'pending'))).limit(1)
      if (!invite) throw notFound('Pool invitation')
      await lockPool(tx, invite.poolId)
      if (await activePoolMembership(tx, user.id)) throw new AppError(409, 'pool_membership_exists', 'Leave your current Pool before joining another')
      const [pool] = await tx.select().from(pools).where(and(eq(pools.id, invite.poolId), isNull(pools.closedAt))).limit(1)
      if (!pool || !await acceptedFriends(tx, pool.ownerUserId, user.id)) throw new AppError(409, 'pool_invitation_invalid', 'You must still be friends with the Pool owner')
      const [count] = await tx.select({ value: sql<number>`count(*)::int` }).from(poolMembers).where(and(eq(poolMembers.poolId, pool.id), isNull(poolMembers.leftAt)))
      if (Number(count?.value ?? 0) >= 6) throw new AppError(409, 'pool_full', 'This Pool is full')
      await tx.insert(poolMembers).values({ id: newId(), poolId: pool.id, userId: user.id })
      await tx.update(poolInvitations).set({ status: 'accepted', inviteeDisclosureAcceptedAt: new Date(), respondedAt: new Date(), updatedAt: new Date() }).where(eq(poolInvitations.id, id))
      const canceled = await tx.update(poolInvitations).set({ status: 'declined', respondedAt: new Date(), updatedAt: new Date() }).where(and(eq(poolInvitations.inviteeUserId, user.id), eq(poolInvitations.status, 'pending'), ne(poolInvitations.id, id))).returning({ inviterUserId: poolInvitations.inviterUserId })
      return [...new Set((await activePoolMembers(tx, pool.id)).map((row) => row.user.id).concat(canceled.map((row) => row.inviterUserId)))]
    })
    await publishPoolChanges(affected)
    return { status: 'accepted' }
  })

  app.post('/api/pools/invitations/:id/decline', async (request, reply) => {
    const user = requireUser(request)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const rows = await db.update(poolInvitations).set({ status: 'declined', respondedAt: new Date(), updatedAt: new Date() }).where(and(eq(poolInvitations.id, id), eq(poolInvitations.inviteeUserId, user.id), eq(poolInvitations.status, 'pending'))).returning()
    if (!rows.length) throw notFound('Pool invitation')
    await publishPoolChanges([user.id, rows[0]!.inviterUserId])
    reply.code(204).send()
  })

  app.delete('/api/pools/invitations/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const [invite] = await db.select().from(poolInvitations).where(and(eq(poolInvitations.id, id), eq(poolInvitations.status, 'pending'))).limit(1)
    if (!invite) throw notFound('Pool invitation')
    const membership = await db.transaction((tx) => activePoolMembership(tx, user.id))
    if (!membership || membership.pool.id !== invite.poolId || membership.pool.ownerUserId !== user.id) throw new AppError(403, 'pool_owner_required', 'Only the Pool owner can cancel invitations')
    await db.update(poolInvitations).set({ status: 'canceled', respondedAt: new Date(), updatedAt: new Date() }).where(eq(poolInvitations.id, id))
    await publishPoolChanges([user.id, invite.inviteeUserId])
    reply.code(204).send()
  })

  app.patch('/api/pools/owner', async (request) => {
    const user = requireUser(request)
    const { userId } = z.object({ userId: z.uuid() }).parse(request.body)
    const affected = await db.transaction(async (tx) => {
      const membership = await activePoolMembership(tx, user.id)
      if (!membership || membership.pool.ownerUserId !== user.id) throw new AppError(403, 'pool_owner_required', 'Only the Pool owner can transfer ownership')
      await lockPool(tx, membership.pool.id)
      const target = await activePoolMembership(tx, userId)
      if (!target || target.pool.id !== membership.pool.id) throw notFound('Pool member')
      await tx.update(pools).set({ ownerUserId: userId, updatedAt: new Date() }).where(eq(pools.id, membership.pool.id))
      return (await activePoolMembers(tx, membership.pool.id)).map((row) => row.user.id)
    })
    await publishPoolChanges(affected)
    return { ownerUserId: userId }
  })

  app.delete('/api/pools/members/:userId', async (request, reply) => {
    const user = requireUser(request)
    const { userId } = z.object({ userId: z.uuid() }).parse(request.params)
    const transferToUserId = z.object({ transferToUserId: z.uuid().optional() }).parse(request.query).transferToUserId
    const affected = await db.transaction(async (tx) => {
      const membership = await activePoolMembership(tx, user.id)
      if (!membership) throw notFound('Pool')
      await lockPool(tx, membership.pool.id)
      if (userId !== user.id && membership.pool.ownerUserId !== user.id) throw new AppError(403, 'pool_owner_required', 'Only the Pool owner can remove members')
      const target = await activePoolMembership(tx, userId)
      if (!target || target.pool.id !== membership.pool.id) throw notFound('Pool member')
      const before = await activePoolMembers(tx, membership.pool.id)
      if (membership.pool.ownerUserId === userId) {
        if (before.length > 1) {
          if (!transferToUserId || transferToUserId === userId || !before.some((row) => row.user.id === transferToUserId)) throw new AppError(409, 'pool_owner_transfer_required', 'Choose another member to own the Pool before leaving')
          await tx.update(pools).set({ ownerUserId: transferToUserId, updatedAt: new Date() }).where(eq(pools.id, membership.pool.id))
        } else {
          await tx.update(pools).set({ closedAt: new Date(), updatedAt: new Date() }).where(eq(pools.id, membership.pool.id))
          await tx.update(poolInvitations).set({ status: 'canceled', respondedAt: new Date(), updatedAt: new Date() }).where(and(eq(poolInvitations.poolId, membership.pool.id), eq(poolInvitations.status, 'pending')))
        }
      }
      await tx.update(poolMembers).set({ leftAt: new Date() }).where(and(eq(poolMembers.poolId, membership.pool.id), eq(poolMembers.userId, userId), isNull(poolMembers.leftAt)))
      return before.map((row) => row.user.id)
    })
    await publishPoolChanges(affected)
    reply.code(204).send()
  })
}
