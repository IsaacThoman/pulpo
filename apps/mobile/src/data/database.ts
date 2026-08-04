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

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined

export async function mobileDatabase(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= SQLite.openDatabaseAsync('pulpo-mobile.db').then(async (database) => {
    await database.execAsync(MOBILE_SCHEMA)
    await database.runAsync(
      'INSERT OR IGNORE INTO migrations(version, applied_at) VALUES (?, ?)',
      MOBILE_DATABASE_VERSION,
      Date.now(),
    )
    return database
  })
  return databasePromise
}

export { cacheNamespace }

export async function getValue<T>(namespace: string, key: string): Promise<T | null> {
  const database = await mobileDatabase()
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM kv WHERE namespace = ? AND key = ?', namespace, key,
  )
  return row ? JSON.parse(row.value) as T : null
}

export async function setValue(namespace: string, key: string, value: unknown): Promise<void> {
  const database = await mobileDatabase()
  await database.runAsync(
    `INSERT INTO kv(namespace, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    namespace, key, JSON.stringify(value), Date.now(),
  )
}

export async function clearNamespace(namespace: string): Promise<string[]> {
  const database = await mobileDatabase()
  const files = await database.getAllAsync<{ local_uri: string }>(
    'SELECT local_uri FROM attachment_cache WHERE namespace = ?', namespace,
  )
  await database.withTransactionAsync(async () => {
    for (const table of ['kv', 'drafts', 'response_cursors', 'outbox', 'chat_cache', 'attachment_cache']) {
      await database.runAsync(`DELETE FROM ${table} WHERE namespace = ?`, namespace)
    }
    await database.runAsync('DELETE FROM chat_fts WHERE namespace = ?', namespace)
  })
  return files.map((file) => file.local_uri)
}

export async function clearDownloadedData(namespace: string): Promise<string[]> {
  const database = await mobileDatabase()
  const files = await database.getAllAsync<{ local_uri: string }>(
    'SELECT local_uri FROM attachment_cache WHERE namespace = ?', namespace,
  )
  await database.withTransactionAsync(async () => {
    for (const table of ['chat_cache', 'attachment_cache']) {
      await database.runAsync(`DELETE FROM ${table} WHERE namespace = ?`, namespace)
    }
    await database.runAsync('DELETE FROM chat_fts WHERE namespace = ?', namespace)
  })
  return files.map((file) => file.local_uri)
}

export async function recordCachedAttachment(
  namespace: string,
  attachmentId: string,
  localUri: string,
  sizeBytes: number,
  quotaBytes: number,
): Promise<string[]> {
  const database = await mobileDatabase()
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
}

export async function saveDraft(namespace: string, chatId: string, body: string, attachments: unknown[]): Promise<void> {
  const database = await mobileDatabase()
  if (!body && attachments.length === 0) {
    await database.runAsync('DELETE FROM drafts WHERE namespace = ? AND chat_id = ?', namespace, chatId)
    return
  }
  await database.runAsync(
    `INSERT INTO drafts(namespace, chat_id, body, attachments, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(namespace, chat_id) DO UPDATE SET body = excluded.body, attachments = excluded.attachments, updated_at = excluded.updated_at`,
    namespace, chatId, body, JSON.stringify(attachments), Date.now(),
  )
}

export async function loadDraft<T>(namespace: string, chatId: string): Promise<{ body: string; attachments: T[] } | null> {
  const database = await mobileDatabase()
  const row = await database.getFirstAsync<{ body: string; attachments: string }>(
    'SELECT body, attachments FROM drafts WHERE namespace = ? AND chat_id = ?', namespace, chatId,
  )
  return row ? { body: row.body, attachments: JSON.parse(row.attachments) as T[] } : null
}

function searchableText(chat: ServerChat): string {
  return (chat.responses ?? []).flatMap((response) => [response.input, response.output])
    .map((value) => JSON.stringify(value)).join(' ')
}

export async function cacheChats(namespace: string, chats: ServerChat[]): Promise<void> {
  const database = await mobileDatabase()
  await database.withTransactionAsync(async () => {
    for (const chat of chats) {
      await database.runAsync(
        `INSERT INTO chat_cache(namespace, chat_id, payload, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(namespace, chat_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
        namespace, chat.id, JSON.stringify(chat), Date.parse(chat.updatedAt) || Date.now(),
      )
      await database.runAsync('DELETE FROM chat_fts WHERE namespace = ? AND chat_id = ?', namespace, chat.id)
      await database.runAsync(
        'INSERT INTO chat_fts(namespace, chat_id, title, body) VALUES (?, ?, ?, ?)',
        namespace, chat.id, chat.title, searchableText(chat),
      )
    }
  })
}

