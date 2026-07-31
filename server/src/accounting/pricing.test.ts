import { describe, expect, it } from 'vitest'
import { calculateCostMicros, calculateReservationMicros } from './pricing.js'

const pricing = {
  inputPriceMicros: 2_500_000,
  cachedInputPriceMicros: 1_250_000,
  outputPriceMicros: 10_000_000,
  perRequestPriceMicros: 100,
}

describe('pricing', () => {
  it('separates cached and uncached input', () => {
    expect(calculateCostMicros({
      inputTokens: 1_000,
      cachedInputTokens: 400,
      outputTokens: 200,
      reasoningTokens: 50,
      totalTokens: 1_200,
    }, pricing)).toBe(4_100)
  })

  it('reserves the configured maximum output cost', () => {
    expect(calculateReservationMicros('hello', 1_000, pricing)).toBeGreaterThanOrEqual(10_000)
  })
})
