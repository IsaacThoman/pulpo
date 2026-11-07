import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { ConverterConfig } from './config.js'
import { isTargetFormat, supportedConversions, supportsConversion, TARGET_CONTENT_TYPES } from './formats.js'
import { BusyError, JobLimiter } from './limiter.js'
import { ConversionError, type ConversionErrorCode, type ConversionJob } from './soffice.js'

export type Convert = (job: ConversionJob) => Promise<Uint8Array>

type ErrorCode = ConversionErrorCode | 'unauthorized' | 'not_found' | 'method_not_allowed' | 'input_too_large' | 'busy' | 'starting' | 'internal_error'

const STATUS: Record<ErrorCode, number> = {
  unsupported_conversion: 400,
  unauthorized: 401,
  not_found: 404,
  method_not_allowed: 405,
  input_too_large: 413,
  output_too_large: 413,
  unexpected_content: 415,
  encrypted: 422,
  conversion_failed: 422,
  aborted: 499,
  internal_error: 500,
  busy: 503,
  starting: 503,
  timeout: 504,
}

class RequestError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message)
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (response.headersSent || response.destroyed) return
  const payload = JSON.stringify(body)
  // The connection cannot be reused when the request body was left unread.
  const close = response.req.complete ? {} : { connection: 'close' }
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store', ...close, ...headers })
  response.end(payload)
}

function sendError(response: ServerResponse, code: ErrorCode, message: string): void {
  sendJson(response, STATUS[code], { error: { code, message } }, code === 'busy' || code === 'starting' ? { 'retry-after': '5' } : {})
}

function authorized(request: IncomingMessage, token: string | null): boolean {
  if (!token) return true
  const header = request.headers.authorization ?? ''
  const expected = Buffer.from(`Bearer ${token}`)
  const actual = Buffer.from(header)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Reads the body, refusing it as soon as it is longer than allowed. */
function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) return Promise.reject(new RequestError('input_too_large', 'The file is too large to convert'))
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > maxBytes) {
        request.pause()
        reject(new RequestError('input_too_large', 'The file is too large to convert'))
        return
      }
      chunks.push(chunk)
    })
    request.once('end', () => resolve(Buffer.concat(chunks)))
    request.once('error', reject)
  })
}

export interface ConverterServer {
  server: Server
  limiter: JobLimiter
  /** Healthy once LibreOffice is known to start; until then conversions are refused. */
  setReady: (ready: boolean) => void
}

/**
 * The converter's HTTP interface:
 *
 * - `GET /healthz`: 200 once ready, else 503.
 * - `GET /v1/formats`: the supported `{ from, to }` pairs.
 * - `POST /v1/convert?from=<ext>&to=<docx|xlsx|pptx|pdf>`: the document's bytes in, the converted
 *   bytes out. Failures are JSON `{ error: { code, message } }`.
 */
export function createConverterServer(config: Pick<ConverterConfig, 'token' | 'maxInputBytes' | 'concurrency' | 'maxQueued' | 'timeoutMs'>, convert: Convert): ConverterServer {
  const limiter = new JobLimiter(config.concurrency, config.maxQueued)
  let ready = false

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://converter.invalid')
    if (url.pathname === '/healthz') {
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new RequestError('method_not_allowed', 'Use GET')
      return sendJson(response, ready ? 200 : 503, { status: ready ? 'ok' : 'starting', ...limiter.stats })
    }
    if (!authorized(request, config.token)) throw new RequestError('unauthorized', 'Missing or wrong token')
    if (url.pathname === '/v1/formats') return sendJson(response, 200, { conversions: supportedConversions() })
    if (url.pathname !== '/v1/convert') throw new RequestError('not_found', 'Not found')
    if (request.method !== 'POST') throw new RequestError('method_not_allowed', 'Use POST')
    if (!ready) throw new RequestError('starting', 'The converter is starting')
    const from = (url.searchParams.get('from') ?? '').toLowerCase()
    const to = (url.searchParams.get('to') ?? '').toLowerCase()
    if (!isTargetFormat(to) || !supportsConversion(from, to)) {
      throw new RequestError('unsupported_conversion', `Converting .${from.slice(0, 16)} files to .${to.slice(0, 16)} is not supported`)
    }
    const declared = Number(request.headers['content-length'])
    if (Number.isFinite(declared) && declared > config.maxInputBytes) throw new RequestError('input_too_large', 'The file is too large to convert')
    // A client that disconnects cancels its job, queued or running.
    const controller = new AbortController()
    response.once('close', () => { if (!response.writableFinished) controller.abort() })
    // The body is read only once the job has a slot, so queued uploads wait in the socket
    // instead of in memory: at most `concurrency` inputs are held at once.
    const output = await limiter.run(async () => {
      const input = await readBody(request, config.maxInputBytes)
      if (!input.byteLength) throw new RequestError('unexpected_content', 'The file is empty')
      return convert({ input, from, to, signal: controller.signal })
    }, controller.signal)
    if (response.destroyed) return
    response.writeHead(200, { 'content-type': TARGET_CONTENT_TYPES[to], 'content-length': output.byteLength, 'cache-control': 'no-store' })
    response.end(output)
  }

  /**
   * Reads and discards what is left of a refused request's body (at most the input limit), so
   * the client receives the answer instead of a broken pipe. An oversized body is not read.
   */
  const drain = (request: IncomingMessage, code: ErrorCode) => new Promise<void>((resolve) => {
    if (request.complete || request.destroyed || code === 'input_too_large') return resolve()
    // Callers without the token get less: enough for an answer, not a way to make it read 100 MB.
    const limit = code === 'unauthorized' ? Math.min(config.maxInputBytes, 16 * 1024 * 1024) : config.maxInputBytes
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > limit) { request.pause(); resolve() }
    })
    request.once('end', () => resolve())
    request.once('error', () => resolve())
    request.once('close', () => resolve())
    request.resume()
  })

  const fail = async (request: IncomingMessage, response: ServerResponse, error: unknown) => {
    const known = error instanceof RequestError || error instanceof ConversionError
      ? { code: error.code, message: error.message }
      : error instanceof BusyError ? { code: 'busy' as const, message: 'The converter is busy; try again shortly' } : null
    if (!known && !response.destroyed) console.error('office-converter: request failed', error)
    const { code, message } = known ?? { code: 'internal_error' as const, message: 'The conversion failed' }
    await drain(request, code)
    sendError(response, code, message)
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => fail(request, response, error)).finally(() => {
      // An oversized upload is answered before it was read; stop reading once the answer is out.
      if (request.complete) return
      if (response.writableFinished) request.destroy()
      else response.once('finish', () => request.destroy())
    })
  })
  // Long enough for a queued job plus a running one; the job timeout ends conversions themselves.
  server.requestTimeout = config.timeoutMs * 3 + 30_000
  server.headersTimeout = 30_000
  return { server, limiter, setReady: (value) => { ready = value } }
}
