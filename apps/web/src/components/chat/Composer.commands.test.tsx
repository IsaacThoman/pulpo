// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
})
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
vi.mock('@/lib/local-first/composer-sync', () => ({ webComposerSync: () => null, clearWebComposerSync() {} }))
vi.mock('@/lib/local-first/database', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return { ...actual, localAccountKey: (id: string) => id, localDb: {
    drafts: {
      where: () => ({ equals: () => ({ first: async () => undefined, delete: async () => {} }) }),
      put: async () => {},
    },
  } }
})

const { Composer } = await import('./Composer')
const { useAuth } = await import('@/stores/auth')
const { useSettings } = await import('@/stores/settings')
const { useUploadOutbox } = await import('@/stores/upload-outbox')
const { useChat } = await import('@/stores/chat')
const { clearRuntimeComposerDrafts } = await import('@/lib/local-first/composer-drafts')
const { queryClient } = await import('@/lib/query-client')

const chatId = '11111111-1111-4111-8111-111111111111'
const stageSubmission = vi.fn(() => ({ chatId: 'staged', submissionId: 'submission' }))
const openSideChat = vi.fn(async () => 'side-chat')
const forkChat = vi.fn(async () => 'fork-chat')
const original = useChat.getState()

beforeEach(() => {
  useAuth.setState({ user: { id: 'account' } as NonNullable<ReturnType<typeof useAuth.getState>['user']>, filesEnabled: false })
  useSettings.setState({ composerSyncEnabled: false, agentModes: { model: false } })
  useUploadOutbox.setState({ uploads: {}, submissions: [], stageSubmission })
  useChat.setState({
    openSideChat, forkChat,
    chats: [{
      id: chatId, title: 'Chat', modelId: 'model', createdAt: 1, updatedAt: 1, pinned: false, folderId: null, sortOrder: 0,
      tags: [], temporary: false, expiresAt: null, expired: false,
      messages: [{ id: 'reply-1', role: 'assistant', content: 'Answer', timestamp: 1, done: true }],
    }],
  })
  queryClient.clear()
  clearRuntimeComposerDrafts('account')
  stageSubmission.mockClear()
  openSideChat.mockClear()
  forkChat.mockClear()
})
afterEach(() => {
  cleanup()
  useChat.setState({ openSideChat: original.openSideChat, forkChat: original.forkChat, chats: [] })
})

function Location() {
  return <span data-testid="location">{useLocation().pathname}</span>
}

function renderComposer(commands: Array<'btw' | 'fork'> = ['btw', 'fork']) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/c/${chatId}`]}><TooltipProvider>
        <Routes><Route path="*" element={<><Location /><Composer chatId={chatId} modelId="model" syncEnabled={false} commands={commands} /></>} /></Routes>
      </TooltipProvider></MemoryRouter>
    </QueryClientProvider>,
  )
}

function send(view: ReturnType<typeof renderComposer>, text: string) {
  const input = view.getByRole('textbox', { name: 'Message' })
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

it('suggests the commands while one is typed and completes the chosen one', async () => {
  const view = renderComposer()
  const input = view.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: '/' } })
  const commands = view.getByRole('group', { name: 'Commands' })
  expect(commands.textContent).toContain('/btw')
  expect(commands.textContent).toContain('/fork')
  fireEvent.click(view.getByText('/btw'))
  await waitFor(() => expect(input.value).toBe('/btw '))

  fireEvent.change(input, { target: { value: '/usr/bin' } })
  expect(view.queryByRole('group', { name: 'Commands' })).toBeNull()
})

it('asks a /btw question in a new side chat and opens it', async () => {
  const view = renderComposer()
  send(view, '/btw what does this regex do?')
  await waitFor(() => expect(view.getByTestId('location').textContent).toBe('/c/side-chat'))
  expect(openSideChat).toHaveBeenCalledWith(chatId)
  expect(stageSubmission).toHaveBeenCalledWith(expect.objectContaining({
    chatId: 'side-chat', content: 'what does this regex do?', modelId: 'model', temporary: false,
  }))
  expect((view.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('')
})

it('forks from the latest reply with /fork', async () => {
  const view = renderComposer()
  send(view, '/fork')
  await waitFor(() => expect(view.getByTestId('location').textContent).toBe('/c/fork-chat'))
  expect(forkChat).toHaveBeenCalledWith('reply-1')
  expect(stageSubmission).not.toHaveBeenCalled()
})

it('sends other messages that start with a slash, and commands the chat does not offer, as written', async () => {
  const view = renderComposer(['fork'])
  send(view, '/btw hello')
  await waitFor(() => expect(stageSubmission).toHaveBeenCalledWith(expect.objectContaining({ chatId, content: '/btw hello' })))
  send(view, '/usr/bin/env node')
  await waitFor(() => expect(stageSubmission).toHaveBeenLastCalledWith(expect.objectContaining({ chatId, content: '/usr/bin/env node' })))
  expect(openSideChat).not.toHaveBeenCalled()
})
