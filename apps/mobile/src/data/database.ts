import * as SQLite from 'expo-sqlite'
import {
  MOBILE_DATABASE_VERSION,
  MOBILE_SCHEMA,
  attachmentEvictionPlan,
  cacheNamespace,
  orderOutbox,
  outboxRetryDelay,
  type AttachmentCacheRecord,
  type OutboxRecord,
} from './schema'
import type { ServerChat } from '../types'
import {
  MAX_CACHED_CHAT_DETAIL_BYTES,
  cachedChatDetailIdsToEvict,
  cachedChatIdsToRemove,
  mergeCachedChat,
  utf8ByteLength,
  withoutCachedChatDetails,
} from './cache'
import { createOperationQueue } from './operationQueue'

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined
const enqueueDatabaseOperation = createOperationQueue()

export async function mobileDatabase(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= SQLite.openDatabaseAsync('pulpo-mobile.db').then(async (database) => {
    await database.execAsync(MOBILE_SCHEMA)
    const current = await database.getFirstAsync<{ version: number }>(
      'SELECT version FROM migrations WHERE version = ?', MOBILE_DATABASE_VERSION,
    )
    if (!current) {
      const namespaces = await database.getAllAsync<{ namespace: string }>('SELECT DISTINCT namespace FROM chat_cache')
      for (const { namespace } of namespaces) await trimOpenedChatDetailsInDatabase(database, namespace, 50)
    }
    await database.runAsync(
      'INSERT OR IGNORE INTO migrations(version, applied_at) VALUES (?, ?)',
      MOBILE_DATABASE_VERSION,
      Date.now(),
    )
    return database
  })
  return databasePromise
}

