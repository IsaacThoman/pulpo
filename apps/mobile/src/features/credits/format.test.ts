import { describe, expect, it } from 'vitest'
import type { CreditSummary } from '@pulpo/contracts'
import { autoTopUpLabel, formatUsdCents, formatUsdMicros, paymentDetail, paymentTitle, promoResetLabel } from './format'

type Payment = CreditSummary['payments'][number]
const payment = (overrides: Partial<Payment>): Payment => ({
  id: 'pi_1', provider: 'stripe', kind: 'credits', automatic: false, plan: null, requestedCreditCents: 2500,
  amountCents: 2688, status: 'paid', createdAt: '2026-11-20T15:00:00.000Z', ...overrides,
})

describe('credit formatting', () => {
  it('formats US dollars like the web balance', () => {
    expect(formatUsdMicros(1_000_000)).toBe('$1.00')
    expect(formatUsdMicros(12_345_678)).toBe('$12.35')
    expect(formatUsdMicros(-420_000)).toBe('-$0.42')
    expect(formatUsdCents(123_456_789)).toBe('$1,234,567.89')
    expect(formatUsdCents(0)).toBe('$0.00')
  })

  it('describes payments in the web’s Payment history wording', () => {
    expect(paymentTitle(payment({}))).toBe('$25.00 credit top-up')
    expect(paymentTitle(payment({ automatic: true, requestedCreditCents: 1000 }))).toBe('$10.00 auto top-up')
    expect(paymentTitle(payment({ kind: 'subscription', plan: 'eight', requestedCreditCents: null }))).toBe('Pulpo Eight subscription')
    expect(paymentTitle(payment({ kind: 'subscription', plan: 'fat', provider: 'app_store' }))).toBe('Pulpo Fat subscription · App Store')
    expect(paymentDetail(payment({ status: 'refunded' }), 'en-US')).toBe('Nov 20, 2026 · Refunded')
    expect(paymentDetail(payment({ status: 'open' }), 'en-US')).toMatch(/· Unknown$/)
  })

  it('summarizes auto top-up, which is set up on the web', () => {
    expect(autoTopUpLabel({ enabled: true, thresholdCents: 500, amountCents: 2000 })).toBe('$20.00 below $5.00')
    expect(autoTopUpLabel({ enabled: false, thresholdCents: 500, amountCents: 2000 })).toBe('Off')
    expect(autoTopUpLabel({ enabled: true, thresholdCents: null, amountCents: null })).toBe('Off')
  })

  it('shows when a used-up promo budget refills: a time today, otherwise the date too', () => {
    const now = new Date(2026, 10, 28, 9, 0)
    expect(promoResetLabel(new Date(2026, 10, 28, 17, 30).toISOString(), now, 'en-US')).toBe('5:30 PM')
    expect(promoResetLabel(new Date(2026, 11, 1, 0, 0).toISOString(), now, 'en-US')).toMatch(/^Dec 1/)
  })
})
