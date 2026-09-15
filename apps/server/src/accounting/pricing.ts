import type { ResponseUsage } from '@pulpo/contracts'

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

export function estimateInputTokens(input: unknown): number {
  return Math.max(1, Math.ceil(JSON.stringify(input).length / 4))
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

export const MINIMUM_OUTPUT_RESERVATION_TOKENS = 8_000

/** Find the largest fully funded output limit, using the same rounding as billing. */
export function budgetOutputReservation(input: {
  requestInput: unknown
  maxOutputTokens: number
  pricing: Pricing
  capacityMicros: number
  accruedCostMicros?: number
}): { amountMicros: number; maxOutputTokens: number } | null {
  const { maxOutputTokens, pricing } = input
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) throw new Error('Invalid output token limit')
  const fixedCostMicros = calculateRollingReservationMicros(input.accruedCostMicros ?? 0, input.requestInput, 0, pricing)
  const cost = (tokens: number) => fixedCostMicros + tokenCostMicros(tokens, pricing.outputPriceMicros)
  let low = Math.min(MINIMUM_OUTPUT_RESERVATION_TOKENS, maxOutputTokens)
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

export function workspaceUsageMicros(readyDurationMs: number, pricePerMinuteMicros: number): number {
  if (pricePerMinuteMicros <= 0 || readyDurationMs <= 0) return 0
  return Math.ceil(readyDurationMs / 60_000) * pricePerMinuteMicros
}
