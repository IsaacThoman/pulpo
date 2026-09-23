import { afterEach, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import {
  autoTopUpSettingsError,
  autoTopUpStatusLine,
  defaultAutoTopUpSettings,
  managedBillingPlan,
  paymentMethodLabel,
  paymentStatusLabel,
  pendingBillingPlan,
  planChoiceDisabled,
  planChoiceLabel,
  type AutoTopUpSummary,
} from './billing'

describe('payment status labels', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('updates payment history labels when the language changes', async () => {
    expect(paymentStatusLabel('paid')).toBe('Paid')
    expect(paymentStatusLabel('refunded')).toBe('Refunded')

    await i18n.changeLanguage('es-ES')
    expect(paymentStatusLabel('paid')).toBe('Pagado')
    expect(paymentStatusLabel('refunded')).toBe('Reembolsado')
    expect(paymentStatusLabel('unexpected_api_status')).toBe('Desconocido')

    await i18n.changeLanguage('en-US')
    expect(paymentStatusLabel('paid')).toBe('Paid')
    expect(paymentStatusLabel('unexpected_api_status')).toBe('Unknown')
  })
})

describe('plan comparison choices', () => {
  it('uses only the Stripe subscription for plan-management state', () => {
    expect(managedBillingPlan({ subscription: null })).toBe('baby')
    expect(managedBillingPlan({ subscription: {
      plan: 'eight', pendingPlan: null, status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: null,
    } })).toBe('eight')
  })

  it('keeps the paid plan current while a downgrade waits for renewal', () => {
    const summary = { subscription: {
      plan: 'fat' as const, pendingPlan: 'eight' as const, status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: null,
    } }
    expect(managedBillingPlan(summary)).toBe('fat')
    expect(pendingBillingPlan(summary)).toBe('eight')
    expect(pendingBillingPlan({ subscription: { ...summary.subscription, pendingPlan: null } })).toBeNull()
    expect(planChoiceLabel('fat', 'fat', false, 'eight')).toBe('Keep $24/month')
    expect(planChoiceDisabled('fat', 'fat', false, 'eight')).toBe(false)
    expect(planChoiceLabel('eight', 'fat', false, 'eight')).toBe('Switches at renewal')
    expect(planChoiceDisabled('eight', 'fat', false, 'eight')).toBe(true)
    expect(planChoiceLabel('baby', 'fat', false, 'eight')).toBe('Cancel plan')
    expect(planChoiceLabel('eight', 'fat', true, 'eight')).toBe('Renew for $8/month')
    expect(planChoiceDisabled('eight', 'fat', true, 'eight')).toBe(false)
  })

  it('lets paid users upgrade, downgrade, or switch to Baby', () => {
    expect(planChoiceLabel('fat', 'eight', false)).toBe('Upgrade for $24/month')
    expect(planChoiceLabel('eight', 'fat', false)).toBe('Downgrade to $8/month')
    expect(planChoiceLabel('baby', 'eight', false)).toBe('Cancel plan')
    expect(planChoiceDisabled('fat', 'eight', false)).toBe(false)
    expect(planChoiceDisabled('eight', 'fat', false)).toBe(false)
    expect(planChoiceDisabled('baby', 'eight', false)).toBe(false)
  })

  it('disables the current plan and a scheduled Baby switch', () => {
    expect(planChoiceLabel('eight', 'eight', false)).toBe('Current plan')
    expect(planChoiceDisabled('eight', 'eight', false)).toBe(true)
    expect(planChoiceLabel('eight', 'eight', true)).toBe('Renew for $8/month')
    expect(planChoiceLabel('fat', 'fat', true)).toBe('Renew for $24/month')
    expect(planChoiceDisabled('eight', 'eight', true)).toBe(false)
    expect(planChoiceLabel('baby', 'fat', true)).toBe('Current plan')
    expect(planChoiceDisabled('baby', 'fat', true)).toBe(true)
    expect(planChoiceLabel('eight', 'fat', true)).toBe('Renew for $8/month')
    expect(planChoiceLabel('fat', 'eight', true)).toBe('Renew for $24/month')
    expect(planChoiceDisabled('eight', 'fat', true)).toBe(false)
  })
})

