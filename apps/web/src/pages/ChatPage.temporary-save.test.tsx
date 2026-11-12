// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Chat, Model } from '@/lib/types'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
})
vi.mock('@/lib/local-first/composer-sync', () => ({ webComposerSync: () => null, clearWebComposerSync() {} }))
vi.mock('@/components/chat/MessageList', () => ({ MessageList: () => <div data-testid="messages" /> }))
vi.mock('@/lib/local-first/shelf', () => ({ webShelf: () => null }))
const { ChatPage } = await import('./ChatPage')
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
