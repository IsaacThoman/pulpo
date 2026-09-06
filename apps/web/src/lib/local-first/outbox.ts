import { apiRequest, ApiError, isNetworkError } from '@/lib/api'
import { localAccountKey, localDb, type OutboxMutation } from './database'

const flushing = new Map<string, Promise<string[]>>()

export async function enqueueMutation(
  mutation: Omit<OutboxMutation, 'id' | 'createdAt' | 'attempts' | 'nextAttemptAt' | 'idempotencyKey'> & {
    id?: string
    idempotencyKey?: string
  },
): Promise<OutboxMutation> {
  const record: OutboxMutation = {
    ...mutation,
    userId: localAccountKey(mutation.userId),
    id: mutation.id ?? crypto.randomUUID(),
    idempotencyKey: mutation.idempotencyKey ?? crypto.randomUUID(),
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: Date.now(),
  }
  await localDb.outbox.put(record)
  return record
}

async function runOutbox(userId: string): Promise<string[]> {
  if (!navigator.onLine) return []
  const settledPaths: string[] = []
  const accountKey = localAccountKey(userId)
  const due = await localDb.outbox
    .where('[userId+nextAttemptAt]')
    .between([accountKey, DexieMinKey], [accountKey, Date.now()])
    .sortBy('createdAt')
  for (const mutation of due) {
    try {
      await apiRequest(mutation.path, {
        method: mutation.method,
        body: mutation.body,
        idempotencyKey: mutation.idempotencyKey,
      })
      await localDb.outbox.delete(mutation.id)
      settledPaths.push(mutation.path)
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        await localDb.outbox.delete(mutation.id)
        settledPaths.push(mutation.path)
        continue
      }
      const attempts = mutation.attempts + 1
      await localDb.outbox.update(mutation.id, {
        attempts,
        lastError: error instanceof Error ? error.message : 'Network request failed',
        nextAttemptAt: Date.now() + Math.min(60_000, 1_000 * 2 ** attempts),
      })
      if (isNetworkError(error)) break
    }
  }
  return settledPaths
}

const DexieMinKey = -Infinity

export function flushOutbox(userId: string): Promise<string[]> {
  const key = localAccountKey(userId)
  let pending = flushing.get(key)
  if (!pending) {
    pending = runOutbox(userId).finally(() => { flushing.delete(key) })
    flushing.set(key, pending)
  }
  return pending
}