describe('automatic top-up settings', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  const valid = { thresholdCents: 500, amountCents: 2_500, monthlyLimitCents: 10_000 }

  it('matches the server bounds', () => {
    expect(autoTopUpSettingsError(valid)).toBeNull()
    expect(autoTopUpSettingsError({ ...valid, thresholdCents: 0 })).toBeNull()
    expect(autoTopUpSettingsError({ ...valid, thresholdCents: null })).toContain('threshold')
    expect(autoTopUpSettingsError({ ...valid, thresholdCents: 50_001 })).toContain('threshold')
    expect(autoTopUpSettingsError({ ...valid, amountCents: 499 })).toContain('amount')
    expect(autoTopUpSettingsError({ ...valid, monthlyLimitCents: 500_001 })).toContain('monthly limit')
  })

  it('requires the monthly limit to cover one charge including the platform fee', () => {
    expect(autoTopUpSettingsError({ ...valid, monthlyLimitCents: 2_685 })).toBeNull()
    expect(autoTopUpSettingsError({ ...valid, monthlyLimitCents: 2_684 })).toContain('at least one top-up')
  })

  it('starts from stored settings or a limit of four top-ups', () => {
    expect(defaultAutoTopUpSettings(undefined, 5_000)).toEqual({ enabled: true, thresholdCents: 500, amountCents: 5_000, monthlyLimitCents: 20_000 })
    const stored = { thresholdCents: 1_000, amountCents: 2_000, monthlyLimitCents: 6_000 } as AutoTopUpSummary
    expect(defaultAutoTopUpSettings(stored)).toEqual({ enabled: true, thresholdCents: 1_000, amountCents: 2_000, monthlyLimitCents: 6_000 })
  })

  it('labels saved cards', () => {
    expect(paymentMethodLabel({ brand: 'visa', last4: '4242' })).toBe('Visa •••• 4242')
    expect(paymentMethodLabel({ brand: 'amex', last4: '0005' })).toBe('Amex •••• 0005')
    expect(paymentMethodLabel({ brand: null, last4: null })).toBe('Card')
  })

  it('summarizes the status in one line', async () => {
    const active = {
      enabled: true, state: 'active', thresholdCents: 500, amountCents: 2_500, monthlyLimitCents: 10_000,
      monthSpentCents: 5_370, monthResetsAt: '2026-10-01T00:00:00.000Z', paymentMethod: { brand: 'visa', last4: '4242' }, lastAttempt: null,
    } satisfies AutoTopUpSummary
    expect(autoTopUpStatusLine({ ...active, state: 'off', enabled: false })).toBeNull()
    expect(autoTopUpStatusLine(active)).toEqual({ text: 'Auto top-up adds $25.00 when your balance falls below $5.00 · $53.70 of $100.00 used this month', tone: 'muted' })
    // Resets at midnight UTC show as the 1st in every time zone.
    expect(autoTopUpStatusLine({ ...active, state: 'limit_reached' })?.text).toBe('Auto top-up paused until Oct 1, 2026 · $53.70 of $100.00 used this month')
    expect(autoTopUpStatusLine({ ...active, state: 'payment_failed', lastAttempt: { status: 'failed', creditCents: 2_500, failureMessage: 'Your card has insufficient funds.', createdAt: '2026-09-22T00:00:00.000Z' } }))
      .toEqual({ text: 'Auto top-up turned off: Your card has insufficient funds.', tone: 'error' })
    expect(autoTopUpStatusLine({ ...active, state: 'payment_method_removed' })?.tone).toBe('attention')
    await i18n.changeLanguage('es-ES')
    expect(autoTopUpStatusLine({ ...active, state: 'payment_method_removed' })?.text).toBe('La recarga automática se desactivó porque se eliminó tu tarjeta guardada.')
  })
})
