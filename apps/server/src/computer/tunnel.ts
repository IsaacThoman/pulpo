import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import type { Redis } from 'ioredis'
import {
  COMPUTER_REQUEST_TIMEOUT_MS, computerMethods, computerTransferTimeoutMs,
  type ComputerErrorCode, type ComputerMethod, type ComputerParams, type ComputerRequest, type ComputerResponse, type ComputerResult, type ComputerTransfer,
} from '@pulpo/contracts'
import { createRedis } from '../redis.js'
import { COMPUTER_RESPONSES_CHANNEL } from '../redis-keys.js'
import { getBlobStore } from '../storage/index.js'
import { exactSizeStream } from '../attachments/streams.js'
import { computerHostConnected, computerResponseMessageSchema, publishComputerRequest } from './host.js'
import {
  completeComputerTransfer, computerTransferObjectKey, createComputerTransfer, disposeComputerTransfer, readComputerTransfer,
} from './transfers.js'

/**
 * The server's side of "This computer". The worker never dials a user's computer: each request is
 * published to Redis, the API process that holds the desktop app's socket emits it there
 * (`computer.request`), and the answer (`computer.response`) comes back the same way. File bytes
 * travel through one-time transfer URLs served by the API.
 */

/** The desktop app that owns the session is not connected, or it stopped answering. */
export class ComputerUnavailableError extends Error {
  constructor(message = 'The user\'s computer is not connected to Pulpo right now') { super(message) }
}

/** The desktop app answered that it could not, or may not, do what was asked. `message` is for the agent. */
export class ComputerRequestError extends Error {
  constructor(readonly code: ComputerErrorCode, message: string) { super(message) }
}

/** Whose computer, and which of its sessions: the realtime room is keyed by both, so an answer can only come from that user's app. */
export interface ComputerSessionRef {
  userId: string
  sessionId: string
}

export interface ComputerCallOptions {
  /** How long to wait for the answer; defaults to COMPUTER_REQUEST_TIMEOUT_MS. */
  timeoutMs?: number
  signal?: AbortSignal
}

/** A reply can start before the desktop app has announced its new session; give it this long to show up. */
export const COMPUTER_CONNECT_WAIT_MS = 10_000
const COMPUTER_CONNECT_POLL_MS = 500
/**
 * While an answer is awaited, how often the session's presence is checked. An app that went away
 * (its socket closed) fails the call after two misses in a row, instead of after the whole timeout;
 * a socket that reconnects in between is seen again and the call goes on waiting.
 */
export const COMPUTER_PRESENCE_CHECK_MS = 5_000

/** Whether a desktop app has announced this session within COMPUTER_HOST_TTL_MS. */
export async function computerConnected(session: ComputerSessionRef): Promise<boolean> {
  return computerHostConnected(session.userId, session.sessionId)
}

type PendingCall = { session: ComputerSessionRef; settle: (response: ComputerResponse) => void }
const pendingCalls = new Map<string, PendingCall>()
let responseSubscriber: Promise<Redis> | undefined

function receiveAnswer(message: string): void {
  let value: unknown
  try { value = JSON.parse(message) } catch { return }
  const parsed = computerResponseMessageSchema.safeParse(value)
  if (!parsed.success) return
  const { userId, response } = parsed.data
  const call = pendingCalls.get(response.id)
  // The API only forwards answers from the session's room, but check the pairing here too.
  if (!call || call.session.userId !== userId || call.session.sessionId !== response.sessionId) return
  call.settle(response)
}

