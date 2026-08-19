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
