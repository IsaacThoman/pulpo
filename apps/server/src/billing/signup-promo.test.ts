import { describe, expect, it } from 'vitest'
import { parseSignupPromoSettings } from '../settings/application-settings.js'
import { signupPromoPatchSchema } from './admin-routes.js'
import { signupPromoEligibleUntil, signupPromoIneligibility, signupPromoWindow } from './signup-promo.js'

const now = new Date('2026-11-25T15:42:10.000Z')
const enabled = parseSignupPromoSettings({ enabled: true, eligibleDays: 7 })
const account = { role: 'user', blocked: false, createdAt: new Date('2026-11-24T08:00:00.000Z') }

describe('signup promo budget window', () => {
  it('counts claims in the current UTC hour', () => {
    expect(signupPromoWindow('hour', now)).toEqual({
      startsAt: new Date('2026-11-25T15:00:00.000Z'),
      resetsAt: new Date('2026-11-25T16:00:00.000Z'),
    })
  })

  it('counts claims in the current UTC day', () => {
    expect(signupPromoWindow('day', now)).toEqual({
      startsAt: new Date('2026-11-25T00:00:00.000Z'),
      resetsAt: new Date('2026-11-26T00:00:00.000Z'),
    })
  })
})

describe('signup promo eligibility', () => {
  it('defaults to a disabled one-dollar promo with a daily budget', () => {
    expect(parseSignupPromoSettings(undefined)).toEqual({
      enabled: false, amountMicros: 1_000_000, message: '', eligibleDays: 7, budgetMicros: 25_000_000, budgetPeriod: 'day',
    })
  })

  it('lets a new, approved account claim once', () => {
    expect(signupPromoIneligibility(enabled, account, false, now)).toBeNull()
    expect(signupPromoIneligibility(enabled, account, true, now)).toBe('already_claimed')
  })

  it('stops offering the promo once the account is older than the window', () => {
    const until = signupPromoEligibleUntil(account.createdAt, enabled)
    expect(until.toISOString()).toBe('2026-12-01T08:00:00.000Z')
    expect(signupPromoIneligibility(enabled, account, false, until)).toBe('not_eligible')
  })

  it('excludes pending and blocked accounts and disabled promos', () => {
    expect(signupPromoIneligibility(enabled, { ...account, role: 'pending' }, false, now)).toBe('not_eligible')
    expect(signupPromoIneligibility(enabled, { ...account, blocked: true }, false, now)).toBe('not_eligible')
    expect(signupPromoIneligibility({ ...enabled, enabled: false }, account, false, now)).toBe('disabled')
  })
})

describe('signup promo admin patch', () => {
  it('leaves omitted settings out instead of filling defaults', () => {
    expect(signupPromoPatchSchema.parse({ budgetMicros: 5_000_000 })).toEqual({ budgetMicros: 5_000_000 })
  })

  it('rejects unknown fields and a zero amount', () => {
    expect(signupPromoPatchSchema.safeParse({ amountMicros: 0 }).success).toBe(false)
    expect(signupPromoPatchSchema.safeParse({ budget: 1 }).success).toBe(false)
  })
})