export async function cachedChats(namespace: string): Promise<ServerChat[]> {
  const database = await mobileDatabase()
  const rows = await database.getAllAsync<{ payload: string }>(
    'SELECT payload FROM chat_cache WHERE namespace = ? ORDER BY updated_at DESC', namespace,
  )
  return rows.map((row) => JSON.parse(row.payload) as ServerChat)
}

export async function searchCachedChats(namespace: string, query: string): Promise<string[]> {
  const database = await mobileDatabase()
  const rows = await database.getAllAsync<{ chat_id: string }>(
    `SELECT chat_id FROM chat_fts WHERE namespace = ? AND chat_fts MATCH ? ORDER BY rank LIMIT 50`,
    namespace, query.replace(/["']/g, ' ').trim().split(/\s+/).map((term) => `"${term}"*`).join(' '),
  )
  return rows.map((row) => row.chat_id)
}

export async function enqueueOutbox(record: OutboxRecord): Promise<void> {
  const database = await mobileDatabase()
  await database.runAsync(
    `INSERT INTO outbox(id, namespace, entity_key, method, path, body, created_at, attempts, next_attempt_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    record.id, record.namespace, record.entityKey, record.method, record.path, record.body,
    record.createdAt, record.attempts, record.nextAttemptAt,
  )
}

export async function pendingOutbox(namespace: string): Promise<OutboxRecord[]> {
  const database = await mobileDatabase()
  const rows = await database.getAllAsync<{
    id: string; namespace: string; entity_key: string; method: OutboxRecord['method']; path: string;
    body: string | null; created_at: number; attempts: number; next_attempt_at: number;
  }>('SELECT * FROM outbox WHERE namespace = ?', namespace)
  return orderOutbox(rows.map((row) => ({
    id: row.id, namespace: row.namespace, entityKey: row.entity_key, method: row.method,
    path: row.path, body: row.body, createdAt: row.created_at, attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
  })))
}

export async function completeOutbox(id: string): Promise<void> {
  const database = await mobileDatabase()
  await database.runAsync('DELETE FROM outbox WHERE id = ?', id)
}

export async function failOutbox(id: string, attempts: number, message: string): Promise<void> {
  const database = await mobileDatabase()
  const delay = outboxRetryDelay(attempts)
  await database.runAsync(
    'UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?',
    attempts, Date.now() + delay, message.slice(0, 500), id,
  )
}

export async function saveResponseCursor(namespace: string, responseId: string, sequence: number): Promise<void> {
  const database = await mobileDatabase()
  await database.runAsync(
    `INSERT INTO response_cursors(namespace, response_id, sequence, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(namespace, response_id) DO UPDATE SET sequence = max(sequence, excluded.sequence), updated_at = excluded.updated_at`,
    namespace, responseId, sequence, Date.now(),
  )
}

export async function responseCursors(namespace: string): Promise<Record<string, number>> {
  const database = await mobileDatabase()
  const rows = await database.getAllAsync<{ response_id: string; sequence: number }>(
    'SELECT response_id, sequence FROM response_cursors WHERE namespace = ?', namespace,
  )
  return Object.fromEntries(rows.map((row) => [row.response_id, row.sequence]))
}
