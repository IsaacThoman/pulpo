import { describe, expect, it } from 'vitest'
import { planChoiceDisabled, planChoiceLabel } from './billing'

describe('plan comparison choices', () => {
  it('lets paid users upgrade to Fat or switch to Baby', () => {
    expect(planChoiceLabel('fat', 'eight', false)).toBe('Upgrade for $24/month')
    expect(planChoiceLabel('baby', 'eight', false)).toBe('Switch to Baby')
    expect(planChoiceDisabled('fat', 'eight', false)).toBe(false)
    expect(planChoiceDisabled('baby', 'eight', false)).toBe(false)
  })

  it('disables the current plan and a scheduled Baby switch', () => {
    expect(planChoiceLabel('eight', 'eight', false)).toBe('Current plan')
    expect(planChoiceDisabled('eight', 'eight', false)).toBe(true)
    expect(planChoiceLabel('baby', 'fat', true)).toBe('Switch scheduled')
    expect(planChoiceDisabled('baby', 'fat', true)).toBe(true)
    expect(planChoiceDisabled('eight', 'fat', false)).toBe(true)
  })
})
