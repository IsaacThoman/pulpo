import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Model } from '@/lib/types'

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
vi.stubGlobal('document', { documentElement: { classList: { toggle: vi.fn() } } })
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
}

const requests: PendingRequest[] = []
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

const [
  { useUploadOutbox, processUploadOutboxChat },
  { useChat },
  { useAuth },
  { useSettings },
  { useCatalog },
  { queryClient },
] = await Promise.all([
  import('./upload-outbox'),
  import('./chat'),
  import('./auth'),
  import('./settings'),
  import('./catalog'),
  import('@/lib/query-client'),
])

const userId = '00000000-0000-4000-8000-000000000001'
const chatId = '00000000-0000-4000-8000-000000000002'
const createdAt = '2026-08-14T12:00:00.000Z'
const model: Model = {
  id: 'test-model', name: 'Test', providerGroupId: 'test-provider', provider: 'Test',
  labLogo: 'pulpo', modelLogo: 'pulpo', inferenceProvider: 'Test', description: '',
  contextWindow: 128_000, tags: ['reasoning'], iconLight: '#000', iconDark: '#fff',
  inputPrice: 0, outputPrice: 0, perMessagePrice: 0, enabled: true, agentEnabled: true,
  presets: [],
}

function upload(localId: string, status: 'uploading' | 'ready' | 'error', mimeType = 'image/png') {
  return {
    localId,
    id: status === 'ready' ? `server-${localId}` : undefined,
    name: `${localId}.png`,
    size: 12,
    mimeType,
    previewUrl: null,
    status,
    error: status === 'error' ? 'Upload failed' : undefined,
    chatId,
    temporary: false,
    managed: false,
    attempt: 0,
  } as const
}

function draft(attachmentIds: string[], content: string) {
  return {
    chatId,
    content,
    modelId: model.id,
    presetSelections: {},
    agentMode: false,
    temporary: false,
    autoExpire: false,
    attachmentIds,
  }
}

beforeEach(() => {
  requests.splice(0)
  queryClient.clear()
  useAuth.setState({ user: {
    id: userId, name: 'Test', email: 'test@example.com', username: 'test_user', avatarUrl: null,
    profileColor: null, role: 'user', initials: 'T', balanceMicros: 1_000,
    storageLimitBytes: 1_000, blocked: false, stateRevision: 0, createdAt,
  } })
  useSettings.setState({ agentModes: { [model.id]: false }, generation: {} })
  useCatalog.setState({ models: [model], loaded: true, agentAvailable: true })
  useChat.setState({
    chats: [{
      id: chatId, title: 'Outbox', modelId: model.id, messages: [], queuedMessages: [],
      createdAt: Date.parse(createdAt), updatedAt: Date.parse(createdAt), pinned: false,
      folderId: null, sortOrder: 0, tags: [], temporary: false, expiresAt: null, expired: false,
      provisional: false,
    }],
    folders: [], activeChatId: chatId, activeTemporaryChatId: null, streamingIds: [],
    responseSequences: {}, responseChatIds: {},
  })
  useUploadOutbox.setState({ uploads: {}, submissions: [], preservedDrafts: {} })
})

afterAll(() => vi.unstubAllGlobals())

