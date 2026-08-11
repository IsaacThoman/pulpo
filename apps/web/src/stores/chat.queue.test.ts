import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueuedMessage } from '@pulpo/contracts'

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

const requests: Array<{ path: string; method?: string; body?: unknown; resolve: (body: unknown) => void }> = []
vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve) => {
  requests.push({
    path: String(input),
    method: init?.method,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    resolve: (body) => resolve(new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
  })
})))

const [{ useChat }, { useAuth }, { queryClient }] = await Promise.all([
  import('./chat'),
  import('./auth'),
  import('@/lib/query-client'),
])

const userId = '00000000-0000-4000-8000-000000000001'
const chatId = '00000000-0000-4000-8000-000000000002'
const createdAt = '2026-08-07T12:00:00.000Z'

function queued(overrides: Partial<QueuedMessage> = {}): QueuedMessage {
  return {
    id: '00000000-0000-4000-8000-000000000003',
    chatId,
    content: 'queued prompt',
    modelId: 'test-model',
    presetSelections: {},
    agentMode: false,
    position: 4,
    status: 'pending',
    error: null,
    attachments: [],
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  }
}

beforeEach(() => {
  requests.splice(0)
  queryClient.clear()
  useAuth.setState({ user: {
    id: userId, name: 'Test', email: 'test@example.com', username: 'test_user', avatarUrl: null, profileColor: null, role: 'user', initials: 'T',
    balanceMicros: 1_000, storageLimitBytes: 1_000, blocked: false, stateRevision: 0, createdAt,
  } })
  useChat.setState({
    chats: [{
      id: chatId, title: 'Queue', modelId: 'test-model', messages: [], queuedMessages: [],
      createdAt: Date.parse(createdAt), updatedAt: Date.parse(createdAt), pinned: false,
      folderId: null, sortOrder: 0, tags: [], temporary: false, expiresAt: null, expired: false,
    }],
    streamingIds: [],
    responseSequences: {},
    responseChatIds: {},
  })
})

afterAll(() => vi.unstubAllGlobals())

describe('chat queue store', () => {
  it('optimistically appends and reconciles a server queued message', async () => {
    const pending = useChat.getState().enqueueMessage(chatId, {
      input: 'queued prompt', modelId: 'test-model', presetSelections: {}, attachmentIds: [], agentMode: false,
    }, [])

    expect(useChat.getState().chats[0]?.queuedMessages).toHaveLength(1)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({ path: `/api/chats/${chatId}/queued-messages`, method: 'POST' })
    requests[0]!.resolve({ queuedMessage: queued() })
    await pending

    expect(useChat.getState().chats[0]?.queuedMessages).toEqual([queued()])
  })

  it('keeps a queued item at the same position through editing', async () => {
    useChat.setState((state) => ({
      chats: state.chats.map((chat) => ({ ...chat, queuedMessages: [queued()] })),
    }))
    const pending = useChat.getState().updateQueuedMessage(chatId, queued().id, {
      action: 'save_edit', input: 'edited prompt', modelId: 'test-model',
      presetSelections: { effort: 'high' }, attachmentIds: [], agentMode: false,
    })

    expect(useChat.getState().chats[0]?.queuedMessages?.[0]).toMatchObject({
      content: 'edited prompt', position: 4, status: 'pending',
    })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const saved = queued({ content: 'edited prompt', presetSelections: { effort: 'high' } })
    requests[0]!.resolve({ queuedMessage: saved })
    await pending

    expect(useChat.getState().chats[0]?.queuedMessages).toEqual([saved])
  })

  it('optimistically reorders queued messages and reconciles server positions', async () => {
    const first = queued({ id: '00000000-0000-4000-8000-000000000003', position: 0 })
    const second = queued({ id: '00000000-0000-4000-8000-000000000004', position: 1, content: 'second' })
    const third = queued({ id: '00000000-0000-4000-8000-000000000005', position: 2, content: 'third' })
    useChat.setState((state) => ({
      chats: state.chats.map((chat) => ({ ...chat, queuedMessages: [first, second, third] })),
    }))

    const pending = useChat.getState().reorderQueuedMessage(chatId, third.id, first.id, 'before')
    expect(useChat.getState().chats[0]?.queuedMessages?.map((message) => message.id)).toEqual([
      third.id, first.id, second.id,
    ])
    expect(useChat.getState().chats[0]?.queuedMessages?.map((message) => message.position)).toEqual([0, 1, 2])
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      path: `/api/chats/${chatId}/queued-messages/${third.id}/reorder`,
      method: 'PATCH',
      body: { targetMessageId: first.id, edge: 'before' },
    })
    const saved = [third, first, second].map((message, position) => ({ ...message, position }))
    requests[0]!.resolve({ queuedMessages: saved })
    await pending

    expect(useChat.getState().chats[0]?.queuedMessages).toEqual(saved)
  })
})
