import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { usernameSchema } from '@pulpo/contracts'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { friendships, userBlocks, users } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { publicFriendProfile } from '../profile/service.js'

export function orderedPair(left: string, right: string): [string, string] {
  return left < right ? [left, right] : [right, left]
}

export function friendRequestAction(
  existing: Pick<typeof friendships.$inferSelect, 'status' | 'requestedByUserId'> | undefined,
  requesterUserId: string,
): 'create' | 'keep' | 'accept' {
  if (!existing) return 'create'
  if (existing.status === 'accepted' || existing.requestedByUserId === requesterUserId) return 'keep'
  return 'accept'
}

function pairWhere(left: string, right: string) {
  const [userAId, userBId] = orderedPair(left, right)
  return and(eq(friendships.userAId, userAId), eq(friendships.userBId, userBId))
}

async function blockedBetween(left: string, right: string): Promise<boolean> {
  const [row] = await db.select({ blocker: userBlocks.blockerUserId }).from(userBlocks).where(or(
    and(eq(userBlocks.blockerUserId, left), eq(userBlocks.blockedUserId, right)),
    and(eq(userBlocks.blockerUserId, right), eq(userBlocks.blockedUserId, left)),
  )).limit(1)
  return Boolean(row)
}

async function requireAvailableTarget(id: string, currentUserId: string) {
  if (id === currentUserId) throw new AppError(409, 'cannot_friend_self', 'You cannot add yourself as a friend')
  const [target] = await db.select().from(users).where(and(
    eq(users.id, id), eq(users.blocked, false), ne(users.role, 'pending'),
  )).limit(1)
  if (!target || await blockedBetween(currentUserId, id)) throw notFound('User')
  return target
}

export async function friendUserIds(userId: string): Promise<string[]> {
  const [rows, blocks] = await Promise.all([
    db.select({ userAId: friendships.userAId, userBId: friendships.userBId })
      .from(friendships).where(and(
        eq(friendships.status, 'accepted'),
        or(eq(friendships.userAId, userId), eq(friendships.userBId, userId)),
      )),
    db.select({ blockerUserId: userBlocks.blockerUserId, blockedUserId: userBlocks.blockedUserId })
      .from(userBlocks).where(or(eq(userBlocks.blockerUserId, userId), eq(userBlocks.blockedUserId, userId))),
  ])
  const blockedIds = new Set(blocks.map((row) => row.blockerUserId === userId ? row.blockedUserId : row.blockerUserId))
  return [userId, ...rows
    .map((row) => row.userAId === userId ? row.userBId : row.userAId)
    .filter((id) => !blockedIds.has(id))]
}

