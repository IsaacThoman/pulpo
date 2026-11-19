// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { COMPUTER_HOST_HEARTBEAT_MS, type ComputerRequest, type ComputerResponse } from '@pulpo/contracts'
import { useRealtimeSocket, type PulpoSocket } from '@/lib/realtime-socket'
import { ComputerBridge } from './ComputerBridge'
import { endComputerSession, resetComputerSessionsForTests, trackComputerSession } from './sessions'

const sessionId = '00000000-0000-4000-8000-0000000000c1'

function fakeSocket() {
  const listeners = new Map<string, Set<(value?: unknown) => void>>()
  return {
    connected: true,
    listeners,
    on: vi.fn((name: string, listener: (value?: unknown) => void) => { (listeners.get(name) ?? listeners.set(name, new Set()).get(name)!).add(listener) }),
    off: vi.fn((name: string, listener: (value?: unknown) => void) => { listeners.get(name)?.delete(listener) }),
    emit: vi.fn(),
    fire(name: string, value?: unknown) { for (const listener of listeners.get(name) ?? []) listener(value) },
  }
}

function request(id: string, method: ComputerRequest['method'] = 'describe'): ComputerRequest {
  return { id, sessionId, method, params: {}, timeoutMs: 30_000 }
}

let socket: ReturnType<typeof fakeSocket>
let computer: { handle: ReturnType<typeof vi.fn>; sessions: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.useFakeTimers()
  resetComputerSessionsForTests()
  socket = fakeSocket()
  computer = { handle: vi.fn(), sessions: vi.fn(async () => []), end: vi.fn(async () => undefined) }
  window.pulpoDesktop = { platform: 'desktop', computer } as unknown as typeof window.pulpoDesktop
  useRealtimeSocket.setState({ socket: socket as unknown as PulpoSocket })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete window.pulpoDesktop
  useRealtimeSocket.setState({ socket: null })
})

const hosts = () => socket.emit.mock.calls.filter(([name]) => name === 'computer.host').map(([, value]) => value)

it('answers each request through the desktop app, without one waiting on another', async () => {
  let finishPoll!: (response: ComputerResponse) => void
  computer.handle.mockImplementation((incoming: ComputerRequest) => incoming.method === 'operation.get'
    ? new Promise((resolve) => { finishPoll = resolve })
    : Promise.resolve({ id: incoming.id, sessionId, ok: true, result: { status: 'cancelled' } }))
  await act(async () => { render(<ComputerBridge />) })
  const poll = request('00000000-0000-4000-8000-0000000000a1', 'operation.get')
  const cancel = request('00000000-0000-4000-8000-0000000000a2', 'operation.cancel')
  await act(async () => {
    socket.fire('computer.request', poll)
    socket.fire('computer.request', cancel)
    socket.fire('computer.request', { id: 'not-a-uuid' })
  })
  expect(computer.handle).toHaveBeenCalledTimes(2)
  expect(socket.emit).toHaveBeenCalledWith('computer.response', { id: cancel.id, sessionId, ok: true, result: { status: 'cancelled' } })
  await act(async () => { finishPoll({ id: poll.id, sessionId, ok: true, result: { status: 'running' } }) })
  expect(socket.emit).toHaveBeenLastCalledWith('computer.response', { id: poll.id, sessionId, ok: true, result: { status: 'running' } })
})

it('answers with a failure when the desktop app throws', async () => {
  computer.handle.mockRejectedValue(new Error('IPC closed'))
  await act(async () => { render(<ComputerBridge />) })
  const incoming = request('00000000-0000-4000-8000-0000000000a3')
  await act(async () => { socket.fire('computer.request', incoming) })
  expect(socket.emit).toHaveBeenCalledWith('computer.response', { id: incoming.id, sessionId, ok: false, code: 'failed', message: 'IPC closed' })
})

it('announces sessions on change, on reconnect, and as a heartbeat while any is active', async () => {
  await act(async () => { render(<ComputerBridge />) })
  expect(hosts()).toEqual([])
  act(() => trackComputerSession(sessionId))
  expect(hosts()).toEqual([{ sessionIds: [sessionId] }])
  act(() => socket.fire('connect'))
  expect(hosts()).toHaveLength(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(COMPUTER_HOST_HEARTBEAT_MS) })
  expect(hosts()).toHaveLength(3)
  act(() => endComputerSession(sessionId))
  expect(hosts().at(-1)).toEqual({ sessionIds: [] })
  expect(computer.end).toHaveBeenCalledWith(sessionId)
  const count = hosts().length
  await act(async () => { await vi.advanceTimersByTimeAsync(COMPUTER_HOST_HEARTBEAT_MS * 2) })
  act(() => socket.fire('connect'))
  expect(hosts()).toHaveLength(count)
})

it('keeps serving the sessions the desktop app still holds after a reload, until they expire there', async () => {
  computer.sessions.mockResolvedValue([sessionId])
  await act(async () => { render(<ComputerBridge />) })
  expect(hosts()).toEqual([{ sessionIds: [sessionId] }])
  computer.sessions.mockResolvedValue([])
  await act(async () => { await vi.advanceTimersByTimeAsync(COMPUTER_HOST_HEARTBEAT_MS) })
  expect(hosts().at(-1)).toEqual({ sessionIds: [] })
  expect(computer.end).not.toHaveBeenCalled()
})

it('does nothing without the bridge', async () => {
  window.pulpoDesktop = { platform: 'desktop' } as unknown as typeof window.pulpoDesktop
  await act(async () => { render(<ComputerBridge />) })
  expect(socket.on).not.toHaveBeenCalled()
})

it('stops listening when unmounted', async () => {
  const view = render(<ComputerBridge />)
  await act(async () => undefined)
  view.unmount()
  expect(socket.listeners.get('computer.request')?.size ?? 0).toBe(0)
  expect(socket.listeners.get('connect')?.size ?? 0).toBe(0)
})
