import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputerSelection, ResponseSnapshot } from '@pulpo/contracts'

const storage = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
}
vi.stubGlobal('localStorage', localStorageStub)
vi.stubGlobal('navigator', { onLine: true })
vi.stubGlobal('document', { documentElement: { classList: { contains: () => false, toggle: vi.fn() } } })
vi.stubGlobal('window', {
  localStorage: localStorageStub,
  matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  setTimeout,
  clearTimeout,
})

interface PendingRequest {
  path: string
  method?: string
  body?: Record<string, unknown>
  resolve: (body: unknown, status?: number) => void
}
const requests: PendingRequest[] = []
vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve) => {
  requests.push({
    path: String(input),
    method: init?.method,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    resolve: (body, status = 200) => resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
  })
})))

const [{ useChat }, { useAuth }, { queryClient }, sessions] = await Promise.all([
  import('./chat'),
  import('./auth'),
  import('@/lib/query-client'),
  import('@/features/computer/sessions'),
])

const userId = '00000000-0000-4000-8000-000000000001'
const chatId = '00000000-0000-4000-8000-000000000002'
const createdAt = '2026-11-01T12:00:00.000Z'

function selection(): ComputerSelection {
  return { sessionId: crypto.randomUUID(), access: 'suggest', folder: '/Users/me/project' }
}

function snapshot(responseId: string, status: ResponseSnapshot['status']): ResponseSnapshot {
  return { responseId, status, sequence: 5, output: [], usage: null, error: null, updatedAt: createdAt }
}

beforeEach(() => {
  requests.splice(0)
  queryClient.clear()
  sessions.resetComputerSessionsForTests()
  useAuth.setState({ user: {
    id: userId, name: 'Test', email: 'test@example.com', username: 'test_user', avatarUrl: null, profileColor: null, usageVisibility: 'friends', role: 'user', initials: 'T',
    balanceMicros: 1_000, storageLimitBytes: 1_000, blocked: false, stateRevision: 0, createdAt,
  } })
  useChat.setState({
    chats: [{
      id: chatId, title: 'Chat', modelId: 'test-model', messages: [], queuedMessages: [],
      createdAt: Date.parse(createdAt), updatedAt: Date.parse(createdAt), pinned: false,
      folderId: null, sortOrder: 0, tags: [], temporary: false, expiresAt: null, expired: false,
    }],
    streamingIds: [], responseSequences: {}, responseChatIds: {},
  })
})

// Sends in one chat run in order; settle whatever a test left open.
afterEach(async () => {
  for (const request of requests.splice(0)) request.resolve({})
  await new Promise((resolve) => setTimeout(resolve, 0))
})
afterAll(() => vi.unstubAllGlobals())

function send(computer: ComputerSelection | undefined, agentMode = true) {
  const responseId = crypto.randomUUID()
  useChat.getState().sendMessage(chatId, 'list the folder', 'test-model', [], false, false, {
    targetChatId: chatId, responseId, presetSelections: {}, agentMode, computer,
  })
  return responseId
}

