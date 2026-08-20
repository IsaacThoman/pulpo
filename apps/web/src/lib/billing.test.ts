import { describe, expect, it } from 'vitest'
import { planChoiceDisabled, planChoiceLabel } from './billing'

describe('plan comparison choices', () => {
  it('lets paid users upgrade, downgrade, or switch to Baby', () => {
    expect(planChoiceLabel('fat', 'eight', false)).toBe('Upgrade for $24/month')
    expect(planChoiceLabel('eight', 'fat', false)).toBe('Downgrade to $8/month')
    expect(planChoiceLabel('baby', 'eight', false)).toBe('Switch to Baby')
    expect(planChoiceDisabled('fat', 'eight', false)).toBe(false)
    expect(planChoiceDisabled('eight', 'fat', false)).toBe(false)
    expect(planChoiceDisabled('baby', 'eight', false)).toBe(false)
  })

  it('disables the current plan and a scheduled Baby switch', () => {
    expect(planChoiceLabel('eight', 'eight', false)).toBe('Current plan')
    expect(planChoiceDisabled('eight', 'eight', false)).toBe(true)
    expect(planChoiceLabel('eight', 'eight', true)).toBe('Renew')
    expect(planChoiceDisabled('eight', 'eight', true)).toBe(false)
    expect(planChoiceLabel('baby', 'fat', true)).toBe('Current plan')
    expect(planChoiceDisabled('baby', 'fat', true)).toBe(true)
    expect(planChoiceLabel('eight', 'fat', true)).toBe('Renew for $8/month')
    expect(planChoiceLabel('fat', 'eight', true)).toBe('Renew for $24/month')
    expect(planChoiceDisabled('eight', 'fat', true)).toBe(false)
  })
})
