import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResponseSnapshot } from '@pulpo/contracts'

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() { return storage.size },
})
vi.stubGlobal('navigator', { onLine: true })
vi.stubGlobal('document', {
  documentElement: { classList: { toggle: vi.fn() } },
})
vi.stubGlobal('window', {
  matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  setTimeout,
  clearTimeout,
})

interface PendingRequest {
  path: string
  method?: string
  body?: unknown
  resolve: (body: unknown) => void
}

const requests: PendingRequest[] = []
let networkFailure = false
vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve) => {
  if (networkFailure) throw new TypeError('Failed to fetch')
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

const [{ useChat }, { useAuth }, { queryClient }, { withBranchMetadata }] = await Promise.all([
  import('./chat'),
  import('./auth'),
  import('@/lib/query-client'),
  import('@/lib/message-branches'),
])
import type { ServerChat, ServerResponse } from './chat'

const userId = '00000000-0000-4000-8000-000000000001'
const chatId = '00000000-0000-4000-8000-000000000002'
const responseAId = '00000000-0000-4000-8000-000000000003'
const createdAt = '2026-08-03T12:00:00.000Z'

function response(id: string, status: ServerResponse['status']): ServerResponse & { snapshot: ResponseSnapshot } {
  const done = !['queued', 'in_progress'].includes(status)
  const output = done ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: id }] }] : []
  return {
    id,
    parentResponseId: null,
    userMessageId: '00000000-0000-4000-8000-000000000004',
    modelId: 'test-model',
    displayModelId: 'test-model',
    status,
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'one prompt' }] }],
    output,
    presetSelections: {},
    usage: null,
    error: null,
    createdAt,
    completedAt: done ? createdAt : null,
    snapshot: {
      responseId: id,
      status,
      sequence: done ? 2 : 0,
      output,
      usage: null,
      error: null,
      updatedAt: createdAt,
    },
    branches: {
      user: { ids: [id], index: 0 },
      assistant: { ids: [id], index: 0 },
    },
  }
}

function detail(activeId: string, responses: ServerResponse[]): ServerChat {
  return {
    id: chatId,
    title: 'Branch test',
    modelId: 'test-model',
    pinned: false,
    folderId: null,
    createdAt,
    updatedAt: createdAt,
    activeResponseId: activeId,
    activeBranchLeafId: activeId,
    responses: withBranchMetadata(responses),
  }
}

function visibleResponseIds(): string[] {
  return useChat.getState().chats.find((chat) => chat.id === chatId)?.messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.id) ?? []
}

function expectOnly(responseId: string): void {
  const chat = useChat.getState().chats.find((item) => item.id === chatId)
  expect(chat?.messages.map((message) => message.id)).toEqual([`${responseId}:input`, responseId])
  expect(visibleResponseIds()).toEqual([responseId])
}

