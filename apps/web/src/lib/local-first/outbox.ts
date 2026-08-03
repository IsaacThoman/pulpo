import { apiRequest, ApiError, isNetworkError } from '@/lib/api'
import { localDb, type OutboxMutation } from './database'

let flushing: Promise<void> | null = null

export async function enqueueMutation(
  mutation: Omit<OutboxMutation, 'id' | 'createdAt' | 'attempts' | 'nextAttemptAt' | 'idempotencyKey'> & {
    id?: string
    idempotencyKey?: string
  },
): Promise<OutboxMutation> {
  const record: OutboxMutation = {
    ...mutation,
    id: mutation.id ?? crypto.randomUUID(),
    idempotencyKey: mutation.idempotencyKey ?? crypto.randomUUID(),
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: Date.now(),
  }
  await localDb.outbox.put(record)
  return record
}

async function runOutbox(userId: string): Promise<void> {
  if (!navigator.onLine) return
  const due = await localDb.outbox
    .where('[userId+nextAttemptAt]')
    .between([userId, DexieMinKey], [userId, Date.now()])
    .sortBy('createdAt')
  for (const mutation of due) {
    try {
      await apiRequest(mutation.path, {
        method: mutation.method,
        body: mutation.body,
        idempotencyKey: mutation.idempotencyKey,
      })
      await localDb.outbox.delete(mutation.id)
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        await localDb.outbox.delete(mutation.id)
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
}

const DexieMinKey = -Infinity

export function flushOutbox(userId: string): Promise<void> {
  if (!flushing) flushing = runOutbox(userId).finally(() => { flushing = null })
  return flushing
}