/** One subscriber connection per process, shared by every call. */
function subscribeToAnswers(): Promise<Redis> {
  responseSubscriber ??= (async () => {
    const connection = createRedis()
    connection.on('message', (channel: string, message: string) => {
      if (channel === COMPUTER_RESPONSES_CHANNEL) receiveAnswer(message)
    })
    try {
      await connection.subscribe(COMPUTER_RESPONSES_CHANNEL)
    } catch (error) {
      connection.disconnect()
      throw error
    }
    return connection
  })().catch((error: unknown) => {
    responseSubscriber = undefined
    throw error
  })
  return responseSubscriber
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('The request was cancelled')
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortReason(signal)); return }
    const onAbort = () => { clearTimeout(timer); reject(abortReason(signal!)) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function waitForComputer(session: ComputerSessionRef, signal?: AbortSignal, waitMs = COMPUTER_CONNECT_WAIT_MS): Promise<void> {
  const deadline = Date.now() + waitMs
  while (!await computerConnected(session)) {
    if (signal?.aborted) throw abortReason(signal)
    if (Date.now() >= deadline) throw new ComputerUnavailableError()
    await pause(Math.min(COMPUTER_CONNECT_POLL_MS, Math.max(0, deadline - Date.now())), signal)
  }
}

/**
 * Sends one request to the desktop app that owns the session and returns its validated result.
 * Throws ComputerUnavailableError when no app serves the session or none answers in time, and
 * ComputerRequestError when the app refuses or fails.
 */
export async function computerCall<M extends ComputerMethod>(
  session: ComputerSessionRef,
  method: M,
  params: ComputerParams<M>,
  options: ComputerCallOptions = {},
): Promise<ComputerResult<M>> {
  const definition = computerMethods[method]
  const checked = definition.params.safeParse(params)
  if (!checked.success) {
    throw new ComputerRequestError('invalid_request', `Invalid ${method} request: ${checked.error.issues[0]?.message ?? 'bad parameters'}`)
  }
  const { signal } = options
  if (signal?.aborted) throw abortReason(signal)
  await waitForComputer(session, signal)
  await subscribeToAnswers()
  if (signal?.aborted) throw abortReason(signal)
  const timeoutMs = options.timeoutMs ?? COMPUTER_REQUEST_TIMEOUT_MS
  const request: ComputerRequest = { id: randomUUID(), sessionId: session.sessionId, method, params: checked.data, timeoutMs }
  const response = await new Promise<ComputerResponse>((resolve, reject) => {
    let settled = false
    let misses = 0
    const finish = () => {
      settled = true
      clearTimeout(timer)
      clearInterval(presence)
      pendingCalls.delete(request.id)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => { finish(); reject(abortReason(signal!)) }
    const timer = setTimeout(() => {
      finish()
      reject(new ComputerUnavailableError('The user\'s computer did not answer in time'))
    }, timeoutMs)
    const presence = setInterval(() => {
      void computerConnected(session).then((connected) => {
        if (settled) return
        misses = connected ? 0 : misses + 1
        if (misses < 2) return
        finish()
        reject(new ComputerUnavailableError())
      // A Redis hiccup says nothing about the computer.
      }).catch(() => undefined)
    }, COMPUTER_PRESENCE_CHECK_MS)
    pendingCalls.set(request.id, { session, settle: (answer) => { finish(); resolve(answer) } })
    signal?.addEventListener('abort', onAbort, { once: true })
    publishComputerRequest(session.userId, request).catch((error: unknown) => { finish(); reject(error) })
  })
  if (!response.ok) throw new ComputerRequestError(response.code, response.message)
  const result = definition.result.safeParse(response.result)
  if (!result.success) {
    throw new ComputerRequestError('failed', `The computer sent an invalid ${method} result: ${result.error.issues[0]?.message ?? 'unexpected shape'}`)
  }
  return result.data as ComputerResult<M>
}

/** For tests: calls still waiting for an answer. */
export function pendingComputerCallCount(): number {
  return pendingCalls.size
}

/** A one-time URL the desktop app sends one file's bytes to. */
export interface ComputerUpload {
  transfer: ComputerTransfer
  /** The bytes the desktop app sent. Call after its answer arrived; the caller must consume or destroy the stream. */
  open(): Promise<{ stream: Readable; sizeBytes: number }>
  /** The same bytes in memory; throws when there are more than `maxBytes`. */
  bytes(maxBytes: number): Promise<Uint8Array>
  /** Deletes the stored bytes and retires the URL. Safe to call more than once. */
  dispose(): Promise<void>
}

function disposer(id: string): () => Promise<void> {
  let disposing: Promise<void> | undefined
  return () => {
    disposing ??= disposeComputerTransfer(id).catch((error: unknown) => {
      // A later call may try again; the maintenance sweep is the backstop.
      disposing = undefined
      throw error
    })
    return disposing
  }
}

export async function createComputerUpload(session: ComputerSessionRef, options: { maxBytes: number; /** How long the URL must live, when longer than usual. */ ttlMs?: number }): Promise<ComputerUpload> {
  const { id, url } = await createComputerTransfer(session, 'upload', options.maxBytes, Date.now(), options.ttlMs)
  const storedSize = async () => {
    const record = await readComputerTransfer(id)
    if (record?.sizeBytes == null) throw new ComputerRequestError('failed', 'The computer did not send the file')
    return record.sizeBytes
  }
  return {
    transfer: { url },
    async open() {
      const sizeBytes = await storedSize()
      return { stream: await getBlobStore().getStream(computerTransferObjectKey(id)), sizeBytes }
    },
    async bytes(maxBytes) {
      const sizeBytes = await storedSize()
      if (sizeBytes > maxBytes) throw new ComputerRequestError('too_large', `The file is larger than ${maxBytes} bytes`)
      return getBlobStore().get(computerTransferObjectKey(id))
    },
    dispose: disposer(id),
  }
}

/** A one-time URL the desktop app fetches one file's bytes from. */
export interface ComputerDownload {
  transfer: ComputerTransfer
  /** Deletes the stored bytes and retires the URL. Safe to call more than once. */
  dispose(): Promise<void>
}

export async function createComputerDownload(session: ComputerSessionRef, body: Uint8Array | Readable, sizeBytes: number): Promise<ComputerDownload> {
  const { id, url } = await createComputerTransfer(session, 'download', sizeBytes, Date.now(), computerTransferTimeoutMs(sizeBytes) + 60_000)
  const dispose = disposer(id)
  try {
    const metadata = { contentType: 'application/octet-stream', contentLength: sizeBytes }
    if (body instanceof Uint8Array) {
      if (body.byteLength !== sizeBytes) throw new Error(`Download body has ${body.byteLength} bytes, expected ${sizeBytes}`)
      await getBlobStore().put(computerTransferObjectKey(id), body, metadata)
    } else {
      await getBlobStore().putStream(computerTransferObjectKey(id), exactSizeStream(body, sizeBytes), metadata)
    }
    // The URL serves nothing until the bytes are complete.
    if (!await completeComputerTransfer(id, sizeBytes)) throw new Error('The download expired before its bytes were stored')
  } catch (error) {
    await dispose().catch(() => undefined)
    throw error
  }
  return { transfer: { url }, dispose }
}
