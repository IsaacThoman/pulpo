import { DEFAULT_MINIMUM_OUTPUT_RESERVATION_TOKENS, type ResponseUsage } from '@pulpo/contracts'

export interface Pricing {
  inputPriceMicros: number
  cachedInputPriceMicros: number
  cacheWritePriceMicros: number
  outputPriceMicros: number
  perRequestPriceMicros: number
}

export function tokenCostMicros(tokens: number, pricePerMillionMicros: number): number {
  return Math.ceil((tokens * pricePerMillionMicros) / 1_000_000)
}

export function calculateCostMicros(usage: ResponseUsage, pricing: Pricing): number {
  const cachedInput = Math.min(usage.inputTokens, usage.cachedInputTokens)
  const cacheWrite = Math.min(usage.inputTokens - cachedInput, usage.cacheWriteTokens)
  const uncachedInput = Math.max(0, usage.inputTokens - cachedInput - cacheWrite)
  return (
    pricing.perRequestPriceMicros +
    tokenCostMicros(uncachedInput, pricing.inputPriceMicros) +
    tokenCostMicros(cachedInput, pricing.cachedInputPriceMicros) +
    tokenCostMicros(cacheWrite, pricing.cacheWritePriceMicros) +
    tokenCostMicros(usage.outputTokens, pricing.outputPriceMicros)
  )
}

/**
 * What one inline image can cost in input tokens. Providers bill images by their pixels, not their
 * base64 size: high-resolution modes top out near 10k tokens, while a 7 MB photo is 2.4M base64
 * characters. Counting those characters as text reserved dollars for a cent's worth of input.
 */
export const IMAGE_RESERVATION_TOKENS = 10_000

const IMAGE_DATA_URL = /^data:image\/[^;,]*;base64,/i
const IMAGE_MIME_KEYS = ['mimeType', 'media_type', 'mime_type'] as const

/** An image block carrying its own base64 `data`, in the pi-ai, Anthropic, or Gemini shape. */
function isInlineImageBlock(value: unknown): value is Record<string, unknown> & { data: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.data === 'string'
    && IMAGE_MIME_KEYS.some((key) => typeof record[key] === 'string' && (record[key] as string).toLowerCase().startsWith('image/'))
}

export function estimateInputTokens(input: unknown): number {
  let imageTokens = 0
  const countImage = (encoded: string) => {
    imageTokens += Math.min(IMAGE_RESERVATION_TOKENS, Math.ceil(encoded.length / 4))
    return ''
  }
  const json = JSON.stringify(input, (_key, value: unknown) => {
    if (typeof value === 'string') return IMAGE_DATA_URL.test(value) ? countImage(value) : value
    if (isInlineImageBlock(value)) return { ...value, data: countImage(value.data) }
    return value
  }) ?? ''
  return Math.max(1, Math.ceil(json.length / 4) + imageTokens)
}

export function calculateReservationMicros(
  input: unknown,
  maxOutputTokens: number,
  pricing: Pricing,
): number {
  return (
    pricing.perRequestPriceMicros +
    tokenCostMicros(estimateInputTokens(input), Math.max(pricing.inputPriceMicros, pricing.cacheWritePriceMicros)) +
    tokenCostMicros(maxOutputTokens, pricing.outputPriceMicros)
  )
}

export function calculateRollingReservationMicros(
  accruedCostMicros: number,
  input: unknown,
  maxOutputTokens: number,
  pricing: Pricing,
): number {
  return accruedCostMicros + calculateReservationMicros(input, maxOutputTokens, pricing)
}

/** Find the largest fully funded output limit, using the same rounding as billing. */
export function budgetOutputReservation(input: {
  requestInput: unknown
  maxOutputTokens: number
  minimumOutputReservationTokens?: number
  pricing: Pricing
  capacityMicros: number
  accruedCostMicros?: number
}): { amountMicros: number; maxOutputTokens: number } | null {
  const { maxOutputTokens, pricing } = input
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) throw new Error('Invalid output token limit')
  const fixedCostMicros = calculateRollingReservationMicros(input.accruedCostMicros ?? 0, input.requestInput, 0, pricing)
  const cost = (tokens: number) => fixedCostMicros + tokenCostMicros(tokens, pricing.outputPriceMicros)
  const minimum = input.minimumOutputReservationTokens ?? DEFAULT_MINIMUM_OUTPUT_RESERVATION_TOKENS
  if (!Number.isSafeInteger(minimum) || minimum < 1 || minimum > 2_147_483_647) throw new Error('Invalid minimum output reservation')
  let low = Math.min(minimum, maxOutputTokens)
  if (cost(low) > input.capacityMicros) return null
  let high = maxOutputTokens
  while (low < high) {
    const mid = low + Math.ceil((high - low) / 2)
    if (cost(mid) <= input.capacityMicros) low = mid
    else high = mid - 1
  }
  return { amountMicros: cost(low), maxOutputTokens: low }
}

export function availableReservationCapacityMicros(
  balanceMicros: number,
  totalPendingMicros: number,
  currentReservationMicros: number,
): number {
  return balanceMicros - Math.max(0, totalPendingMicros - currentReservationMicros)
}

export function workspaceHoldMicros(timeoutSeconds: number, pricePerMinuteMicros: number): number {
  if (pricePerMinuteMicros <= 0 || timeoutSeconds <= 0) return 0
  return Math.ceil(timeoutSeconds / 60) * pricePerMinuteMicros
}

export function workspaceBillableMinutes(readyDurationMs: number): number {
  return readyDurationMs > 0 ? Math.ceil(readyDurationMs / 60_000) : 0
}

export function workspaceUsageMicros(readyDurationMs: number, pricePerMinuteMicros: number): number {
  if (pricePerMinuteMicros <= 0 || readyDurationMs <= 0) return 0
  return workspaceBillableMinutes(readyDurationMs) * pricePerMinuteMicros
}
