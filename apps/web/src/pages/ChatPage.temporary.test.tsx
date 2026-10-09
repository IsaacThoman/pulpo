// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Chat, Model } from '@/lib/types'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
})
vi.mock('@/lib/local-first/composer-sync', () => ({ webComposerSync: () => null, clearWebComposerSync() {} }))
vi.mock('@/components/chat/MessageList', () => ({ MessageList: () => null }))
vi.mock('@/lib/local-first/shelf', () => ({ webShelf: () => null }))
const { ChatPage } = await import('./ChatPage')
const { useChat } = await import('@/stores/chat')
const { useUploadOutbox } = await import('@/stores/upload-outbox')
const { useAuth } = await import('@/stores/auth')
const { useSettings } = await import('@/stores/settings')
const { useCatalog } = await import('@/stores/catalog')
const { useDesktopChrome } = await import('@/stores/desktopChrome')
const { queryClient } = await import('@/lib/query-client')
const { localDb } = await import('@/lib/local-first/database')
const { clearRuntimeComposerDrafts, rememberRuntimeComposerDraft } = await import('@/lib/local-first/composer-drafts')
const { useComposerSyncPreference } = await import('@/stores/composer-sync-preference')

const userId = '00000000-0000-4000-8000-000000000001'
const model: Model = {
  id: 'test-model', name: 'Test Model', providerGroupId: 'test', provider: 'Test', inferenceProvider: 'Test',
  labLogo: 'pulpo', modelLogo: 'pulpo', description: '', contextWindow: 128_000, tags: [],
  iconLight: '#000', iconDark: '#fff', inputPrice: 0, outputPrice: 0, perMessagePrice: 0,
  enabled: true, presets: [],
}
const normalChat: Chat = {
  id: 'normal-chat', title: 'Normal chat', modelId: model.id, messages: [],
  createdAt: 0, updatedAt: 0, pinned: false, folderId: null, sortOrder: 0, tags: [],
  temporary: false, expiresAt: null, expired: false,
}
const temporaryChat: Chat = { ...normalChat, id: 'temporary-chat', temporary: true }

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', {
    status: 200, headers: { 'content-type': 'application/json' },
  }))
  await localDb.drafts.clear()
  clearRuntimeComposerDrafts(userId)
  rememberRuntimeComposerDraft(userId, 'new', { content: 'Unsent draft', attachments: [], attachmentIds: [] })
  queryClient.clear()
  useAuth.setState({ user: { id: userId } as NonNullable<ReturnType<typeof useAuth.getState>['user']>, dictationEnabled: false })
  useSettings.setState({ generation: {}, agentModes: {}, defaultModelId: model.id,
    showPromptSuggestions: false, composerSyncEnabled: false, automaticChatExpiration: 'disabled' })
  useComposerSyncPreference.setState({ enabled: false, generation: '' })
  useCatalog.setState({ models: [model], loaded: true, agentAvailable: false })
  useChat.setState({ chats: [normalChat], folders: [], activeChatId: null, activeTemporaryChatId: null,
    streamingIds: [], responseSequences: {}, responseChatIds: {}, adminAccessRequiredChatId: null })
  useUploadOutbox.setState({ uploads: {}, submissions: [], preservedDrafts: {} })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function renderChat() {
  return render(<MemoryRouter><TooltipProvider>
    <Link to="/c/normal-chat" onClick={() => useChat.getState().abandonTemporaryChat()}>Open normal chat</Link>
    <Link to="/">Return to new chat</Link>
    <Routes>
      <Route path="/" element={<ChatPage />} />
      <Route path="/c/:chatId" element={<ChatPage />} />
    </Routes>
  </TooltipProvider></MemoryRouter>)
}

function expectTemporary(view: ReturnType<typeof renderChat>, temporary: boolean) {
  expect(Boolean(view.container.querySelector('[data-desktop-temporary-chat="true"]'))).toBe(temporary)
  expect(useDesktopChrome.getState().temporaryChat).toBe(temporary)
  const composer = view.getByRole('textbox') as HTMLTextAreaElement
  expect(composer.placeholder).toBe(temporary ? 'Temporary message…' : 'Message…')
}

async function enableTemporary(view: ReturnType<typeof renderChat>) {
  await waitFor(() => expect(view.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(view.getByRole('button', { name: 'Enable temporary chat' }))
  await view.findByRole('button', { name: 'Disable temporary chat' })
  expectTemporary(view, true)
}

it('clears the page and desktop tint when disabling temporary mode', async () => {
  const view = renderChat()
  await enableTemporary(view)
  fireEvent.click(view.getByRole('button', { name: 'Disable temporary chat' }))
  await view.findByRole('button', { name: 'Enable temporary chat' })
  expectTemporary(view, false)
})

it.each([false, true])('uses the normal chat mode after leaving a temporary chat (submitted: %s)', async (submitted) => {
  const view = renderChat()
  await enableTemporary(view)
  if (submitted) {
    act(() => useChat.setState({ chats: [normalChat, temporaryChat], activeTemporaryChatId: temporaryChat.id }))
    await view.findByRole('button', { name: 'Save chat' })
    expectTemporary(view, true)
  }
  fireEvent.click(view.getByRole('link', { name: 'Open normal chat' }))
  await view.findByRole('button', { name: 'New chat' })
  expectTemporary(view, false)

  fireEvent.click(view.getByRole('link', { name: 'Return to new chat' }))
  await view.findByRole('button', { name: 'Enable temporary chat' })
  expectTemporary(view, false)
})

it('does not tint a normal chat while its data is loading', async () => {
  const view = renderChat()
  await enableTemporary(view)
  act(() => useChat.setState({ chats: [] }))
  fireEvent.click(view.getByRole('link', { name: 'Open normal chat' }))
  await waitFor(() => expectTemporary(view, false))
  act(() => useChat.setState({ chats: [normalChat] }))
  await view.findByRole('button', { name: 'New chat' })
  expectTemporary(view, false)
})

it('clears temporary styling when the active chat becomes permanent', async () => {
  const view = renderChat()
  await enableTemporary(view)
  act(() => useChat.setState({ chats: [normalChat, temporaryChat], activeTemporaryChatId: temporaryChat.id }))
  await view.findByRole('button', { name: 'Save chat' })
  expectTemporary(view, true)
  // Persisting changes the chat flag before the save handler navigates to its URL.
  act(() => useChat.setState({ chats: [normalChat, { ...temporaryChat, temporary: false }] }))
  await view.findByRole('button', { name: 'New chat' })
  expectTemporary(view, false)
})
