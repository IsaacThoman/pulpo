import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { ComputerReply, ComputerReplyErrorCode, ComputerRequest, ComputerRequestResult } from '@pulpo/contracts'
import { createRedis, redis as sharedRedis } from '../../redis.js'
import { computerIsOnline } from './presence.js'

export const COMPUTER_REQUESTS_CHANNEL = 'pulpo:computer-requests'
export const COMPUTER_REPLIES_CHANNEL = 'pulpo:computer-replies'
export const COMPUTER_EVENTS_CHANNEL = 'pulpo:computer-events'

export const DEFAULT_COMPUTER_RPC_TIMEOUT_MS = 30_000

export type ComputerRpcErrorCode = ComputerReplyErrorCode | 'offline' | 'unreachable'

export class ComputerRpcError extends Error {
  constructor(public readonly code: ComputerRpcErrorCode, message: string) {
    super(message)
    this.name = 'ComputerRpcError'
  }
}

/** Published by the worker; the API replica that holds the computer's socket relays it. */
export interface ComputerRequestEnvelope {
  requestId: string
  computerId: string
  request: ComputerRequest
  timeoutMs: number
}

export interface ComputerReplyEnvelope {
  requestId: string
  reply: ComputerReply
}

/** Published by the worker (or API) to push a notification to a connected computer. */
export interface ComputerEventEnvelope {
  computerId: string
  event: string
  payload: unknown
}

interface PendingRequest {
  resolve: (reply: ComputerReply) => void
  timer: NodeJS.Timeout
}

/**
 * Worker-side client. Requests go out over Redis pub/sub because the agent worker never holds
 * sockets; replies come back on a second channel and are matched by request id.
 */
export class ComputerRpcClient {
  private subscriber?: Redis
  private subscribed?: Promise<void>
  private readonly pending = new Map<string, PendingRequest>()

  constructor(
    private readonly publisher: Redis = sharedRedis,
    private readonly createSubscriber: () => Redis = createRedis,
  ) {}

  private ensureSubscribed(): Promise<void> {
    if (this.subscribed) return this.subscribed
    const subscriber = this.createSubscriber()
    this.subscriber = subscriber
    subscriber.on('message', (channel: string, message: string) => {
      if (channel !== COMPUTER_REPLIES_CHANNEL) return
      let envelope: ComputerReplyEnvelope
      try { envelope = JSON.parse(message) as ComputerReplyEnvelope } catch { return }
      const waiting = this.pending.get(envelope.requestId)
      if (!waiting) return
      clearTimeout(waiting.timer)
      this.pending.delete(envelope.requestId)
      waiting.resolve(envelope.reply)
    })
    this.subscribed = subscriber.subscribe(COMPUTER_REPLIES_CHANNEL).then(() => undefined)
    return this.subscribed
  }

  async request<K extends ComputerRequest['kind']>(
    computerId: string,
    request: Extract<ComputerRequest, { kind: K }>,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<ComputerRequestResult[K]> {
    await this.ensureSubscribed()
    options.signal?.throwIfAborted()
    const timeoutMs = options.timeoutMs ?? DEFAULT_COMPUTER_RPC_TIMEOUT_MS
    const requestId = randomUUID()
    const reply = await new Promise<ComputerReply | 'timeout' | 'aborted'>((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); resolve('timeout') }, timeoutMs)
      const onAbort = () => { clearTimeout(timer); this.pending.delete(requestId); resolve('aborted') }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(requestId, {
        resolve: (value) => { options.signal?.removeEventListener('abort', onAbort); resolve(value) },
        timer,
      })
      const envelope: ComputerRequestEnvelope = { requestId, computerId, request, timeoutMs }
      void this.publisher.publish(COMPUTER_REQUESTS_CHANNEL, JSON.stringify(envelope)).catch(() => {
        clearTimeout(timer)
        this.pending.delete(requestId)
        resolve({ ok: false, error: 'Unable to reach the realtime relay', code: 'failed' })
      })
    })
    if (reply === 'aborted') throw options.signal?.reason ?? new Error('Computer request aborted')
    if (reply === 'timeout') {
      const online = await computerIsOnline(computerId, this.publisher).catch(() => false)
      throw online
        ? new ComputerRpcError('unreachable', 'The computer did not answer in time')
        : new ComputerRpcError('offline', 'The computer is offline')
    }
    if (!reply.ok) throw new ComputerRpcError(reply.code, reply.error)
    return reply.result as ComputerRequestResult[K]
  }

  async close(): Promise<void> {
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer)
      waiting.resolve({ ok: false, error: 'RPC client closed', code: 'failed' })
    }
    this.pending.clear()
    this.subscriber?.disconnect()
    this.subscriber = undefined
    this.subscribed = undefined
  }
}

let sharedClient: ComputerRpcClient | undefined
export function computerRpc(): ComputerRpcClient {
  sharedClient ??= new ComputerRpcClient()
  return sharedClient
}

/** Push a server-originated notification (approval request, pairing request, revocation) to a computer's socket. */
export async function publishComputerEvent(computerId: string, event: string, payload: unknown, client: Redis = sharedRedis): Promise<void> {
  const envelope: ComputerEventEnvelope = { computerId, event, payload }
  await client.publish(COMPUTER_EVENTS_CHANNEL, JSON.stringify(envelope))
}
