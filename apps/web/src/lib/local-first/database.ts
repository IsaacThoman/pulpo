import Dexie, { type EntityTable } from 'dexie'
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'
import { fitChatToBytes, MAX_PERSISTED_CHAT_DETAIL_BYTES } from './chat-cache-policy'
import { createPersistenceQueue } from './persistence-queue'
import { chatDataPrefix, restoreQueryCache, splitQueryCache, type StoredQueryClient } from './query-cache-records'
import { runtimeAccountKey, runtimeInstanceUrl, isDesktopRuntime } from '../runtime'

const DEFAULT_MAX_LOCAL_CHATS = 50
function queryCacheKey(): string {
  return isDesktopRuntime() ? `query-cache-v3:${runtimeInstanceUrl()}` : 'query-cache-v3'
}

export function localAccountKey(userId: string): string {
  return userId.includes('|') ? userId : runtimeAccountKey(userId)
}

interface KeyValueRow {
  key: string
  value: unknown
  updatedAt: number
}

export interface OutboxMutation {
  id: string
  userId: string
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  idempotencyKey: string
  createdAt: number
  attempts: number
  nextAttemptAt: number
  lastError?: string
}

export interface ResponseCursorRow {
  id: string
  tabId: string
  responseId: string
  sequence: number
  updatedAt: number
}

export interface DraftRow {
  id: string
  userId: string
  chatId: string
  content: string
  attachments?: unknown[]
  updatedAt: number
}

export interface CachedAttachmentRow {
  id: string
  userId: string
  originalName: string
  mimeType: string
  sizeBytes: number
  blob: Blob
  lastAccessed: number
}

class PulpoLocalDatabase extends Dexie {
  kv!: EntityTable<KeyValueRow, 'key'>
  outbox!: EntityTable<OutboxMutation, 'id'>
  responseCursors!: EntityTable<ResponseCursorRow, 'id'>
  drafts!: EntityTable<DraftRow, 'id'>
  attachmentBlobs!: EntityTable<CachedAttachmentRow, 'id'>

  constructor() {
    super('pulpo-local-v1')
    this.version(1).stores({
      kv: '&key, updatedAt',
      outbox: '&id, [userId+nextAttemptAt], createdAt',
      responseCursors: '&id, [tabId+responseId], updatedAt',
      drafts: '&id, [userId+chatId], updatedAt',
    })
    this.version(2).stores({
      kv: '&key, updatedAt',
      outbox: '&id, userId, [userId+nextAttemptAt], createdAt',
      responseCursors: '&id, tabId, [tabId+responseId], updatedAt',
      drafts: '&id, userId, [userId+chatId], updatedAt',
    })
    this.version(3).stores({
      kv: '&key, updatedAt',
      outbox: '&id, userId, [userId+nextAttemptAt], createdAt',
      responseCursors: '&id, tabId, [tabId+responseId], updatedAt',
      drafts: '&id, userId, [userId+chatId], updatedAt',
      attachmentBlobs: '&id, userId, [userId+lastAccessed], lastAccessed',
    })
    // Desktop stores the instance-qualified account key in the userId field.
    // Existing browser rows intentionally keep their user ID as the account key.
    this.version(4).stores({
      kv: '&key, updatedAt',
      outbox: '&id, userId, [userId+nextAttemptAt], createdAt',
      responseCursors: '&id, tabId, [tabId+responseId], updatedAt',
      drafts: '&id, userId, [userId+chatId], updatedAt',
      attachmentBlobs: '&id, userId, [userId+lastAccessed], lastAccessed',
    })
  }
}

export const localDb = new PulpoLocalDatabase()

