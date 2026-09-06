import { afterEach, expect, it, vi } from 'vitest'
import { durableShelfAttachments, shelfComposerAttachments, mobileShelf, clearMobileShelf } from './shelf'

const fixture = vi.hoisted(() => ({ files: new Set<string>(['cache://one']), copies: [] as string[], rows: new Map<string, unknown>(), saves: vi.fn() }))
vi.mock('react-native', () => ({ Appearance: { setColorScheme() {} }, AppState: { addEventListener: () => ({ remove() {} }) } }))
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }))
vi.mock('expo-file-system', () => ({
  Paths: { document: 'documents:' },
  Directory: class { uri: string; constructor(...parts: string[]) { this.uri = parts.join('/') } create() {} },
  File: class {
    uri: string
    constructor(...parts: Array<string | { uri: string }>) { this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/') }
    get exists() { return fixture.files.has(this.uri) }
    copy(to: { uri: string }) { fixture.files.add(to.uri); fixture.copies.push(to.uri) }
    delete() { fixture.files.delete(this.uri) }
  },
}))
vi.mock('./api', () => ({ uploadAttachment: vi.fn() }))
vi.mock('../../api/client', () => ({ apiRequest: vi.fn(async () => { throw new Error('offline') }) }))
vi.mock('../../store/session', () => ({ useSessionStore: { getState: () => ({ user: { id: 'user' }, instanceUrl: 'instance' }) } }))
vi.mock('../../data/database', () => ({
  cacheNamespace: () => 'account', shelfFileIsUsedByDraft: async () => false,
  getValue: async (namespace: string, key: string) => fixture.rows.get(`${namespace}:${key}`) ?? null,
  setValue: async () => {},
  saveShelfCheckpoint: async (namespace: string, checkpoint: unknown, composer: unknown) => { fixture.rows.set(`${namespace}:shelved-drafts`, structuredClone(checkpoint)); fixture.saves(namespace, checkpoint, composer) },
}))
afterEach(() => { clearMobileShelf('account'); fixture.rows.clear(); fixture.copies.length = 0; fixture.saves.mockClear() })

it('copies pending files into account-scoped durable storage before shelving', () => {
  const result = durableShelfAttachments('account', [{ localId: 'local', name: 'one.txt', mimeType: 'text/plain', uri: 'cache://one', state: 'uploading', size: 2 }])
  expect(result[0]?.source).toBe('documents:/shelved-drafts/account/local')
  expect(fixture.copies).toEqual(['documents:/shelved-drafts/account/local'])
  expect(result[0]?.id).toBeUndefined()
})
it('rejects missing local files but restores ready remote files without a cached preview', () => {
  expect(() => durableShelfAttachments('account', [{ localId: 'missing', name: 'lost', mimeType: 'text/plain', uri: '', state: 'uploading' }])).toThrow('unavailable')
  expect(shelfComposerAttachments([{ localId: 'file', id: 'server', name: 'one.pdf', mimeType: 'application/pdf', size: 2 }])[0]).toMatchObject({ serverId: 'server', uri: '', state: 'ready' })
})
it('preserves cross-platform attachment order without applying the mobile picker limit', () => {
  const attachments = Array.from({ length: 20 }, (_, index) => ({ localId: String(index), id: String(index), name: `${index}.png`, mimeType: 'image/png', size: 2 }))
  expect(shelfComposerAttachments(attachments).map((a) => a.serverId)).toEqual(attachments.map((a) => a.id))
})
it('passes the restored composer and shelf checkpoint to the same database transaction', async () => {
  const shelf = mobileShelf('account')
  const id = await shelf.shelve('saved', [])
  await shelf.restore(id, { content: 'outgoing', attachments: [] })
  expect(fixture.saves.mock.calls.some((call) => call[2]?.body === 'saved' && call[2]?.handoff?.before?.content === 'outgoing')).toBe(true)
})
