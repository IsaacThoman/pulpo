import type { OfficeEditableFormat } from '@pulpo/contracts'
import { getConfig } from '../../config.js'
import { AppError } from '../../lib/errors.js'

export type OfficeTarget = OfficeEditableFormat | 'pdf'

/** The converter's own limit (OFFICE_CONVERTER_MAX_INPUT_MB); larger files are refused before upload. */
export const OFFICE_CONVERTER_MAX_INPUT_BYTES = 100 * 1024 * 1024

/** Whether this server can convert office files: it needs the converter service. */
export function officeConversionAvailable(): boolean {
  return Boolean(getConfig().OFFICE_CONVERTER_URL)
}

const FAILURES: Record<string, { status: number; code: string; message: string }> = {
  unsupported_conversion: { status: 400, code: 'office_conversion_unsupported', message: 'This file cannot be converted to that format' },
  unexpected_content: { status: 415, code: 'office_file_unreadable', message: "This file isn't the kind of document its name says, so it can't be converted" },
  encrypted: { status: 422, code: 'office_file_encrypted', message: 'This file is password-protected. Remove the password and upload it again to convert it' },
  conversion_failed: { status: 422, code: 'office_conversion_failed', message: "This file couldn't be converted. It may be damaged" },
  input_too_large: { status: 413, code: 'office_file_too_large', message: 'This file is too large to convert' },
  output_too_large: { status: 413, code: 'office_file_too_large', message: 'The converted file would be too large' },
  timeout: { status: 504, code: 'office_conversion_timeout', message: 'Converting this file took too long' },
  busy: { status: 503, code: 'office_converter_busy', message: 'The converter is busy. Try again in a moment' },
  starting: { status: 503, code: 'office_converter_busy', message: 'The converter is starting. Try again in a moment' },
}

/** Misconfiguration (wrong URL or token) and outages look the same to users; operators need the cause. */
function unavailable(cause: unknown): AppError {
  console.error(JSON.stringify({ level: 'error', event: 'files.office_converter_unavailable', cause: cause instanceof Error ? cause.message : String(cause) }))
  return new AppError(502, 'office_converter_unavailable', "The converter isn't available right now. Try again later", 'server_error')
}

/**
 * Converts one document with the office converter service. Its failures become AppErrors with
 * `office_*` codes clients show as they are; anything unexpected reads as "unavailable".
 */
export async function convertOfficeDocument(input: { bytes: Uint8Array; from: string; to: OfficeTarget; signal?: AbortSignal }): Promise<Uint8Array> {
  const config = getConfig()
  if (!config.OFFICE_CONVERTER_URL) throw new AppError(404, 'office_conversion_unavailable', 'Converting office files is not available on this server')
  if (input.bytes.byteLength > OFFICE_CONVERTER_MAX_INPUT_BYTES) throw new AppError(413, FAILURES.input_too_large!.code, FAILURES.input_too_large!.message)
  const url = new URL('/v1/convert', config.OFFICE_CONVERTER_URL)
  url.searchParams.set('from', input.from)
  url.searchParams.set('to', input.to)
  const timeout = AbortSignal.timeout(config.OFFICE_CONVERTER_TIMEOUT_SECONDS * 1000)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      // A copy in a plain ArrayBuffer, which is what fetch accepts as a body.
      body: new Uint8Array(input.bytes),
      headers: {
        'content-type': 'application/octet-stream',
        ...config.OFFICE_CONVERTER_TOKEN ? { authorization: `Bearer ${config.OFFICE_CONVERTER_TOKEN}` } : {},
      },
      signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
    })
    if (response.ok) return new Uint8Array(await response.arrayBuffer())
    const body = await response.json().catch((cause: unknown) => {
      // Keep aborts distinct from an unreadable error body.
      if (timeout.aborted || input.signal?.aborted) throw cause
      return null
    }) as { error?: { code?: unknown } } | null
    const failure = typeof body?.error?.code === 'string' && Object.hasOwn(FAILURES, body.error.code) ? FAILURES[body.error.code]! : null
    if (!failure) throw unavailable(`HTTP ${response.status}${typeof body?.error?.code === 'string' ? ` ${body.error.code}` : ''}`)
    throw new AppError(failure.status, failure.code, failure.message, failure.status >= 500 ? 'server_error' : 'invalid_request_error')
  } catch (cause) {
    if (timeout.aborted) throw new AppError(504, FAILURES.timeout!.code, FAILURES.timeout!.message, 'server_error')
    if (input.signal?.aborted || cause instanceof AppError) throw cause
    throw unavailable(cause)
  }
}

/**
 * Conversions run inline in the request: they take seconds, the user is waiting for the result,
 * and the converter service already bounds and queues work across the instance (answering
 * "busy" when full). This cap keeps one account (its previews, exports, conversions, and its
 * agents' conversions) from taking the whole converter, which runs three at a time by default.
 */
const MAX_CONVERSIONS_PER_ACCOUNT = 2
const running = new Map<string, number>()

export async function withConversionSlot<T>(userId: string, run: () => Promise<T>): Promise<T> {
  const count = running.get(userId) ?? 0
  if (count >= MAX_CONVERSIONS_PER_ACCOUNT) {
    throw new AppError(429, 'office_conversion_rate_limited', 'Wait for your other conversions to finish, then try again')
  }
  running.set(userId, count + 1)
  try {
    return await run()
  } finally {
    const left = (running.get(userId) ?? 1) - 1
    if (left > 0) running.set(userId, left)
    else running.delete(userId)
  }
}
