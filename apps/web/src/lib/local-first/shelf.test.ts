// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { webShelf, clearWebShelves } from './shelf'
import { localDb } from './database'
import { loadComposerDraft, saveComposerDraft } from './composer-drafts'
import { useComposerSyncPreference } from '@/stores/composer-sync-preference'

vi.hoisted(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }) })
const fixture = vi.hoisted(() => ({ userId: 'one', api: vi.fn(async () => { throw new Error('offline') }) }))
vi.mock('@/stores/auth', () => ({ useAuth: { getState: () => ({ user: { id: fixture.userId } }) } }))
vi.mock('@/lib/api', () => ({ apiRequest: fixture.api, authenticatedFetch: vi.fn() }))
vi.mock('@/lib/runtime', () => ({ runtimeAccountKey: (id: string) => id, runtimeInstanceUrl: () => '', isDesktopRuntime: () => false }))
beforeEach(async () => { fixture.userId = 'one'; fixture.api.mockClear(); useComposerSyncPreference.setState({ enabled: true, generation: '' }); await localDb.open() })
afterEach(async () => { clearWebShelves(); await localDb.delete() })

it('atomically saves a pending shelf item, empty composer, and crash recovery checkpoint', async () => {
  await saveComposerDraft('one', 'new', { content: 'draft', attachments: [] })
  await webShelf('one').shelve('draft', [])
  expect(await loadComposerDraft('one', 'new')).toBeNull()
  expect((await localDb.kv.get('shelf:one'))?.value).toMatchObject({ operations: [{ action: { type: 'save', draft: { content: 'draft' } } }] })
  expect((await localDb.kv.get('composer-sync:one:new'))?.value).toMatchObject({ pending: { content: '', attachments: [] }, submissions: [{ state: { content: 'draft' } }] })
})
it('restores from disk while automatic draft sync is off, preserving the outgoing prompt', async () => {
  useComposerSyncPreference.setState({ enabled: false })
  const id = await webShelf('one').shelve('saved', [])
  clearWebShelves()
  const shelf = webShelf('one'); await shelf.hydrate()
  await shelf.restore(id, { content: 'outgoing', attachments: [] })
  expect(await loadComposerDraft('one', 'new')).toEqual({ content: 'saved', attachments: [] })
  expect(shelf.getSnapshot().map((row) => row.content)).toEqual(['outgoing'])
  expect(await localDb.kv.get('composer-sync:one:new')).toBeUndefined()
})
it('never sends an old account shelf using a newly selected account session', async () => {
  const shelf = webShelf('one')
  await shelf.shelve('private', [])
  await shelf.sync()
  fixture.api.mockClear(); fixture.userId = 'two'
  await shelf.sync()
  expect(fixture.api).not.toHaveBeenCalled()
  const other = webShelf('two'); await other.hydrate()
  expect(other.getSnapshot()).toEqual([])
})
