import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { budgetReservationFunders, budgetReservations, poolMembers, pools, users } from '../database/schema.js'
import { bumpAccountRevisions, publishScopedStateChanges } from '../friends/sync.js'

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

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
  return (await activePoolMembers(tx, pool.id)).map((row) => row.user.id).concat(leavingUserId)
}
