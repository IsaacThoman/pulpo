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
  resolve: (body: unknown, status?: number) => void
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
    resolve: (body, status = 200) => resolve(new Response(JSON.stringify(body), {
      status,
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
  it('projects settled and inference reference response costs from micros to USD', () => {
    const settled = {
      ...response(responseAId, 'completed'),
      usage: { inputTokens: 802, outputTokens: 12 },
      costMicros: 4_200,
      inferenceReferenceCostMicros: 38_500,
      subscriptionCoveredMicros: 3_000,
    }

    useChat.getState().setDetailedChat(detail(responseAId, [settled]))

    expect(useChat.getState().chats[0]?.messages.find((message) => message.id === responseAId)).toMatchObject({
      tokensIn: 802,
      tokensOut: 12,
      cost: 0.0042,
      inferenceReferenceCost: 0.0385,
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

  it('preserves a new chat until summaries acknowledge it, including after creation completes', async () => {
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

    const server = queryClient.getQueryData<ServerChat>(['chat', userId, id])!
    useChat.getState().setDetailedChat(server)
    useChat.getState().replaceSummaries([])
    expect(useChat.getState().chats.find((chat) => chat.id === id)).toMatchObject({
      provisional: false, awaitingSummary: true,
    })

    useChat.getState().replaceSummaries([server])
    expect(useChat.getState().chats.find((chat) => chat.id === id)?.awaitingSummary).toBe(false)
    // Once acknowledged, a later omission can represent a real remote deletion.
    useChat.getState().replaceSummaries([])
    expect(useChat.getState().chats.some((chat) => chat.id === id)).toBe(false)
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

  // Issue #226: reservation rejection deletes the server response (and new chat).
  it.each(['new', 'existing', 'temporary'] as const)(
    'resubmits an insufficient-balance message in a %s chat',
    async (kind) => {
      useCatalog.setState({ models: [{ ...testModel, outputPrice: 10 }, { ...testModel, id: 'cheaper-model', outputPrice: 0.01 }] })
      const existingChatId = crypto.randomUUID()
      if (kind === 'existing') {
        const initial = { ...detail(responseAId, [response(responseAId, 'completed')]), id: existingChatId }
        queryClient.setQueryData(['chat', userId, existingChatId], initial)
        useChat.getState().setDetailedChat(initial)
      }
      const targetChatId = useChat.getState().sendMessage(
        kind === 'existing' ? existingChatId : null, 'one prompt', 'test-model', [], kind === 'temporary', true,
      )
      await vi.waitFor(() => expect(requests).toHaveLength(1))
      const failedMessageId = useChat.getState().chats.find((chat) => chat.id === targetChatId)!.messages.at(-2)!.id
      const balanceError = 'Insufficient balance for the maximum request cost'
      requests[0]!.resolve({ error: { code: 'insufficient_balance', message: balanceError } }, 402)
      await vi.waitFor(() => expect(
        useChat.getState().chats.find((chat) => chat.id === targetChatId)?.messages.at(-1),
      ).toMatchObject({ done: true, error: balanceError }))

      const attachmentId = crypto.randomUUID()
      const retry = () => useChat.getState().editUserMessage({
        chatId: targetChatId,
        messageId: failedMessageId,
        content: 'one prompt',
        modelId: 'cheaper-model',
        attachments: [{ id: attachmentId, name: 'image.png', mimeType: 'image/png', size: 42, type: 'image' }],
        agentMode: true,
      })
      const firstRetry = retry()
      const rejection = expect(firstRetry).rejects.toMatchObject({ status: 402, message: balanceError })
      await vi.waitFor(() => expect(requests).toHaveLength(2))
      requests[1]!.resolve({ error: { code: 'insufficient_balance', message: balanceError } }, 402)
      await rejection
      expect(queryClient.getQueryData<ServerChat>(['chat', userId, targetChatId])?.responses).toHaveLength(kind === 'existing' ? 2 : 1)
      if (kind !== 'existing') {
        useChat.getState().replaceSummaries([])
        expect(useChat.getState().chats.some((chat) => chat.id === targetChatId)).toBe(true)
      }
      const edit = retry()
      await vi.waitFor(() => expect(requests).toHaveLength(3))
      expect(requests[2]).toMatchObject({
        path: kind === 'existing' ? `/api/chats/${targetChatId}/responses` : '/api/chats/start',
        method: 'POST',
      })
      const body = requests[2]!.body as { response?: Record<string, unknown> } & Record<string, unknown>
      const submitted = kind === 'existing' ? body : body.response!
      expect(submitted.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
      expect(submitted).toMatchObject({
        modelId: 'cheaper-model', input: 'one prompt', attachmentIds: [attachmentId], agentMode: true,
        parentResponseId: kind === 'existing' ? responseAId : null,
      })
      if (kind !== 'existing') expect(body.chat).toMatchObject({
        clientId: targetChatId, temporary: kind === 'temporary', autoExpire: true,
      })
      const retriedId = submitted.clientId as string
      requests[2]!.resolve({ response: response(retriedId, 'queued').snapshot }, 202)
      await edit
      const retriedDetail = queryClient.getQueryData<ServerChat>(['chat', userId, targetChatId])!
      expect(retriedDetail.responses?.some((item) => `${item.id}:input` === failedMessageId)).toBe(false)
      expect(retriedDetail.responses?.find((item) => item.id === retriedId)?.rejectedSend).toBeUndefined()
      expect(useChat.getState().chats.find((chat) => chat.id === targetChatId)?.provisional).toBe(false)
      useChat.getState().applyResponseSnapshot(response(retriedId, 'completed').snapshot)
      expect(useChat.getState().chats.find((chat) => chat.id === targetChatId)?.messages.at(-1)).toMatchObject({ id: retriedId, done: true })

    },
  )

  it('keeps a newly sent message visible in paginated history', async () => {
    const initial = { ...detail(responseAId, [response(responseAId, 'completed')]),
      history: { offset: 500, hasMore: true, before: responseAId, leafId: responseAId } }
    queryClient.setQueryData(['chat', userId, chatId], initial)
    useChat.getState().setDetailedChat(initial)
    useChat.getState().sendMessage(chatId, 'new paginated prompt', 'test-model')
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const optimistic = queryClient.getQueryData<ServerChat>(['chat', userId, chatId])!
    const newId = optimistic.activeBranchLeafId!
    expect(newId).not.toBe(responseAId)
    expect(visibleResponseIds()).toEqual([responseAId, newId])
    expect(useChat.getState().chats.find(chat => chat.id === chatId)?.history).toMatchObject({ offset: 500, leafId: newId })
    requests[0]!.resolve({ response: response(newId, 'queued').snapshot }, 202)
    await new Promise(resolve => setTimeout(resolve, 0))
    const completed = { ...optimistic.responses!.find(row => row.id === newId)!, status: 'completed' as const, snapshot: response(newId, 'completed').snapshot }
    useChat.getState().applyResponseSnapshot(completed.snapshot)
    useChat.getState().setDetailedChat({ ...optimistic, responses: [initial.responses![0]!, completed] })
  })

  it.each(['completed', 'failed'] as const)('creates a user branch for a persisted %s response', async (status) => {
    const responseA = response(responseAId, status)
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
      agentModes: { 'test-model': false },
      generation: { 'test-model': { reasoning: 'low' } },
    })

    useChat.getState().regenerate(chatId, responseAId, { modelId: 'test-model', presetSelections: { reasoning: 'high' }, agentMode: true })

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

  it('restores a visited paginated branch immediately and ignores superseded acknowledgments', async () => {
    const responseBId = '00000000-0000-4000-8000-000000000005'
    const paged = (id: string) => ({ ...detail(id, [response(id, 'completed')]),
      history: { offset: 500, hasMore: true, before: id, leafId: id } })
    const initial = paged(responseAId)
    queryClient.setQueryData(['chat', userId, chatId], initial)
    useChat.getState().setDetailedChat(initial)
    useChat.getState().activateBranch(chatId, responseBId)
    expectOnly(responseAId)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    requests[0]!.resolve(paged(responseBId))
    await vi.waitFor(() => expectOnly(responseBId))

    useChat.getState().activateBranch(chatId, responseAId)
    expectOnly(responseAId)
    expect(useChat.getState().chats[0]?.history?.offset).toBe(500)
    // React Query can publish a stale refetch before its bridge effect hydrates the store.
    queryClient.setQueryData(['chat', userId, chatId], paged(responseBId))
    useChat.getState().setDetailedChat(paged(responseBId))
    expectOnly(responseAId)
    expect(queryClient.getQueryData<ServerChat>(['chat', userId, chatId])?.activeBranchLeafId).toBe(responseAId)
    useChat.getState().activateBranch(chatId, responseBId)
    expectOnly(responseBId)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    requests[1]!.resolve(paged(responseAId))
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    expect(queryClient.getQueryData<ServerChat>(['chat', userId, chatId])?.activeBranchLeafId).toBe(responseBId)
    expectOnly(responseBId)
    requests[2]!.resolve(paged(responseBId))
  })

  it('does not hydrate an activation after its query was removed', async () => {
    const responseBId = '00000000-0000-4000-8000-000000000005'
    const initial = detail(responseAId, [response(responseAId, 'completed')])
    queryClient.setQueryData(['chat', userId, chatId], initial)
    useChat.getState().setDetailedChat(initial)
    useChat.getState().activateBranch(chatId, responseBId)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    queryClient.removeQueries({ queryKey: ['chat', userId, chatId] })
    useChat.setState({ chats: [] })
    requests[0]!.resolve(detail(responseBId, [response(responseBId, 'completed')]))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(queryClient.getQueryData(['chat', userId, chatId])).toBeUndefined()
    expect(useChat.getState().chats).toEqual([])
  })

  it('keeps server sibling counts when switching back during a regeneration in paged history', async () => {
    const responseBId = '00000000-0000-4000-8000-000000000005'
    const history = { offset: 0, hasMore: false, before: responseBId, leafId: responseBId }
    const assistantBranch = (ids: string[], id: string) => ({ ids, index: ids.indexOf(id) })
    // Paged history holds only the active lineage; A is known only through B's server metadata.
    const responseB = {
      ...response(responseBId, 'completed'),
      branches: { user: { ids: [responseBId], index: 0 }, assistant: assistantBranch([responseAId, responseBId], responseBId) },
    }
    const initial: ServerChat = { ...detail(responseBId, []), responses: [responseB], history }
    queryClient.setQueryData(['chat', userId, chatId], initial)
    useChat.getState().setDetailedChat(initial)

    useChat.getState().regenerate(chatId, responseBId, { modelId: 'test-model', presetSelections: {}, agentMode: false })
    const responseCId = queryClient.getQueryData<ServerChat>(['chat', userId, chatId])!.activeBranchLeafId!
    const branchOf = (id: string) => useChat.getState().chats.find((chat) => chat.id === chatId)
      ?.messages.find((message) => message.id === id)?.branch
    expect(branchOf(responseCId)).toEqual(assistantBranch([responseAId, responseBId, responseCId], responseCId))

    // Regeneration prunes B from the active page; its visited window still restores immediately.
    useChat.getState().activateBranch(chatId, responseBId)
    expectOnly(responseBId)
    expect(branchOf(responseBId)).toEqual(assistantBranch([responseAId, responseBId, responseCId], responseBId))
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    requests[0]!.resolve({ response: response(responseCId, 'in_progress').snapshot }, 202)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]!.path).toContain(`/api/messages/${responseBId}/activate?historyLimit=`)
    const allThree = [responseAId, responseBId, responseCId]
    requests[1]!.resolve({
      activeBranchLeafId: responseBId,
      history,
      attachments: [],
      responses: [{ ...responseB, branches: { ...responseB.branches, assistant: assistantBranch(allThree, responseBId) } }],
    })
    await vi.waitFor(() => expect(
      queryClient.getQueryData<ServerChat>(['chat', userId, chatId])?.activeBranchLeafId,
    ).toBe(responseBId))

    // C is still streaming, so its optimistic row is merged back into B's page.
    expectOnly(responseBId)
    expect(branchOf(responseBId)).toEqual(assistantBranch(allThree, responseBId))

    const responseCCompleted = response(responseCId, 'completed')
    useChat.getState().applyResponseSnapshot(responseCCompleted.snapshot)
    useChat.getState().setDetailedChat({
      ...detail(responseBId, [responseB, responseCCompleted]),
      responses: [responseB, responseCCompleted].map((row) => ({
        ...row, branches: { ...row.branches, assistant: assistantBranch(allThree, row.id) },
      })),
    })
    expectOnly(responseBId)
    expect(branchOf(responseBId)).toEqual(assistantBranch(allThree, responseBId))
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

    useChat.getState().regenerate(chatId, responseAId, { modelId: 'test-model', presetSelections: { reasoning: 'high' }, agentMode: true })
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
    useChat.getState().regenerate(chatId, responseBId, { modelId: 'test-model', presetSelections: {}, agentMode: false })
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
    expect(requests[3]!.body).toHaveProperty('timeZone', Intl.DateTimeFormat().resolvedOptions().timeZone)
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


describe('server receipt timing in the web store', () => {
  it('freezes on live reply text and retains the same duration after completion and reload', () => {
    const id = '00000000-0000-4000-8000-000000000099'
    const initial = response(id, 'in_progress')
    const requestReceivedAt = '2026-09-06T12:00:00.000Z'
    const firstReplyTextAt = '2026-09-06T12:00:10.000Z'
    initial.snapshot = { ...initial.snapshot, requestReceivedAt, updatedAt: requestReceivedAt }
    useChat.getState().setDetailedChat(detail(id, [initial]))
    useChat.getState().applyResponseEvents([{
      responseId: id, sequence: 1, type: 'response.reasoning_summary_text.delta',
      payload: { delta: 'Thinking' }, emittedAt: '2026-09-06T12:00:03.000Z', requestReceivedAt,
    }])
    const assistant = () => useChat.getState().chats[0]?.messages.find((message) => message.id === id)
    expect(assistant()?.initialResponseDurationMs).toBeUndefined()
    useChat.getState().applyResponseEvents([{
      responseId: id, sequence: 2, type: 'response.output_text.delta',
      payload: { delta: 'Hello' }, emittedAt: firstReplyTextAt, requestReceivedAt, firstReplyTextAt,
    }])
    expect(assistant()?.initialResponseDurationMs).toBe(10_000)
    useChat.getState().applyResponseEvents([{
      responseId: id, sequence: 3, type: 'response.output_text.delta',
      payload: { delta: ' world' }, emittedAt: '2026-09-06T12:00:15.000Z',
    }])
    expect(assistant()?.initialResponseDurationMs).toBe(10_000)
    const completed = response(id, 'completed')
    completed.snapshot = {
      ...completed.snapshot, requestReceivedAt, firstReplyTextAt, sequence: 4, updatedAt: '2026-09-06T12:00:30.000Z',
    }
    useChat.getState().applyResponseSnapshot(completed.snapshot)
    expect(assistant()?.initialResponseDurationMs).toBe(10_000)
    useChat.getState().setDetailedChat(detail(id, [completed]))
    expect(assistant()?.initialResponseDurationMs).toBe(10_000)
  })
})

describe('stable hydrated message identities', () => {
  it('reuses unchanged completed messages and queue state across detail snapshots', () => {
    const first = detail(responseAId, [response(responseAId, 'completed')])
    useChat.getState().setDetailedChat(first)
    const previous = useChat.getState().chats.find((chat) => chat.id === chatId)!
    const next = structuredClone(first)
    next.title = 'Updated title'
    useChat.getState().setDetailedChat(next)
    const updated = useChat.getState().chats.find((chat) => chat.id === chatId)!
    expect(updated.messages).toBe(previous.messages)
    expect(updated.queuedMessages).toBe(previous.queuedMessages)
    expect(updated.title).toBe('Updated title')
  })
})


it('preserves loaded pagination when a later sidebar summary refresh omits transcript details', () => {
  const history = { offset: 4500, hasMore: true, before: responseAId, leafId: responseAId }
  const loaded = { ...detail(responseAId, [response(responseAId, 'completed')]), history }
  useChat.getState().setDetailedChat(loaded)
  const previous = useChat.getState().chats.find(chat => chat.id === chatId)!
  const { responses: _responses, history: _history, ...summary } = loaded
  useChat.getState().replaceSummaries([{ ...summary, title: 'New sidebar title' }])
  const updated = useChat.getState().chats.find(chat => chat.id === chatId)!
  expect(updated.title).toBe('New sidebar title')
  expect(updated.messages).toBe(previous.messages)
  expect(updated.history).toBe(previous.history)
  expect(updated.history).toEqual(history)
})
