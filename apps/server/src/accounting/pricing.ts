import type { ResponseUsage } from '@pulpo/contracts'

export interface Pricing {
  inputPriceMicros: number
  cachedInputPriceMicros: number
  outputPriceMicros: number
  perRequestPriceMicros: number
}

export function tokenCostMicros(tokens: number, pricePerMillionMicros: number): number {
  return Math.ceil((tokens * pricePerMillionMicros) / 1_000_000)
}

export function calculateCostMicros(usage: ResponseUsage, pricing: Pricing): number {
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens)
  return (
    pricing.perRequestPriceMicros +
    tokenCostMicros(uncachedInput, pricing.inputPriceMicros) +
    tokenCostMicros(usage.cachedInputTokens, pricing.cachedInputPriceMicros) +
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
    tokenCostMicros(estimateInputTokens(input), pricing.inputPriceMicros) +
    tokenCostMicros(maxOutputTokens, pricing.outputPriceMicros)
  )
}
