import { and, eq, gt, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm'
import { db } from '../database/client.js'
import { budgetReservationFunders, budgetReservations, poolInvitations, poolMembers, pools, users } from '../database/schema.js'
import { bumpAccountRevisions, publishScopedStateChanges } from '../friends/sync.js'

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export const POOL_INVITATION_TTL_MS = 7 * 86_400_000

export function poolInvitationExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + POOL_INVITATION_TTL_MS)
}

/** Pending invitations that have not yet passed their expiry; stale rows are swept to 'expired' by cleanup. */
export function openPoolInvitation(now = new Date()): SQL {
  return and(eq(poolInvitations.status, 'pending'), gt(poolInvitations.createdAt, new Date(now.getTime() - POOL_INVITATION_TTL_MS)))!
}

export async function expirePoolInvitations(tx: Transaction, now = new Date(), scope?: SQL) {
  return tx.update(poolInvitations).set({ status: 'expired', respondedAt: now, updatedAt: now }).where(and(
    eq(poolInvitations.status, 'pending'), lte(poolInvitations.createdAt, new Date(now.getTime() - POOL_INVITATION_TTL_MS)), scope,
  )).returning({ poolId: poolInvitations.poolId, inviterUserId: poolInvitations.inviterUserId, inviteeUserId: poolInvitations.inviteeUserId })
}

export async function sweepExpiredPoolInvitations(now = new Date()): Promise<void> {
  const affected = await db.transaction(async (tx) => {
    const expired = await expirePoolInvitations(tx, now)
    const dissolved: string[] = []
    for (const poolId of new Set(expired.map((row) => row.poolId))) dissolved.push(...await dissolveSingletonPool(tx, poolId, { keepWhileInvited: true }))
    return [...new Set(expired.flatMap((row) => [row.inviterUserId, row.inviteeUserId]).concat(dissolved))]
  })
  if (affected.length) await publishPoolChanges(affected)
}

export async function activePoolMembership(tx: Transaction, userId: string) {
  const [row] = await tx.select({ member: poolMembers, pool: pools }).from(poolMembers)
    .innerJoin(pools, eq(pools.id, poolMembers.poolId))
    .where(and(eq(poolMembers.userId, userId), isNull(poolMembers.leftAt), isNull(pools.closedAt))).limit(1)
  return row ?? null
}

export async function activePoolMembers(tx: Transaction, poolId: string) {
  return tx.select({ member: poolMembers, user: users }).from(poolMembers)
    .innerJoin(users, eq(users.id, poolMembers.userId))
    .where(and(eq(poolMembers.poolId, poolId), isNull(poolMembers.leftAt)))
}

export async function poolBalanceMicros(tx: Transaction, poolId: string): Promise<number> {
  const [row] = await tx.select({ total: sql<number>`coalesce(sum(${users.balanceMicros}), 0)::bigint` })
    .from(poolMembers).innerJoin(users, eq(users.id, poolMembers.userId))
    .where(and(eq(poolMembers.poolId, poolId), isNull(poolMembers.leftAt)))
  return Number(row?.total ?? 0)
}

export async function poolPeerIds(tx: Transaction, userId: string): Promise<string[]> {
  const membership = await activePoolMembership(tx, userId)
  if (!membership) return []
  return (await activePoolMembers(tx, membership.pool.id)).map((row) => row.user.id).filter((id) => id !== userId)
}

export async function dissolveSingletonPool(tx: Transaction, poolId: string, options: { keepWhileInvited?: boolean } = {}): Promise<string[]> {
  const members = await activePoolMembers(tx, poolId)
  if (members.length > 1) return []
  const pending = await tx.select().from(poolInvitations).where(and(eq(poolInvitations.poolId, poolId), eq(poolInvitations.status, 'pending')))
  if (options.keepWhileInvited && pending.some((row) => row.createdAt.getTime() + POOL_INVITATION_TTL_MS > Date.now())) return []
  const now = new Date()
  await tx.update(pools).set({ closedAt: now, updatedAt: now }).where(and(eq(pools.id, poolId), isNull(pools.closedAt)))
  await tx.update(poolMembers).set({ leftAt: now }).where(and(eq(poolMembers.poolId, poolId), isNull(poolMembers.leftAt)))
  await tx.update(poolInvitations).set({ status: 'canceled', respondedAt: now, updatedAt: now }).where(and(eq(poolInvitations.poolId, poolId), eq(poolInvitations.status, 'pending')))
  return [...new Set(members.map((row) => row.user.id).concat(pending.map((row) => row.inviteeUserId)))]
}

export async function pendingFundingByUser(tx: Transaction, userIds: string[]): Promise<Map<string, number>> {
  if (!userIds.length) return new Map()
  const rows = await tx.select({
    userId: budgetReservationFunders.userId,
    total: sql<number>`coalesce(sum(${budgetReservationFunders.reservedMicros}), 0)::bigint`,
  }).from(budgetReservationFunders)
    .innerJoin(budgetReservations, eq(budgetReservations.id, budgetReservationFunders.reservationId))
    .where(and(inArray(budgetReservationFunders.userId, userIds), eq(budgetReservations.status, 'pending')))
    .groupBy(budgetReservationFunders.userId)
  return new Map(rows.map((row) => [row.userId, Number(row.total)]))
}

export async function publishPoolChanges(userIds: string[]): Promise<void> {
  const changes = await db.transaction((tx) => bumpAccountRevisions(tx, userIds))
  await publishScopedStateChanges(changes, ['pool', 'usage', 'billing'])
}

export async function separatePoolOnBlock(tx: Transaction, blockerUserId: string, blockedUserId: string): Promise<string[]> {
  const [blockerMembership, blockedMembership] = await Promise.all([
    activePoolMembership(tx, blockerUserId), activePoolMembership(tx, blockedUserId),
  ])
  if (!blockerMembership || blockerMembership.pool.id !== blockedMembership?.pool.id) return []
  const pool = blockerMembership.pool
  const leavingUserId = pool.ownerUserId === blockerUserId ? blockedUserId : blockerUserId
  await tx.update(poolMembers).set({ leftAt: new Date() }).where(and(
    eq(poolMembers.poolId, pool.id), eq(poolMembers.userId, leavingUserId), isNull(poolMembers.leftAt),
  ))
  const dissolved = await dissolveSingletonPool(tx, pool.id)
  return [...new Set((await activePoolMembers(tx, pool.id)).map((row) => row.user.id).concat(leavingUserId, dissolved))]
}
