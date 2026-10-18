// @vitest-environment node
import type { SidebarState } from '@pulpo/contracts'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchSidebarState: vi.fn(),
  fetchSidebarItems: vi.fn(),
  kept: new Map<string, unknown>(),
  outbox: [] as Array<{ method: string; path: string; body: string | null; createdAt: number }>,
  chats: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../api/client', () => ({ isNetworkError: (error: unknown) => (error as { network?: boolean } | null)?.network === true }))
vi.mock('../../data/database', () => ({
  getValue: async (_namespace: string, key: string) => mocks.kept.get(key) ?? null,
  setValue: async (_namespace: string, key: string, value: unknown) => { mocks.kept.set(key, value) },
  pendingOutbox: async () => mocks.outbox,
}))
vi.mock('./api', () => ({ fetchSidebarState: mocks.fetchSidebarState, fetchSidebarItems: mocks.fetchSidebarItems }))
vi.mock('../../mockup5/src/store/prototypeStore', () => ({ usePrototypeStore: { getState: () => ({ chats: mocks.chats }) } }))

const { sidebarItemsQuery, sidebarStateQuery, sidebarUnavailable, withPendingItems } = await import('./queries')

const NAMESPACE = 'https://pulpo.test|a'
const state = { chatsFolderId: 'chats', archiveFolderId: 'archive', folders: [], pinnedItems: [] } satisfies SidebarState
let client: QueryClient

