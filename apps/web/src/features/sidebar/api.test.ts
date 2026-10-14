import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileListing, FileNode, SidebarState } from '@pulpo/contracts'
import type { Chat } from '@/lib/types'

const storage = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
}
vi.stubGlobal('localStorage', localStorageStub)
vi.stubGlobal('document', { documentElement: { classList: { contains: () => false, toggle: vi.fn() } } })
vi.stubGlobal('window', {
  matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  localStorage: localStorageStub,
  setTimeout,
  clearTimeout,
})

const requests: Array<{ path: string; method?: string; body?: unknown }> = []
/** The server's answer to a request; by default none, so the optimistic state stays in place to inspect. */
let respond: (path: string, method: string) => Response | null = () => null
vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
  requests.push({ path: String(input), method: init?.method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
  const response = respond(String(input), init?.method ?? 'GET')
  return response ? Promise.resolve(response) : new Promise<Response>(() => undefined)
}))
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const [
  { archiveSidebarSelection, moveSidebarSelection, orderPinnedItems, pinSidebarItems, trashSidebarSelection },
  { useChat }, { useAuth }, { useSettings }, { queryClient }, { sidebarItemsKey, sidebarQueryKey }, { folderQueryKey }, { useFileToasts },
] = await Promise.all([
  import('./api'),
  import('@/stores/chat'),
  import('@/stores/auth'),
  import('@/stores/settings'),
  import('@/lib/query-client'),
  import('./cache'),
  import('@/features/files/api'),
  import('@/features/files/browser/toasts'),
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
  respond = () => null
  useFileToasts.setState({ toasts: [] })
  useSettings.setState({ trashRetention: '30d' })
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

describe('undoing sidebar changes', () => {
  const toasts = () => useFileToasts.getState().toasts
  const sent = (method: string, path: string) => requests.filter((request) => request.method === method && request.path.endsWith(path)).map((request) => request.body)

  it('moves items and puts them back on undo', async () => {
    respond = () => json({ nodes: [] })
    await moveSidebarSelection(['work'], 'f9')

    expect(sent('POST', '/api/sidebar/move')).toEqual([{ ids: ['work'], parentId: 'f9' }])
    expect(toasts()).toEqual([expect.objectContaining({ message: 'Moved "work"', undo: expect.any(Function) })])
    await toasts()[0]!.undo!()
    expect(sent('POST', '/api/sidebar/move')).toEqual([{ ids: ['work'], parentId: 'f9' }, { ids: ['work'], parentId: 'chats' }])
  })

  it('does not announce a move that changes nothing', async () => {
    respond = () => json({ nodes: [] })
    await moveSidebarSelection(['loose'], null)
    expect(toasts()).toEqual([])
  })

  it('trashes chats and items, and restores both on undo', async () => {
    respond = (path, method) => method === 'DELETE' ? new Response(null, { status: 204 })
      : path.endsWith('/api/sidebar/trash') ? json({ ids: ['notes'] }) : json({})
    await trashSidebarSelection(['notes', 'loose'])

    expect(sent('POST', '/api/sidebar/trash')).toEqual([{ ids: ['notes'] }])
    expect(useChat.getState().chats.map((chat) => chat.id)).toEqual(['pinned-chat'])
    expect(toasts()).toEqual([expect.objectContaining({ message: 'Moved 2 items to the trash', undo: expect.any(Function) })])
    await toasts()[0]!.undo!()
    expect(sent('POST', '/api/sidebar/restore')).toEqual([{ ids: ['notes'] }])
    expect(sent('POST', '/api/chats/loose/recover')).toHaveLength(1)
  })

  it('says chats deleted right away are gone, without an undo', async () => {
    useSettings.setState({ trashRetention: 'instant' })
    respond = () => new Response(null, { status: 204 })
    await trashSidebarSelection(['loose'])
    expect(toasts()).toEqual([expect.objectContaining({ message: 'Deleted "loose"', undo: undefined })])
  })

  it('archives a pinned item and puts it back, pinned in its old place, on undo', async () => {
    respond = () => json({})
    await archiveSidebarSelection(['pinned-folder'])

    expect(sent('POST', '/api/sidebar/archive')).toEqual([{ fileIds: ['pinned-folder'] }])
    expect(toasts()).toEqual([expect.objectContaining({ message: 'Moved "pinned-folder" to the archive' })])
    await toasts()[0]!.undo!()
    expect(sent('POST', '/api/sidebar/move')).toEqual([{ ids: ['pinned-folder'], parentId: 'elsewhere' }])
    expect(sent('PUT', '/api/sidebar/pinned')).toEqual([{ ids: ['pinned-chat', 'pinned-folder'] }])
  })

  it('reports a failure in a toast instead of throwing', async () => {
    respond = () => json({ error: { code: 'file_move_cycle', message: 'cycle' } }, 400)
    await expect(moveSidebarSelection(['work'], 'f9')).resolves.toBeUndefined()
    expect(toasts()).toEqual([expect.objectContaining({ message: 'A folder cannot be moved into itself', tone: 'error' })])
  })
})
