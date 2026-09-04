import type { QueryClient } from '@tanstack/react-query'
import type { MobileQueuedMessage, ServerChat } from '../types'
import { queryKeys } from './queries'
import { flushCacheWrites } from './writeBehind'
import { ApiError, apiRequest } from '../api/client'
import { cacheOpenedChat, cachedChats, completeOutbox, failOutbox, pendingOutbox } from './database'
import { readyOutboxPrefix } from './schema'

const activeReplays = new Map<string, Promise<{ replayed: number; rejected: number }>>()

async function performReplay(namespace: string, client?: QueryClient): Promise<{ replayed: number; rejected: number }> {
  const rows = readyOutboxPrefix(await pendingOutbox(namespace), Date.now())
  let replayed = 0
  let rejected = 0
  for (const row of rows) {
    try {
      const result = await apiRequest<{ queuedMessage?: MobileQueuedMessage | null }>(row.path, {
        method: row.method,
        body: row.body ? JSON.parse(row.body) : undefined,
        idempotencyKey: row.id,
      })
      if (row.entityKey.startsWith('queued-message:')) await settleQueuedSubmission(namespace, row.id, row.path, result.queuedMessage ?? null, undefined, client)
      await completeOutbox(row.id)
      replayed += 1
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
        if (row.entityKey.startsWith('queued-message:')) await settleQueuedSubmission(namespace, row.id, row.path, null, error.message, client)
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

export function replayOutbox(namespace: string, client?: QueryClient): Promise<{ replayed: number; rejected: number }> {
  const active = activeReplays.get(namespace)
  if (active) return active
  const replay = performReplay(namespace, client)
  activeReplays.set(namespace, replay)
  void replay.finally(() => {
    if (activeReplays.get(namespace) === replay) activeReplays.delete(namespace)
  }).catch(() => undefined)
  return replay
}

async function settleQueuedSubmission(namespace: string, id: string, path: string, saved: MobileQueuedMessage | null, error?: string, client?: QueryClient): Promise<void> {
  const chatId = path.split('/')[3]
  if (!chatId) return
  await flushCacheWrites(namespace)
  const key = queryKeys.chat(namespace, chatId)
  const persisted = (await cachedChats(namespace)).find((chat) => chat.id === chatId)
  const current = client?.getQueryData<ServerChat>(key) ?? persisted
  if (!current) return
  const queue = current.queuedMessages ?? []
  const next = { ...current, queuedMessages: queue.flatMap((item): MobileQueuedMessage[] => {
    if (item.pendingSubmissionId !== id) return saved?.id === item.id ? [] : [item]
    return error ? [{ ...item, status: 'failed', localFailure: true, error }] : []
  }) }
  if (saved) next.queuedMessages.push(saved)
  if (!next.temporary) await cacheOpenedChat(namespace, next)
  client?.setQueryData(key, next)
}
