import { describe, expect, it } from 'vitest'
import {
  availableReservationCapacityMicros,
  calculateCostMicros,
  calculateReservationMicros,
  calculateRollingReservationMicros,
  workspaceHoldMicros,
  workspaceUsageMicros,
} from './pricing.js'

const pricing = {
  inputPriceMicros: 2_500_000,
  cachedInputPriceMicros: 1_250_000,
  cacheWritePriceMicros: 3_125_000,
  outputPriceMicros: 10_000_000,
  perRequestPriceMicros: 100,
}

describe('pricing', () => {
  it('separates cache reads, cache writes, and uncached input', () => {
    expect(calculateCostMicros({
      inputTokens: 1_000,
      cachedInputTokens: 400,
      cacheWriteTokens: 200,
      outputTokens: 200,
      reasoningTokens: 50,
      totalTokens: 1_200,
    }, pricing)).toBe(4_225)
  })

  it('does not bill overlapping cache categories twice', () => {
    expect(calculateCostMicros({
      inputTokens: 100,
      cachedInputTokens: 80,
      cacheWriteTokens: 50,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 100,
    }, { ...pricing, perRequestPriceMicros: 0 })).toBe(163)
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

  it('reserves whole workspace minutes for the response timeout', () => {
    expect(workspaceHoldMicros(1_800, 10_000)).toBe(300_000)
    expect(workspaceHoldMicros(61, 10_000)).toBe(20_000)
    expect(workspaceHoldMicros(0, 10_000)).toBe(0)
  })

  it('settles workspace time in whole billed minutes after ready', () => {
    expect(workspaceUsageMicros(1, 10_000)).toBe(10_000)
    expect(workspaceUsageMicros(60_000, 10_000)).toBe(10_000)
    expect(workspaceUsageMicros(60_001, 10_000)).toBe(20_000)
    expect(workspaceUsageMicros(0, 10_000)).toBe(0)
  })

  it('releases unsuccessful fixed-cost allowances on the next resize', () => {
    const reservationIncludingUnbilledTool = 30_000
    const accruedBilledCost = 2_000
    const resized = calculateRollingReservationMicros(accruedBilledCost, 'next turn', 1_000, pricing)

    expect(resized).toBe(accruedBilledCost + calculateReservationMicros('next turn', 1_000, pricing))
    expect(resized).toBeLessThan(reservationIncludingUnbilledTool + calculateReservationMicros('next turn', 1_000, pricing))
  })
})
