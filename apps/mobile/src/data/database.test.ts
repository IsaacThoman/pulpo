import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MOBILE_SCHEMA } from './schema'
import type { ServerChat } from '../types'

const mocks = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: mocks.open }))
let db: DatabaseSync
let statements: string[]
let failMigration = false
const chat = (id = 'a'): ServerChat => ({
  id, title: 'Title', modelId: 'model', pinned: false, folderId: null, sortOrder: 0,
  temporary: false, activeResponseId: null, createdAt: '2026-09-01', updatedAt: '2026-09-01',
  responses: [], attachments: [], queuedMessages: [],
})

beforeEach(() => {
  vi.resetModules()
  db = new DatabaseSync(':memory:')
  statements = []
  failMigration = false
  const record = (sql: string) => { statements.push(sql); if (failMigration && sql.startsWith('INSERT INTO migrations')) throw new Error('interrupted migration') }
  mocks.open.mockResolvedValue({
    execAsync: async (sql: string) => { record(sql); db.exec(sql) },
    runAsync: async (sql: string, ...args: Array<string | number | null>) => { record(sql); return db.prepare(sql).run(...args) },
    getFirstAsync: async (sql: string, ...args: Array<string | number | null>) => { record(sql); return db.prepare(sql).get(...args) ?? null },
    getAllAsync: async (sql: string, ...args: Array<string | number | null>) => { record(sql); return db.prepare(sql).all(...args) },
    withTransactionAsync: async (work: () => Promise<void>) => {
      db.exec('BEGIN'); try { await work(); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
    },
  })
})

function legacy() {
  db.exec(MOBILE_SCHEMA)
  db.prepare('INSERT INTO migrations VALUES (3, 0)').run()
  const document = { ...chat(), title: '🐙 café', attachments: [{ id: 'attachment' }] }
  const payload = JSON.stringify(document)
  db.prepare('INSERT INTO chat_cache VALUES (?, ?, ?, ?)').run('n', 'a', payload, 10)
  db.prepare('INSERT INTO chat_access VALUES (?, ?, ?)').run('n', 'a', 20)
  db.prepare('INSERT INTO chat_fts VALUES (?, ?, ?, ?)').run('n', 'a', document.title, 'searchable body')
  db.prepare('INSERT INTO drafts VALUES (?, ?, ?, ?, ?)').run('n', 'a', 'unsent', '[]', 10)
  db.prepare('INSERT INTO attachment_cache VALUES (?, ?, ?, ?, ?)').run('n', 'attachment', 'file:///offline.png', 20, 30)
  db.prepare('INSERT INTO response_cursors VALUES (?, ?, ?, ?)').run('n', 'response', 7, 10)
  db.prepare('INSERT INTO outbox VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('op', 'n', 'a', 'POST', '/api/chats/a/queue', '{}', 1, 0, 0, null)
  return { document, payload }
}

describe('split transcript cache', () => {
  it('migrates v3 transactionally without losing offline documents, access, drafts, or search', async () => {
    const { document, payload } = legacy()
    const api = await import('./database')
    await api.mobileDatabase()
    expect(await api.cachedChat('n', 'a')).toEqual(document)
    expect((await api.cachedChatSummaries('n'))[0]?.responses).toBeUndefined()
    expect(await api.cachedChatBytes('n', 'a')).toBe(Buffer.byteLength(payload))
    expect(await api.loadDraft('n', 'a')).toMatchObject({ body: 'unsent' })
    expect(await api.pendingOutbox('n')).toMatchObject([{ id: 'op', entityKey: 'a' }])
    expect(db.prepare('SELECT local_uri FROM attachment_cache').get()).toEqual({ local_uri: 'file:///offline.png' })
    expect(db.prepare('SELECT sequence FROM response_cursors').get()).toEqual({ sequence: 7 })
    expect(await api.searchCachedChats('n', 'searchable')).toEqual(['a'])
    expect(db.prepare('SELECT opened_at FROM chat_access').get()).toEqual({ opened_at: 20 })
    expect(db.prepare('SELECT version FROM migrations WHERE version = 4').get()).toEqual({ version: 4 })
  })

  it('rolls back migrated data and version together on interruption', async () => {
    const { payload } = legacy()
    failMigration = true
    await expect((await import('./database')).mobileDatabase()).rejects.toThrow('interrupted')
    expect(db.prepare('SELECT payload FROM chat_cache').get()).toEqual({ payload })
    expect(db.prepare('SELECT count(*) AS count FROM chat_details').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT version FROM migrations WHERE version = 4').get()).toBeUndefined()
  })

  it('updates summary and queue without loading, rewriting, or reindexing bodies', async () => {
    legacy()
    const api = await import('./database')
    await api.mobileDatabase()
    const payload = db.prepare('SELECT payload FROM chat_details').get()
    statements = []
    await api.cacheChats('n', [{ ...chat(), responses: undefined, attachments: undefined, title: 'Renamed', folderId: 'folder', queuedMessages: [] }])
    expect(statements.some((sql) => /FROM chat_details|INTO chat_details|UPDATE chat_details|SET title = \?, body/.test(sql))).toBe(false)
    expect(db.prepare('SELECT payload FROM chat_details').get()).toEqual(payload)
    expect(await api.cachedChat('n', 'a')).toMatchObject({ title: 'Renamed', folderId: 'folder', attachments: [{ id: 'attachment' }] })
    expect(await api.searchCachedChats('n', 'searchable')).toEqual(['a'])
    statements = []
    const reopened = await api.cachedChat('n', 'a')
    await api.cacheOpenedChat('n', { ...reopened!, title: 'Renamed again' })
    expect(statements.some((sql) => /INTO chat_details|UPDATE chat_details|SET title = \?, body/.test(sql))).toBe(false)
    expect(db.prepare('SELECT payload FROM chat_details').get()).toEqual(payload)
  })

  it('reads one joined document and trims only metadata without touching retained rows', async () => {
    const api = await import('./database')
    await api.cacheOpenedChat('n', chat('a'))
    await api.cacheOpenedChat('n', chat('b'))
    statements = []
    expect(await api.cachedChat('n', 'a')).toMatchObject({ id: 'a', responses: [] })
    expect(statements).toHaveLength(1)
    expect(statements[0]).toContain('c.chat_id = ?')
    statements = []
    await api.markCachedChatOpened('n', 'a', 50)
    expect(statements.filter((sql) => sql.startsWith('SELECT')).every((sql) => !/\bpayload\b/.test(sql))).toBe(true)
    expect(statements.filter((sql) => sql.includes('INTO chat_access'))).toHaveLength(1)
    await api.trimCachedChats('n', 1)
    expect((await api.cachedChat('n', 'a'))?.responses).toEqual([])
    expect((await api.cachedChat('n', 'b'))?.responses).toBeUndefined()
    expect(await api.cachedChatSummaries('n')).toHaveLength(2)
  })

  it('handles zero retention, oversized documents, namespace deletion, and temporary chats', async () => {
    const api = await import('./database')
    await api.cacheOpenedChat('n', chat(), 0)
    expect((await api.cachedChat('n', 'a'))?.responses).toBeUndefined()
    await api.cacheOpenedChat('other', chat())
    await api.cacheOpenedChat('n', { ...chat(), responses: [], title: 'x'.repeat(5 * 1024 * 1024) })
    expect(await api.cachedChatBytes('n', 'a')).toBeUndefined()
    await api.cacheOpenedChat('n', { ...chat(), temporary: true })
    expect(await api.cachedChat('n', 'a')).toBeUndefined()
    expect((await api.cachedChat('other', 'a'))?.responses).toEqual([])
    await api.clearNamespace('other')
    expect(db.prepare('SELECT count(*) AS count FROM chat_details').get()).toEqual({ count: 0 })
  })

  it('retains exact byte boundaries and evicts the oldest document beyond the aggregate quota', async () => {
    const api = await import('./database')
    const limit = 5 * 1024 * 1024
    for (let i = 0; i < 6; i++) {
      const document = chat(String(i))
      const overhead = Buffer.byteLength(JSON.stringify(document))
      document.title += 'x'.repeat(limit - overhead)
      expect(Buffer.byteLength(JSON.stringify(document))).toBe(limit)
      await api.cacheOpenedChat('n', document)
      db.prepare('UPDATE chat_access SET opened_at = ? WHERE namespace = ? AND chat_id = ?').run(i, 'n', document.id)
    }
    expect(await api.cachedChatBytes('n', '0')).toBeUndefined()
    expect(await api.cachedChatBytes('n', '5')).toBe(limit)
    expect(db.prepare('SELECT SUM(payload_bytes) AS bytes FROM chat_details').get()).toEqual({ bytes: 25 * 1024 * 1024 })
  })
})
