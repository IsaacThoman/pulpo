import { createHash } from 'node:crypto'
import type { PublicApiProtocol } from './codecs.js'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  return Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .reduce<Record<string, unknown>>((output, [key, item]) => {
      output[key] = canonical(item)
      return output
    }, {})
}

export function publicRequestFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('base64url')
}

export function publicIdempotencyScope(keyId: string, protocol: PublicApiProtocol): string {
  return `api:${keyId}:${protocol}`
}
