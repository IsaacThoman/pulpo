import { describe, expect, it } from 'vitest'
import {
  autoTopUpDecision,
  autoTopUpState,
  chargeCentsForCredits,
  effectivePlan,
  remainingPercentage,
  resolvePlanEntitlement,
  resolveSubscriptionChange,
  splitReservationMicros,
  subscriptionPaidPlan,
  subscriptionPendingPlan,
  utcMonthEnd,
  utcMonthStart,
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

  it.each(['baby', 'eight', 'fat'] as const)('uses an explicit %s plan override without changing the subscribed plan', (planOverride) => {
    const future = new Date('2026-09-01T00:00:00Z')
    const result = resolvePlanEntitlement(
      [{ plan: 'eight', status: 'active', paidThrough: future }],
      planOverride,
      new Date('2026-08-17T00:00:00Z'),
    )
    expect(result).toEqual({ subscriptionPlan: 'eight', plan: planOverride, planOverridden: true })
  })

  it('returns to the subscribed plan when the override is reset or invalid', () => {
    const future = new Date('2026-09-01T00:00:00Z')
    const subscriptions = [{ plan: 'fat', status: 'active', paidThrough: future }]
    const now = new Date('2026-08-17T00:00:00Z')
    expect(resolvePlanEntitlement(subscriptions, null, now)).toEqual({
      subscriptionPlan: 'fat', plan: 'fat', planOverridden: false,
    })
    expect(resolvePlanEntitlement(subscriptions, 'enterprise', now)).toEqual({
      subscriptionPlan: 'fat', plan: 'fat', planOverridden: false,
    })
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

  it('restores an already paid Fat period for free instead of charging another upgrade', () => {
    expect(resolveSubscriptionChange({ plan: 'eight', paidPlan: 'fat', cancelAtPeriodEnd: false }, 'fat')).toBe('restore_fat')
    expect(resolveSubscriptionChange({ plan: 'eight', paidPlan: 'fat', cancelAtPeriodEnd: true }, 'fat')).toBe('restore_fat')
    expect(resolveSubscriptionChange({ plan: 'eight', paidPlan: 'eight', cancelAtPeriodEnd: false }, 'fat')).toBe('upgrade_fat')
    expect(resolveSubscriptionChange({ plan: 'eight', paidPlan: null, cancelAtPeriodEnd: false }, 'fat')).toBe('upgrade_fat')
    expect(resolveSubscriptionChange({ plan: 'eight', paidPlan: 'fat', cancelAtPeriodEnd: false }, 'eight')).toBe('noop')
  })

  it('keeps the paid plan in effect until the period ends after a downgrade', () => {
    const future = new Date('2026-09-01T00:00:00Z')
    const now = new Date('2026-08-17T00:00:00Z')
    const downgraded = { plan: 'eight', paidPlan: 'fat', status: 'active', paidThrough: future }
    expect(effectivePlan([downgraded], now)).toBe('fat')
    expect(effectivePlan([downgraded], new Date('2026-09-02T00:00:00Z'))).toBe('baby')
    expect(effectivePlan([{ ...downgraded, paidPlan: null }], now)).toBe('eight')
    expect(effectivePlan([{ plan: 'fat', paidPlan: 'eight', status: 'active', paidThrough: future }], now)).toBe('eight')
    expect(subscriptionPaidPlan(downgraded)).toBe('fat')
    expect(subscriptionPendingPlan(downgraded)).toBe('eight')
    expect(subscriptionPendingPlan({ plan: 'fat', paidPlan: 'fat' })).toBeNull()
    expect(subscriptionPendingPlan({ plan: 'fat', paidPlan: null })).toBeNull()
    expect(resolvePlanEntitlement([downgraded], null, now)).toEqual({
      subscriptionPlan: 'fat', plan: 'fat', planOverridden: false,
    })
  })
})

describe('automatic top-ups', () => {
  const base = {
    enabled: true,
    hasPaymentMethod: true,
    onHold: false,
    availableMicros: 4_990_000,
    thresholdCents: 500,
    amountCents: 2_500,
    monthlyLimitCents: 10_000,
    monthSpentCents: 0,
  }

  it('charges only below the threshold', () => {
    expect(autoTopUpDecision(base)).toBe('charge')
    expect(autoTopUpDecision({ ...base, availableMicros: 5_000_000 })).toBe('above_threshold')
    expect(autoTopUpDecision({ ...base, availableMicros: -1 })).toBe('charge')
  })

  it('never charges past the monthly limit on pre-tax charges', () => {
    // $25 of credit is charged as $26.85 before tax.
    expect(autoTopUpDecision({ ...base, monthSpentCents: 10_000 - 2_685 })).toBe('charge')
    expect(autoTopUpDecision({ ...base, monthSpentCents: 10_000 - 2_684 })).toBe('limit_reached')
    expect(autoTopUpDecision({ ...base, monthlyLimitCents: 2_684 })).toBe('limit_reached')
  })

  it('does nothing when disabled, unconfigured, on hold, or without a card', () => {
    expect(autoTopUpDecision({ ...base, enabled: false })).toBe('inactive')
    expect(autoTopUpDecision({ ...base, hasPaymentMethod: false })).toBe('inactive')
    expect(autoTopUpDecision({ ...base, onHold: true })).toBe('inactive')
    expect(autoTopUpDecision({ ...base, amountCents: null })).toBe('inactive')
  })

  it('reports the state shown on the billing page', () => {
    const state = { enabled: true, hasPaymentMethod: true, disabledReason: null, amountCents: 2_500, monthlyLimitCents: 10_000, monthSpentCents: 0 }
    expect(autoTopUpState(state)).toBe('active')
    expect(autoTopUpState({ ...state, hasPaymentMethod: false })).toBe('off')
    expect(autoTopUpState({ ...state, monthSpentCents: 8_000 })).toBe('limit_reached')
    expect(autoTopUpState({ ...state, enabled: false })).toBe('off')
    expect(autoTopUpState({ ...state, enabled: false, disabledReason: 'payment_failed' })).toBe('payment_failed')
    expect(autoTopUpState({ ...state, enabled: false, disabledReason: 'payment_method_removed' })).toBe('payment_method_removed')
  })

  it('resets the monthly limit at the UTC month boundary', () => {
    const lastMoment = new Date('2026-09-30T23:59:59.999Z')
    expect(utcMonthStart(lastMoment).toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(utcMonthEnd(lastMoment).toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(utcMonthEnd(new Date('2026-12-15T00:00:00.000Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
})
