import { createHmac } from 'node:crypto'
import { safeEqual } from '../lib/crypto.js'

/**
 * Media elements fetch their source themselves, without the app's bearer header, and keep issuing
 * range requests while someone listens. Stream URLs therefore carry a signed capability for one
 * file's current bytes that lasts long enough to finish a long recording. Binding the stored object
 * rather than the node revision keeps playback going through a rename while ending it when the
 * content is replaced.
 */
export const MEDIA_STREAM_TTL_SECONDS = 6 * 60 * 60

export interface MediaStreamClaims {
  nodeId: string
  userId: string
  objectKey: string
  /** Unix time in seconds. */
  expiresAt: number
}

function sign(payload: string, secret: string): string {
  const key = createHmac('sha256', secret).update('pulpo:file-media-stream:v1').digest()
  return createHmac('sha256', key).update(payload).digest('base64url')
}

export function createMediaStreamToken(claims: MediaStreamClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify([claims.nodeId, claims.userId, claims.objectKey, claims.expiresAt])).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

export function verifyMediaStreamToken(token: string, secret: string, now = Date.now()): MediaStreamClaims | null {
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined || !safeEqual(signature, sign(payload, secret))) return null
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!Array.isArray(decoded) || decoded.length !== 4) return null
    const [nodeId, userId, objectKey, expiresAt] = decoded as unknown[]
    if (typeof nodeId !== 'string' || typeof userId !== 'string' || typeof objectKey !== 'string') return null
    if (typeof expiresAt !== 'number' || !Number.isInteger(expiresAt) || expiresAt * 1000 <= now) return null
    return { nodeId, userId, objectKey, expiresAt }
  } catch {
    return null
  }
}

export interface ByteRange {
  start: number
  /** Inclusive. */
  end: number
}

/**
 * The single byte range a `Range` header asks for. Returns null to serve the whole file (no header,
 * a syntax this route ignores, or several ranges) and 'unsatisfiable' when the range lies past the end.
 */
export function parseByteRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/i)
  if (!match) return null
  const [, first = '', last = ''] = match
  if (!first && !last) return null
  if (!first) {
    const suffix = Number(last)
    if (suffix === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(first)
  if (last && Number(last) < start) return null
  if (start >= size) return 'unsatisfiable'
  return { start, end: last ? Math.min(Number(last), size - 1) : size - 1 }
}
