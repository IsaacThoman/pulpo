// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { MOBILE_SCHEMA } from '../../data/schema'

const database = vi.hoisted(() => ({ current: null as DatabaseSync | null }))

vi.mock('expo-file-system', () => ({ File: class {} }))
vi.mock('../../store/preferences', () => ({ usePreferencesStore: { getState: () => ({ attachmentCacheMb: 100 }) } }))
vi.mock('../../data/database', () => ({
  getValue: async () => null,
  setValue: async () => undefined,
  withMobileDatabase: async <T,>(operation: (db: unknown) => Promise<T>) => operation({
    runAsync: async (source: string, ...params: Array<string | number | null>) => database.current!.prepare(source).run(...params),
  }),
}))

const { forgetStaleDocCopies } = await import('./cache')

const NAMESPACE = 'https://pulpo.test|a'

function storeCopy(id: string) {
  database.current!.prepare('INSERT INTO file_docs(namespace, doc_id, state, schema_version, dirty, size_bytes, opened_at) VALUES (?, ?, ?, 2, 1, 1, 1)').run(NAMESPACE, id, new Uint8Array([0]))
  database.current!.prepare('INSERT INTO file_doc_updates(namespace, doc_id, data) VALUES (?, ?, ?)').run(NAMESPACE, id, new Uint8Array([0]))
}

describe('stored document copies', () => {
  it('are forgotten for items that are no longer documents, even with unsynced edits', async () => {
    database.current = new DatabaseSync(':memory:')
    database.current.exec(MOBILE_SCHEMA)
    storeCopy('became-a-file')
    storeCopy('still-a-document')
    await forgetStaleDocCopies(NAMESPACE, [
      { id: 'BECAME-A-FILE', kind: 'blob' },
      { id: 'still-a-document', kind: 'doc' },
      { id: 'a-folder', kind: 'folder' },
    ])
    const docs = database.current.prepare('SELECT doc_id FROM file_docs ORDER BY doc_id').all()
    const updates = database.current.prepare('SELECT doc_id FROM file_doc_updates ORDER BY doc_id').all()
    expect(docs).toEqual([{ doc_id: 'still-a-document' }])
    expect(updates).toEqual([{ doc_id: 'still-a-document' }])
  })
})
