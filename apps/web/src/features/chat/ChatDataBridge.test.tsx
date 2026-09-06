// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (value?: unknown) => void>()
  const socket = {
    connected: true,
    on: (name: string, listener: (value?: unknown) => void) => { listeners.set(name, listener) },
    emit: vi.fn(), disconnect: vi.fn(),
    timeout: (_ms: number) => socket,
    emitWithAck: vi.fn(async () => ({ accountRevision: 0, invalidate: [] as string[], snapshots: [], events: [] })),
  }
  const chat = {
    activeTemporaryChatId: null, streamingIds: ['response-a'], responseSequences: {}, responseChatIds: {}, chats: [],
    replaceSummaries: vi.fn(), replaceFolders: vi.fn(), setDetailedChat: vi.fn(), setAdminAccessRequiredChat: vi.fn(),
    applyResponseEvents: vi.fn(), applyResponseSnapshot: vi.fn(),
  }
  return { listeners, socket, chat, flushOutbox: vi.fn(async () => [] as string[]), load: vi.fn() }
})
vi.mock('socket.io-client', () => ({ io: () => mocks.socket }))
vi.mock('@/stores/auth', () => ({ useAuth: (selector: (state: unknown) => unknown) => selector({ user: { id: 'user', role: 'user', stateRevision: 0 }, instanceReady: true }) }))
vi.mock('@/stores/catalog', () => ({ useCatalog: (selector: (state: unknown) => unknown) => selector({ load: mocks.load }) }))
vi.mock('@/stores/chat', () => ({
  useChat: Object.assign((selector: (state: unknown) => unknown) => selector(mocks.chat), { getState: () => mocks.chat }),
  mergeServerChatDetails: (_previous: unknown, incoming: unknown) => incoming,
}))
vi.mock('@/lib/local-first/composer-sync', () => ({ bindWebComposerSocket: () => () => {} }))
vi.mock('@/stores/composer-sync-preference', () => ({ useComposerSyncPreference: { getState: () => ({ enabled: false }) } }))
vi.mock('@/lib/local-first/outbox', () => ({ flushOutbox: mocks.flushOutbox }))
vi.mock('@/lib/local-first/database', () => ({ localDb: { responseCursors: {
  where: () => ({ equals: () => ({ toArray: async () => [{ responseId: 'response-a', sequence: 10 }] }) }),
  get: async () => ({ sequence: 10 }), bulkPut: vi.fn(), delete: vi.fn(),
} } }))

const { queryClient } = await import('@/lib/query-client')
const { ChatDataBridge } = await import('./ChatDataBridge')

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.socket.connected = true
  mocks.listeners.clear()
  mocks.socket.emitWithAck.mockResolvedValue({ accountRevision: 0, invalidate: [], snapshots: [], events: [] })
  mocks.flushOutbox.mockResolvedValue([])
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { headers: { 'content-type': 'application/json' } })))
})
afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function mountBridge() {
  await act(async () => { render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/c/chat-a']}><ChatDataBridge /></MemoryRouter></QueryClientProvider>) })
  mocks.socket.emit.mockClear()
}

it('synchronizes once for connect/focus/visibility/online and restores response cursors without refetching unchanged data', async () => {
  await mountBridge()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  await act(async () => {
    mocks.listeners.get('connect')!()
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(120)
  })
  expect(mocks.socket.emitWithAck).toHaveBeenCalledTimes(1)
  expect(mocks.socket.emitWithAck).toHaveBeenCalledWith('client.sync', expect.objectContaining({ responseCursors: { 'response-a': 10 }, activeChatId: 'chat-a' }))
  expect(mocks.socket.emit).toHaveBeenCalledWith('response.subscribe', { responseId: 'response-a', afterSequence: 10 })
  expect(invalidate).not.toHaveBeenCalled()
})

it('coalesces scoped revision notifications and reconciles a rejected settings mutation', async () => {
  await mountBridge()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  mocks.flushOutbox.mockResolvedValue(['/api/settings'])
  await act(async () => {
    mocks.listeners.get('account.revision')!({ revision: 1, scopes: ['settings'] })
    mocks.listeners.get('account.revision')!({ revision: 1, scopes: ['settings'] })
    await vi.advanceTimersByTimeAsync(16)
  })
  expect(invalidate.mock.calls).toEqual([[{ queryKey: ['settings', 'user'] }]])
  invalidate.mockClear()
  await act(async () => { mocks.listeners.get('connect')!(); await vi.advanceTimersByTimeAsync(120) })
  expect(invalidate.mock.calls).toEqual([[{ queryKey: ['settings', 'user'] }]])
})

it('does not run scheduled synchronization after unmount or while disconnected', async () => {
  await mountBridge()
  mocks.socket.connected = false
  await act(async () => { mocks.listeners.get('connect')!(); await vi.advanceTimersByTimeAsync(120) })
  expect(mocks.socket.emitWithAck).not.toHaveBeenCalled()
  mocks.socket.connected = true
  mocks.listeners.get('connect')!()
  cleanup()
  await vi.advanceTimersByTimeAsync(120)
  expect(mocks.socket.emitWithAck).not.toHaveBeenCalled()
})
