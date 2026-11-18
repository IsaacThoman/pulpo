import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat } from '@/lib/types'
import type { ServerChat } from './chat'

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

const userId = '00000000-0000-4000-8000-000000000001'
const originId = '00000000-0000-4000-8000-0000000000a1'
const responseId = '00000000-0000-4000-8000-0000000000b1'

function serverChat(id: string, overrides: Partial<ServerChat> = {}): ServerChat {
  return {
    id, title: id, modelId: 'test-model', pinned: false, folderId: null,
    createdAt: new Date(1_000).toISOString(), updatedAt: new Date(1_000).toISOString(),
    activeResponseId: null, activeBranchLeafId: null, ...overrides,
  }
}

const requests: Array<{ path: string; method?: string; body?: Record<string, unknown> }> = []
let reply: unknown = {}
vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
  requests.push({
    path: String(input),
    method: init?.method,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined,
  })
  return Promise.resolve(new Response(JSON.stringify(reply), { status: 201, headers: { 'content-type': 'application/json' } }))
}))

const [{ useChat }, { useAuth }, { queryClient }, { isSidebarChat }] = await Promise.all([
  import('./chat'),
  import('./auth'),
  import('@/lib/query-client'),
  import('@/features/sidebar/chat-groups'),
])

function chat(id: string, overrides: Partial<Chat> = {}): Chat {
  return {
    id, title: id, modelId: 'test-model', messages: [], createdAt: 1_000, updatedAt: 1_000, pinned: false,
    folderId: null, sortOrder: 0, tags: [], temporary: false, expiresAt: null, expired: false, ...overrides,
  }
}

beforeEach(() => {
  requests.splice(0)
  reply = {}
  queryClient.clear()
  useAuth.setState({ user: {
    id: userId, name: 'Test', email: 'test@example.com', username: 'test_user', avatarUrl: null, profileColor: null, usageVisibility: 'friends', role: 'user', initials: 'T',
    balanceMicros: 1_000, storageLimitBytes: 1_000, blocked: false, stateRevision: 0, createdAt: '2026-09-01T00:00:00.000Z',
  } })
  useChat.setState({ activeTemporaryChatId: null, streamingIds: [], responseSequences: {}, responseChatIds: {}, chats: [chat(originId)] })
})

afterAll(() => vi.unstubAllGlobals())

describe('side chats, forks, and threads', () => {
  it('forks from a reply into a listed chat', async () => {
    reply = serverChat('fork', { title: 'origin (fork)', kind: 'chat', originChatId: originId, originResponseId: responseId })
    queryClient.setQueryData(['chats', userId], [serverChat(originId)])

    await expect(useChat.getState().forkChat(responseId)).resolves.toBe('fork')

    expect(requests[0]).toMatchObject({ path: `/api/messages/${responseId}/fork`, method: 'POST' })
    expect(requests[0]!.body?.clientId).toEqual(expect.any(String))
    const fork = useChat.getState().chats.find((item) => item.id === 'fork')
    expect(fork).toMatchObject({ kind: 'chat', originChatId: originId, originResponseId: responseId })
    expect(isSidebarChat(fork!)).toBe(true)
    expect(queryClient.getQueryData<ServerChat[]>(['chats', userId])?.map((row) => row.id)).toEqual([originId, 'fork'])
  })

  it('opens a side chat at a reply without listing it', async () => {
    reply = serverChat('side', { kind: 'side', originChatId: originId, originResponseId: responseId })
    queryClient.setQueryData(['chats', userId], [serverChat(originId)])

    await expect(useChat.getState().openSideChat(originId, responseId)).resolves.toBe('side')

    expect(requests[0]).toMatchObject({ path: `/api/chats/${originId}/side-chats`, method: 'POST', body: { responseId } })
    const side = useChat.getState().chats.find((item) => item.id === 'side')
    expect(side).toMatchObject({ kind: 'side', originChatId: originId })
    expect(isSidebarChat(side!)).toBe(false)
    expect(queryClient.getQueryData<ServerChat[]>(['chats', userId])?.map((row) => row.id)).toEqual([originId])
  })

  it('keeps opened side chats and threads when the chat list refreshes without them', () => {
    useChat.setState((state) => ({ chats: [...state.chats, chat('side', { kind: 'side' }), chat('thread', { kind: 'thread' }), chat('gone')] }))
    useChat.getState().replaceSummaries([serverChat(originId)])
    expect(useChat.getState().chats.map((item) => item.id).sort()).toEqual([originId, 'side', 'thread'].sort())
  })

  it('resolves and reopens a thread', async () => {
    useChat.setState((state) => ({ chats: [...state.chats, chat('thread', { kind: 'thread' })] }))
    reply = serverChat('thread', { kind: 'thread', threadResolvedAt: '2026-11-18T12:00:00.000Z' })

    await useChat.getState().setThreadResolved('thread', true)

    expect(requests[0]).toMatchObject({ path: '/api/chats/thread/thread', method: 'PATCH', body: { resolved: true } })
    expect(useChat.getState().chats.find((item) => item.id === 'thread')?.threadResolvedAt).toBe(Date.parse('2026-11-18T12:00:00.000Z'))

    reply = serverChat('thread', { kind: 'thread', threadResolvedAt: null })
    await useChat.getState().setThreadResolved('thread', false)
    expect(useChat.getState().chats.find((item) => item.id === 'thread')?.threadResolvedAt).toBeNull()
  })

  it('marks the user message of a thread update turn', () => {
    useChat.getState().setDetailedChat(serverChat(originId, {
      activeResponseId: responseId,
      activeBranchLeafId: responseId,
      responses: [{
        id: responseId, parentResponseId: null, userMessageId: null, modelId: 'test-model', status: 'completed',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Thread update — sent automatically' }] }],
        output: [], presetSelections: {}, usage: null, error: null, createdAt: new Date(2_000).toISOString(), completedAt: null,
        threadUpdate: true,
        snapshot: { responseId, sequence: 1, status: 'completed', output: [], usage: null, error: null, updatedAt: new Date(2_000).toISOString() } as never,
        branches: { user: { ids: [responseId], index: 0 }, assistant: { ids: [responseId], index: 0 } },
      }],
    }))
    const messages = useChat.getState().chats.find((item) => item.id === originId)!.messages
    expect(messages[0]).toMatchObject({ role: 'user', threadUpdate: true, content: 'Thread update — sent automatically' })
    expect(messages[1]?.threadUpdate).toBeUndefined()
  })
})

describe('isSidebarChat', () => {
  it('lists saved ordinary chats only', () => {
    expect(isSidebarChat({ temporary: false })).toBe(true)
    expect(isSidebarChat({ temporary: false, kind: 'chat' })).toBe(true)
    expect(isSidebarChat({ temporary: true, kind: 'chat' })).toBe(false)
    expect(isSidebarChat({ temporary: false, kind: 'side' })).toBe(false)
    expect(isSidebarChat({ temporary: false, kind: 'thread' })).toBe(false)
  })
})
