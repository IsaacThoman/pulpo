import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  MOBILE_SCHEMA,
  attachmentEvictionPlan,
  cacheNamespace,
  orderOutbox,
  outboxRetryDelay,
  readyOutboxPrefix,
  type OutboxRecord,
} from './schema'

describe('mobile SQLite schema', () => {
  it('migrates an empty database and supports namespaced FTS', () => {
    const database = new DatabaseSync(':memory:')
    database.exec(MOBILE_SCHEMA)
    database.prepare('INSERT INTO chat_fts(namespace, chat_id, title, body) VALUES (?, ?, ?, ?)')
      .run('one|user', 'chat-1', 'SwiftUI app', 'Liquid Glass menus')
    database.prepare('INSERT INTO chat_fts(namespace, chat_id, title, body) VALUES (?, ?, ?, ?)')
      .run('two|user', 'chat-2', 'SwiftUI app', 'Other server')
    const rows = database.prepare('SELECT chat_id FROM chat_fts WHERE namespace = ? AND chat_fts MATCH ?')
      .all('one|user', 'Liquid*') as Array<{ chat_id: string }>
    expect(rows.map((row) => row.chat_id)).toEqual(['chat-1'])
  })

  it('isolates cache namespaces by origin and user', () => {
    expect(cacheNamespace('https://pulpo.baby/path', 'user-1')).toBe('https://pulpo.baby|user-1')
    expect(cacheNamespace('https://other.example', 'user-1')).not.toBe(cacheNamespace('https://pulpo.baby', 'user-1'))
  })

  it('replays outbox records in causal creation order, regardless of retry time', () => {
    const record = (id: string, nextAttemptAt: number, createdAt: number): OutboxRecord => ({
      id, namespace: 'n', entityKey: id, method: 'PATCH', path: `/api/chats/${id}`,
      body: '{}', attempts: 0, nextAttemptAt, createdAt,
    })
    expect(orderOutbox([record('third', 0, 3), record('second', 1, 2), record('first', 10, 1)])
      .map((item) => item.id)).toEqual(['first', 'second', 'third'])
    expect(readyOutboxPrefix([
      record('response', 0, 2),
      record('chat', 2_000, 1),
    ], 1_000)).toEqual([])
    expect([0, 1, 5, 20].map(outboxRetryDelay)).toEqual([1_000, 2_000, 32_000, 60_000])
  })

  it('isolates drafts and settings and replaces the latest values', () => {
    const database = new DatabaseSync(':memory:')
    database.exec(MOBILE_SCHEMA)
    const setDraft = database.prepare(`INSERT INTO drafts(namespace, chat_id, body, attachments, updated_at)
      VALUES (?, ?, ?, '[]', ?) ON CONFLICT(namespace, chat_id) DO UPDATE SET body = excluded.body`)
    setDraft.run('one|user', 'new', 'first draft', 1)
    setDraft.run('one|user', 'new', 'latest draft', 2)
    setDraft.run('two|user', 'new', 'another account', 1)
    const draft = database.prepare('SELECT body FROM drafts WHERE namespace = ? AND chat_id = ?')
      .get('one|user', 'new') as { body: string }
    expect(draft.body).toBe('latest draft')

    const setPreference = database.prepare(`INSERT INTO kv(namespace, key, value, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    setPreference.run('global', 'preferences', '{"theme":"dark"}', 1)
    setPreference.run('global', 'preferences', '{"theme":"light"}', 2)
    expect(database.prepare('SELECT value FROM kv WHERE namespace = ? AND key = ?')
      .get('global', 'preferences')).toEqual({ value: '{"theme":"light"}' })
    expect(database.prepare('SELECT count(*) AS count FROM drafts WHERE namespace = ?')
      .get('two|user')).toEqual({ count: 1 })
  })

  it('evicts the least-recently used attachment files to the configured quota', () => {
    const records = [
      { attachmentId: 'new', localUri: 'file:///new', sizeBytes: 40, lastAccessed: 30 },
      { attachmentId: 'old', localUri: 'file:///old', sizeBytes: 40, lastAccessed: 10 },
      { attachmentId: 'middle', localUri: 'file:///middle', sizeBytes: 40, lastAccessed: 20 },
    ]
    expect(attachmentEvictionPlan(records, 80).map((record) => record.attachmentId)).toEqual(['old'])
    expect(attachmentEvictionPlan(records, 39).map((record) => record.attachmentId)).toEqual(['old', 'middle', 'new'])
  })
})
