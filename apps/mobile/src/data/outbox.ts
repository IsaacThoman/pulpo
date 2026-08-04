import { ApiError, apiRequest } from '../api/client'
import { completeOutbox, failOutbox, pendingOutbox } from './database'
import { readyOutboxPrefix } from './schema'

const activeReplays = new Map<string, Promise<{ replayed: number; rejected: number }>>()

async function performReplay(namespace: string): Promise<{ replayed: number; rejected: number }> {
  const rows = readyOutboxPrefix(await pendingOutbox(namespace), Date.now())
  let replayed = 0
  let rejected = 0
  for (const row of rows) {
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

export function replayOutbox(namespace: string): Promise<{ replayed: number; rejected: number }> {
  const active = activeReplays.get(namespace)
  if (active) return active
  const replay = performReplay(namespace)
  activeReplays.set(namespace, replay)
  void replay.finally(() => {
    if (activeReplays.get(namespace) === replay) activeReplays.delete(namespace)
  }).catch(() => undefined)
  return replay
}