export async function registerFriendRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/friends', async (request) => {
    const user = requireUser(request)
    const [connectionRows, allBlockRows] = await Promise.all([
      db.select().from(friendships).where(or(eq(friendships.userAId, user.id), eq(friendships.userBId, user.id))),
      db.select().from(userBlocks).where(or(eq(userBlocks.blockerUserId, user.id), eq(userBlocks.blockedUserId, user.id))),
    ])
    const blockRows = allBlockRows.filter((row) => row.blockerUserId === user.id)
    const blockedIds = new Set(allBlockRows.map((row) => row.blockerUserId === user.id ? row.blockedUserId : row.blockerUserId))
    const profileIds = [...new Set([
      ...connectionRows.map((row) => row.userAId === user.id ? row.userBId : row.userAId),
      ...blockRows.map((row) => row.blockedUserId),
    ])]
    const profiles = profileIds.length
      ? await db.select().from(users).where(inArray(users.id, profileIds))
      : []
    const byId = new Map(profiles.map((profile) => [profile.id, profile]))
    const connection = (row: typeof friendships.$inferSelect) => {
      const otherId = row.userAId === user.id ? row.userBId : row.userAId
      const profile = byId.get(otherId)
      return profile ? {
        requestId: row.id,
        profile: publicFriendProfile(profile),
        requestedAt: row.createdAt.toISOString(),
        acceptedAt: row.acceptedAt?.toISOString() ?? null,
      } : null
    }
    const visibleConnections = connectionRows.filter((row) => {
      const otherId = row.userAId === user.id ? row.userBId : row.userAId
      const profile = byId.get(otherId)
      return !blockedIds.has(otherId) && profile?.blocked === false && profile.role !== 'pending'
    })
    return {
      friends: visibleConnections.filter((row) => row.status === 'accepted').map(connection).filter(Boolean),
      incoming: visibleConnections.filter((row) => row.status === 'pending' && row.requestedByUserId !== user.id).map(connection).filter(Boolean),
      outgoing: visibleConnections.filter((row) => row.status === 'pending' && row.requestedByUserId === user.id).map(connection).filter(Boolean),
      blocked: blockRows.map((row) => byId.get(row.blockedUserId)).filter(Boolean).map((profile) => publicFriendProfile(profile!)),
    }
  })

  app.get('/api/friends/pending-count', async (request) => {
    const user = requireUser(request)
    const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(friendships).where(and(
      eq(friendships.status, 'pending'), ne(friendships.requestedByUserId, user.id),
      or(eq(friendships.userAId, user.id), eq(friendships.userBId, user.id)),
      sql`exists (
        select 1 from ${users}
        where ${users.id} = case when ${friendships.userAId} = ${user.id} then ${friendships.userBId} else ${friendships.userAId} end
          and ${users.blocked} = false and ${users.role} <> 'pending'
      )`,
      sql`not exists (
        select 1 from ${userBlocks}
        where (${userBlocks.blockerUserId} = ${user.id}
            and ${userBlocks.blockedUserId} = case when ${friendships.userAId} = ${user.id} then ${friendships.userBId} else ${friendships.userAId} end)
          or (${userBlocks.blockedUserId} = ${user.id}
            and ${userBlocks.blockerUserId} = case when ${friendships.userAId} = ${user.id} then ${friendships.userBId} else ${friendships.userAId} end)
      )`,
    ))
    return { count: Number(result?.count ?? 0) }
  })

  app.get('/api/friends/search', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const user = requireUser(request)
    const raw = z.object({ username: z.string().trim().min(1).max(31) }).parse(request.query).username.replace(/^@/, '')
    const username = usernameSchema.parse(raw)
    const [target] = await db.select().from(users).where(and(
      sql`lower(${users.username}) = ${username}`, eq(users.blocked, false), ne(users.role, 'pending'),
    )).limit(1)
    if (!target || (target.id !== user.id && await blockedBetween(user.id, target.id))) throw notFound('User')
    if (target.id === user.id) return { profile: publicFriendProfile(target), relationship: 'self', requestId: null }
    const [relationship] = await db.select().from(friendships).where(pairWhere(user.id, target.id)).limit(1)
    return {
      profile: publicFriendProfile(target),
      relationship: relationship?.status === 'accepted' ? 'friends'
        : relationship?.requestedByUserId === user.id ? 'outgoing'
          : relationship ? 'incoming' : 'none',
      requestId: relationship?.id ?? null,
    }
  })

  app.post('/api/friends/requests', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = requireUser(request)
    const { userId } = z.object({ userId: z.uuid() }).parse(request.body)
    await requireAvailableTarget(userId, user.id)
    const [userAId, userBId] = orderedPair(user.id, userId)
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${userAId}:${userBId}`}))`)
      const [block] = await tx.select({ blocker: userBlocks.blockerUserId }).from(userBlocks).where(or(
        and(eq(userBlocks.blockerUserId, user.id), eq(userBlocks.blockedUserId, userId)),
        and(eq(userBlocks.blockerUserId, userId), eq(userBlocks.blockedUserId, user.id)),
      )).limit(1)
      if (block) throw notFound('User')
      const [existing] = await tx.select().from(friendships).where(and(
        eq(friendships.userAId, userAId), eq(friendships.userBId, userBId),
      )).limit(1)
      const action = friendRequestAction(existing, user.id)
      if (action === 'keep') return existing!
      if (action === 'accept') {
        const [accepted] = await tx.update(friendships).set({ status: 'accepted', acceptedAt: new Date(), updatedAt: new Date() })
          .where(eq(friendships.id, existing!.id)).returning()
        return accepted!
      }
      const [created] = await tx.insert(friendships).values({
        id: newId(), userAId, userBId, requestedByUserId: user.id,
      }).returning()
      return created!
    })
    reply.code(result.status === 'accepted' ? 200 : 201)
    return { requestId: result.id, status: result.status }
  })

  app.post('/api/friends/requests/:id/accept', async (request) => {
    const user = requireUser(request)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const [row] = await db.select().from(friendships).where(eq(friendships.id, id)).limit(1)
    if (!row || (row.userAId !== user.id && row.userBId !== user.id)) throw notFound('Friend request')
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${row.userAId}:${row.userBId}`}))`)
      const [current] = await tx.select().from(friendships).where(eq(friendships.id, id)).limit(1)
      if (!current || (current.userAId !== user.id && current.userBId !== user.id)) throw notFound('Friend request')
      if (current.status === 'accepted') return
      if (current.requestedByUserId === user.id) throw new AppError(409, 'cannot_accept_own_request', 'The recipient must accept this request')
      const [block] = await tx.select({ blocker: userBlocks.blockerUserId }).from(userBlocks).where(or(
        and(eq(userBlocks.blockerUserId, current.userAId), eq(userBlocks.blockedUserId, current.userBId)),
        and(eq(userBlocks.blockerUserId, current.userBId), eq(userBlocks.blockedUserId, current.userAId)),
      )).limit(1)
      if (block) throw notFound('Friend request')
      await tx.update(friendships).set({ status: 'accepted', acceptedAt: new Date(), updatedAt: new Date() }).where(eq(friendships.id, id))
    })
    return { status: 'accepted' }
  })

  app.delete('/api/friends/requests/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const [row] = await db.select().from(friendships).where(eq(friendships.id, id)).limit(1)
    if (!row || (row.userAId !== user.id && row.userBId !== user.id)) throw notFound('Friend request')
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${row.userAId}:${row.userBId}`}))`)
      const deleted = await tx.delete(friendships).where(and(
        eq(friendships.id, id), eq(friendships.status, 'pending'),
        or(eq(friendships.userAId, user.id), eq(friendships.userBId, user.id)),
      )).returning({ id: friendships.id })
      if (!deleted.length) throw notFound('Friend request')
    })
    reply.code(204).send()
  })

  app.delete('/api/friends/:userId', async (request, reply) => {
    const user = requireUser(request)
    const { userId } = z.object({ userId: z.uuid() }).parse(request.params)
    const [userAId, userBId] = orderedPair(user.id, userId)
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${userAId}:${userBId}`}))`)
      const deleted = await tx.delete(friendships).where(and(pairWhere(user.id, userId), eq(friendships.status, 'accepted'))).returning({ id: friendships.id })
      if (!deleted.length) throw notFound('Friendship')
    })
    reply.code(204).send()
  })

  app.post('/api/friends/blocks', async (request, reply) => {
    const user = requireUser(request)
    const { userId } = z.object({ userId: z.uuid() }).parse(request.body)
    if (userId === user.id) throw new AppError(409, 'cannot_block_self', 'You cannot block yourself')
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
    if (!target) throw notFound('User')
    const [userAId, userBId] = orderedPair(user.id, userId)
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${userAId}:${userBId}`}))`)
      await tx.delete(friendships).where(pairWhere(user.id, userId))
      await tx.insert(userBlocks).values({ blockerUserId: user.id, blockedUserId: userId }).onConflictDoNothing()
    })
    reply.code(204).send()
  })

  app.delete('/api/friends/blocks/:userId', async (request, reply) => {
    const user = requireUser(request)
    const { userId } = z.object({ userId: z.uuid() }).parse(request.params)
    const [userAId, userBId] = orderedPair(user.id, userId)
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${userAId}:${userBId}`}))`)
      await tx.delete(userBlocks).where(and(eq(userBlocks.blockerUserId, user.id), eq(userBlocks.blockedUserId, userId)))
    })
    reply.code(204).send()
  })
}
