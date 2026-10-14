import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileListing, FileNode, SidebarState } from '@pulpo/contracts'
import type { Chat } from '@/lib/types'

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
})
vi.stubGlobal('document', { documentElement: { classList: { contains: () => false, toggle: vi.fn() } } })
vi.stubGlobal('window', {
  matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  setTimeout,
  clearTimeout,
})

const requests: Array<{ path: string; method?: string; body?: unknown }> = []
// Requests never settle, so the optimistic state stays in place to inspect.
vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
  requests.push({ path: String(input), method: init?.method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
  return new Promise<Response>(() => undefined)
}))

const [{ orderPinnedItems, pinSidebarItems }, { useChat }, { useAuth }, { queryClient }, { sidebarItemsKey, sidebarQueryKey }, { folderQueryKey }] = await Promise.all([
  import('./api'),
  import('@/stores/chat'),
  import('@/stores/auth'),
  import('@/lib/query-client'),
  import('./cache'),
  import('@/features/files/api'),
])

const userId = '00000000-0000-4000-8000-000000000001'

function chat(id: string, overrides: Partial<Chat> = {}): Chat {
  return {
    id, title: id, modelId: 'test-model', messages: [], createdAt: 1_000, updatedAt: 1_000, pinned: false,
    folderId: null, sortOrder: 0, tags: [], temporary: false, expiresAt: null, expired: false, ...overrides,
  }
}

function item(id: string, parentId: string, sortOrder: number, overrides: Partial<FileNode> = {}): FileNode {
  return {
    id, parentId, kind: 'folder', name: id, status: 'ready', mimeType: null, sizeBytes: 0, revision: 0, trashedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', sortOrder, ...overrides,
  }
}

const state = () => queryClient.getQueryData<SidebarState>(sidebarQueryKey(userId))!
const listing = (folderId: string) => queryClient.getQueryData<FileNode[]>(sidebarItemsKey(userId, folderId))!
const chatOf = (id: string) => useChat.getState().chats.find((candidate) => candidate.id === id)!

beforeEach(() => {
  requests.splice(0)
  queryClient.clear()
  useAuth.setState({ user: {
    id: userId, name: 'Test', email: 'test@example.com', username: 'test_user', avatarUrl: null, profileColor: null, role: 'user', initials: 'T',
    balanceMicros: 1_000, storageLimitBytes: 1_000, blocked: false, stateRevision: 0, createdAt: '2026-09-01T00:00:00.000Z',
  } })
  useChat.setState({ chats: [chat('pinned-chat', { pinned: true, sortOrder: 3 }), chat('loose', { sortOrder: 0 })] })
  queryClient.setQueryData<SidebarState>(sidebarQueryKey(userId), {
    chatsFolderId: 'chats', archiveFolderId: 'archive', folders: [],
    pinnedItems: [item('pinned-folder', 'elsewhere', 5, { pinned: true })],
  })
  queryClient.setQueryData<FileNode[]>(sidebarItemsKey(userId, 'chats'), [item('work', 'chats', 1), item('notes', 'chats', 2, { kind: 'doc' })])
  queryClient.setQueryData<FileListing>(folderQueryKey(userId, 'chats'), {
    folder: null, ancestors: [], children: [item('work', 'chats', 1), item('notes', 'chats', 2, { kind: 'doc' })],
  })
})

afterAll(() => vi.unstubAllGlobals())

describe('pinning sidebar items', () => {
  it('pins chats and items after everything pinned, at once, wherever they are', () => {
    void pinSidebarItems(['notes', 'loose'], true)

    expect(state().pinnedItems!.map((pinned) => [pinned.id, pinned.sortOrder, pinned.pinned])).toEqual([
      ['pinned-folder', 5, true], ['notes', 6, true],
    ])
    expect(chatOf('loose')).toMatchObject({ pinned: true, sortOrder: 7 })
    // The sidebar lists them under Pinned instead of in their folder; Files marks them.
    expect(listing('chats').map((node) => node.id)).toEqual(['work'])
    expect(queryClient.getQueryData<FileListing>(folderQueryKey(userId, 'chats'))!.children.find((node) => node.id === 'notes')).toMatchObject({ pinned: true })
    expect(requests).toContainEqual(expect.objectContaining({ method: 'POST', body: { ids: ['notes', 'loose'], pinned: true } }))
  })

  it('unpins them back to the top of their folder', () => {
    void pinSidebarItems(['pinned-chat'], false)
    // Above the unfiled chat and the Files items at the top of the sidebar.
    expect(chatOf('pinned-chat')).toMatchObject({ pinned: false, sortOrder: -1 })

    queryClient.setQueryData<FileNode[]>(sidebarItemsKey(userId, 'elsewhere'), [item('other', 'elsewhere', 4)])
    void pinSidebarItems(['pinned-folder'], false)
    expect(state().pinnedItems).toEqual([])
    expect(listing('elsewhere').map((node) => [node.id, node.pinned ?? false])).toEqual([['pinned-folder', false], ['other', false]])
    expect(listing('elsewhere')[0]!.sortOrder).toBeLessThan(4)
  })

  it('orders the pinned list, pinning what it lists', () => {
    void orderPinnedItems(['work', 'pinned-folder', 'pinned-chat'])

    expect(state().pinnedItems!.map((pinned) => [pinned.id, pinned.sortOrder])).toEqual([['pinned-folder', 1], ['work', 0]])
    expect(chatOf('pinned-chat')).toMatchObject({ pinned: true, sortOrder: 2 })
    expect(listing('chats').map((node) => node.id)).toEqual(['notes'])
    expect(requests).toContainEqual(expect.objectContaining({ method: 'PUT', body: { ids: ['work', 'pinned-folder', 'pinned-chat'] } }))
  })
})
