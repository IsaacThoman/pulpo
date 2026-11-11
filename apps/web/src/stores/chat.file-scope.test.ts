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
let refuse = false
vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
  requests.push({
    path: String(input),
    method: init?.method,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  })
  if (refuse && init?.method === 'PATCH') {
    return Promise.resolve(new Response(JSON.stringify({ error: { code: 'not_found', message: 'Chat not found' } }), { status: 404, headers: { 'content-type': 'application/json' } }))
  }
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
  refuse = false
  queryClient.clear()
  useAuth.setState({ user: {
    id: userId, name: 'Test', email: 'test@example.com', username: 'test_user', avatarUrl: null, profileColor: null, usageVisibility: 'friends', role: 'user', initials: 'T',
    balanceMicros: 1_000, storageLimitBytes: 1_000, blocked: false, stateRevision: 0, createdAt: '2026-09-01T00:00:00.000Z',
  } })
  useChat.setState({ chats: [chat({ fileScopeIds: [plan, notes], fileScopeAccess: { [plan]: 'write', [notes]: 'read' }, fileChangeMode: 'suggest' })] })
})

afterAll(() => vi.unstubAllGlobals())

describe('chat Files access', () => {
  it('sets the chat’s change mode, which replaces modes set per item', async () => {
    useChat.getState().setChatFileChangeMode('chat-1', 'write')

    expect(useChat.getState().chats[0]).toMatchObject({ fileChangeMode: 'write', fileScopeAccess: {} })
    await vi.waitFor(() => expect(requests).toContainEqual({
      method: 'PATCH', path: expect.stringContaining('/api/chats/chat-1'), body: { fileChangeMode: 'write' },
    }))
  })

  it('drops the modes of items removed from the scope', async () => {
    useChat.getState().setChatFileScope('chat-1', [plan])

    expect(useChat.getState().chats[0]).toMatchObject({ fileScopeIds: [plan], fileScopeAccess: { [plan]: 'write' } })
    await vi.waitFor(() => expect(requests).toContainEqual({
      method: 'PATCH', path: expect.stringContaining('/api/chats/chat-1'), body: { fileScopeIds: [plan] },
    }))
  })

  it('shows the previous mode again when the server refuses the change', async () => {
    refuse = true
    useChat.getState().setChatFileChangeMode('chat-1', 'read')
    expect(useChat.getState().chats[0]!.fileChangeMode).toBe('read')
    await vi.waitFor(() => expect(useChat.getState().chats[0]).toMatchObject({
      fileChangeMode: 'suggest', fileScopeAccess: { [plan]: 'write', [notes]: 'read' },
    }))
  })

  it('keeps a newer change when an older one is refused', async () => {
    refuse = true
    useChat.getState().setChatFileScope('chat-1', [plan])
    useChat.setState((state) => ({ chats: state.chats.map((item) => ({ ...item, fileScopeIds: [notes] })) }))
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(useChat.getState().chats[0]!.fileScopeIds).toEqual([notes])
  })

  it('sends nothing for a chat the server has not created yet', async () => {
    useChat.setState((state) => ({ chats: state.chats.map((item) => ({ ...item, provisional: true })) }))
    useChat.getState().setChatFileChangeMode('chat-1', 'write')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(requests).toEqual([])
    expect(useChat.getState().chats[0]!.fileChangeMode).toBe('write')
  })

  it('revokes browsing for the chat', async () => {
    useChat.setState((state) => ({ chats: state.chats.map((item) => ({ ...item, filesBrowseAllowed: true })) }))
    useChat.getState().revokeChatFilesBrowse('chat-1')
    expect(useChat.getState().chats[0]!.filesBrowseAllowed).toBe(false)
    await vi.waitFor(() => expect(requests).toContainEqual({
      method: 'PATCH', path: expect.stringContaining('/api/chats/chat-1'), body: { filesBrowseAllowed: false },
    }))
  })

  it('answers a permission request', async () => {
    await useChat.getState().answerFilesPermission('response-1', 'response-1:files-permission:1', 'allow_chat')
    expect(requests).toContainEqual({
      method: 'POST', path: expect.stringContaining('/api/responses/response-1/files-permission'),
      body: { itemId: 'response-1:files-permission:1', decision: 'allow_chat' },
    })
  })

  it('reads the chat’s Files access from the server', () => {
    useChat.getState().replaceSummaries([{
      id: 'chat-1', title: 'Chat', modelId: 'test-model', pinned: false, folderId: null, fileScopeIds: [plan],
      fileScopeAccess: { [plan]: 'read' }, fileChangeMode: 'write', filesBrowseAllowed: true,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
      activeResponseId: null, activeBranchLeafId: null,
    }])
    expect(useChat.getState().chats.find((item) => item.id === 'chat-1')).toMatchObject({
      fileScopeAccess: { [plan]: 'read' }, fileChangeMode: 'write', filesBrowseAllowed: true,
    })
  })
})
