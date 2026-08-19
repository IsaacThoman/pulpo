import { describe, expect, it } from 'vitest'
import { grantMicrosForPaidOrder, isStaleProviderUpdate } from './webhooks.js'

describe('billing webhook lifecycle rules', () => {
  it('grants purchased credit exactly once', () => {
    expect(grantMicrosForPaidOrder({
      isCreditPurchase: true,
      requestedCreditCents: 2_500,
      plan: null,
      billingReason: 'purchase',
      alreadyGrantedMicros: 0,
    })).toBe(25_000_000)
    expect(grantMicrosForPaidOrder({
      isCreditPurchase: true,
      requestedCreditCents: 2_500,
      plan: null,
      billingReason: 'purchase',
      alreadyGrantedMicros: 25_000_000,
    })).toBe(0)
  })

  it.each([
    ['eight', 'subscription_create', 2_000_000],
    ['eight', 'subscription_cycle', 2_000_000],
    ['fat', 'subscription_create', 16_000_000],
    ['fat', 'subscription_cycle', 16_000_000],
  ] as const)('grants %s credit for %s orders', (plan, billingReason, expected) => {
    expect(grantMicrosForPaidOrder({
      isCreditPurchase: false,
      requestedCreditCents: null,
      plan,
      billingReason,
      alreadyGrantedMicros: 0,
    })).toBe(expected)
  })

  it('does not grant cycle credit for prorations or duplicate orders', () => {
    expect(grantMicrosForPaidOrder({
      isCreditPurchase: false,
      requestedCreditCents: null,
      plan: 'fat',
      billingReason: 'subscription_update',
      alreadyGrantedMicros: 0,
    })).toBe(0)
    expect(grantMicrosForPaidOrder({
      isCreditPurchase: false,
      requestedCreditCents: null,
      plan: 'fat',
      billingReason: 'subscription_cycle',
      alreadyGrantedMicros: 16_000_000,
    })).toBe(0)
  })

  it('rejects stale subscription state while accepting equal-time retries', () => {
    const current = new Date('2026-08-17T15:00:00.000Z')
    expect(isStaleProviderUpdate(current, new Date('2026-08-17T14:59:59.999Z'))).toBe(true)
    expect(isStaleProviderUpdate(current, current)).toBe(false)
    expect(isStaleProviderUpdate(current, new Date('2026-08-17T15:00:00.001Z'))).toBe(false)
  })
})
