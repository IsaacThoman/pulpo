import { describe, expect, it, vi } from 'vitest'

vi.mock('../config.js', () => ({
  getConfig: () => ({
    PULPO_BILLING_ENABLED: true,
    STRIPE_SECRET_KEY: 'sk_test_fixture',
    STRIPE_EIGHT_PRICE_ID: 'price_eight',
    STRIPE_FAT_PRICE_ID: 'price_fat',
    STRIPE_CREDIT_PRODUCT_ID: 'prod_credit',
  }),
}))

import {
  grantMicrosForPaidOrder,
  invoicePaymentListParams,
  isStaleProviderUpdate,
  matchingStripeOwner,
  paidPlanForInvoice,
  shouldRecordPaidPlan,
  stripeCheckoutStatus,
  validateAutoTopUpInvoice,
  validateCreditCheckoutPayment,
} from './webhooks.js'

describe('billing webhook lifecycle rules', () => {
  it('retrieves invoice payments without exceeding Stripe expansion depth', () => {
    expect(invoicePaymentListParams('in_paid')).toEqual({
      invoice: 'in_paid',
      status: 'paid',
      limit: 10,
    })
  })

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
    ['eight', 'subscription_create', 1_000_000],
    ['eight', 'subscription_cycle', 1_000_000],
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

  it('does not re-grant credits when reconciliation later fills processing fees', () => {
    expect(grantMicrosForPaidOrder({
      isCreditPurchase: true,
      requestedCreditCents: 1_000,
      plan: null,
      billingReason: 'purchase',
      alreadyGrantedMicros: 10_000_000,
    })).toBe(0)
  })

  it('keeps subscription checkout processing until its paid invoice arrives', () => {
    expect(stripeCheckoutStatus({ mode: 'subscription', status: 'complete', paymentStatus: 'paid' })).toBe('processing')
    expect(stripeCheckoutStatus({ mode: 'payment', status: 'complete', paymentStatus: 'paid' })).toBe('succeeded')
    expect(stripeCheckoutStatus({ mode: 'payment', status: 'expired', paymentStatus: 'unpaid' })).toBe('expired')
    expect(stripeCheckoutStatus({ mode: 'setup', status: 'complete', paymentStatus: 'no_payment_required' })).toBe('succeeded')
    expect(stripeCheckoutStatus({ mode: 'setup', status: 'open', paymentStatus: 'no_payment_required' })).toBe('open')
  })

  it('validates automatic top-up invoices against the attempt', () => {
    const valid = {
      attempt: { userId: 'user_1', creditCents: 2_500, chargeCents: 2_685 },
      ownerUserId: 'user_1',
      metadataCreditCents: '2500',
      subtotalCents: 2_685,
      currency: 'usd',
      productIds: ['prod_credit'],
      expectedProductId: 'prod_credit',
      invoiceId: 'in_auto',
    }
    expect(() => validateAutoTopUpInvoice(valid)).not.toThrow()
    expect(() => validateAutoTopUpInvoice({ ...valid, ownerUserId: 'user_2' })).toThrow('attempt owner')
    expect(() => validateAutoTopUpInvoice({ ...valid, subtotalCents: 2_684 })).toThrow('amount')
    expect(() => validateAutoTopUpInvoice({ ...valid, metadataCreditCents: '5000' })).toThrow('amount')
    expect(() => validateAutoTopUpInvoice({ ...valid, currency: 'eur' })).toThrow('amount')
    expect(() => validateAutoTopUpInvoice({ ...valid, productIds: ['prod_other'] })).toThrow('product')
    expect(() => validateAutoTopUpInvoice({ ...valid, productIds: ['prod_credit', 'prod_credit'] })).toThrow('product')
  })

  it('grants an automatic top-up once', () => {
    const paid = { isCreditPurchase: true, requestedCreditCents: 2_500, plan: null, billingReason: 'auto_top_up' }
    expect(grantMicrosForPaidOrder({ ...paid, alreadyGrantedMicros: 0 })).toBe(25_000_000)
    expect(grantMicrosForPaidOrder({ ...paid, alreadyGrantedMicros: 25_000_000 })).toBe(0)
  })

  it('validates tax-exclusive credit checkout amounts and configured product', () => {
    expect(() => validateCreditCheckoutPayment({
      requestedCreditCents: 1_000,
      metadataCreditCents: '1000',
      storedChargeCents: 1_106,
      subtotalCents: 1_106,
      currency: 'usd',
      productId: 'prod_credits',
      expectedProductId: 'prod_credits',
      checkoutId: 'cs_test_ok',
    })).not.toThrow()
    expect(() => validateCreditCheckoutPayment({
      requestedCreditCents: 1_000,
      metadataCreditCents: '1000',
      storedChargeCents: 1_106,
      subtotalCents: 1_195,
      currency: 'usd',
      productId: 'prod_credits',
      expectedProductId: 'prod_credits',
      checkoutId: 'cs_test_amount',
    })).toThrow(/amount did not match/)
    expect(() => validateCreditCheckoutPayment({
      requestedCreditCents: 1_000,
      metadataCreditCents: '1000',
      storedChargeCents: 1_106,
      subtotalCents: 1_106,
      currency: 'usd',
      productId: 'prod_unknown',
      expectedProductId: 'prod_credits',
      checkoutId: 'cs_test_product',
    })).toThrow(/Unexpected product/)
  })

  it('rejects mismatched Stripe ownership signals', () => {
    expect(matchingStripeOwner(['user_1', 'user_1', null], 'in_1')).toBe('user_1')
    expect(() => matchingStripeOwner(['user_1', 'user_2'], 'in_1')).toThrow(/identity did not match/)
  })

  it('rejects stale subscription state while accepting equal-time retries', () => {
    const current = new Date('2026-08-17T15:00:00.000Z')
    expect(isStaleProviderUpdate(current, new Date('2026-08-17T14:59:59.999Z'))).toBe(true)
    expect(isStaleProviderUpdate(current, current)).toBe(false)
    expect(isStaleProviderUpdate(current, new Date('2026-08-17T15:00:00.001Z'))).toBe(false)
  })

  it('records the plan a paid invoice actually charged for', () => {
    expect(paidPlanForInvoice([{ amount: 2_400, priceId: 'price_fat' }], 'eight')).toBe('fat')
    // An upgrade invoice credits the old price and charges the new one.
    expect(paidPlanForInvoice([
      { amount: -400, priceId: 'price_eight' },
      { amount: 1_200, priceId: 'price_fat' },
    ], 'eight')).toBe('fat')
    expect(paidPlanForInvoice([{ amount: 0, priceId: 'price_other' }], 'eight')).toBe('eight')
    expect(paidPlanForInvoice([], 'fat')).toBe('fat')
  })

  it('lets only newer invoices move the paid plan when reconciliation replays history', () => {
    const earlier = new Date('2026-08-01T00:00:00Z')
    const later = new Date('2026-09-01T00:00:00Z')
    expect(shouldRecordPaidPlan(null, earlier)).toBe(true)
    expect(shouldRecordPaidPlan(earlier, later)).toBe(true)
    expect(shouldRecordPaidPlan(later, later)).toBe(true)
    expect(shouldRecordPaidPlan(later, earlier)).toBe(false)
  })
})
