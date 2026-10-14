import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
  requests.push({
    path: String(input),
    method: init?.method,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  })
  return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
}))

const [{ useChat }, { useAuth }, { queryClient }] = await Promise.all([
  import('./chat'),
  import('./auth'),
  import('@/lib/query-client'),
])

const userId = '00000000-0000-4000-8000-000000000001'
const plan = '00000000-0000-4000-8000-0000000000a1'
const notes = '00000000-0000-4000-8000-0000000000a2'

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1', title: 'Chat', modelId: 'test-model', messages: [], createdAt: 1_000, updatedAt: 1_000, pinned: false,
    folderId: null, sortOrder: 0, tags: [], temporary: false, expiresAt: null, expired: false, ...overrides,
  }
}

beforeEach(() => {
  requests.splice(0)
  queryClient.clear()
  useAuth.setState({ user: {
    id: userId, name: 'Test', email: 'test@example.com', username: 'test_user', avatarUrl: null, profileColor: null, role: 'user', initials: 'T',
    balanceMicros: 1_000, storageLimitBytes: 1_000, blocked: false, stateRevision: 0, createdAt: '2026-09-01T00:00:00.000Z',
  } })
  useChat.setState({ chats: [chat({ fileScopeIds: [plan, notes], fileScopeAccess: { [plan]: 'write', [notes]: 'read' } })] })
})

afterAll(() => vi.unstubAllGlobals())

describe('chat Files access modes', () => {
  it('changes one item’s mode and sends only that entry', async () => {
    useChat.getState().setChatFileAccess('chat-1', notes, 'suggest')

    expect(useChat.getState().chats[0]!.fileScopeAccess).toEqual({ [plan]: 'write', [notes]: 'suggest' })
    await vi.waitFor(() => expect(requests).toContainEqual({
      method: 'PATCH', path: expect.stringContaining('/api/chats/chat-1'), body: { fileScopeAccess: { [notes]: 'suggest' } },
    }))
  })

  it('drops the modes of items removed from the scope', async () => {
    useChat.getState().setChatFileScope('chat-1', [plan])

    expect(useChat.getState().chats[0]).toMatchObject({ fileScopeIds: [plan], fileScopeAccess: { [plan]: 'write' } })
    await vi.waitFor(() => expect(requests).toContainEqual({
      method: 'PATCH', path: expect.stringContaining('/api/chats/chat-1'), body: { fileScopeIds: [plan] },
    }))
  })

  it('reads modes from the server', () => {
    useChat.getState().replaceSummaries([{
      id: 'chat-1', title: 'Chat', modelId: 'test-model', pinned: false, folderId: null, fileScopeIds: [plan],
      fileScopeAccess: { [plan]: 'read' }, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
      activeResponseId: null, activeBranchLeafId: null,
    }])
    expect(useChat.getState().chats.find((item) => item.id === 'chat-1')?.fileScopeAccess).toEqual({ [plan]: 'read' })
  })
})
