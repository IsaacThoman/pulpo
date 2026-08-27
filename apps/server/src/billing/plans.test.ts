import { describe, expect, it } from 'vitest'
import {
  chargeCentsForCredits,
  effectivePlan,
  remainingPercentage,
  resolveSubscriptionChange,
  splitReservationMicros,
  utcWeekEnd,
  utcWeekStart,
} from './plans.js'

describe('billing plan calculations', () => {
  it.each([
    [500, 579],
    [1_000, 1_106],
    [2_500, 2_685],
    [5_000, 5_316],
    [10_000, 10_579],
  ])('quotes %d credits as %d before tax', (credits, charge) => {
    expect(chargeCentsForCredits(credits)).toBe(charge)
  })

  it('uses Monday UTC boundaries', () => {
    const sunday = new Date('2026-08-23T23:59:59.999Z')
    expect(utcWeekStart(sunday).toISOString()).toBe('2026-08-17T00:00:00.000Z')
    expect(utcWeekEnd(sunday).toISOString()).toBe('2026-08-24T00:00:00.000Z')
    expect(utcWeekStart(new Date('2026-08-24T00:00:00.000Z')).toISOString()).toBe('2026-08-24T00:00:00.000Z')
  })

  it('reserves weekly allowance before account credit', () => {
    expect(splitReservationMicros(3_000_000, 2_000_000, 1_000_000)).toEqual({ weeklyMicros: 1_000_000, fiveHourMicros: 1_000_000, balanceMicros: 2_000_000 })
    expect(splitReservationMicros(500_000, 2_000_000, 1_000_000)).toEqual({ weeklyMicros: 500_000, fiveHourMicros: 500_000, balanceMicros: 0 })
  })

  it('returns a private remaining percentage and hides zero limits', () => {
    expect(remainingPercentage(3_000_000, 0)).toBe(100)
    expect(remainingPercentage(3_000_000, 1_500_000)).toBe(50)
    expect(remainingPercentage(3_000_000, 4_000_000)).toBe(0)
    expect(remainingPercentage(0, 0)).toBeNull()
  })

  it('includes pending reservations in the private remaining percentage', () => {
    const settledMicros = 500_000
    const pendingMicros = 1_000_000
    expect(remainingPercentage(3_000_000, settledMicros + pendingMicros)).toBe(50)
  })

  it('chooses the highest currently paid plan', () => {
    const future = new Date('2026-09-01T00:00:00Z')
    const now = new Date('2026-08-17T00:00:00Z')
    expect(effectivePlan([{ plan: 'eight', status: 'past_due', paidThrough: future }], now)).toBe('eight')
    expect(effectivePlan([
      { plan: 'eight', status: 'active', paidThrough: future },
      { plan: 'fat', status: 'active', paidThrough: future },
    ], now)).toBe('fat')
    expect(effectivePlan([{ plan: 'fat', status: 'revoked', paidThrough: future }], now)).toBe('baby')
    expect(effectivePlan([{ plan: 'fat', status: 'past_due', paidThrough: now }], now)).toBe('baby')
  })

  it('resolves mid-cycle plan changes', () => {
    expect(resolveSubscriptionChange(null, 'fat')).toBe('missing')
    expect(resolveSubscriptionChange({ plan: 'eight', cancelAtPeriodEnd: false }, 'eight')).toBe('noop')
    expect(resolveSubscriptionChange({ plan: 'eight', cancelAtPeriodEnd: true }, 'eight')).toBe('renew')
    expect(resolveSubscriptionChange({ plan: 'eight', cancelAtPeriodEnd: true }, 'baby')).toBe('noop')
    expect(resolveSubscriptionChange({ plan: 'eight', cancelAtPeriodEnd: false }, 'baby')).toBe('cancel')
    expect(resolveSubscriptionChange({ plan: 'eight', cancelAtPeriodEnd: false }, 'fat')).toBe('upgrade_fat')
    expect(resolveSubscriptionChange({ plan: 'fat', cancelAtPeriodEnd: false }, 'eight')).toBe('downgrade_eight')
    expect(resolveSubscriptionChange({ plan: 'fat', cancelAtPeriodEnd: true }, 'eight')).toBe('downgrade_eight')
  })
})
