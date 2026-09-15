import { describe, expect, it } from 'vitest'
import { AUTO_TOP_UP_DEFAULTS, autoTopUpInputSchema, belowTopUpThreshold, topUpFits, utcMonth } from './auto-top-up-policy.js'

describe('automatic top-up policy', () => {
  it('is opt-in and validates amounts, fee coverage, and monetary precision', () => {
    expect(AUTO_TOP_UP_DEFAULTS.enabled).toBe(false)
    const input = { ...AUTO_TOP_UP_DEFAULTS, revision: 0 }
    expect(autoTopUpInputSchema.safeParse(input).success).toBe(true)
    for (const patch of [{ thresholdCents: 0 }, { thresholdCents: 2501 }, { creditCents: 499 }, { creditCents: 50001 }, { creditCents: 500.5 }, { monthlyLimitCents: 2500 }, { monthlyLimitCents: 2147483648 }]) {
      expect(autoTopUpInputSchema.safeParse({ ...input, ...patch }).success).toBe(false)
    }
  })
  it('triggers strictly below personal available balance, including reservations', () => {
    expect(belowTopUpThreshold(5_000_000, 0, 500)).toBe(false)
    expect(belowTopUpThreshold(5_000_000, 1, 500)).toBe(true)
    expect(belowTopUpThreshold(0, 0, 500)).toBe(true)
  })
  it('includes all pending charges, fees, and tax in the hard cap', () => {
    expect(topUpFits(10000, 7000, 1000, 2000)).toBe(true)
    expect(topUpFits(10000, 7000, 1000, 2001)).toBe(false)
    expect(topUpFits(10000, 10000, 0, 579)).toBe(false)
  })
  it('uses UTC calendar months across year boundaries and leap years', () => {
    expect(utcMonth(new Date('2026-12-31T23:59:59Z')).end.toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(utcMonth(new Date('2028-02-29T23:59:59Z')).end.toISOString()).toBe('2028-03-01T00:00:00.000Z')
    expect(utcMonth(new Date('2026-10-01T00:00:00Z')).start.toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })
})