describe('upload outbox', () => {
  it('keeps later submissions local until the FIFO head is accepted', async () => {
    useUploadOutbox.setState({ uploads: { first: upload('first', 'uploading') } })
    useUploadOutbox.getState().stageSubmission(draft(['first'], 'first message'))
    useUploadOutbox.getState().stageSubmission(draft([], 'second message'))
    await Promise.resolve()

    expect(requests).toHaveLength(0)
    expect(useChat.getState().chats[0]?.messages.filter((message) => message.deliveryStatus)).toHaveLength(2)

    useUploadOutbox.setState({ uploads: { first: upload('first', 'ready') } })
    const processing = processUploadOutboxChat(chatId)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({ path: `/api/chats/${chatId}/responses`, method: 'POST' })
    expect(requests.some((request) => request.path.includes('queued-messages'))).toBe(false)

    requests[0]!.resolve({})
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toMatchObject({
      path: `/api/chats/${chatId}/queued-messages`,
      method: 'POST',
      body: expect.objectContaining({ input: 'second message' }),
    })
    requests[1]!.resolve({ queuedMessage: null })
    await processing

    expect(useUploadOutbox.getState().submissions).toHaveLength(0)
    expect(useUploadOutbox.getState().uploads.first).toBeUndefined()
  })

  it('creates a provisional new chat and promotes the same bubble through the start endpoint', async () => {
    useChat.setState({ chats: [], activeChatId: null })
    useUploadOutbox.setState({
      uploads: { image: { ...upload('image', 'uploading'), chatId: null } },
    })
    const staged = useUploadOutbox.getState().stageSubmission({
      ...draft(['image'], 'new chat'),
      chatId: null,
    })
    await Promise.resolve()

    const provisional = useChat.getState().chats.find((chat) => chat.id === staged.chatId)
    expect(provisional).toMatchObject({ provisional: true })
    expect(provisional?.messages).toEqual([
      expect.objectContaining({
        id: `${staged.submissionId}:input`,
        deliveryStatus: 'uploading',
      }),
    ])
    expect(requests).toHaveLength(0)

    useUploadOutbox.setState({
      uploads: { image: { ...upload('image', 'ready'), chatId: null } },
    })
    const processing = processUploadOutboxChat(staged.chatId)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      path: '/api/chats/start',
      method: 'POST',
      body: expect.objectContaining({ chat: expect.objectContaining({ clientId: staged.chatId }) }),
    })
    expect(useChat.getState().chats[0]?.messages.map((message) => message.id)).toEqual([
      `${staged.submissionId}:input`, staged.submissionId,
    ])

    requests[0]!.resolve({})
    await processing
    expect(useChat.getState().chats[0]?.provisional).toBe(false)
  })

  it('restores a failed head and blocks later messages until it is discarded', async () => {
    useUploadOutbox.setState({ uploads: { failed: upload('failed', 'error') } })
    const first = useUploadOutbox.getState().stageSubmission(draft(['failed'], 'failed message'))
    useUploadOutbox.getState().stageSubmission(draft([], 'later message'))

    await vi.waitFor(() => expect(
      useUploadOutbox.getState().submissions.find((submission) => submission.id === first.submissionId)?.status,
    ).toBe('recovery'))
    expect(requests).toHaveLength(0)
    expect(useChat.getState().chats[0]?.messages.some((message) => message.content === 'failed message')).toBe(false)

    useUploadOutbox.getState().discardSubmission(first.submissionId)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({ path: `/api/chats/${chatId}/responses`, method: 'POST' })
    requests[0]!.resolve({})
    await vi.waitFor(() => expect(useUploadOutbox.getState().submissions).toHaveLength(0))
  })

  it('retries a failed upload in place and keeps its local identity', async () => {
    const file = new File(['image'], 'retry.png', { type: 'image/png' })
    useUploadOutbox.setState({
      uploads: {
        retry: {
          ...upload('retry', 'error'), file, managed: true, attempt: 1,
        },
      },
    })

    useUploadOutbox.getState().retryUpload('retry')
    expect(useUploadOutbox.getState().uploads.retry).toMatchObject({
      localId: 'retry', status: 'uploading', attempt: 2,
    })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    requests[0]!.resolve({ attachment: { id: 'retried-server-id' }, uploadUrl: '/upload/retry', uploadHeaders: {} })
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toMatchObject({ path: '/upload/retry', method: 'PUT' })
    requests[1]!.resolve({})
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    expect(requests[2]).toMatchObject({ path: '/api/attachments/retried-server-id/confirm', method: 'POST' })
    requests[2]!.resolve({ mimeType: 'image/png' })

    await vi.waitFor(() => expect(useUploadOutbox.getState().uploads.retry).toMatchObject({
      localId: 'retry', id: 'retried-server-id', status: 'ready', error: undefined,
    }))
  })

  it('revalidates a server-confirmed non-image type before dispatch', async () => {
    useUploadOutbox.setState({
      uploads: { document: upload('document', 'ready', 'application/pdf') },
    })
    const staged = useUploadOutbox.getState().stageSubmission(draft(['document'], 'document'))

    await vi.waitFor(() => expect(
      useUploadOutbox.getState().submissions.find((submission) => submission.id === staged.submissionId),
    ).toMatchObject({ status: 'recovery', recoveryError: expect.stringContaining('Agent mode') }))
    expect(requests).toHaveLength(0)
  })

  it('moves an edited temporary bubble back into the composer recovery slot', async () => {
    useUploadOutbox.setState({ uploads: { image: upload('image', 'uploading') } })
    const staged = useUploadOutbox.getState().stageSubmission(draft(['image'], 'edit me'))
    await Promise.resolve()

    useUploadOutbox.getState().returnSubmissionToComposer(staged.submissionId)

    expect(useUploadOutbox.getState().submissions[0]).toMatchObject({ status: 'recovery' })
    expect(useChat.getState().chats[0]?.messages.some((message) => message.content === 'edit me')).toBe(false)
  })
})
