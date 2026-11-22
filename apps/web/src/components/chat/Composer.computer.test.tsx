// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

const computer = vi.hoisted(() => ({
  status: vi.fn(async () => ({ fullAccess: false, folders: [], defaultFolder: { path: '/Users/me/Pulpo', name: 'Pulpo' } })),
  chooseFolder: vi.fn(), allowFullAccess: vi.fn(), end: vi.fn(async () => undefined), sessions: vi.fn(async () => []), handle: vi.fn(),
  begin: vi.fn<(session: { sessionId: string; access: string; folder: string | null }) => Promise<{ ok: true } | { ok: false; reason: string }>>(),
}))
vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
  // The desktop app with the "This computer" bridge.
  window.pulpoDesktop = { platform: 'desktop', os: 'darwin', computer } as unknown as typeof window.pulpoDesktop
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
const { useChat } = await import('@/stores/chat')
const { useUploadOutbox } = await import('@/stores/upload-outbox')
const { getCatalogModel, useCatalog } = await import('@/stores/catalog')
const { useFileToasts } = await import('@/features/files/browser/toasts')
const { chooseComputer, resetComputerChoicesForTests } = await import('@/features/computer/selection')
const { activeComputerSessionIds, resetComputerSessionsForTests } = await import('@/features/computer/sessions')
const { runtimeAccountKey } = await import('@/lib/runtime')
const { clearRuntimeComposerDrafts, rememberRuntimeComposerDraft } = await import('@/lib/local-first/composer-drafts')
const { queryClient } = await import('@/lib/query-client')

const chatId = '11111111-1111-4111-8111-111111111111'
const folder = { path: '/Users/me/project', name: 'project' }
const fetchMock = vi.fn(async (..._args: unknown[]) => new Response('{}', { headers: { 'content-type': 'application/json' } }))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  localStorage.clear()
  resetComputerChoicesForTests()
  resetComputerSessionsForTests()
  useAuth.setState({ user: { id: 'account' } as NonNullable<ReturnType<typeof useAuth.getState>['user']>, instanceReady: true })
  useSettings.setState({ composerSyncEnabled: false, agentModes: { model: true } })
  useUploadOutbox.setState({ uploads: {}, submissions: [] })
  useCatalog.setState({ agentAvailable: true, computerAccess: true, models: [{ ...getCatalogModel(''), id: 'model', enabled: true, agentEnabled: true }] })
  useChat.setState({ chats: [{
    id: chatId, title: 'Chat', modelId: 'model', messages: [], queuedMessages: [], createdAt: 0, updatedAt: 0, pinned: false,
    folderId: null, sortOrder: 0, tags: [], temporary: false, expiresAt: null, expired: false,
  }], streamingIds: [], responseChatIds: {}, responseSequences: {} })
  useFileToasts.setState({ toasts: [] })
  queryClient.clear()
  clearRuntimeComposerDrafts('account')
  chooseComputer(runtimeAccountKey('account'), chatId, { enabled: true, access: 'suggest', folder })
  rememberRuntimeComposerDraft('account', chatId, { content: 'Tidy the folder', attachments: [], attachmentIds: [] })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

function renderComposer() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><TooltipProvider><Composer chatId={chatId} modelId="model" syncEnabled={false} /></TooltipProvider></MemoryRouter>
    </QueryClientProvider>,
  )
}

function sentBodies(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.flatMap(([url, init]) => String(url).includes(`/api/chats/${chatId}/responses`)
    ? [JSON.parse(String((init as RequestInit).body))] : [])
}

it('registers the session with the desktop app before sending, and sends it with the message', async () => {
  computer.begin.mockResolvedValue({ ok: true })
  const view = renderComposer()
  expect(view.getByRole('button', { name: 'Agent options, This computer' })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(sentBodies()).toHaveLength(1))
  const [session] = computer.begin.mock.calls[0]!
  expect(session).toEqual({ sessionId: expect.any(String), access: 'suggest', folder: folder.path })
  expect(sentBodies()[0]).toMatchObject({ agentMode: true, computer: session })
  const sendCall = fetchMock.mock.calls.findIndex(([url]) => String(url).includes('/responses'))
  expect(computer.begin.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[sendCall]!)
  expect(activeComputerSessionIds()).toEqual([session.sessionId])
})

it('keeps the draft and says why when the desktop app refuses the session', async () => {
  computer.begin.mockResolvedValue({ ok: false, reason: 'signed_out' })
  const view = renderComposer()
  fireEvent.click(view.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(useFileToasts.getState().toasts).toEqual([expect.objectContaining({ message: "This computer isn't connected", tone: 'error' })]))
  expect(sentBodies()).toEqual([])
  expect(useUploadOutbox.getState().submissions).toEqual([])
  expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Tidy the folder')
})

it('sends without the computer when agent mode is off', async () => {
  useSettings.setState({ agentModes: { model: false } })
  const view = renderComposer()
  expect(view.getByRole('button', { name: 'Agent options, Disabled' })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(sentBodies()).toHaveLength(1))
  expect(computer.begin).not.toHaveBeenCalled()
  expect(sentBodies()[0]).not.toHaveProperty('computer')
})
