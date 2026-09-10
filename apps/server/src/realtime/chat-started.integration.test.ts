import { createServer } from 'node:http'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { io as connect, type Socket } from 'socket.io-client'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ message: null as null | ((channel: string, value: string) => void) }))
vi.mock('@socket.io/redis-streams-adapter', () => ({ createAdapter: () => undefined }))
vi.mock('../redis.js', () => ({ createRedis: () => ({
  subscribe: async () => {}, disconnect() {},
  on: (_event: string, callback: typeof mocks.message) => { mocks.message = callback },
}) }))
vi.mock('../database/client.js', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ values: { composerSyncEnabled: true } }] }) }) }) } }))
vi.mock('../config.js', () => ({ getConfig: () => ({}), isAllowedOrigin: () => true }))
vi.mock('../auth/service.js', () => ({ authenticateSessionToken: async (token: string) => ({ id: token?.split(':')[0], role: 'user' }) }))
vi.mock('../lib/client-ip.js', () => ({ resolveClientIp: () => '127.0.0.1' }))
vi.mock('../composer/service.js', () => ({ accessComposer: vi.fn() }))
vi.mock('../responses/service.js', () => ({ toSnapshot: vi.fn() }))
vi.mock('../responses/events.js', () => ({ readResponseEvents: async () => [] }))
import { createSocketServer } from './socket.js'

let server: Awaited<ReturnType<typeof createSocketServer>> | undefined
const clients: Socket[] = []
const nextEvent = (socket: Socket, event: string) => new Promise<void>((resolve) => { socket.once(event, () => resolve()) })
afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect()
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
})

it('delivers starts to two connected devices, isolates other accounts and opt-outs, and never replays it on reconnect', async () => {
  const http = createServer()
  server = await createSocketServer(http)
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  const port = (http.address() as { port: number }).port
  const device = async (account: string, enabled = true) => {
    const socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'],
      auth: { sessionToken: `${account}:${'x'.repeat(40)}`,  composerSyncEnabled: enabled }, reconnection: false })
    clients.push(socket)
    await nextEvent(socket, 'connect')
    return socket
  }
  const first = await device('owner'), second = await device('owner')
  const other = await device('other'), optedOut = await device('owner', false)
  const firstEvents = vi.fn(), secondEvents = vi.fn(), otherEvents = vi.fn(), optedOutEvents = vi.fn()
  first.on('chat.started', firstEvents); second.on('chat.started', secondEvents)
  other.on('chat.started', otherEvents); optedOut.on('chat.started', optedOutEvents)
  const publish = (chatId: string) => mocks.message!('pulpo:chat-started', JSON.stringify({ userId: 'owner', chatId, responseId: `response:${chatId}` }))
  publish('live')
  await vi.waitFor(() => {
    expect(firstEvents).toHaveBeenCalledWith({ chatId: 'live', responseId: 'response:live' })
    expect(secondEvents).toHaveBeenCalledWith({ chatId: 'live', responseId: 'response:live' })
  })
  expect(otherEvents).not.toHaveBeenCalled()
  expect(optedOutEvents).not.toHaveBeenCalled()

  // Establish a recoverable offset, then disconnect the first device's transport.
  const revision = nextEvent(first, 'account.revision')
  server.to('user:owner').emit('account.revision', { revision: 1 })
  await revision
  first.io.engine.close()
  await vi.waitFor(() => expect(server!.of('/').sockets.size).toBe(3))
  publish('while-disconnected')
  await vi.waitFor(() => expect(secondEvents).toHaveBeenCalledTimes(2))
  const reconnected = nextEvent(first, 'connect')
  first.connect()
  await reconnected
  expect(first.recovered).toBe(true)
  await delay(20)
  expect(firstEvents).toHaveBeenCalledTimes(1)
  publish('after-reconnect')
  await vi.waitFor(() => expect(firstEvents).toHaveBeenCalledTimes(2))
  expect(firstEvents).toHaveBeenLastCalledWith({ chatId: 'after-reconnect', responseId: 'response:after-reconnect' })
  expect(otherEvents).not.toHaveBeenCalled()
  expect(optedOutEvents).not.toHaveBeenCalled()
})
