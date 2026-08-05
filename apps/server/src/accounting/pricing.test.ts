import { describe, expect, it } from 'vitest'
import {
  availableReservationCapacityMicros,
  calculateCostMicros,
  calculateReservationMicros,
  calculateRollingReservationMicros,
} from './pricing.js'

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

  it('retains accrued actual cost plus only the next turn maximum', () => {
    const nextTurnMaximum = calculateReservationMicros(['current context'], 1_000, pricing)

    expect(calculateRollingReservationMicros(4_100, ['current context'], 1_000, pricing)).toBe(4_100 + nextTurnMaximum)
  })

  it('replaces unused prior allowance instead of accumulating it', () => {
    const priorReservation = 50_000
    const accruedActualCost = 4_100
    const nextTurnMaximum = calculateReservationMicros('next turn', 1_000, pricing)
    const resized = calculateRollingReservationMicros(accruedActualCost, 'next turn', 1_000, pricing)

    expect(resized).toBe(accruedActualCost + nextTurnMaximum)
    expect(resized).toBeLessThan(priorReservation + nextTurnMaximum)
  })

  it('makes the current reservation replaceable while preserving other pending reservations', () => {
    expect(availableReservationCapacityMicros(50_000, 30_000, 20_000)).toBe(40_000)
    expect(availableReservationCapacityMicros(50_000, 30_000, 0)).toBe(20_000)
  })

  it('releases unsuccessful fixed-cost allowances on the next resize', () => {
    const reservationIncludingUnbilledTool = 30_000
    const accruedBilledCost = 2_000
    const resized = calculateRollingReservationMicros(accruedBilledCost, 'next turn', 1_000, pricing)

    expect(resized).toBe(accruedBilledCost + calculateReservationMicros('next turn', 1_000, pricing))
    expect(resized).toBeLessThan(reservationIncludingUnbilledTool + calculateReservationMicros('next turn', 1_000, pricing))
  })
})
