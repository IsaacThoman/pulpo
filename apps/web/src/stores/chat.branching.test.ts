import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResponseSnapshot } from '@pulpo/contracts'

const storage = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() { return storage.size },
}
vi.stubGlobal('localStorage', localStorageStub)
vi.stubGlobal('navigator', { onLine: true })
vi.stubGlobal('document', {
  documentElement: { classList: { toggle: vi.fn() } },
})
vi.stubGlobal('window', {
  localStorage: localStorageStub,
  matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  setTimeout,
  clearTimeout,
})

interface PendingRequest {
  path: string
  method?: string
  body?: unknown
  resolve: (body: unknown) => void
  reject: (error: unknown) => void
}

const requests: PendingRequest[] = []
let networkFailure = false
vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
  if (networkFailure) throw new TypeError('Failed to fetch')
  requests.push({
    path: String(input),
    method: init?.method,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    resolve: (body) => resolve(new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
    reject,
  })
})))

const [{ useChat }, { useAuth }, { useSettings }, { queryClient }, { withBranchMetadata }, { useCatalog }] = await Promise.all([
  import('./chat'),
  import('./auth'),
  import('./settings'),
  import('@/lib/query-client'),
  import('@/lib/message-branches'),
  import('./catalog'),
])
import type { Model } from '@/lib/types'
import type { ServerChat, ServerResponse } from './chat'

const userId = '00000000-0000-4000-8000-000000000001'
const chatId = '00000000-0000-4000-8000-000000000002'
const responseAId = '00000000-0000-4000-8000-000000000003'
const createdAt = '2026-08-03T12:00:00.000Z'

const testModel: Model = {
  id: 'test-model',
  name: 'Test model',
  providerGroupId: 'test-provider',
  provider: 'Test provider',
  inferenceProvider: 'Test provider',
  labLogo: 'pulpo',
  modelLogo: 'pulpo',
  description: '',
  contextWindow: 128_000,
  tags: ['reasoning'],
  iconLight: '#000000',
  iconDark: '#ffffff',
  inputPrice: 0,
  outputPrice: 0,
  perMessagePrice: 0,
  enabled: true,
  agentEnabled: true,
  presets: [{
    id: 'reasoning',
    name: 'Reasoning',
    icon: 'brain',
    defaultChoiceId: 'low',
    choices: [
      { id: 'low', displayName: 'Low', action: { type: 'params', params: { reasoning_effort: 'low' } } },
      { id: 'high', displayName: 'High', action: { type: 'params', params: { reasoning_effort: 'high' } } },
    ],
  }],
}

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

