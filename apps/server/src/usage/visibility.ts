import { and, eq, inArray, or } from 'drizzle-orm'
import type { UsageVisibility } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { friendships, users } from '../database/schema.js'
import { activePoolMembership, poolPeerIds } from '../pools/service.js'

export interface UsageViewerRelation {
  self: boolean
  /** An accepted friendship between the viewer and the profile owner. */
  friends: boolean
  /** Both are active members of the same Pool. */
  sharesPool: boolean
}

/** Levels nest: public ⊇ friends ⊇ pool. Owners and Pool members can always see usage. */
export function canViewUsage(visibility: UsageVisibility, viewer: UsageViewerRelation): boolean {
  if (viewer.self || viewer.sharesPool || visibility === 'public') return true
  return visibility === 'friends' && viewer.friends
}

async function acceptedFriends(left: string, right: string): Promise<boolean> {
  const [row] = await db.select({ id: friendships.id }).from(friendships).where(and(
    eq(friendships.status, 'accepted'),
    or(
      and(eq(friendships.userAId, left), eq(friendships.userBId, right)),
      and(eq(friendships.userAId, right), eq(friendships.userBId, left)),
    ),
  )).limit(1)
  return Boolean(row)
}

async function sharesActivePool(left: string, right: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const leftMembership = await activePoolMembership(tx, left)
    if (!leftMembership) return false
    return (await activePoolMembership(tx, right))?.pool.id === leftMembership.pool.id
  })
}

/**
 * Whether the viewer may see the target's usage. Callers resolve the target with the
 * profile lookup rules first, so blocked or pending accounts never reach this check.
 */
export async function usageAccess(
  viewerId: string,
  target: Pick<typeof users.$inferSelect, 'id' | 'usageVisibility'>,
  known: { friends?: boolean } = {},
): Promise<boolean> {
  // Cheapest checks first: self and public need no lookups, and friendship only matters at 'friends'.
  const relation: UsageViewerRelation = { self: target.id === viewerId, friends: false, sharesPool: false }
  if (canViewUsage(target.usageVisibility, relation)) return true
  if (target.usageVisibility === 'friends') {
    relation.friends = known.friends ?? await acceptedFriends(viewerId, target.id)
    if (canViewUsage(target.usageVisibility, relation)) return true
  }
  relation.sharesPool = await sharesActivePool(viewerId, target.id)
  return canViewUsage(target.usageVisibility, relation)
}

/** Drops friends whose usage is limited to their Pool unless they share the viewer's Pool. */
export async function visibleFriendUsageCircle(viewerId: string, friendIds: string[]): Promise<string[]> {
  const others = friendIds.filter((id) => id !== viewerId)
  if (!others.length) return friendIds
  const poolOnly = await db.select({ id: users.id, usageVisibility: users.usageVisibility }).from(users)
    .where(and(inArray(users.id, others), eq(users.usageVisibility, 'pool')))
  if (!poolOnly.length) return friendIds
  const peers = new Set(await db.transaction((tx) => poolPeerIds(tx, viewerId)))
  const hidden = new Set(poolOnly
    .filter((row) => !canViewUsage(row.usageVisibility, { self: false, friends: true, sharesPool: peers.has(row.id) }))
    .map((row) => row.id))
  return friendIds.filter((id) => !hidden.has(id))
}
