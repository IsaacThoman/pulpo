import Dexie, { type EntityTable } from 'dexie'
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'
import { retainedChatQueryHashes } from './chat-cache-policy'
import { runtimeAccountKey, runtimeInstanceUrl, isDesktopRuntime } from '../runtime'
import { clearRuntimeComposerDraftPrefix } from './composer-draft-runtime'

const DEFAULT_MAX_LOCAL_CHATS = 50
function queryCacheKey(): string {
  return isDesktopRuntime() ? `query-cache-v1:${runtimeInstanceUrl()}` : 'query-cache-v1'
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
  modelId: string
  presetSelections: Record<string, string>
  agentMode: boolean
  autoExpire?: boolean
  attachments: Array<{
    localId: string
    serverId?: string
    name: string
    mimeType: string
    sizeBytes: number
  }>
  editorId: string
  serverRevision?: number
  serverUpdatedAt?: string
  dirty: boolean
  deleted: boolean
  updatedAt: number
}

export interface DraftAttachmentBlobRow {
  id: string
  userId: string
  localId: string
  blob: Blob
  name: string
  mimeType: string
  sizeBytes: number
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
  draftAttachmentBlobs!: EntityTable<DraftAttachmentBlobRow, 'id'>

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
    this.version(5).stores({
      kv: '&key, updatedAt',
      outbox: '&id, userId, [userId+nextAttemptAt], createdAt',
      responseCursors: '&id, tabId, [tabId+responseId], updatedAt',
      drafts: '&id, userId, [userId+chatId], updatedAt',
      attachmentBlobs: '&id, userId, [userId+lastAccessed], lastAccessed',
      draftAttachmentBlobs: '&id, userId, [userId+localId], updatedAt',
    })
    this.version(6).stores({
      kv: '&key, updatedAt',
      outbox: '&id, userId, [userId+nextAttemptAt], createdAt',
      responseCursors: '&id, tabId, [tabId+responseId], updatedAt',
      drafts: '&id, userId, [userId+chatId], dirty, updatedAt',
      attachmentBlobs: '&id, userId, [userId+lastAccessed], lastAccessed',
      draftAttachmentBlobs: '&id, userId, [userId+localId], updatedAt',
    }).upgrade(async (transaction) => {
      await transaction.table<DraftRow>('drafts').toCollection().modify((draft) => {
        draft.deleted = false
        draft.dirty ??= true
      })
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
  const chatDetails = queries
    .filter((query) => query.queryKey[0] === 'chat' && typeof query.queryKey[2] === 'string')
    .map((query) => ({
      queryHash: query.queryHash,
      dataUpdatedAt: query.state.dataUpdatedAt,
      data: query.state.data,
    }))
  const retainedHashes = retainedChatQueryHashes(chatDetails, maxLocalChats)
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
    await localDb.kv.put({ key: queryCacheKey(), value: trimChatQueries(client), updatedAt: Date.now() })
  },
  restoreClient: async () => {
    const row = await localDb.kv.get(queryCacheKey())
    return row?.value as PersistedClient | undefined
  },
  removeClient: async () => {
    await localDb.kv.delete(queryCacheKey())
  },
}

export async function clearLocalUserData(userId: string): Promise<void> {
  const accountKey = localAccountKey(userId)
  clearRuntimeComposerDraftPrefix(`${accountKey}:draft:`)
  await localDb.transaction('rw', localDb.outbox, localDb.drafts, localDb.attachmentBlobs, localDb.draftAttachmentBlobs, async () => {
    await localDb.outbox.where('userId').equals(accountKey).delete()
    await localDb.drafts.where('userId').equals(accountKey).delete()
    await localDb.attachmentBlobs.where('userId').equals(accountKey).delete()
    await localDb.draftAttachmentBlobs.where('userId').equals(accountKey).delete()
  })
  await indexedDbPersister.removeClient()
}

export const localChatLimit = DEFAULT_MAX_LOCAL_CHATS
