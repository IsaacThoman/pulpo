import Dexie, { type EntityTable } from 'dexie'
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'

const MAX_LOCAL_CHATS = 50
const QUERY_CACHE_KEY = 'query-cache-v1'

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
  updatedAt: number
}

class PulpoLocalDatabase extends Dexie {
  kv!: EntityTable<KeyValueRow, 'key'>
  outbox!: EntityTable<OutboxMutation, 'id'>
  responseCursors!: EntityTable<ResponseCursorRow, 'id'>
  drafts!: EntityTable<DraftRow, 'id'>

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
  }
}

export const localDb = new PulpoLocalDatabase()

function trimChatQueries(client: PersistedClient): PersistedClient {
  const queries = client.clientState.queries
  const chatDetails = queries
    .filter((query) => query.queryKey[0] === 'chat' && typeof query.queryKey[2] === 'string')
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
  const retainedHashes = new Set(chatDetails.slice(0, MAX_LOCAL_CHATS).map((query) => query.queryHash))
  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries: queries.filter((query) => {
        if (query.queryKey[0] === 'admin') return false
        if (query.queryKey[0] !== 'chat' || typeof query.queryKey[2] !== 'string') return true
        return retainedHashes.has(query.queryHash)
      }),
    },
  }
}

export const indexedDbPersister: Persister = {
  persistClient: async (client) => {
    await localDb.kv.put({ key: QUERY_CACHE_KEY, value: trimChatQueries(client), updatedAt: Date.now() })
  },
  restoreClient: async () => {
    const row = await localDb.kv.get(QUERY_CACHE_KEY)
    return row?.value as PersistedClient | undefined
  },
  removeClient: async () => {
    await localDb.kv.delete(QUERY_CACHE_KEY)
  },
}

export async function clearLocalUserData(userId: string): Promise<void> {
  await localDb.transaction('rw', localDb.outbox, localDb.drafts, async () => {
    await localDb.outbox.where('userId').equals(userId).delete()
    await localDb.drafts.where('userId').equals(userId).delete()
  })
  await indexedDbPersister.removeClient()
}

export const localChatLimit = MAX_LOCAL_CHATS
