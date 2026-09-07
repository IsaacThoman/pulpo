import { dataProfileSuffix } from '@pulpo/client-core'
export const MOBILE_DATABASE_VERSION = 4

export const MOBILE_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, key)
);
CREATE TABLE IF NOT EXISTS drafts (
  namespace TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  body TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, chat_id)
);
CREATE TABLE IF NOT EXISTS response_cursors (
  namespace TEXT NOT NULL,
  response_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, response_id)
);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  body TEXT,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS outbox_namespace_order ON outbox(namespace, next_attempt_at, created_at);
CREATE TABLE IF NOT EXISTS chat_cache (
  namespace TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, chat_id)
);
CREATE TABLE IF NOT EXISTS chat_details (
  namespace TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL,
  PRIMARY KEY (namespace, chat_id),
  FOREIGN KEY (namespace, chat_id) REFERENCES chat_cache(namespace, chat_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS chat_access (
  namespace TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, chat_id)
);
CREATE INDEX IF NOT EXISTS chat_access_lru ON chat_access(namespace, opened_at DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS chat_fts USING fts5(
  namespace UNINDEXED,
  chat_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS attachment_cache (
  namespace TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  local_uri TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  last_accessed INTEGER NOT NULL,
  PRIMARY KEY (namespace, attachment_id)
);
CREATE INDEX IF NOT EXISTS attachment_cache_lru ON attachment_cache(namespace, last_accessed);
`

export function cacheNamespace(instanceUrl: string, userId: string): string {
  return `${new URL(instanceUrl).origin}|${userId}${dataProfileSuffix(userId)}`
}

export interface OutboxRecord {
  id: string
  namespace: string
  entityKey: string
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  body: string | null
  createdAt: number
  attempts: number
  nextAttemptAt: number
}

export function orderOutbox(records: OutboxRecord[]): OutboxRecord[] {
  return [...records].sort((left, right) =>
    left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}

export function readyOutboxPrefix(records: OutboxRecord[], now: number): OutboxRecord[] {
  const ordered = orderOutbox(records)
  const firstWaiting = ordered.findIndex((record) => record.nextAttemptAt > now)
  return firstWaiting === -1 ? ordered : ordered.slice(0, firstWaiting)
}

export function outboxRetryDelay(attempts: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts))
}

export interface AttachmentCacheRecord {
  attachmentId: string
  localUri: string
  sizeBytes: number
  lastAccessed: number
}

export function attachmentEvictionPlan(records: AttachmentCacheRecord[], quotaBytes: number): AttachmentCacheRecord[] {
  const oldestFirst = [...records].sort((left, right) =>
    left.lastAccessed - right.lastAccessed || left.attachmentId.localeCompare(right.attachmentId))
  let total = oldestFirst.reduce((sum, record) => sum + Math.max(0, record.sizeBytes), 0)
  const evictions: AttachmentCacheRecord[] = []
  for (const record of oldestFirst) {
    if (total <= quotaBytes) break
    evictions.push(record)
    total -= Math.max(0, record.sizeBytes)
  }
  return evictions
}

/** Run inside the version-marker transaction; all body processing stays in SQLite. */
export const MIGRATE_CHAT_DETAILS_V4 = `
INSERT OR IGNORE INTO chat_details(namespace, chat_id, payload, payload_bytes)
SELECT namespace, chat_id, payload, length(CAST(payload AS BLOB)) FROM chat_cache
WHERE json_type(payload, '$.responses') = 'array' AND COALESCE(json_extract(payload, '$.temporary'), 0) = 0;
UPDATE chat_cache SET payload = json_remove(payload, '$.responses', '$.attachments');
DELETE FROM chat_access WHERE EXISTS (SELECT 1 FROM chat_cache c WHERE c.namespace = chat_access.namespace
  AND c.chat_id = chat_access.chat_id AND json_extract(c.payload, '$.temporary') = 1);
DELETE FROM chat_fts WHERE EXISTS (SELECT 1 FROM chat_cache c WHERE c.namespace = chat_fts.namespace
  AND c.chat_id = chat_fts.chat_id AND json_extract(c.payload, '$.temporary') = 1);
DELETE FROM chat_cache WHERE json_extract(payload, '$.temporary') = 1;
`;
