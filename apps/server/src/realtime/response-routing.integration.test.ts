import { createServer } from 'node:http'
import { once } from 'node:events'
import { io as connect, type Socket } from 'socket.io-client'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  message: null as null | ((channel: string, value: string) => void),
  lookup: vi.fn(),
}))
vi.mock('@socket.io/redis-streams-adapter', () => ({ createAdapter: () => undefined }))
vi.mock('../redis.js', () => ({ createRedis: () => ({
  subscribe: async () => {}, disconnect() {},
  on: (_event: string, callback: typeof mocks.message) => { mocks.message = callback },
}) }))
vi.mock('../database/client.js', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.lookup }) }) }) } }))
vi.mock('../config.js', () => ({ getConfig: () => ({}), isAllowedOrigin: () => true }))
vi.mock('../auth/service.js', () => ({ authenticateSessionToken: async (token: string) => ({ id: token?.split(':')[0], role: 'user' }) }))
vi.mock('../lib/client-ip.js', () => ({ resolveClientIp: () => '127.0.0.1' }))
vi.mock('../composer/service.js', () => ({ accessComposer: vi.fn() }))
vi.mock('../responses/service.js', () => ({ toSnapshot: vi.fn() }))
vi.mock('../responses/events.js', () => ({ readResponseEvents: async () => [] }))
import { createSocketServer } from './socket.js'

let server: Awaited<ReturnType<typeof createSocketServer>> | undefined
const clients: Socket[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect()
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
  vi.restoreAllMocks()
  mocks.lookup.mockReset()
})

it.each(['event', 'snapshot'] as const)('contains an expired owner lookup failure and retries %s routing on the next publication', async (kind) => {
  const realNow = Date.now
  let elapsed = 0
  // Install before creating the resolver so its injected clock observes expiry.
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + elapsed)
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  const owner = { userId: 'owner', chatId: 'chat' }
  const failure = new Error('ownership database temporarily unavailable')
  mocks.lookup.mockResolvedValueOnce([owner]).mockRejectedValueOnce(failure).mockResolvedValue([owner])
  const http = createServer()
  server = await createSocketServer(http)
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  const port = (http.address() as { port: number }).port
  const device = async (account: string) => {
    const socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'],
      auth: { sessionToken: `${account}:${'x'.repeat(40)}`, composerSyncEnabled: false }, reconnection: false, timeout: 5000 })
    clients.push(socket)
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('connect_error', reject)
    })
    return socket
  }
  const owningClient = await device('owner')
  const foreignClient = await device('other')
  const ownerEvents = vi.fn(), foreignEvents = vi.fn(), completed = vi.fn(), foreignCompleted = vi.fn()
  owningClient.on(`response.${kind}`, ownerEvents)
  foreignClient.on(`response.${kind}`, foreignEvents)
  owningClient.on('response.completed', completed)
  foreignClient.on('response.completed', foreignCompleted)
  const publish = (sequence: number) => {
    const value = kind === 'event'
      ? { responseId: 'response', sequence, type: 'response.output_text.delta', payload: { delta: `text:${sequence}` } }
      : { responseId: 'response', sequence, status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: `text:${sequence}` }] }] }
    mocks.message!(`pulpo:response-${kind === 'event' ? 'events' : 'snapshots'}`, JSON.stringify(value))
  }
  publish(1)
  await vi.waitFor(() => expect(ownerEvents).toHaveBeenCalledTimes(1))
  expect(mocks.lookup).toHaveBeenCalledTimes(1)
  // A cache hit on an established stream does not need another ownership query.
  publish(2)
  await vi.waitFor(() => expect(ownerEvents).toHaveBeenCalledTimes(2))
  expect(mocks.lookup).toHaveBeenCalledTimes(1)
  elapsed = 300_001
  publish(3)
  await vi.waitFor(() => expect(logged).toHaveBeenCalledWith(`[realtime] response.${kind} failed`, failure))
  expect(ownerEvents).toHaveBeenCalledTimes(2)
  expect(mocks.lookup).toHaveBeenCalledTimes(2)
  publish(4)
  await vi.waitFor(() => expect(ownerEvents).toHaveBeenCalledTimes(3))
  expect(ownerEvents.mock.calls.at(-1)?.[0]).toMatchObject({ responseId: 'response', sequence: 4 })
  expect(mocks.lookup).toHaveBeenCalledTimes(3)
  expect(foreignEvents).not.toHaveBeenCalled()
  expect(foreignCompleted).not.toHaveBeenCalled()
  if (kind === 'snapshot') {
    await vi.waitFor(() => expect(completed).toHaveBeenCalledTimes(3))
    expect(completed.mock.calls.at(-1)?.[0]).toEqual({ responseId: 'response', chatId: 'chat', preview: 'text:4' })
  } else expect(completed).not.toHaveBeenCalled()
})
