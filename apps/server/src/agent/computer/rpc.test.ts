import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'

vi.mock('../../redis.js', () => ({ redis: {}, createRedis: () => ({}) }))

import { COMPUTER_REPLIES_CHANNEL, COMPUTER_REQUESTS_CHANNEL, ComputerRpcClient, ComputerRpcError, type ComputerReplyEnvelope, type ComputerRequestEnvelope } from './rpc.js'
import { computerPresenceKey } from './presence.js'

/** In-memory stand-in for the two Redis connections: one publisher, one subscriber. */
function fakeRedis(online: Set<string>) {
  const bus = new EventEmitter()
  const published: ComputerRequestEnvelope[] = []
  const publisher = {
    publish: async (channel: string, message: string) => {
      if (channel === COMPUTER_REQUESTS_CHANNEL) published.push(JSON.parse(message) as ComputerRequestEnvelope)
      bus.emit('publish', channel, message)
      return 1
    },
    get: async (key: string) => [...online].some((id) => computerPresenceKey(id) === key) ? JSON.stringify({ socketId: 'socket-1' }) : null,
    exists: async (key: string) => ([...online].some((id) => computerPresenceKey(id) === key) ? 1 : 0),
  } as unknown as Redis
  const subscriber = () => {
    const emitter = new EventEmitter()
    bus.on('publish', (channel: string, message: string) => { if (channel === COMPUTER_REPLIES_CHANNEL) emitter.emit('message', channel, message) })
    return Object.assign(emitter, { subscribe: async () => 1, disconnect: () => undefined }) as unknown as Redis
  }
  const reply = (envelope: ComputerReplyEnvelope) => bus.emit('publish', COMPUTER_REPLIES_CHANNEL, JSON.stringify(envelope))
  return { publisher, subscriber, published, reply }
}

describe('ComputerRpcClient', () => {
  it('publishes a request and resolves with the matching reply', async () => {
    const fake = fakeRedis(new Set(['c1']))
    const client = new ComputerRpcClient(fake.publisher, fake.subscriber)
    const pending = client.request('c1', { chatId: '00000000-0000-4000-8000-000000000001', kind: 'operation.status', id: 'op-1' })
    await vi.waitFor(() => expect(fake.published).toHaveLength(1))
    expect(fake.published[0]).toMatchObject({ computerId: 'c1', request: { chatId: '00000000-0000-4000-8000-000000000001', kind: 'operation.status', id: 'op-1' } })
    fake.reply({ requestId: 'unrelated', reply: { ok: true, result: null } })
    fake.reply({ requestId: fake.published[0]!.requestId, reply: { ok: true, result: { id: 'op-1', status: 'completed', output: 'done', exitCode: 0 } } })
    await expect(pending).resolves.toMatchObject({ status: 'completed', output: 'done' })
    await client.close()
  })

  it('surfaces desktop-side refusals with their code', async () => {
    const fake = fakeRedis(new Set(['c1']))
    const client = new ComputerRpcClient(fake.publisher, fake.subscriber)
    const pending = client.request('c1', { chatId: '00000000-0000-4000-8000-000000000001', kind: 'operation.start', id: 'op-2', type: 'bash', args: { command: 'ls' } })
    await vi.waitFor(() => expect(fake.published).toHaveLength(1))
    fake.reply({ requestId: fake.published[0]!.requestId, reply: { ok: false, error: 'needs approval', code: 'approval_required' } })
    await expect(pending).rejects.toMatchObject({ code: 'approval_required', message: 'needs approval' })
    await client.close()
  })

  it('reports offline when nothing answers and no presence key exists, unreachable otherwise', async () => {
    const offline = fakeRedis(new Set())
    const offlineClient = new ComputerRpcClient(offline.publisher, offline.subscriber)
    await expect(offlineClient.request('gone', { chatId: '00000000-0000-4000-8000-000000000001', kind: 'operation.status', id: 'x' }, { timeoutMs: 30 }))
      .rejects.toSatisfy((error: unknown) => error instanceof ComputerRpcError && error.code === 'offline')
    await offlineClient.close()

    const silent = fakeRedis(new Set(['quiet']))
    const silentClient = new ComputerRpcClient(silent.publisher, silent.subscriber)
    await expect(silentClient.request('quiet', { chatId: '00000000-0000-4000-8000-000000000001', kind: 'operation.status', id: 'x' }, { timeoutMs: 30 }))
      .rejects.toSatisfy((error: unknown) => error instanceof ComputerRpcError && error.code === 'unreachable')
    await silentClient.close()
  })

  it('aborts a pending request when the signal fires', async () => {
    const fake = fakeRedis(new Set(['c1']))
    const client = new ComputerRpcClient(fake.publisher, fake.subscriber)
    const controller = new AbortController()
    const pending = client.request('c1', { chatId: '00000000-0000-4000-8000-000000000001', kind: 'operation.status', id: 'op-3' }, { signal: controller.signal, timeoutMs: 5_000 })
    await vi.waitFor(() => expect(fake.published).toHaveLength(1))
    controller.abort(new Error('stopped'))
    await expect(pending).rejects.toThrow('stopped')
    await client.close()
  })
})
