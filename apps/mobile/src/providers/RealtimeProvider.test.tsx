// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { create } from 'zustand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ io: vi.fn(), me: vi.fn() }))
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }))
vi.mock('expo-crypto', () => ({ randomUUID: () => 'client-id' }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => queryClient }))
vi.mock('socket.io-client', () => ({ io: mocks.io }))
vi.mock('../store/session', () => ({ useSessionStore: session }))
vi.mock('../api/client', () => ({ apiOrigin: () => 'https://pulpo.test', mobileApi: { me: mocks.me } }))
vi.mock('../features/chat/shelf', () => ({ bindMobileShelfSocket: () => () => {} }))
vi.mock('../features/chat/composerSync', () => ({ bindMobileComposerSocket: () => () => {} }))
vi.mock('../data/outbox', () => ({ replayOutbox: async () => ({ replayed: 0, rejected: 0 }) }))
vi.mock('../data/database', () => ({
  cacheNamespace: (origin: string, id: string) => `${origin}|${id}`,
  getValue: async () => 'client-id', setValue: async () => {},
  responseCursors: async () => ({}), saveResponseCursors: async () => {},
  deleteResponseCursor: async () => {}, pendingOutbox: async () => [],
}))

const session = create(() => ({ token: 'token' as string | null, user: { id: 'new-user', role: 'pending', stateRevision: 0 }, status: 'pending', instanceUrl: 'https://pulpo.test' }))
const queryClient = { invalidateQueries: vi.fn(), getQueryData: vi.fn() }
const { RealtimeProvider } = await import('./RealtimeProvider')
const { useRealtimeStore } = await import('./realtimeStore')
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
let sockets: ReturnType<typeof fakeSocket>[]
function fakeSocket() {
  const handlers = new Map<string, (...args: any[]) => void>()
  return {
    connected: false,
    on: vi.fn((event: string, listener: (...args: any[]) => void) => { handlers.set(event, listener) }),
    emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
    fire(event: string, ...args: any[]) { handlers.get(event)?.(...args) },
  }
}
beforeEach(() => {
  vi.useFakeTimers()
  sockets = []
  mocks.io.mockReset().mockImplementation(() => { const socket = fakeSocket(); sockets.push(socket); return socket })
  mocks.me.mockResolvedValue({ user: {} })
  session.setState({ status: 'pending', token: 'token', user: { id: 'new-user', role: 'pending', stateRevision: 0 } })
  useRealtimeStore.setState({ connectionPhase: 'idle', connected: false, syncError: null })
  container = document.createElement('div'); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.restoreAllMocks() })
async function mount() { await act(async () => root.render(<RealtimeProvider><span>App</span></RealtimeProvider>)) }

describe('realtime session lifecycle', () => {
  it('waits for approval and connects when the same session becomes approved', async () => {
    await mount()
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(mocks.io).not.toHaveBeenCalled()
    expect(useRealtimeStore.getState().syncError).toBeNull()
    await act(async () => session.setState({ status: 'authenticated', user: { id: 'new-user', role: 'user', stateRevision: 0 } }))
    expect(mocks.io).toHaveBeenCalledOnce()
    expect(sockets[0]!.connect).toHaveBeenCalledOnce()
    await act(async () => { sockets[0]!.connected = true; sockets[0]!.fire('connect') })
    expect(useRealtimeStore.getState()).toMatchObject({ connected: true, syncError: null })
  })

  it('connects immediately for open signup and clears errors when signing out', async () => {
    session.setState({ status: 'authenticated', user: { id: 'new-user', role: 'user', stateRevision: 0 } })
    await mount()
    expect(sockets[0]!.connect).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(useRealtimeStore.getState().syncError).not.toBeNull()
    await act(async () => session.setState({ status: 'anonymous', token: null }))
    expect(sockets[0]!.disconnect).toHaveBeenCalledOnce()
    expect(useRealtimeStore.getState()).toMatchObject({ connectionPhase: 'idle', syncError: null })
  })
})


it('forwards chat starts with the instance/account scope and drops disconnected or disposed delivery', async () => {
  const { mobileChatStarted } = await import('../features/chat/chatStarted')
  const receive = vi.spyOn(mobileChatStarted, 'receive')
  session.setState({ status: 'authenticated', user: { id: 'new-user', role: 'user', stateRevision: 0 } })
  await mount()
  const socket = sockets[0]!
  const event = { chatId: 'new-chat', responseId: 'response' }
  socket.fire('chat.started', event)
  expect(receive).not.toHaveBeenCalled()
  socket.connected = true
  socket.fire('chat.started', event)
  expect(receive).toHaveBeenCalledWith('https://pulpo.test|new-user', event)
  receive.mockClear()
  await act(async () => session.setState({ status: 'anonymous', token: null }))
  socket.fire('chat.started', event)
  expect(receive).not.toHaveBeenCalled()
})
