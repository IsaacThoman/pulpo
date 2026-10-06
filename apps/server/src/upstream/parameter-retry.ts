import { upstreamErrorDetails } from '../responses/upstream-request.js'

export const MAX_PARAMETER_RETRIES = 4

const UNSUPPORTED_PHRASING = /unsupported|not supported|unknown (?:parameter|field|argument)|unrecognized|not permitted|extra (?:inputs|fields)|not allowed|does not support|doesn't support|is deprecated|no longer supported|not available for/i

/**
 * The top-level request key a provider's 400 names, when it is one of the
 * optional knobs we may drop. Providers phrase these differently ("Unsupported
 * parameter: 'x'", "`x` is not supported", "x: Extra inputs are not
 * permitted"), so match any optional key the message mentions, earliest first.
 * The message must say the field is unsupported: an invalid schema or an
 * out-of-range value is the caller's error to see, not a reason to drop it.
 */
export function rejectedOptionalParameter(error: unknown, body: Record<string, unknown>, optional: ReadonlySet<string>): string | undefined {
  const details = upstreamErrorDetails(error)
  if (details.status !== 400 && details.status !== 422) return undefined
  if (!UNSUPPORTED_PHRASING.test(details.message)) return undefined
  const present = [...optional].filter((key) => key in body)
  if (details.param) {
    const key = details.param.split(/[.[]/)[0] ?? ''
    if (present.includes(key)) return key
  }
  let best: { key: string; index: number } | undefined
  for (const key of present) {
    const match = new RegExp(`(?<![A-Za-z0-9_])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`).exec(details.message)
    if (match && (!best || match.index < best.index)) best = { key, index: match.index }
  }
  return best?.key
}

export function withoutKey<T extends Record<string, unknown>>(body: T, key: string): T {
  return Object.fromEntries(Object.entries(body).filter(([candidate]) => candidate !== key)) as T
}

export function logParameterRetry(format: string, parameter: string, message: string): void {
  console.info(JSON.stringify({ level: 'info', service: 'pulpo-worker', event: 'upstream.parameter_stripped', format, parameter, message }))
}
