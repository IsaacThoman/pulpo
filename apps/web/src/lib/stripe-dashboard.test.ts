import { describe, expect, it } from 'vitest'
import { stripeDashboardUrl, stripePaymentUrl, stripeSubscriptionUrl, stripeWebhooksUrl } from './stripe-dashboard'

describe('Stripe dashboard URLs', () => {
  it('builds test mode links', () => {
    expect(stripeDashboardUrl('test')).toBe('https://dashboard.stripe.com/test')
    expect(stripeWebhooksUrl('test')).toBe('https://dashboard.stripe.com/test/webhooks')
    expect(stripePaymentUrl('test', 'pi_1')).toBe('https://dashboard.stripe.com/test/payments/pi_1')
    expect(stripePaymentUrl('test', 'in_1')).toBe('https://dashboard.stripe.com/test/invoices/in_1')
    expect(stripeSubscriptionUrl('test', 'sub_1')).toBe('https://dashboard.stripe.com/test/subscriptions/sub_1')
  })

  it('builds live mode links', () => {
    expect(stripeDashboardUrl('live', '/payments/pi_1')).toBe('https://dashboard.stripe.com/payments/pi_1')
  })
})