function withDatabase<T>(operation: (database: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  return enqueueDatabaseOperation(async () => operation(await mobileDatabase()))
}

export { cacheNamespace }

export async function getValue<T>(namespace: string, key: string): Promise<T | null> {
  return withDatabase(async (database) => {
    const row = await database.getFirstAsync<{ value: string }>(
      'SELECT value FROM kv WHERE namespace = ? AND key = ?', namespace, key,
    )
    return row ? JSON.parse(row.value) as T : null
  })
}

export async function setValue(namespace: string, key: string, value: unknown): Promise<void> {
  await withDatabase(async (database) => {
    await database.runAsync(
      `INSERT INTO kv(namespace, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      namespace, key, JSON.stringify(value), Date.now(),
    )
  })
}

export async function clearNamespace(namespace: string): Promise<string[]> {
  return withDatabase(async (database) => {
    const files = await database.getAllAsync<{ local_uri: string }>(
      'SELECT local_uri FROM attachment_cache WHERE namespace = ?', namespace,
    )
    await database.withTransactionAsync(async () => {
      for (const table of ['kv', 'drafts', 'response_cursors', 'outbox', 'chat_cache', 'chat_access', 'attachment_cache']) {
        await database.runAsync(`DELETE FROM ${table} WHERE namespace = ?`, namespace)
      }
      await database.runAsync('DELETE FROM chat_fts WHERE namespace = ?', namespace)
    })
    return files.map((file) => file.local_uri)
  })
}

export async function clearDownloadedData(namespace: string): Promise<string[]> {
  return withDatabase(async (database) => {
    const files = await database.getAllAsync<{ local_uri: string }>(
      'SELECT local_uri FROM attachment_cache WHERE namespace = ?', namespace,
    )
    await database.withTransactionAsync(async () => {
      for (const table of ['chat_cache', 'chat_access', 'attachment_cache']) {
        await database.runAsync(`DELETE FROM ${table} WHERE namespace = ?`, namespace)
      }
      await database.runAsync('DELETE FROM chat_fts WHERE namespace = ?', namespace)
    })
    return files.map((file) => file.local_uri)
  })
}

export async function recordCachedAttachment(
  namespace: string,
  attachmentId: string,
  localUri: string,
  sizeBytes: number,
  quotaBytes: number,
): Promise<string[]> {
  return withDatabase(async (database) => {
    const now = Date.now()
    await database.runAsync(
      `INSERT INTO attachment_cache(namespace, attachment_id, local_uri, size_bytes, last_accessed)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(namespace, attachment_id) DO UPDATE SET
         local_uri = excluded.local_uri,
         size_bytes = excluded.size_bytes,
         last_accessed = excluded.last_accessed`,
      namespace, attachmentId, localUri, sizeBytes, now,
    )
    const rows = await database.getAllAsync<{
      attachment_id: string
      local_uri: string
      size_bytes: number
      last_accessed: number
    }>('SELECT attachment_id, local_uri, size_bytes, last_accessed FROM attachment_cache WHERE namespace = ?', namespace)
    const records: AttachmentCacheRecord[] = rows.map((row) => ({
      attachmentId: row.attachment_id,
      localUri: row.local_uri,
      sizeBytes: row.size_bytes,
      lastAccessed: row.last_accessed,
    }))
    const evictions = attachmentEvictionPlan(records, quotaBytes)
    if (evictions.length) {
      const placeholders = evictions.map(() => '?').join(', ')
      await database.runAsync(
        `DELETE FROM attachment_cache WHERE namespace = ? AND attachment_id IN (${placeholders})`,
        namespace,
        ...evictions.map((record) => record.attachmentId),
      )
    }
    return evictions.map((record) => record.localUri)
  })
}

export async function cachedAttachmentUri(namespace: string, attachmentId: string): Promise<string | null> {
  return withDatabase(async (database) => {
    const row = await database.getFirstAsync<{ local_uri: string }>(
      'SELECT local_uri FROM attachment_cache WHERE namespace = ? AND attachment_id = ?',
      namespace,
      attachmentId,
    )
    if (!row) return null
    await database.runAsync(
      'UPDATE attachment_cache SET last_accessed = ? WHERE namespace = ? AND attachment_id = ?',
      Date.now(),
      namespace,
      attachmentId,
    )
    return row.local_uri
  })
}

export async function removeCachedAttachment(namespace: string, attachmentId: string): Promise<string | null> {
  return withDatabase(async (database) => {
    const row = await database.getFirstAsync<{ local_uri: string }>(
      'SELECT local_uri FROM attachment_cache WHERE namespace = ? AND attachment_id = ?',
      namespace,
      attachmentId,
    )
    await database.runAsync(
      'DELETE FROM attachment_cache WHERE namespace = ? AND attachment_id = ?',
      namespace,
      attachmentId,
    )
    return row?.local_uri ?? null
  })
}

export async function saveDraft(namespace: string, chatId: string, body: string, attachments: unknown[]): Promise<void> {
  await withDatabase(async (database) => {
    if (!body && attachments.length === 0) {
      await database.runAsync('DELETE FROM drafts WHERE namespace = ? AND chat_id = ?', namespace, chatId)
      return
    }
    await database.runAsync(
      `INSERT INTO drafts(namespace, chat_id, body, attachments, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(namespace, chat_id) DO UPDATE SET body = excluded.body, attachments = excluded.attachments, updated_at = excluded.updated_at`,
      namespace, chatId, body, JSON.stringify(attachments), Date.now(),
    )
  })
}

export async function loadDraft<T>(namespace: string, chatId: string): Promise<{ body: string; attachments: T[] } | null> {
  return withDatabase(async (database) => {
    const row = await database.getFirstAsync<{ body: string; attachments: string }>(
      'SELECT body, attachments FROM drafts WHERE namespace = ? AND chat_id = ?', namespace, chatId,
    )
    return row ? { body: row.body, attachments: JSON.parse(row.attachments) as T[] } : null
  })
}

function searchableText(chat: ServerChat): string {
  return (chat.responses ?? []).flatMap((response) => [response.input, response.output])
    .map((value) => JSON.stringify(value)).join(' ')
}

async function cacheChatsInDatabase(database: SQLite.SQLiteDatabase, namespace: string, chats: ServerChat[]): Promise<void> {
  await database.withTransactionAsync(async () => {
    for (const chat of chats) {
      if (chat.temporary) {
        await database.runAsync('DELETE FROM chat_cache WHERE namespace = ? AND chat_id = ?', namespace, chat.id)
        await database.runAsync('DELETE FROM chat_access WHERE namespace = ? AND chat_id = ?', namespace, chat.id)
        await database.runAsync('DELETE FROM chat_fts WHERE namespace = ? AND chat_id = ?', namespace, chat.id)
        continue
      }
      const current = await database.getFirstAsync<{ payload: string }>(
        'SELECT payload FROM chat_cache WHERE namespace = ? AND chat_id = ?', namespace, chat.id,
      )
      const merged = mergeCachedChat(current ? JSON.parse(current.payload) as ServerChat : null, chat)
      const mergedPayload = JSON.stringify(merged)
      const stored = Object.hasOwn(merged, 'responses') && utf8ByteLength(mergedPayload) > MAX_CACHED_CHAT_DETAIL_BYTES
        ? withoutCachedChatDetails(merged)
        : merged
      await database.runAsync(
        `INSERT INTO chat_cache(namespace, chat_id, payload, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(namespace, chat_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
        namespace, chat.id, JSON.stringify(stored), Date.parse(stored.updatedAt) || Date.now(),
      )
      await database.runAsync('DELETE FROM chat_fts WHERE namespace = ? AND chat_id = ?', namespace, chat.id)
      await database.runAsync(
        'INSERT INTO chat_fts(namespace, chat_id, title, body) VALUES (?, ?, ?, ?)',
        namespace, chat.id, stored.title, Object.hasOwn(stored, 'responses') ? searchableText(stored) : '',
      )
    }
  })
}

export async function cacheChats(namespace: string, chats: ServerChat[]): Promise<void> {
  await withDatabase((database) => cacheChatsInDatabase(database, namespace, chats))
}

async function trimOpenedChatDetailsInDatabase(
  database: SQLite.SQLiteDatabase,
  namespace: string,
  limit: number,
): Promise<void> {
  const cacheRows = await database.getAllAsync<{ chat_id: string; payload: string; updated_at: number }>(
    'SELECT chat_id, payload, updated_at FROM chat_cache WHERE namespace = ?', namespace,
  )
  const accessRows = await database.getAllAsync<{ chat_id: string; opened_at: number }>(
    'SELECT chat_id, opened_at FROM chat_access WHERE namespace = ?', namespace,
  )
  const openedAt = new Map(accessRows.map((row) => [row.chat_id, row.opened_at]))
  const detailed = cacheRows.flatMap((row) => {
    const chat = JSON.parse(row.payload) as ServerChat
    return Object.hasOwn(chat, 'responses')
      ? [{ ...row, chat, openedAt: openedAt.get(row.chat_id) ?? row.updated_at }]
      : []
  }).sort((left, right) => right.openedAt - left.openedAt || left.chat_id.localeCompare(right.chat_id))
  const evictedIds = new Set(cachedChatDetailIdsToEvict(detailed.map((row) => ({
    chatId: row.chat_id,
    openedAt: row.openedAt,
    payloadBytes: utf8ByteLength(row.payload),
  })), limit))
  const keep = detailed.filter((row) => !evictedIds.has(row.chat_id))
  const evict = detailed.filter((row) => evictedIds.has(row.chat_id))
  await database.withTransactionAsync(async () => {
    for (const row of keep) {
      await database.runAsync(
        `INSERT INTO chat_access(namespace, chat_id, opened_at) VALUES (?, ?, ?)
         ON CONFLICT(namespace, chat_id) DO UPDATE SET opened_at = excluded.opened_at`,
        namespace, row.chat_id, row.openedAt,
      )
    }
    for (const row of evict) {
      const summary = withoutCachedChatDetails(row.chat)
      await database.runAsync(
        'UPDATE chat_cache SET payload = ? WHERE namespace = ? AND chat_id = ?',
        JSON.stringify(summary), namespace, row.chat_id,
      )
      await database.runAsync('DELETE FROM chat_access WHERE namespace = ? AND chat_id = ?', namespace, row.chat_id)
      await database.runAsync('DELETE FROM chat_fts WHERE namespace = ? AND chat_id = ?', namespace, row.chat_id)
      await database.runAsync(
        'INSERT INTO chat_fts(namespace, chat_id, title, body) VALUES (?, ?, ?, ?)',
        namespace, row.chat_id, summary.title, '',
      )
    }
  })
}

export async function cacheOpenedChat(
  namespace: string,
  chat: ServerChat,
  limit = 50,
): Promise<void> {
  await withDatabase(async (database) => {
    await cacheChatsInDatabase(database, namespace, [chat])
    if (chat.temporary) return
    await database.runAsync(
      `INSERT INTO chat_access(namespace, chat_id, opened_at) VALUES (?, ?, ?)
       ON CONFLICT(namespace, chat_id) DO UPDATE SET opened_at = excluded.opened_at`,
      namespace, chat.id, Date.now(),
    )
    await trimOpenedChatDetailsInDatabase(database, namespace, limit)
  })
}

export async function markCachedChatOpened(namespace: string, chatId: string, limit = 50): Promise<void> {
  await withDatabase(async (database) => {
    await database.runAsync(
      `INSERT INTO chat_access(namespace, chat_id, opened_at) VALUES (?, ?, ?)
       ON CONFLICT(namespace, chat_id) DO UPDATE SET opened_at = excluded.opened_at`,
      namespace, chatId, Date.now(),
    )
    await trimOpenedChatDetailsInDatabase(database, namespace, limit)
  })
}

async function reconcileCachedChatScopeInternal(
  namespace: string,
  chats: ServerChat[],
  scope: 'active' | 'deleted' | 'all',
  limit: number,
  cacheIncoming: boolean,
): Promise<void> {
  await withDatabase(async (database) => {
    if (cacheIncoming) await cacheChatsInDatabase(database, namespace, chats)
    const rows = await database.getAllAsync<{ chat_id: string; payload: string; updated_at: number }>(
      'SELECT chat_id, payload, updated_at FROM chat_cache WHERE namespace = ? ORDER BY updated_at DESC', namespace,
    )
    const removedIds = cachedChatIdsToRemove(
      rows.map((row) => JSON.parse(row.payload) as ServerChat),
      new Set(chats.map((chat) => chat.id)),
      scope,
    )
    if (removedIds.length) {
      await database.withTransactionAsync(async () => {
        for (const chatId of removedIds) {
          await database.runAsync('DELETE FROM chat_cache WHERE namespace = ? AND chat_id = ?', namespace, chatId)
          await database.runAsync('DELETE FROM chat_access WHERE namespace = ? AND chat_id = ?', namespace, chatId)
          await database.runAsync('DELETE FROM chat_fts WHERE namespace = ? AND chat_id = ?', namespace, chatId)
        }
      })
    }
    await trimOpenedChatDetailsInDatabase(database, namespace, limit)
  })
}

export function reconcileCachedChatScope(
  namespace: string,
  chats: ServerChat[],
  scope: 'active' | 'deleted' | 'all',
  limit: number,
): Promise<void> {
  return reconcileCachedChatScopeInternal(namespace, chats, scope, limit, true)
}

/** Remove stale summaries after list queries have already queued their writes. */
export function pruneCachedChatScope(
  namespace: string,
  chats: ServerChat[],
  scope: 'active' | 'deleted' | 'all',
  limit: number,
): Promise<void> {
  return reconcileCachedChatScopeInternal(namespace, chats, scope, limit, false)
}

export async function trimCachedChats(namespace: string, limit: number): Promise<void> {
  await withDatabase((database) => trimOpenedChatDetailsInDatabase(database, namespace, limit))
}

export async function cachedChats(namespace: string): Promise<ServerChat[]> {
  return withDatabase(async (database) => {
    const rows = await database.getAllAsync<{ payload: string }>(
      'SELECT payload FROM chat_cache WHERE namespace = ? ORDER BY updated_at DESC', namespace,
    )
    const parsed = rows.map((row) => JSON.parse(row.payload) as ServerChat)
    const temporaryIds = parsed.filter((chat) => chat.temporary).map((chat) => chat.id)
    if (temporaryIds.length) {
      await database.withTransactionAsync(async () => {
        for (const chatId of temporaryIds) {
          await database.runAsync('DELETE FROM chat_cache WHERE namespace = ? AND chat_id = ?', namespace, chatId)
          await database.runAsync('DELETE FROM chat_access WHERE namespace = ? AND chat_id = ?', namespace, chatId)
          await database.runAsync('DELETE FROM chat_fts WHERE namespace = ? AND chat_id = ?', namespace, chatId)
        }
      })
    }
    return parsed.filter((chat) => !chat.temporary)
  })
}

export async function searchCachedChats(namespace: string, query: string): Promise<string[]> {
  return withDatabase(async (database) => {
    const rows = await database.getAllAsync<{ chat_id: string }>(
      `SELECT chat_id FROM chat_fts WHERE namespace = ? AND chat_fts MATCH ? ORDER BY rank LIMIT 50`,
      namespace, query.replace(/["']/g, ' ').trim().split(/\s+/).map((term) => `"${term}"*`).join(' '),
    )
    return rows.map((row) => row.chat_id)
  })
}

export async function enqueueOutbox(record: OutboxRecord): Promise<void> {
  await withDatabase(async (database) => {
    await database.runAsync(
      `INSERT INTO outbox(id, namespace, entity_key, method, path, body, created_at, attempts, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      record.id, record.namespace, record.entityKey, record.method, record.path, record.body,
      record.createdAt, record.attempts, record.nextAttemptAt,
    )
  })
}

export async function pendingOutbox(namespace: string): Promise<OutboxRecord[]> {
  return withDatabase(async (database) => {
    const rows = await database.getAllAsync<{
      id: string; namespace: string; entity_key: string; method: OutboxRecord['method']; path: string;
      body: string | null; created_at: number; attempts: number; next_attempt_at: number;
    }>('SELECT * FROM outbox WHERE namespace = ?', namespace)
    return orderOutbox(rows.map((row) => ({
      id: row.id, namespace: row.namespace, entityKey: row.entity_key, method: row.method,
      path: row.path, body: row.body, createdAt: row.created_at, attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at,
    })))
  })
}

export async function completeOutbox(id: string): Promise<void> {
  await withDatabase(async (database) => {
    await database.runAsync('DELETE FROM outbox WHERE id = ?', id)
  })
}

export async function completeOutboxEntity(namespace: string, entityKey: string): Promise<void> {
  await withDatabase(async (database) => {
    await database.runAsync('DELETE FROM outbox WHERE namespace = ? AND entity_key = ?', namespace, entityKey)
  })
}

export async function failOutbox(id: string, attempts: number, message: string): Promise<void> {
  const delay = outboxRetryDelay(attempts)
  await withDatabase(async (database) => {
    await database.runAsync(
      'UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?',
      attempts, Date.now() + delay, message.slice(0, 500), id,
    )
  })
}

export async function saveResponseCursor(namespace: string, responseId: string, sequence: number): Promise<void> {
  await saveResponseCursors(namespace, { [responseId]: sequence })
}

export async function saveResponseCursors(namespace: string, cursors: Record<string, number>): Promise<void> {
  const entries = Object.entries(cursors)
  if (entries.length === 0) return
  await withDatabase(async (database) => {
    const now = Date.now()
    await database.withTransactionAsync(async () => {
      for (const [responseId, sequence] of entries) {
        await database.runAsync(
          `INSERT INTO response_cursors(namespace, response_id, sequence, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(namespace, response_id) DO UPDATE SET sequence = max(sequence, excluded.sequence), updated_at = excluded.updated_at`,
          namespace, responseId, sequence, now,
        )
      }
    })
  })
}

export async function deleteResponseCursor(namespace: string, responseId: string): Promise<void> {
  await withDatabase(async (database) => {
    await database.runAsync(
      'DELETE FROM response_cursors WHERE namespace = ? AND response_id = ?', namespace, responseId,
    )
  })
}

export async function responseCursors(namespace: string): Promise<Record<string, number>> {
  return withDatabase(async (database) => {
    const rows = await database.getAllAsync<{ response_id: string; sequence: number }>(
      'SELECT response_id, sequence FROM response_cursors WHERE namespace = ?', namespace,
    )
    return Object.fromEntries(rows.map((row) => [row.response_id, row.sequence]))
  })
}
