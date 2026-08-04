import * as Crypto from 'expo-crypto'
import { ApiError, apiRequest } from '../api/client'
import { completeOutbox, enqueueOutbox, failOutbox, pendingOutbox } from './database'

type OfflineMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export async function queueOfflineMutation(input: {
  namespace: string
  entityKey: string
  method: OfflineMethod
  path: string
  body?: unknown
}): Promise<void> {
  await enqueueOutbox({
    id: Crypto.randomUUID(),
    namespace: input.namespace,
    entityKey: input.entityKey,
    method: input.method,
    path: input.path,
    body: input.body === undefined ? null : JSON.stringify(input.body),
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
  })
}

export async function replayOutbox(namespace: string): Promise<{ replayed: number; rejected: number }> {
  const rows = await pendingOutbox(namespace)
  let replayed = 0
  let rejected = 0
  for (const row of rows) {
    if (row.nextAttemptAt > Date.now()) continue
    try {
      await apiRequest(row.path, {
        method: row.method,
        body: row.body ? JSON.parse(row.body) : undefined,
        idempotencyKey: row.id,
      })
      await completeOutbox(row.id)
      replayed += 1
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        await completeOutbox(row.id)
        rejected += 1
      } else {
        await failOutbox(row.id, row.attempts + 1, error instanceof Error ? error.message : 'Sync failed')
        break
      }
    }
  }
  return { replayed, rejected }
}
