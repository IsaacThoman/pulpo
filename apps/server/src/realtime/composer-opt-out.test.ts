import type { Server as HttpServer } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyComposerState } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({
  connection: null as null | ((socket: unknown) => void),
  message: null as null | ((channel: string, message: string) => void),
  enabled: true, access: vi.fn(), to: vi.fn(), emit: vi.fn(),
}))
vi.mock('../database/client.js', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ values: { composerSyncEnabled: mocks.enabled } }] }) }) }) } }))
vi.mock('socket.io', () => ({ Server: class {
  use() {}
  on(event: string, callback: (socket: unknown) => void) { if (event === 'connection') mocks.connection = callback }
  to(room: string) { mocks.to(room); return this }
  emit(...args: unknown[]) { mocks.emit(...args) }
} }))
vi.mock('@socket.io/redis-streams-adapter', () => ({ createAdapter: vi.fn() }))
vi.mock('../redis.js', () => ({ createRedis: () => ({
  subscribe: async () => {},
  on: (_event: string, callback: typeof mocks.message) => { mocks.message = callback },
}) }))
vi.mock('../config.js', () => ({ getConfig: () => ({}), isAllowedOrigin: () => true }))
vi.mock('../composer/service.js', () => ({ accessComposer: mocks.access }))
import { createSocketServer } from './socket.js'

function connect(auth = {}, adminChatAccess: unknown = null) {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const rooms = new Set(['composer:user']) // Recovered sockets can restore previous rooms.
  const socket = {
    data: { user: { id: 'user' }, adminChatAccess, composerSyncEnabled: true },
    handshake: { auth },
    join: (room: string) => rooms.add(room), leave: (room: string) => rooms.delete(room),
    on: (event: string, callback: (...args: any[]) => unknown) => handlers.set(event, callback),
  }
  mocks.connection!(socket)
  return { socket, rooms, call: (event: string, ...args: unknown[]) => handlers.get(event)!(...args) }
}
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.enabled = true
  await createSocketServer({} as HttpServer)
  mocks.access.mockResolvedValue({ ok: true, snapshot: { draftId: 'new', revision: 1, clearedRevision: 0, mutationId: null, state: emptyComposerState() } })
})
describe('composer socket opt-out', () => {
  it('enforces account opt-out even for older clients and suppresses broadcasts', async () => {
    mocks.enabled = false
    const client = connect(), ack = vi.fn()
    await client.call('composer.read', { draftId: 'new' }, ack)
    await client.call('composer.write', { draftId: 'new' }, ack)
    expect(mocks.access).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(ack).toHaveBeenLastCalledWith({ ok: false, error: 'composer_sync_disabled' }))
    mocks.message!('pulpo:composer-changes', JSON.stringify({ userId: 'user', snapshot: {} }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.emit).not.toHaveBeenCalled()
  })
  it('defaults older clients to enabled and broadcasts only to composer subscribers', async () => {
    const client = connect(), ack = vi.fn()
    expect(client.rooms.has('composer:user')).toBe(true)
    await client.call('composer.read', { draftId: 'new' }, ack)
    await vi.waitFor(() => expect(mocks.access).toHaveBeenCalledWith('user', 'new', undefined))
    await vi.waitFor(() => expect(mocks.to).toHaveBeenLastCalledWith('composer:user'))
    mocks.message!('pulpo:composer-changes', JSON.stringify({ userId: 'user', snapshot: {} }))
    await vi.waitFor(() => expect(mocks.to).toHaveBeenLastCalledWith('composer:user'))
  })
  it('removes restored subscriptions and rejects reads and writes while opted out', async () => {
    const client = connect({ composerSyncEnabled: false }), ack = vi.fn()
    expect(client.rooms.has('composer:user')).toBe(false)
    expect(client.rooms.has('user:user')).toBe(true)
    await client.call('composer.read', { draftId: 'new' }, ack)
    await client.call('composer.write', { draftId: 'new' }, ack)
    expect(mocks.access).not.toHaveBeenCalled()
    expect(ack).toHaveBeenLastCalledWith({ ok: false, error: 'unauthorized' })
    client.call('composer.configure', { enabled: true })
    await client.call('composer.read', { draftId: 'new' }, ack)
    await vi.waitFor(() => expect(mocks.access).toHaveBeenCalledOnce())
    expect(client.rooms.has('composer:user')).toBe(true)
    client.call('composer.configure', { enabled: false })
    expect(client.rooms.has('composer:user')).toBe(false)
  })
  it('does not let administrative access sessions enable composer sync', () => {
    const client = connect({}, {})
    client.call('composer.configure', { enabled: true })
    expect(client.rooms.has('composer:user')).toBe(false)
    expect(client.socket.data.composerSyncEnabled).toBe(false)
  })
})
