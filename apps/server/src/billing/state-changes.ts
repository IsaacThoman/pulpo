import { inArray, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { users } from '../database/schema.js'
import { poolPeerIds } from '../pools/service.js'
import { publishStateChange } from '../responses/events.js'
import { refreshStorageLimit } from './storage-entitlements.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type BillingRevision = { userId: string; revision: number }

/**
 * Applies the side effects of a billing change inside its transaction: refreshes storage
 * limits for the changed users, then bumps the state revision of them and their Pool peers,
 * whose shared allowances may have changed too.
 */
export async function recordBillingChanges(tx: Transaction, changedUsers: Set<string>, at: Date): Promise<BillingRevision[]> {
  for (const userId of changedUsers) await refreshStorageLimit(tx, userId, at)
  for (const userId of [...changedUsers]) for (const peerId of await poolPeerIds(tx, userId)) changedUsers.add(peerId)
  if (changedUsers.size === 0) return []
  return tx.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
    .where(inArray(users.id, [...changedUsers]))
    .returning({ userId: users.id, revision: users.stateRevision })
}

/** Tells connected clients to refresh billing, usage, and Pool state after the transaction commits. */
export async function publishBillingChanges(revisions: BillingRevision[]): Promise<void> {
  await Promise.all(revisions.map((change) => publishStateChange({
    ...change,
    scopes: ['usage', 'pool', 'billing'],
  })))
}
