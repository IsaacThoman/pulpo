import { describe, expect, it } from 'vitest'
import { managedBillingPlan, pendingBillingPlan, planChoiceDisabled, planChoiceLabel } from './billing'

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
