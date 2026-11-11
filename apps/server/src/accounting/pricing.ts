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
const GEMINI_INLINE_DATA_KEYS = new Set(['inline_data', 'inlineData'])

type JsonRecord = Record<string, unknown>
const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value)
const isImageMime = (value: unknown) => typeof value === 'string' && value.toLowerCase().startsWith('image/')
const isImageDataUrl = (value: unknown): value is string => typeof value === 'string' && IMAGE_DATA_URL.test(value)

/**
 * The image an object carries as base64, and the object with that data removed. Only provider image
 * fields count: text that merely looks like a data URL is billed as text, so it is estimated as text.
 */
function inlineImage(key: string, value: JsonRecord): { encoded: string; rest: JsonRecord } | undefined {
  // pi-ai: { type: 'image', data, mimeType }
  if (value.type === 'image' && typeof value.data === 'string' && isImageMime(value.mimeType)) return { encoded: value.data, rest: { ...value, data: '' } }
  // Anthropic: { type: 'image', source: { type: 'base64', media_type, data } }
  if (value.type === 'base64' && key === 'source' && typeof value.data === 'string' && isImageMime(value.media_type)) return { encoded: value.data, rest: { ...value, data: '' } }
  // Gemini: { inline_data: { mime_type, data } } or { inlineData: { mimeType, data } }
  if (GEMINI_INLINE_DATA_KEYS.has(key) && typeof value.data === 'string' && isImageMime(value.mime_type ?? value.mimeType)) return { encoded: value.data, rest: { ...value, data: '' } }
  // Responses: { type: 'input_image', image_url: 'data:image/...' }
  if (value.type === 'input_image' && isImageDataUrl(value.image_url)) return { encoded: value.image_url, rest: { ...value, image_url: '' } }
  // Chat Completions: { type: 'image_url', image_url: { url: 'data:image/...' } }
  if (value.type === 'image_url' && isRecord(value.image_url) && isImageDataUrl(value.image_url.url)) {
    return { encoded: value.image_url.url, rest: { ...value, image_url: { ...value.image_url, url: '' } } }
  }
  return undefined
}

export function estimateInputTokens(input: unknown): number {
  let imageTokens = 0
  const json = JSON.stringify(input, (key, value: unknown) => {
    const image = isRecord(value) ? inlineImage(key, value) : undefined
    if (!image) return value
    imageTokens += Math.min(IMAGE_RESERVATION_TOKENS, Math.ceil(image.encoded.length / 4))
    return image.rest
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
