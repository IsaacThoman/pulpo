import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat } from '@/lib/types'

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
})
vi.stubGlobal('document', { documentElement: { classList: { toggle: vi.fn() } } })
vi.stubGlobal('window', {
  matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  setTimeout,
  clearTimeout,
})

const requests: Array<{ path: string; method?: string; body?: unknown }> = []
vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
  requests.push({
    path: String(input),
    method: init?.method,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  })
  return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
}))

const [{ compareChatOrder, useChat }, { useAuth }, { queryClient }] = await Promise.all([
  import('./chat'),
  import('./auth'),
  import('@/lib/query-client'),
])

const userId = '00000000-0000-4000-8000-000000000001'
const folderId = '00000000-0000-4000-8000-0000000000f1'

function chat(id: string, overrides: Partial<Chat> = {}): Chat {
  return {
    id, title: id, modelId: 'test-model', messages: [], createdAt: 1_000, updatedAt: 1_000, pinned: false,
    folderId: null, sortOrder: 0, tags: [], temporary: false, expiresAt: null, expired: false, ...overrides,
  }
}

function looseOrder() {
  return useChat.getState().chats
    .filter((item) => !item.pinned && !item.folderId)
    .sort(compareChatOrder)
    .map((item) => item.id)
}

beforeEach(() => {
  requests.splice(0)
  queryClient.clear()
  useAuth.setState({ user: {
    id: userId, name: 'Test', email: 'test@example.com', username: 'test_user', avatarUrl: null, profileColor: null, role: 'user', initials: 'T',
    balanceMicros: 1_000, storageLimitBytes: 1_000, blocked: false, stateRevision: 0, createdAt: '2026-09-01T00:00:00.000Z',
  } })
  useChat.setState({
    chats: [
      chat('a', { createdAt: 3_000 }),
      chat('b', { createdAt: 2_000 }),
      chat('c', { createdAt: 1_000 }),
      chat('in-folder', { folderId, sortOrder: 0 }),
      chat('pinned', { pinned: true, sortOrder: 0 }),
    ],
    folders: [{ id: folderId, name: 'Folder', pinned: false, expanded: true, sortOrder: 0 }],
  })
})

afterAll(() => vi.unstubAllGlobals())

describe('chat order', () => {
  it('does not move a chat when it receives new activity', () => {
    expect(looseOrder()).toEqual(['a', 'b', 'c'])
    useChat.setState((state) => ({
      chats: state.chats.map((item) => item.id === 'c' ? { ...item, updatedAt: 9_999 } : item),
    }))
    expect(looseOrder()).toEqual(['a', 'b', 'c'])
  })

  it('reorders unfiled chats and saves the full order', async () => {
    useChat.getState().reorderLooseChats('c', 'a', 'before')

    expect(looseOrder()).toEqual(['c', 'a', 'b'])
    await vi.waitFor(() => expect(requests.some((request) => request.path.endsWith('/api/chats/order'))).toBe(true))
    expect(requests.find((request) => request.path.endsWith('/api/chats/order'))).toMatchObject({
      method: 'PUT',
      body: { chatIds: ['c', 'a', 'b'] },
    })
  })

  it('places a chat moved out of a folder at the top of the unfiled list', () => {
    useChat.getState().reorderLooseChats('c', 'a', 'before')
    useChat.getState().moveToFolder('in-folder', null)

    expect(looseOrder()).toEqual(['in-folder', 'c', 'a', 'b'])
  })

  it('places a folder chat dropped between unfiled chats at that position', () => {
    useChat.getState().moveToFolder('in-folder', null, { targetId: 'b', edge: 'before' })

    expect(looseOrder()).toEqual(['a', 'in-folder', 'b', 'c'])
  })

  it('returns an unpinned chat to the top of the unfiled list', () => {
    useChat.getState().reorderLooseChats('c', 'a', 'before')
    useChat.getState().togglePin('pinned')

    expect(looseOrder()).toEqual(['pinned', 'c', 'a', 'b'])
  })

  it('keeps a pinned chat in place when it is filed into a folder', () => {
    useChat.getState().moveToFolder('pinned', folderId)

    const pinned = useChat.getState().chats.find((item) => item.id === 'pinned')
    expect(pinned).toMatchObject({ pinned: true, folderId, sortOrder: 0 })
  })
})
