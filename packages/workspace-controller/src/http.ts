import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

/** A malformed request from the caller: answered with 400 so the server does not retry it as an outage. */
export class ClientRequestError extends Error {}

export function parseJsonBody<T extends object>(raw: Buffer): T {
  let value: unknown
  try { value = JSON.parse(raw.toString('utf8') || '{}') } catch { throw new ClientRequestError('Request body must be valid JSON') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ClientRequestError('Request body must be a JSON object')
  return value as T
}

export function decodePathSegment(value: string): string {
  try { return decodeURIComponent(value) } catch { throw new ClientRequestError('Request path is not validly encoded') }
}

/** Compares in constant time; hashing first keeps the comparison independent of the presented length. */
export function bearerTokenMatches(authorization: string | undefined, token: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(authorization ?? ''), digest(`Bearer ${token}`))
}

/** The HTTP status of a failed Kubernetes API call, when it has one. */
export function kubernetesStatusCode(error: unknown): number | undefined {
  const { statusCode, code } = (error ?? {}) as { statusCode?: unknown; code?: unknown }
  const status = statusCode ?? code
  return typeof status === 'number' ? status : undefined
}

/** Headers forwarded from the server to a workspace daemon; everything else stays at the controller. */
export function daemonRequestHeaders(headers: IncomingHttpHeaders, daemonToken: string): Record<string, string> {
  const forwarded: Record<string, string> = {
    authorization: `Bearer ${daemonToken}`,
    'content-type': headers['content-type'] ?? 'application/json',
  }
  for (const name of ['x-pulpo-file-checksum', 'if-none-match', 'content-length'] as const) {
    const value = headers[name]
    if (value) forwarded[name] = String(value)
  }
  return forwarded
}