describe('sending with this computer', () => {
  it('sends the session with an Agent message and ends it only when the reply stops', async () => {
    const computer = selection()
    sessions.trackComputerSession(computer.sessionId)
    const responseId = send(computer)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({ path: `/api/chats/${chatId}/responses`, method: 'POST' })
    expect(requests[0]!.body).toMatchObject({ agentMode: true, computer, clientId: responseId })

    requests[0]!.resolve({ response: snapshot(responseId, 'in_progress') })
    useChat.getState().applyResponseSnapshot(snapshot(responseId, 'in_progress'))
    expect(sessions.activeComputerSessionIds()).toEqual([computer.sessionId])
    useChat.getState().applyResponseSnapshot({ ...snapshot(responseId, 'completed'), sequence: 6 })
    expect(sessions.activeComputerSessionIds()).toEqual([])
  })

  it('follows a reply the server renamed', async () => {
    const computer = selection()
    sessions.trackComputerSession(computer.sessionId)
    send(computer)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const serverId = crypto.randomUUID()
    requests[0]!.resolve({ response: snapshot(serverId, 'queued') })
    await vi.waitFor(() => expect(useChat.getState().streamingIds).toContain(serverId))
    useChat.getState().applyResponseSnapshot({ ...snapshot(serverId, 'cancelled'), sequence: 9 })
    expect(sessions.activeComputerSessionIds()).toEqual([])
  })

  it('ends the session and says the computer is unavailable when the send fails', async () => {
    const computer = selection()
    sessions.trackComputerSession(computer.sessionId)
    const responseId = send(computer)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    requests[0]!.resolve({ error: { code: 'computer_unavailable', message: 'Computer unavailable' } }, 409)
    await vi.waitFor(() => expect(useChat.getState().chats[0]!.messages.find((message) => message.id === responseId)).toMatchObject({
      done: true, error: "This computer isn't connected",
    }))
    expect(sessions.activeComputerSessionIds()).toEqual([])
  })

  it('never sends the computer without agent mode', async () => {
    const computer = selection()
    sessions.trackComputerSession(computer.sessionId)
    send(computer, false)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]!.body).not.toHaveProperty('computer')
    expect(sessions.activeComputerSessionIds()).toEqual([])
  })

  it('sends a plain message without a computer field', async () => {
    send(undefined)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]!.body).not.toHaveProperty('computer')
  })

  it('queues with the session, and ends it when the queued message is deleted', async () => {
    const computer = selection()
    sessions.trackComputerSession(computer.sessionId)
    const queuedId = crypto.randomUUID()
    const enqueue = useChat.getState().enqueueMessage(chatId, {
      input: 'later', modelId: 'test-model', presetSelections: {}, attachmentIds: [], agentMode: true, computer,
    }, [])
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]!.body).toMatchObject({ computer })
    requests[0]!.resolve({ queuedMessage: {
      id: queuedId, chatId, content: 'later', modelId: 'test-model', presetSelections: {}, agentMode: true, computer,
      position: 0, status: 'pending', error: null, attachments: [], createdAt, updatedAt: createdAt,
    } })
    await enqueue

    // The reply it becomes is still running: nothing ends.
    useChat.getState().applyResponseSnapshot(snapshot(crypto.randomUUID(), 'completed'))
    expect(sessions.activeComputerSessionIds()).toEqual([computer.sessionId])

    const before = requests.length
    const removal = useChat.getState().deleteQueuedMessage(chatId, queuedId)
    await vi.waitFor(() => expect(requests.length).toBe(before + 1))
    requests.at(-1)!.resolve({})
    await removal
    expect(sessions.activeComputerSessionIds()).toEqual([])
  })

  it('replaces a queued message’s session when its edit is saved', async () => {
    const old = selection()
    const next = selection()
    const queuedId = crypto.randomUUID()
    sessions.trackComputerSession(old.sessionId)
    sessions.linkComputerSessionToQueued(old.sessionId, queuedId)
    sessions.trackComputerSession(next.sessionId)
    const save = useChat.getState().updateQueuedMessage(chatId, queuedId, {
      action: 'save_edit', input: 'edited', modelId: 'test-model', presetSelections: {}, attachmentIds: [], agentMode: true, computer: next,
    })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]!.body).toMatchObject({ action: 'save_edit', computer: next })
    requests[0]!.resolve({ queuedMessage: null })
    await save
    expect(sessions.activeComputerSessionIds()).toEqual([next.sessionId])
  })

  it('edits a message with the session', async () => {
    const computer = selection()
    sessions.trackComputerSession(computer.sessionId)
    const sourceId = crypto.randomUUID()
    const edit = useChat.getState().editUserMessage({
      chatId, messageId: `${sourceId}:input`, content: 'again', modelId: 'test-model', attachments: [], agentMode: true, computer,
    })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({ path: `/api/messages/${sourceId}:input`, method: 'PATCH' })
    expect(requests[0]!.body).toMatchObject({ agentMode: true, computer })
    requests[0]!.resolve({ error: { code: 'computer_unavailable', message: 'Computer unavailable' } }, 409)
    await expect(edit).rejects.toThrow("This computer isn't connected")
    expect(sessions.activeComputerSessionIds()).toEqual([])
  })

  it('links a session to the reply a chat lists with it', () => {
    const computer = selection()
    sessions.restoreComputerSessions([computer.sessionId])
    const responseId = crypto.randomUUID()
    const response = (status: ResponseSnapshot['status']) => ({
      id: responseId, chatId, parentResponseId: null, userMessageId: null, modelId: 'test-model', status, input: [], output: [],
      presetSelections: {}, usage: null, error: null, createdAt, completedAt: null, agentMode: true, computerSessionId: computer.sessionId,
      snapshot: snapshot(responseId, status), branches: { user: { ids: [responseId], index: 0 }, assistant: { ids: [responseId], index: 0 } },
    })
    const detail = (status: ResponseSnapshot['status']) => ({
      id: chatId, title: 'Chat', modelId: 'test-model', pinned: false, folderId: null, createdAt, updatedAt: createdAt,
      activeResponseId: responseId, activeBranchLeafId: responseId, responses: [response(status)],
    })
    useChat.getState().setDetailedChat(detail('in_progress'))
    expect(sessions.activeComputerSessionIds()).toEqual([computer.sessionId])
    useChat.getState().setDetailedChat(detail('completed'))
    expect(sessions.activeComputerSessionIds()).toEqual([])
  })
})
