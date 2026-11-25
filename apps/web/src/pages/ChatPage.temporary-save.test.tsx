// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Chat, Model } from '@/lib/types'
import type { ServerChat, ServerResponse } from '@/stores/chat'
import { TooltipProvider } from '@/components/ui/tooltip'

const { listeners, socket } = vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
  const listeners = new Map<string, (payload: unknown) => void>()
  const socket = {
    connected: true,
    on: (event: string, listener: (payload: unknown) => void) => listeners.set(event, listener),
    emit: vi.fn(), disconnect: vi.fn(),
  }
  return { listeners, socket }
})
vi.mock('socket.io-client', () => ({ io: () => socket }))
vi.mock('@/features/computer/ComputerBridge', () => ({ ComputerBridge: () => null }))
vi.mock('@/lib/local-first/composer-sync', () => ({
  webComposerSync: () => null, clearWebComposerSync() {}, bindWebComposerSocket: () => () => {},
}))
vi.mock('@/components/chat/MessageList', () => ({ MessageList: () => <div data-testid="messages" /> }))
vi.mock('@/lib/local-first/shelf', () => ({ webShelf: () => null, bindWebShelfSocket: () => () => {} }))
const { ChatPage } = await import('./ChatPage')
const { ChatDataBridge } = await import('@/features/chat/ChatDataBridge')
const { useChat } = await import('@/stores/chat')
const { useAuth } = await import('@/stores/auth')
const { useSettings } = await import('@/stores/settings')
const { useCatalog } = await import('@/stores/catalog')
const { queryClient } = await import('@/lib/query-client')
const { useComposerSyncPreference } = await import('@/stores/composer-sync-preference')

const userId = '00000000-0000-4000-8000-000000000001'
const chatId = '00000000-0000-4000-8000-0000000000c1'
const model: Model = {
  id: 'test-model', name: 'Test Model', providerGroupId: 'test', provider: 'Test', inferenceProvider: 'Test',
  labLogo: 'pulpo', modelLogo: 'pulpo', description: '', contextWindow: 128_000, tags: [],
  iconLight: '#000', iconDark: '#fff', inputPrice: 0, outputPrice: 0, perMessagePrice: 0,
  enabled: true, agentEnabled: true, presets: [],
}
const temporaryChat: Chat = {
  id: chatId, title: 'Scratch', modelId: model.id, messages: [], createdAt: 1, updatedAt: 1, pinned: false,
  folderId: null, sortOrder: 0, tags: [], temporary: true, expiresAt: null, expired: false,
}

