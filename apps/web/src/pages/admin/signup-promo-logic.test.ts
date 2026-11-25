import { describe, expect, it } from 'vitest'
import { parseSignupPromoDraft, signupPromoDraft } from './signup-promo-logic'

const settings = { enabled: true, amountMicros: 1_000_000, message: '', eligibleDays: 7, budgetMicros: 25_000_000, budgetPeriod: 'day' as const }

describe('signup promo draft', () => {
  it('round-trips saved settings', () => {
    expect(parseSignupPromoDraft(signupPromoDraft(settings))).toEqual(settings)
  })

  it('converts dollars to micros and trims the message', () => {
    expect(parseSignupPromoDraft({ ...signupPromoDraft(settings), amount: '0.5', budget: '10', message: '  Hi there  ', budgetPeriod: 'hour' }))
      .toEqual({ ...settings, amountMicros: 500_000, budgetMicros: 10_000_000, message: 'Hi there', budgetPeriod: 'hour' })
  })

  it('rejects a zero amount, an empty budget, and out-of-range days', () => {
    const draft = signupPromoDraft(settings)
    expect(parseSignupPromoDraft({ ...draft, amount: '0' })).toBeNull()
    expect(parseSignupPromoDraft({ ...draft, budget: '' })).toBeNull()
    expect(parseSignupPromoDraft({ ...draft, eligibleDays: '0' })).toBeNull()
    expect(parseSignupPromoDraft({ ...draft, eligibleDays: '1.5' })).toBeNull()
  })
})