beforeEach(() => {
  networkFailure = false
  requests.splice(0)
  useAuth.setState({
    user: {
      id: userId,
      name: 'Test User',
      email: 'test@example.com',
      role: 'user',
      initials: 'TU',
      balanceMicros: 1_000_000,
      storageLimitBytes: 1_000_000,
      blocked: false,
      stateRevision: 0,
      createdAt,
    },
  })
  useChat.setState({
    chats: [],
    folders: [],
    activeChatId: chatId,
    activeTemporaryChatId: null,
    streamingIds: [],
    responseSequences: {},
    responseChatIds: {},
  })
  queryClient.clear()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('chat store branching integration', () => {
  it('fails a temporary send instead of persisting it to the offline outbox', async () => {
    networkFailure = true
    const temporaryId = useChat.getState().sendMessage(null, 'private prompt', 'test-model', [], true)

    await vi.waitFor(() => {
      const assistant = useChat.getState().chats.find((chat) => chat.id === temporaryId)?.messages.at(-1)
      expect(assistant).toMatchObject({ done: true, error: 'Failed to fetch' })
    })
  })

  it('keeps a temporary start routeless, preserves it across summaries, and waits to persist', async () => {
    const temporaryId = useChat.getState().sendMessage(null, 'private prompt', 'test-model', [], true)
    const temporaryChat = useChat.getState().chats.find((chat) => chat.id === temporaryId)

    expect(temporaryChat).toMatchObject({ temporary: true, expired: false })
    expect(useChat.getState().activeTemporaryChatId).toBe(temporaryId)
    expect(queryClient.getQueryData<ServerChat[]>(['chats', userId])).toBeUndefined()

    useChat.getState().replaceSummaries([])
    expect(useChat.getState().chats.some((chat) => chat.id === temporaryId)).toBe(true)

    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const save = useChat.getState().persistTemporaryChat(temporaryId)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests).toHaveLength(1)

    requests[0]!.resolve({})
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toMatchObject({
      path: `/api/chats/${temporaryId}/persist`,
      method: 'POST',
    })
    requests[1]!.resolve({
      id: temporaryId,
      title: 'private prompt',
      modelId: 'test-model',
      pinned: false,
      folderId: null,
      temporary: false,
      expiresAt: null,
      createdAt,
      updatedAt: createdAt,
      activeResponseId: null,
      activeBranchLeafId: null,
    })
    await save

    expect(useChat.getState().activeTemporaryChatId).toBeNull()
    expect(useChat.getState().chats.find((chat) => chat.id === temporaryId)?.temporary).toBe(false)
  })

  it('creates and submits a distinct user branch for unchanged text', async () => {
    const responseA = response(responseAId, 'completed')
    const initial = detail(responseAId, [responseA])
    queryClient.setQueryData(['chat', userId, chatId], initial)
    useChat.getState().setDetailedChat(initial)

    void useChat.getState().editUserMessage({
      chatId,
      messageId: `${responseAId}:input`,
      content: 'one prompt',
      modelId: 'test-model',
      attachments: [],
      agentMode: false,
    })

    const optimistic = queryClient.getQueryData<ServerChat>(['chat', userId, chatId])!
    const responseBId = optimistic.activeBranchLeafId!
    const responseB = optimistic.responses!.find((item) => item.id === responseBId)!
    expect(responseBId).not.toBe(responseAId)
    expect(responseB.userMessageId).not.toBe(responseA.userMessageId)
    expect(responseB.input).toEqual(responseA.input)
    expect(responseB.branches.user).toEqual({ ids: [responseAId, responseBId], index: 1 })
    expectOnly(responseBId)

    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      path: `/api/messages/${responseAId}:input`,
      method: 'PATCH',
      body: expect.objectContaining({ content: 'one prompt' }),
    })
    requests[0]!.resolve({ response: responseB.snapshot })

    const completed = {
      ...response(responseBId, 'completed'),
      userMessageId: responseB.userMessageId,
    }
    useChat.getState().applyResponseSnapshot(completed.snapshot)
    useChat.getState().setDetailedChat(detail(responseBId, [responseA, completed]))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('creates an attachment-specific user branch without mutating its sibling', async () => {
    const oldAttachmentId = '00000000-0000-4000-8000-000000000005'
    const newAttachmentId = '00000000-0000-4000-8000-000000000006'
    const responseA = response(responseAId, 'completed')
    responseA.input = [{ role: 'user', content: [
      { type: 'input_text', text: 'one prompt' },
      { type: 'input_file', attachment_id: oldAttachmentId },
    ] }]
    const initial = {
      ...detail(responseAId, [responseA]),
      attachments: [{ id: oldAttachmentId, originalName: 'old.png', mimeType: 'image/png', sizeBytes: 10 }],
    }
    queryClient.setQueryData(['chat', userId, chatId], initial)
    useChat.getState().setDetailedChat(initial)

    const edit = useChat.getState().editUserMessage({
      chatId,
      messageId: `${responseAId}:input`,
      content: 'one prompt',
      modelId: 'test-model',
      attachments: [{ id: newAttachmentId, name: 'new.pdf', mimeType: 'application/pdf', type: 'file', size: 20 }],
      agentMode: true,
    })

    const optimistic = queryClient.getQueryData<ServerChat>(['chat', userId, chatId])!
    const responseBId = optimistic.activeBranchLeafId!
    const responseB = optimistic.responses!.find((item) => item.id === responseBId)!
    expect(JSON.stringify(responseA.input)).toContain(oldAttachmentId)
    expect(JSON.stringify(responseA.input)).not.toContain(newAttachmentId)
    expect(JSON.stringify(responseB.input)).toContain(newAttachmentId)
    expect(JSON.stringify(responseB.input)).not.toContain(oldAttachmentId)
    expect(optimistic.attachments?.map((attachment) => attachment.id)).toEqual([oldAttachmentId, newAttachmentId])

    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]?.body).toMatchObject({
      attachmentIds: [newAttachmentId],
      agentMode: true,
    })
    requests[0]!.resolve({ response: responseB.snapshot })
    await edit
    const completed = {
      ...response(responseBId, 'completed'),
      input: responseB.input,
      userMessageId: responseB.userMessageId,
      agentMode: true,
    }
    useChat.getState().applyResponseSnapshot(completed.snapshot)
    useChat.getState().setDetailedChat({
      ...detail(responseBId, [responseA, completed]),
      attachments: optimistic.attachments,
    })
  })

  it('keeps one visible turn through regenerate, back, forward, stale detail, and completion', async () => {
    const responseA = response(responseAId, 'completed')
    const initial = detail(responseAId, [responseA])
    queryClient.setQueryData(['chat', userId, chatId], initial)
    useChat.getState().setDetailedChat(initial)
    expectOnly(responseAId)

    useChat.getState().regenerate(chatId, responseAId, 'test-model')
    const optimistic = queryClient.getQueryData<ServerChat>(['chat', userId, chatId])!
    const responseBId = optimistic.activeBranchLeafId!
    expect(responseBId).not.toBe(responseAId)
    expectOnly(responseBId)

    useChat.getState().activateBranch(chatId, responseAId)
    expectOnly(responseAId)
    useChat.getState().activateBranch(chatId, responseBId)
    expectOnly(responseBId)

    await vi.waitFor(() => expect(requests).toHaveLength(1))
    requests[0]!.resolve({ response: optimistic.responses!.find((item) => item.id === responseBId)!.snapshot })
    await vi.waitFor(() => expect(requests).toHaveLength(2))

    const responseBStreaming = response(responseBId, 'in_progress')
    useChat.getState().setDetailedChat(detail(responseBId, [responseA, responseBStreaming]))
    expectOnly(responseBId)

    // An older detail response arrives after B was already acknowledged.
    useChat.getState().setDetailedChat(detail(responseAId, [responseA]))
    expectOnly(responseBId)

    requests[1]!.resolve({ activeBranchLeafId: responseAId })
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    useChat.getState().setDetailedChat(detail(responseAId, [responseA, responseBStreaming]))
    expectOnly(responseBId)

    requests[2]!.resolve({ activeBranchLeafId: responseBId })
    await vi.waitFor(() => expect(
      queryClient.getQueryData<ServerChat>(['chat', userId, chatId])?.activeBranchLeafId,
    ).toBe(responseBId))
    expectOnly(responseBId)

    const responseBCompleted = response(responseBId, 'completed')
    useChat.getState().applyResponseSnapshot(responseBCompleted.snapshot)
    expectOnly(responseBId)

    useChat.getState().setDetailedChat(detail(responseBId, [responseA, responseBCompleted]))
    expectOnly(responseBId)

    // Repeat with another regeneration and several rapid switches. Navigation
    // must enqueue only activation requests and must never append sibling turns.
    useChat.getState().regenerate(chatId, responseBId, 'test-model')
    const secondOptimistic = queryClient.getQueryData<ServerChat>(['chat', userId, chatId])!
    const responseCId = secondOptimistic.activeBranchLeafId!
    const responseCStreaming = response(responseCId, 'in_progress')
    expectOnly(responseCId)

    useChat.getState().activateBranch(chatId, responseAId)
    expectOnly(responseAId)
    useChat.getState().activateBranch(chatId, responseCId)
    expectOnly(responseCId)
    useChat.getState().activateBranch(chatId, responseBId)
    expectOnly(responseBId)

    await vi.waitFor(() => expect(requests).toHaveLength(4))
    expect(requests[3]!.path).toContain(`/api/messages/${responseBId}/regenerate`)
    requests[3]!.resolve({ response: responseCStreaming.snapshot })
    await vi.waitFor(() => expect(requests).toHaveLength(5))

    const allThree = [responseA, responseBCompleted, responseCStreaming]
    useChat.getState().setDetailedChat(detail(responseCId, allThree))
    expectOnly(responseBId)
    // A stale response predating C must not turn C into a local follow-up.
    useChat.getState().setDetailedChat(detail(responseAId, [responseA, responseBCompleted]))
    expectOnly(responseBId)

    expect(requests[4]!.path).toContain(`/api/messages/${responseAId}/activate`)
    requests[4]!.resolve({ activeBranchLeafId: responseAId })
    await vi.waitFor(() => expect(requests).toHaveLength(6))
    useChat.getState().setDetailedChat(detail(responseAId, allThree))
    expectOnly(responseBId)

    expect(requests[5]!.path).toContain(`/api/messages/${responseCId}/activate`)
    requests[5]!.resolve({ activeBranchLeafId: responseCId })
    await vi.waitFor(() => expect(requests).toHaveLength(7))
    useChat.getState().setDetailedChat(detail(responseCId, allThree))
    expectOnly(responseBId)

    expect(requests[6]!.path).toContain(`/api/messages/${responseBId}/activate`)
    requests[6]!.resolve({ activeBranchLeafId: responseBId })
    await vi.waitFor(() => expect(
      queryClient.getQueryData<ServerChat>(['chat', userId, chatId])?.activeBranchLeafId,
    ).toBe(responseBId))
    expectOnly(responseBId)

    const responseCCompleted = response(responseCId, 'completed')
    useChat.getState().applyResponseSnapshot(responseCCompleted.snapshot)
    expectOnly(responseBId)
    useChat.getState().setDetailedChat(detail(responseBId, [responseA, responseBCompleted, responseCCompleted]))
    expectOnly(responseBId)
    expect(queryClient.getQueryData<ServerChat>(['chat', userId, chatId])?.responses).toHaveLength(3)
  })
})