beforeEach(() => {
  mocks.kept.clear()
  mocks.outbox = []
  mocks.chats = []
  mocks.fetchSidebarState.mockReset()
  mocks.fetchSidebarItems.mockReset()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('the sidebar queries', () => {
  it('keep what the server says on the device, and answer from it offline', async () => {
    mocks.fetchSidebarState.mockResolvedValue(state)
    await expect(client.fetchQuery(sidebarStateQuery(NAMESPACE))).resolves.toEqual(state)
    await vi.waitFor(() => expect(mocks.kept.get('sidebar:state')).toEqual({ value: state }))

    mocks.fetchSidebarState.mockRejectedValue({ network: true })
    await expect(new QueryClient().fetchQuery(sidebarStateQuery(NAMESPACE))).resolves.toEqual(state)
  })

  it('remember a server without the sidebar, offline too', async () => {
    mocks.fetchSidebarState.mockResolvedValue(null)
    await expect(client.fetchQuery(sidebarStateQuery(NAMESPACE))).resolves.toBeNull()
    mocks.fetchSidebarState.mockRejectedValue({ network: true })
    await vi.waitFor(() => expect(mocks.kept.has('sidebar:state')).toBe(true))
    await expect(new QueryClient().fetchQuery(sidebarStateQuery(NAMESPACE))).resolves.toBeNull()
  })

  it('fail offline when the device has nothing yet, and on other errors', async () => {
    mocks.fetchSidebarItems.mockRejectedValue({ network: true })
    await expect(client.fetchQuery(sidebarItemsQuery(NAMESPACE, 'work'))).rejects.toEqual({ network: true })
    mocks.kept.set('sidebar:items:work', { value: [] })
    mocks.fetchSidebarItems.mockRejectedValue(new Error('Forbidden'))
    await expect(new QueryClient().fetchQuery(sidebarItemsQuery(NAMESPACE, 'work'))).rejects.toThrow('Forbidden')
  })

  it('tell a listing that is missing offline from one that was refused, and from one still loading', () => {
    expect(sidebarUnavailable({ data: undefined, isError: false, fetchStatus: 'paused' })).toBe('offline')
    expect(sidebarUnavailable({ data: undefined, isError: true, fetchStatus: 'idle' })).toBe('failed')
    expect(sidebarUnavailable({ data: undefined, isError: false, fetchStatus: 'fetching' })).toBeNull()
    expect(sidebarUnavailable({ data: [], isError: true, fetchStatus: 'paused' })).toBeNull()
  })

  it('list folders created offline until the server has them, without keeping them as the server’s', async () => {
    mocks.outbox = [
      { method: 'POST', path: '/api/sidebar/folders', body: JSON.stringify({ id: 'top', parentId: null, name: 'Top' }), createdAt: 1 },
      { method: 'POST', path: '/api/sidebar/folders', body: JSON.stringify({ id: 'inner', parentId: 'work', name: 'Inner' }), createdAt: 2 },
      { method: 'PATCH', path: '/api/chats/c', body: JSON.stringify({ folderId: 'top' }), createdAt: 3 },
    ]
    mocks.fetchSidebarState.mockResolvedValue(state)
    const withPending = await client.fetchQuery(sidebarStateQuery(NAMESPACE))
    expect(withPending?.folders.map((folder) => [folder.id, folder.parentId])).toEqual([['top', 'chats'], ['inner', 'work']])
    await vi.waitFor(() => expect(mocks.kept.get('sidebar:state')).toEqual({ value: state }))

    mocks.fetchSidebarItems.mockResolvedValue([{ id: 'doc', sortOrder: -2 }])
    const root = await client.fetchQuery(sidebarItemsQuery(NAMESPACE, 'chats', true))
    expect(root.map((item) => [item.id, item.sortOrder])).toEqual([['top', -3], ['doc', -2]])
    const work = await new QueryClient().fetchQuery(sidebarItemsQuery(NAMESPACE, 'work'))
    expect(work.map((item) => item.id)).toEqual(['inner', 'doc'])
    // Offline, from the device's copy, too; and not twice once the server lists them.
    mocks.fetchSidebarItems.mockResolvedValue([{ id: 'top', sortOrder: 0 }])
    expect((await new QueryClient().fetchQuery(sidebarItemsQuery(NAMESPACE, 'chats', true))).map((item) => item.id)).toEqual(['top'])
    mocks.fetchSidebarItems.mockRejectedValue({ network: true })
    expect((await new QueryClient().fetchQuery(sidebarItemsQuery(NAMESPACE, 'work'))).map((item) => item.id)).toEqual(['inner', 'doc'])
  })

  it('put folders created offline above the folder’s chats too, the newest first, as the server will', () => {
    const chat = (id: string, folderId: string | null, sortOrder: number) => ({ id, folderId, sortOrder, pinned: false, createdAt: 1 })
    const pending = [
      { id: 'older', parentId: null, name: 'Older', createdAt: 1 },
      { id: 'newer', parentId: null, name: 'Newer', createdAt: 2 },
    ]
    const placed = withPendingItems([{ id: 'doc', sortOrder: -5 } as never], 'chats', true, pending, [chat('top-chat', null, -30), chat('filed', 'work', -90)])
    expect(placed.map((item) => [item.id, item.sortOrder])).toEqual([['older', -31], ['newer', -32], ['doc', -5]])
  })

  it('open a folder still waiting to be created, with the folders created in it meanwhile', async () => {
    mocks.outbox = [
      { method: 'POST', path: '/api/sidebar/folders', body: JSON.stringify({ id: 'outer', parentId: null, name: 'Outer' }), createdAt: 1 },
      { method: 'POST', path: '/api/sidebar/folders', body: JSON.stringify({ id: 'nested', parentId: 'outer', name: 'Nested' }), createdAt: 2 },
    ]
    // Offline, with nothing on the device; online before the outbox sent it, the server doesn't know it.
    mocks.fetchSidebarItems.mockRejectedValueOnce({ network: true }).mockRejectedValueOnce(new Error('Not found'))
    expect((await client.fetchQuery(sidebarItemsQuery(NAMESPACE, 'outer'))).map((item) => item.id)).toEqual(['nested'])
    expect(await new QueryClient().fetchQuery(sidebarItemsQuery(NAMESPACE, 'nested'))).toEqual([])
    // Any other folder that can't load still fails.
    mocks.fetchSidebarItems.mockRejectedValueOnce({ network: true })
    await expect(new QueryClient().fetchQuery(sidebarItemsQuery(NAMESPACE, 'unknown'))).rejects.toEqual({ network: true })
  })
})
