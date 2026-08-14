import { and, eq, inArray, or, sql } from 'drizzle-orm'
import type { StateInvalidationScope } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { friendships, users } from '../database/schema.js'
import { publishStateChange } from '../responses/events.js'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface AccountRevisionChange {
  userId: string
  revision: number
}

export function friendPeerIdsFromRows(
  rows: Array<{ userAId: string; userBId: string }>,
  userId: string,
): string[] {
  return [...new Set(rows.map((row) => row.userAId === userId ? row.userBId : row.userAId))]
}

export async function friendPeerIds(
  transaction: DatabaseTransaction,
  userId: string,
  options: { acceptedOnly?: boolean } = {},
): Promise<string[]> {
  const rows = await transaction.select({
    userAId: friendships.userAId,
    userBId: friendships.userBId,
  }).from(friendships).where(and(
    or(eq(friendships.userAId, userId), eq(friendships.userBId, userId)),
    options.acceptedOnly ? eq(friendships.status, 'accepted') : undefined,
  ))
  return friendPeerIdsFromRows(rows, userId)
}

export async function bumpAccountRevisions(
  transaction: DatabaseTransaction,
  userIds: string[],
): Promise<AccountRevisionChange[]> {
  const uniqueIds = [...new Set(userIds)]
  if (!uniqueIds.length) return []
  const rows = await transaction.update(users).set({
    stateRevision: sql`${users.stateRevision} + 1`,
  }).where(inArray(users.id, uniqueIds)).returning({
    userId: users.id,
    revision: users.stateRevision,
  })
  return rows
}

export async function publishScopedStateChanges(
  changes: AccountRevisionChange[],
  scopes: StateInvalidationScope[],
): Promise<void> {
  await Promise.all(changes.map((change) => publishStateChange({ ...change, scopes })))
}