function responseStub(source: ServerResponse & { snapshot: ResponseSnapshot }): ServerResponse {
  const { output: _output, ...snapshot } = source.snapshot
  return {
    ...source,
    input: [],
    output: [],
    presetSelections: {},
    usage: null,
    error: null,
    snapshot,
    detailAvailable: false,
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
      username: 'test_user',
      avatarUrl: null,
      profileColor: null,
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
  useSettings.setState({
    automaticChatExpiration: 'disabled',
    newChatAutoExpire: true,
    agentModes: { 'test-model': false },
    generation: {},
  })
  useCatalog.setState({ models: [testModel], loaded: true, agentAvailable: true })
  queryClient.clear()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('chat store branching integration', () => {
  it('projects the settled response cost from micros to USD', () => {
    const settled = {
      ...response(responseAId, 'completed'),
      usage: { inputTokens: 802, outputTokens: 12 },
      costMicros: 4_200,
      subscriptionCoveredMicros: 3_000,
    }

    useChat.getState().setDetailedChat(detail(responseAId, [settled]))

    expect(useChat.getState().chats[0]?.messages.find((message) => message.id === responseAId)).toMatchObject({
      tokensIn: 802,
      tokensOut: 12,
      cost: 0.0042,
      subscriptionCoveredCost: 0.003,
    })
  })

  it('preserves local folder expansion when server metadata refreshes', () => {
    useChat.setState({
      folders: [{ id: 'folder-1', name: 'Old name', pinned: false, expanded: false, sortOrder: 0 }],
    })

    useChat.getState().replaceFolders([{ id: 'folder-1', name: 'Renamed', pinned: true, sortOrder: 2 }])

    expect(useChat.getState().folders).toEqual([
      { id: 'folder-1', name: 'Renamed', pinned: true, expanded: false, sortOrder: 2 },
    ])
  })

  it('persists the new-chat expiration choice independently from the duration', () => {
    useSettings.setState({ automaticChatExpiration: '24h', newChatAutoExpire: true })

    useSettings.getState().set('newChatAutoExpire', false)

    expect(useSettings.getState()).toMatchObject({
      automaticChatExpiration: '24h',
      newChatAutoExpire: false,
    })
    expect(JSON.parse(storage.get('pulpo-settings') ?? '{}').state).toMatchObject({ newChatAutoExpire: false })
  })

  it('starts an expiring chat with an optimistic deadline and the create flag', async () => {
    useSettings.setState({ automaticChatExpiration: '24h' })
    const before = Date.now()
    const id = useChat.getState().sendMessage(null, 'expiring prompt', 'test-model', [], false, true)

    const optimistic = useChat.getState().chats.find((chat) => chat.id === id)
    expect(optimistic?.expiresAt).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1_000)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      path: '/api/chats/start',
      method: 'POST',
      body: expect.objectContaining({ chat: expect.objectContaining({ autoExpire: true, temporary: false }) }),
    })
    requests[0]!.reject(new Error('Stop test request'))
    await vi.waitFor(() => expect(
      useChat.getState().chats.find((chat) => chat.id === id)?.messages.at(-1)?.done,
    ).toBe(true))
  })

  it('preserves a new chat across a summaries refresh until creation completes', async () => {
    const id = useChat.getState().sendMessage(null, 'new chat prompt', 'test-model')

    expect(useChat.getState().chats.find((chat) => chat.id === id)).toMatchObject({
      provisional: true,
    })

    useChat.getState().replaceSummaries([])

    expect(useChat.getState().chats.some((chat) => chat.id === id)).toBe(true)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    requests[0]!.resolve({})
    await vi.waitFor(() => expect(
      useChat.getState().chats.find((chat) => chat.id === id)?.provisional,
    ).toBe(false))
  })

  it('optimistically toggles an existing deadline and rolls back a rejected change', async () => {
    useSettings.setState({ automaticChatExpiration: '7d', newChatAutoExpire: false })
    const initial = detail(responseAId, [response(responseAId, 'completed')])
    queryClient.setQueryData(['chat', userId, chatId], initial)
    queryClient.setQueryData(['chats', userId], [initial])
    useChat.getState().setDetailedChat(initial)

    useChat.getState().setChatAutoExpiration(chatId, true)
    expect(useChat.getState().chats.find((chat) => chat.id === chatId)?.expiresAt).not.toBeNull()
    expect(useSettings.getState().newChatAutoExpire).toBe(false)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      path: `/api/chats/${chatId}`,
      method: 'PATCH',
      body: { autoExpire: true },
    })

    requests[0]!.reject(new Error('Expiration rejected'))
    await vi.waitFor(() => expect(
      useChat.getState().chats.find((chat) => chat.id === chatId)?.expiresAt,
    ).toBeNull())
    expect(queryClient.getQueryData<ServerChat>(['chat', userId, chatId])?.expiresAt).toBeNull()
  })

  it('disables an existing deadline from chat actions', async () => {
    const initial = {
      ...detail(responseAId, [response(responseAId, 'completed')]),
      expiresAt: '2026-08-17T12:00:00.000Z',
    }
    queryClient.setQueryData(['chat', userId, chatId], initial)
    queryClient.setQueryData(['chats', userId], [initial])
    useChat.getState().setDetailedChat(initial)

    useChat.getState().setChatAutoExpiration(chatId, false)

    expect(useChat.getState().chats.find((chat) => chat.id === chatId)?.expiresAt).toBeNull()
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      path: `/api/chats/${chatId}`,
      method: 'PATCH',
      body: { autoExpire: false },
    })
    requests[0]!.resolve({ ...initial, expiresAt: null })
  })

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

  it.each(['queued', 'in_progress'] as const)('edits a user message while its response is %s', async (status) => {
    const originalId = crypto.randomUUID()
    const responseA = response(originalId, status)
    const initial = detail(originalId, [responseA])
    queryClient.setQueryData(['chat', userId, chatId], initial)
    useChat.getState().setDetailedChat(initial)

    const edit = useChat.getState().editUserMessage({
      chatId,
      messageId: `${originalId}:input`,
      content: 'edited while generating',
      modelId: 'test-model',
      attachments: [],
      agentMode: false,
    })

    const optimistic = queryClient.getQueryData<ServerChat>(['chat', userId, chatId])!
    const responseBId = optimistic.activeBranchLeafId!
    const responseB = optimistic.responses!.find((item) => item.id === responseBId)!
    expect(responseBId).not.toBe(originalId)
    expect(responseB.parentResponseId).toBe(responseA.parentResponseId)
    expect(responseB.userMessageId).not.toBe(responseA.userMessageId)
    expect(new Set(useChat.getState().streamingIds)).toEqual(new Set([originalId, responseBId]))
    expectOnly(responseBId)

    await vi.waitFor(() => expect(requests).toHaveLength(1))
    requests[0]!.resolve({ response: responseB.snapshot })
    await edit

    const responseACompleted = response(originalId, 'completed')
    useChat.getState().applyResponseSnapshot(responseACompleted.snapshot)
    expect(queryClient.getQueryData<ServerChat>(['chat', userId, chatId])?.activeBranchLeafId).toBe(responseBId)
    expect(useChat.getState().streamingIds).toContain(responseBId)
    expect(useChat.getState().streamingIds).not.toContain(originalId)

    const responseBCompleted = {
      ...response(responseBId, 'completed'),
      userMessageId: responseB.userMessageId,
      input: responseB.input,
    }
    useChat.getState().applyResponseSnapshot(responseBCompleted.snapshot)
    useChat.getState().setDetailedChat(detail(responseBId, [responseACompleted, responseBCompleted]))
    expectOnly(responseBId)
    expect(useChat.getState().streamingIds).toEqual([])
  })

  it('keeps the edited branch selected when it completes before its running sibling', async () => {
    const originalId = crypto.randomUUID()
    const responseA = response(originalId, 'in_progress')
    const initial = detail(originalId, [responseA])
    queryClient.setQueryData(['chat', userId, chatId], initial)
    useChat.getState().setDetailedChat(initial)

    const edit = useChat.getState().editUserMessage({
      chatId,
      messageId: `${originalId}:input`,
      content: 'edited branch finishes first',
      modelId: 'test-model',
      attachments: [],
      agentMode: false,
    })
    const optimistic = queryClient.getQueryData<ServerChat>(['chat', userId, chatId])!
    const responseBId = optimistic.activeBranchLeafId!
    const responseB = optimistic.responses!.find((item) => item.id === responseBId)!
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    requests[0]!.resolve({ response: responseB.snapshot })
    await edit

    const responseBCompleted = {
      ...response(responseBId, 'completed'),
      userMessageId: responseB.userMessageId,
      input: responseB.input,
    }
    useChat.getState().applyResponseSnapshot(responseBCompleted.snapshot)
    expect(queryClient.getQueryData<ServerChat>(['chat', userId, chatId])?.activeBranchLeafId).toBe(responseBId)
    expect(useChat.getState().streamingIds).toContain(originalId)

    const responseACompleted = response(originalId, 'completed')
    useChat.getState().applyResponseSnapshot(responseACompleted.snapshot)
    useChat.getState().setDetailedChat(detail(responseBId, [responseACompleted, responseBCompleted]))
    expect(queryClient.getQueryData<ServerChat>(['chat', userId, chatId])?.activeBranchLeafId).toBe(responseBId)
    expectOnly(responseBId)
    expect(useChat.getState().streamingIds).toEqual([])
  })

  it('restores the exact active descendant when an earlier-message edit fails', async () => {
    const responseA = response(responseAId, 'completed')
    const descendantId = '00000000-0000-4000-8000-000000000007'
    const descendant = {
      ...response(descendantId, 'in_progress'),
      parentResponseId: responseAId,
      userMessageId: '00000000-0000-4000-8000-000000000008',
    }
    const initial = detail(descendantId, [responseA, descendant])
    queryClient.setQueryData(['chat', userId, chatId], initial)
    useChat.getState().setDetailedChat(initial)

    const edit = useChat.getState().editUserMessage({
      chatId,
      messageId: `${responseAId}:input`,
      content: 'failed edit',
      modelId: 'test-model',
      attachments: [],
      agentMode: false,
    })
    const optimisticLeaf = queryClient.getQueryData<ServerChat>(['chat', userId, chatId])?.activeBranchLeafId
    expect(optimisticLeaf).not.toBe(descendantId)

    await vi.waitFor(() => expect(requests).toHaveLength(1))
    requests[0]!.reject(new Error('edit failed'))
    await expect(edit).rejects.toThrow('edit failed')

    expect(queryClient.getQueryData<ServerChat>(['chat', userId, chatId])?.activeBranchLeafId).toBe(descendantId)
    expect(visibleResponseIds()).toEqual([responseAId, descendantId])
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

  it('regenerates with the Agent and preset state selected when the action starts', async () => {
    const responseA = {
      ...response(responseAId, 'completed'),
      agentMode: false,
      presetSelections: { reasoning: 'low' },
    }
    const initial = detail(responseAId, [responseA])
    queryClient.setQueryData(['chat', userId, chatId], initial)
    useChat.getState().setDetailedChat(initial)
    useSettings.setState({
      agentModes: { 'another-model': false },
      generation: { 'test-model': { reasoning: 'high' } },
    })

    useChat.getState().regenerate(chatId, responseAId, 'test-model')

    const optimistic = queryClient.getQueryData<ServerChat>(['chat', userId, chatId])!
    const responseBId = optimistic.activeBranchLeafId!
    expect(optimistic.responses?.find((item) => item.id === responseBId)).toMatchObject({
      agentMode: true,
      presetSelections: { reasoning: 'high' },
    })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]?.body).toMatchObject({
      modelId: 'test-model',
      presetSelections: { reasoning: 'high' },
      agentMode: true,
    })
    requests[0]!.resolve({ response: optimistic.responses!.find((item) => item.id === responseBId)!.snapshot })
    const completed = {
      ...response(responseBId, 'completed'),
      agentMode: true,
      presetSelections: { reasoning: 'high' },
    }
    useChat.getState().applyResponseSnapshot(completed.snapshot)
    useChat.getState().setDetailedChat(detail(responseBId, [responseA, completed]))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('loads an uncached branch in one activation request and switches back from cache immediately', async () => {
    const responseBId = '00000000-0000-4000-8000-000000000005'
    const responseA = response(responseAId, 'completed')
    const responseB = response(responseBId, 'completed')
    const initial = detail(responseAId, [responseA, responseStub(responseB)])
    queryClient.setQueryData(['chat', userId, chatId], initial)
    useChat.getState().setDetailedChat(initial)

    useChat.getState().activateBranch(chatId, responseBId)
    expectOnly(responseAId)
    await vi.waitFor(() => expect(requests).toHaveLength(1))

    const activatedB = detail(responseBId, [responseStub(responseA), responseB])
    requests[0]!.resolve({ activeBranchLeafId: responseBId, responses: activatedB.responses })
    await vi.waitFor(() => expectOnly(responseBId))
    expect(requests).toHaveLength(1)

    useChat.getState().activateBranch(chatId, responseAId)
    expectOnly(responseAId)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    const activatedA = detail(responseAId, [responseA, responseStub(responseB)])
    requests[1]!.resolve({ activeBranchLeafId: responseAId, responses: activatedA.responses })
  })

  it('does not downgrade a cached branch when an active-only detail refresh returns its stub', () => {
    const responseBId = '00000000-0000-4000-8000-000000000005'
    const responseA = response(responseAId, 'completed')
    const responseB = response(responseBId, 'completed')
    const cached = detail(responseBId, [responseA, responseB])
    queryClient.setQueryData(['chat', userId, chatId], cached)
    useChat.getState().setDetailedChat(cached)

    useChat.getState().setDetailedChat(detail(responseAId, [responseA, responseStub(responseB)]))

    expect(queryClient.getQueryData<ServerChat>(['chat', userId, chatId])?.responses
      ?.find((item) => item.id === responseBId)).toMatchObject({
      output: responseB.output,
      detailAvailable: true,
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