beforeEach(() => {
  listeners.clear()
  socket.emit.mockClear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
  queryClient.clear()
  useAuth.setState({ user: { id: userId } as NonNullable<ReturnType<typeof useAuth.getState>['user']> })
  useSettings.setState({ generation: {}, agentModes: { [model.id]: false }, defaultModelId: model.id,
    showPromptSuggestions: false, composerSyncEnabled: false })
  useComposerSyncPreference.setState({ enabled: false, generation: '' })
  useCatalog.setState({ models: [model], loaded: true, agentAvailable: true })
  useChat.setState({ chats: [temporaryChat], activeChatId: null, activeTemporaryChatId: chatId,
    streamingIds: [], responseSequences: {}, responseChatIds: {}, adminAccessRequiredChatId: null })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function Path() {
  return <output data-testid="path">{useLocation().pathname}</output>
}

function openChatRoute() {
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/c/${chatId}`]}>
    <TooltipProvider>
      <ChatDataBridge />
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/c/:chatId" element={<ChatPage />} />
      </Routes>
      <Link to="/">Leave chat</Link>
      <Path />
    </TooltipProvider>
  </MemoryRouter></QueryClientProvider>)
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

it('opens an existing temporary chat by URL, keeps its live response, and drops it when leaving', async () => {
  useChat.setState({ chats: [], activeTemporaryChatId: null })
  const responseId = '00000000-0000-4000-8000-0000000000ab'
  const createdAt = new Date().toISOString()
  const snapshot = { responseId, status: 'in_progress' as const, sequence: 1, updatedAt: createdAt, output: [], usage: null, error: null }
  const response: ServerResponse = {
    id: responseId, parentResponseId: null, userMessageId: null, modelId: model.id,
    status: snapshot.status, createdAt, completedAt: null,
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'My search question' }] }],
    output: [], usage: null, error: null, presetSelections: {}, snapshot,
    branches: { user: { ids: [responseId], index: 0 }, assistant: { ids: [responseId], index: 0 } },
  }
  const detail: ServerChat = {
    ...temporaryChat, title: 'Quick Answer', createdAt, updatedAt: createdAt, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1_000).toISOString(),
    activeResponseId: responseId, activeBranchLeafId: responseId, responses: [response],
    history: { before: responseId, hasMore: false, offset: 0, leafId: responseId },
  }
  const summary: ServerChat = {
    id: '00000000-0000-4000-8000-0000000000c2', title: 'Another chat', modelId: model.id,
    pinned: false, folderId: null, createdAt, updatedAt: createdAt, activeResponseId: null, activeBranchLeafId: null,
  }
  let finishSummaries!: (response: Response) => void
  const summaries = new Promise<Response>((resolve) => { finishSummaries = resolve })
  vi.mocked(fetch).mockImplementation(async (input) => {
    const path = String(input)
    if (path === '/api/chats') return summaries
    if (path.startsWith(`/api/chats/${chatId}?`)) return json(detail)
    return json({})
  })
  vi.spyOn(useCatalog.getState(), 'load').mockResolvedValue(undefined)

  const view = openChatRoute()
  await view.findByRole('heading', { name: 'Quick Answer' })
  expect(view.getByTestId('path').textContent).toBe(`/c/${chatId}`)
  expect(view.container.querySelector('[data-desktop-temporary-chat="true"]')).toBeTruthy()
  expect(useChat.getState().activeTemporaryChatId).toBeNull()
  expect(useChat.getState().chats[0]?.messages[0]?.content).toBe('My search question')
  await waitFor(() => expect(socket.emit).toHaveBeenCalledWith('response.subscribe', { responseId, afterSequence: 0 }))

  await act(async () => { finishSummaries(json({ data: [summary] })) })
  await waitFor(() => expect(useChat.getState().chats.some((chat) => chat.id === summary.id)).toBe(true))
  act(() => listeners.get('response.snapshot')!({
    ...snapshot, sequence: 2,
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Live answer' }] }],
  }))
  expect(useChat.getState().chats.find((chat) => chat.id === chatId)?.messages[1]?.content).toBe('Live answer')

  fireEvent.click(view.getByRole('link', { name: 'Leave chat' }))
  await waitFor(() => expect(useChat.getState().chats.some((chat) => chat.id === chatId)).toBe(false))
  expect(queryClient.getQueryData(['chat', userId, chatId])).toBeUndefined()
})

it.each([[404, 'not_found'], [410, 'temporary_chat_expired']])('shows an unavailable chat on a %i from the chat API', async (status, code) => {
  useChat.setState({ chats: [], activeTemporaryChatId: null })
  vi.mocked(fetch).mockImplementation(async (input) => String(input).startsWith(`/api/chats/${chatId}?`)
    ? json({ error: { code } }, status)
    : json({ data: [] }))
  vi.spyOn(useCatalog.getState(), 'load').mockResolvedValue(undefined)
  const view = openChatRoute()
  expect(await view.findByText('Unable to load this chat.')).toBeTruthy()
  expect(view.queryByRole('textbox')).toBeNull()
  expect(view.queryByTestId('messages')).toBeNull()
})

it('keeps showing a temporary chat while saving it moves it to its own route', async () => {
  // Like the store: the chat stops being the active temporary one, then the chat list reloads.
  let finishReload!: () => void
  const reload = new Promise<void>((resolve) => { finishReload = resolve })
  const persistTemporaryChat = vi.fn(async (id: string) => {
    useChat.setState((state) => ({
      activeTemporaryChatId: null,
      chats: state.chats.map((chat) => chat.id === id ? { ...chat, temporary: false } : chat),
    }))
    await reload
    return {} as Awaited<ReturnType<ReturnType<typeof useChat.getState>['persistTemporaryChat']>>
  })
  useChat.setState({ persistTemporaryChat })

  const view = render(<MemoryRouter initialEntries={[{ pathname: '/', state: { temporary: true } }]}><TooltipProvider>
    <Routes>
      <Route path="/" element={<ChatPage />} />
      <Route path="/c/:chatId" element={<ChatPage />} />
    </Routes>
    <Path />
  </TooltipProvider></MemoryRouter>)
  const surface = () => view.container.querySelector('.chat-page-surface')!
  await waitFor(() => expect(view.getByTestId('messages')).toBeTruthy())
  expect(surface().getAttribute('data-desktop-temporary-chat')).toBe('true')

  fireEvent.click(view.getByRole('button', { name: 'Save chat' }))
  await waitFor(() => expect(persistTemporaryChat).toHaveBeenCalledWith(chatId))

  // Before the fix this rendered the empty new-chat page until the reload finished.
  expect(view.queryByTestId('messages')).toBeTruthy()
  expect(view.container.querySelector('.chat-landing-badge-transition')).toBeNull()
  expect(surface().getAttribute('data-desktop-temporary-chat')).toBe('true')

  await act(async () => { finishReload() })
  await waitFor(() => expect(view.getByTestId('path').textContent).toBe(`/c/${chatId}`))
  expect(view.queryByTestId('messages')).toBeTruthy()
  expect(surface().getAttribute('data-desktop-temporary-chat')).toBeNull()
})

it('stays on a new chat started while the save is still finishing', async () => {
  let finishReload!: () => void
  const reload = new Promise<void>((resolve) => { finishReload = resolve })
  const persistTemporaryChat = vi.fn(async (id: string) => {
    useChat.setState((state) => ({
      activeTemporaryChatId: null,
      chats: state.chats.map((chat) => chat.id === id ? { ...chat, temporary: false } : chat),
    }))
    await reload
    return {} as Awaited<ReturnType<ReturnType<typeof useChat.getState>['persistTemporaryChat']>>
  })
  useChat.setState({ persistTemporaryChat })

  const view = render(<MemoryRouter initialEntries={[{ pathname: '/', state: { temporary: true } }]}><TooltipProvider>
    <Routes>
      <Route path="/" element={<ChatPage />} />
      <Route path="/c/:chatId" element={<ChatPage />} />
    </Routes>
    <Path />
  </TooltipProvider></MemoryRouter>)
  await waitFor(() => expect(view.getByTestId('messages')).toBeTruthy())

  fireEvent.click(view.getByRole('button', { name: 'Save chat' }))
  await waitFor(() => expect(persistTemporaryChat).toHaveBeenCalledWith(chatId))
  // The chat is already saved in the store, so the header offers an ordinary new chat.
  fireEvent.click(await view.findByRole('button', { name: 'New chat' }))
  await waitFor(() => expect(view.queryByTestId('messages')).toBeNull())

  await act(async () => { finishReload() })
  await act(async () => {})
  expect(view.getByTestId('path').textContent).toBe('/')
})
