import { describe, expect, it } from 'vitest'
import { DEFAULT_USAGE_TIERS, parseBillingSettings, usageTiersSchema } from '../settings/application-settings.js'
import { resolveUsageTier } from './usage-tiers.js'

const now = new Date('2026-10-13T12:00:00Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1_000)
const resolve = (paidCents: number, firstPaidAt: Date | null) => resolveUsageTier({ tiers: DEFAULT_USAGE_TIERS, paidCents, firstPaidAt, now })

describe('usage tiers', () => {
  it('starts everyone without payments on tier 0', () => {
    expect(resolve(0, null)).toEqual({
      tier: 0,
      next: { tier: 1, dailyLimitMicros: 10_000_000, remainingPaidCents: 500, minDaysSinceFirstPayment: 0, availableAt: null },
    })
  })

  it('moves to tier 1 on the first payment', () => {
    expect(resolve(800, now).tier).toBe(1)
  })

  it('requires both the paid amount and the waiting period', () => {
    expect(resolve(5_000, daysAgo(6)).tier).toBe(1)
    expect(resolve(4_999, daysAgo(60)).tier).toBe(1)
    expect(resolve(5_000, daysAgo(7)).tier).toBe(2)
    expect(resolve(50_000, daysAgo(20)).tier).toBe(3)
    expect(resolve(50_000, daysAgo(30)).tier).toBe(4)
  })

  it('reports what the next tier still needs', () => {
    expect(resolve(6_000, daysAgo(10)).next).toEqual({
      tier: 3, dailyLimitMicros: 75_000_000, remainingPaidCents: 9_000, minDaysSinceFirstPayment: 14, availableAt: daysAgo(-4),
    })
    expect(resolve(100_000, daysAgo(90)).next).toBeNull()
  })

  it('keeps other billing settings when stored tiers are invalid', () => {
    const settings = parseBillingSettings({ eightWeeklyLimitMicros: 1, usageTiers: [{ minPaidCents: 100, minDaysSinceFirstPayment: 0, dailyLimitMicros: 1 }] })
    expect(settings.eightWeeklyLimitMicros).toBe(1)
    expect(settings.usageTiers).toEqual(DEFAULT_USAGE_TIERS)
    expect(parseBillingSettings({}).usageTiers).toEqual(DEFAULT_USAGE_TIERS)
  })

  it('rejects tiers whose requirements decrease', () => {
    expect(usageTiersSchema.safeParse(DEFAULT_USAGE_TIERS).success).toBe(true)
    expect(usageTiersSchema.safeParse([DEFAULT_USAGE_TIERS[0], DEFAULT_USAGE_TIERS[2], DEFAULT_USAGE_TIERS[1]]).success).toBe(false)
  })
})
