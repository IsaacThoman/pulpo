import type { DocClosedEvent, StateInvalidationScope } from '@pulpo/contracts'
import type { db } from '../../database/client.js'
import { getBlobStore } from '../../storage/index.js'
import { publishDocsClosed, publishDocUpdate } from '../doc-events.js'
import { scheduleCompactionAfterUpdate } from '../doc-store.js'
import { mutateFileTree } from '../tree-service.js'

export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** What a Files transaction leaves to do once it commits; nothing here may happen before. */
export interface CommitEffects {
  docUpdates: Array<{ nodeId: string; update: Uint8Array; pendingUpdates: number }>
  closedDocs: Array<{ ids: string[]; reason: DocClosedEvent['reason'] }>
  /** Objects nothing refers to any more. */
  deletedKeys: string[]
}

/** Trashing, restoring, and purging can move chats, so those refresh chat lists too. */
export const TREE_AND_CHAT_SCOPES: StateInvalidationScope[] = ['files', 'folders', 'chats']

/**
 * Runs an agent-change transaction under the account's Files lock (and storage lock, when
 * reserving bytes), then broadcasts document updates to open editors, closes editors of
 * trashed or deleted documents, and deletes released objects.
 */
export async function mutateAgentFiles<T>(
  userId: string,
  work: (tx: DatabaseTransaction, effects: CommitEffects) => Promise<T>,
  options: {
    reserveBytes?: number
    scopes?: StateInvalidationScope[]
    /** Re-checks, under the locks, what the change was decided from. */
    guard?: (tx: DatabaseTransaction) => Promise<void>
  } = {},
): Promise<T> {
  const effects: CommitEffects = { docUpdates: [], closedDocs: [], deletedKeys: [] }
  const result = await mutateFileTree(userId, async (tx) => {
    await options.guard?.(tx)
    return work(tx, effects)
  }, options.scopes, { reserveBytes: options.reserveBytes })
  await runCommitEffects(effects)
  return result
}

/**
 * The change is committed by now, so failures here are logged rather than thrown: editors
 * catch up when they next join, maintenance compacts stale documents, and an object left
 * behind only costs storage.
 */
async function runCommitEffects(effects: CommitEffects): Promise<void> {
  const tasks = [
    ...effects.docUpdates.map(({ nodeId, update, pendingUpdates }) => async () => {
      await publishDocUpdate(nodeId, update)
      await scheduleCompactionAfterUpdate(nodeId, pendingUpdates)
    }),
    ...effects.closedDocs.map(({ ids, reason }) => () => publishDocsClosed(ids, reason)),
  ]
  for (const task of tasks) {
    try {
      await task()
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'files.agent_commit_effect_failed', error: error instanceof Error ? error.message : String(error) }))
    }
  }
  await deleteObjects(effects.deletedKeys)
}

export async function deleteObjects(keys: string[]): Promise<void> {
  for (const key of keys) await getBlobStore().delete(key).catch(() => undefined)
}
