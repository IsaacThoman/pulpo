import { describe, expect, it } from 'vitest'
import { priceLabel, subscriptionStatusLabel } from './format'

const subscription = {
  provider: 'app_store' as const, plan: 'eight' as const, pendingPlan: null, status: 'active' as const,
  cancelAtPeriodEnd: false, currentPeriodEnd: '2026-12-01T12:00:00.000Z',
}

describe('App Store formatting', () => {
  it('shows the App Store’s price with its period', () => {
    expect(priceLabel({ displayPrice: '$9.99', periodUnit: 'month', periodValue: 1 })).toBe('$9.99/month')
    expect(priceLabel({ displayPrice: '29,99 €', periodUnit: 'month', periodValue: 3 })).toBe('29,99 € every 3 months')
    expect(priceLabel({ displayPrice: '$9.99', periodUnit: null, periodValue: null })).toBe('$9.99')
  })

  it('describes renewal, cancellation, a pending plan change, and billing problems', () => {
    expect(subscriptionStatusLabel(subscription, 'en-US')).toBe('Renews Dec 1, 2026')
    expect(subscriptionStatusLabel({ ...subscription, cancelAtPeriodEnd: true }, 'en-US')).toBe('Ends Dec 1, 2026')
    expect(subscriptionStatusLabel({ ...subscription, plan: 'fat', pendingPlan: 'eight' }, 'en-US')).toBe('Pulpo Eight starts Dec 1, 2026')
    expect(subscriptionStatusLabel({ ...subscription, status: 'past_due' })).toMatch(/couldn’t renew/)
  })
})