function trimChatQueries(client: PersistedClient): PersistedClient {
  let maxLocalChats = DEFAULT_MAX_LOCAL_CHATS
  try {
    const persisted = JSON.parse(localStorage.getItem('pulpo-settings') ?? '{}') as { state?: { localChatLimit?: number } }
    const configured = Number(persisted.state?.localChatLimit)
    if (Number.isFinite(configured)) maxLocalChats = Math.min(500, Math.max(0, Math.floor(configured)))
  } catch { /* retain the safe default */ }
  const queries = client.clientState.queries
  let remaining = MAX_PERSISTED_CHAT_DETAIL_BYTES
  let count = 0
  const retained = new Map<string, unknown>()
  for (const query of queries.filter(query => query.queryKey[0] === 'chat').sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)) {
    if (count >= maxLocalChats) break
    const fitted = fitChatToBytes(query.state.data, remaining)
    if (!fitted) continue
    retained.set(query.queryHash, fitted.data)
    remaining -= fitted.bytes
    count++
  }
  return {
    ...client,
    clientState: { ...client.clientState, queries: queries.flatMap(query => {
      if (query.queryKey[0] === 'admin') return []
      if (query.queryKey[0] !== 'chat' || typeof query.queryKey[2] !== 'string') return [query]
      return retained.has(query.queryHash) ? [{ ...query, state: { ...query.state, data: retained.get(query.queryHash) } }] : []
    }) },
  }
}

let writtenChatData = new Map<string, unknown>()
const reportPersistenceError = (error: unknown) => console.warn('Unable to persist the local query cache', error)
const persistenceQueue = createPersistenceQueue<{ key: string; client: PersistedClient }>(async ({ key, client }) => {
  const plan = splitQueryCache(trimChatQueries(client), key, writtenChatData)
  const updatedAt = Date.now()
  await localDb.transaction('rw', localDb.kv, async () => {
    const oldKeys = await localDb.kv.where('key').startsWith(chatDataPrefix(key)).primaryKeys()
    const removed = oldKeys.filter((oldKey) => !plan.data.has(oldKey))
    if (removed.length) await localDb.kv.bulkDelete(removed)
    await localDb.kv.bulkPut([
      ...[...plan.changed].map(([recordKey, value]) => ({ key: recordKey, value, updatedAt })),
      { key, value: plan.envelope, updatedAt },
    ])
    for (const version of ['v1', 'v2']) {
      const legacy = key.replace('query-cache-v3', `query-cache-${version}`)
      await localDb.kv.delete(legacy)
      await localDb.kv.where('key').startsWith(chatDataPrefix(legacy)).delete()
    }
  })
  // Only remember identities after the atomic write succeeds.
  writtenChatData = plan.data
}, reportPersistenceError)

export function flushQueryPersistence(): Promise<void> {
  return persistenceQueue.flush().catch(reportPersistenceError)
}

export const indexedDbPersister: Persister = {
  persistClient: (client) => {
    // Capture the instance before deferring the write.
    persistenceQueue.schedule({ key: queryCacheKey(), client })
  },
  restoreClient: async () => {
    const key = queryCacheKey()
    const row = await localDb.kv.get(key) ?? await localDb.kv.get(key.replace('query-cache-v3', 'query-cache-v2')) ?? await localDb.kv.get(key.replace('query-cache-v3', 'query-cache-v1'))
    if (!row) return undefined
    const client = row.value as StoredQueryClient
    const keys = [...Object.values(client.chatDataKeys ?? {}), ...Object.values(client.chatResponseKeys ?? {}).flat()]
    const records = await localDb.kv.bulkGet(keys)
    writtenChatData = new Map(records.flatMap((record) => record ? [[record.key, record.value] as const] : []))
    return restoreQueryCache(client, writtenChatData)
  },
  removeClient: async () => {
    const key = queryCacheKey()
    await persistenceQueue.cancel()
    await localDb.transaction('rw', localDb.kv, async () => {
      for (const version of ['v1', 'v2', 'v3']) {
        const versionKey = key.replace('query-cache-v3', `query-cache-${version}`)
        await localDb.kv.delete(versionKey)
        await localDb.kv.where('key').startsWith(chatDataPrefix(versionKey)).delete()
      }
    })
    writtenChatData.clear()
  },
}

export async function clearLocalUserData(userId: string): Promise<void> {
  const accountKey = localAccountKey(userId)
  await localDb.transaction('rw', localDb.outbox, localDb.drafts, localDb.attachmentBlobs, localDb.kv, async () => {
    await localDb.kv.where('key').startsWith(`composer-sync:${accountKey}:`).delete()
    await localDb.kv.delete(`shelf:${accountKey}`)
    await localDb.outbox.where('userId').equals(accountKey).delete()
    await localDb.drafts.where('userId').equals(accountKey).delete()
    await localDb.attachmentBlobs.where('userId').equals(accountKey).delete()
  })
  await indexedDbPersister.removeClient()
}

export const localChatLimit = DEFAULT_MAX_LOCAL_CHATS
