import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerAdminBillingRoutes } from './admin-routes.js'
import {
  autoTopUpSettingsSchema,
  availableBillingBalanceMicros,
  billingLimitPercentage,
  fiveHourSummaryPercentages,
  isCreditOrderReason,
  registerBillingRoutes,
  resolvedCheckoutStatus,
  selectSummarySubscription,
} from './routes.js'

const apps: ReturnType<typeof Fastify>[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('billing feature gate', () => {
  it('does not register user billing routes when billing is disabled', async () => {
    const app = Fastify()
    apps.push(app)
    await registerBillingRoutes(app)
    const response = await app.inject({ method: 'GET', url: '/api/billing/summary' })
    expect(response.statusCode).toBe(404)
    const autoTopUp = await app.inject({ method: 'PUT', url: '/api/billing/auto-top-up', payload: {} })
    expect(autoTopUp.statusCode).toBe(404)
  })

  it('does not register admin billing routes when billing is disabled', async () => {
    const app = Fastify()
    apps.push(app)
    await registerAdminBillingRoutes(app)
    const response = await app.inject({ method: 'GET', url: '/api/admin/billing/dashboard' })
    expect(response.statusCode).toBe(404)
  })
})

describe('checkout status resolution', () => {
  it('treats a paid order as authoritative when the checkout row is stale or missing', () => {
    expect(resolvedCheckoutStatus('open', 'paid')).toBe('succeeded')
    expect(resolvedCheckoutStatus(null, 'paid')).toBe('succeeded')
  })

  it('preserves terminal and in-progress checkout states without a paid order', () => {
    expect(resolvedCheckoutStatus('expired', null)).toBe('expired')
    expect(resolvedCheckoutStatus('processing', 'open')).toBe('processing')
    expect(resolvedCheckoutStatus(null, null)).toBeNull()
  })
})

describe('billing summary subscription recovery', () => {
  const subscriptions = [
    { plan: 'eight', status: 'past_due', id: 'sub_actionable' },
    { plan: 'fat', status: 'canceled', id: 'sub_terminal' },
  ]

  it('returns an actionable subscription even when paid entitlements have expired', () => {
    expect(selectSummarySubscription(subscriptions, 'baby')?.id).toBe('sub_actionable')
  })

  it('prefers the subscription that provides the current entitlement plan', () => {
    const current = { plan: 'fat', status: 'active', id: 'sub_current' }
    expect(selectSummarySubscription([subscriptions[0]!, current], 'fat')?.id).toBe('sub_current')
  })

  it('does not surface terminal subscriptions as manageable fallbacks', () => {
    expect(selectSummarySubscription([{ plan: 'fat', status: 'canceled' }], 'baby')).toBeNull()
  })
})

describe('billing summary reservation balances', () => {
  it('reports only the balance that remains available after pending reservations', () => {
    expect(availableBillingBalanceMicros(5_000_000, 1_250_000)).toBe(3_750_000)
  })

  it('never reports a negative available balance', () => {
    expect(availableBillingBalanceMicros(1_000_000, 1_500_000)).toBe(0)
  })

  it('calculates exact bounded bar segments for reserved subscription usage', () => {
    expect(billingLimitPercentage(250_000, 2_000_000)).toBe(12.5)
    expect(billingLimitPercentage(3_000_000, 2_000_000)).toBe(100)
    expect(billingLimitPercentage(1, 0)).toBe(0)
  })

  it('clamps five-hour availability to the lower weekly dollar remainder', () => {
    expect(fiveHourSummaryPercentages({
      weeklyLimitMicros: 10_000_000,
      weeklySpentMicros: 9_000_000,
      weeklyRemainingMicros: 1_000_000,
      fiveHourLimitMicros: 5_000_000,
      fiveHourSpentMicros: 0,
      fiveHourPendingMicros: 0,
      fiveHourRemainingMicros: 5_000_000,
    })).toEqual({
      remainingPercentage: 20,
      availableBarPercentage: 20,
      pendingMicros: 0,
      pendingBarPercentage: 0,
    })
  })
})

describe('automatic top-up settings', () => {
  const valid = { enabled: true, thresholdCents: 500, amountCents: 2_500, monthlyLimitCents: 10_000 }

  it('accepts settings within the top-up bounds', () => {
    expect(autoTopUpSettingsSchema.parse(valid)).toEqual(valid)
    expect(autoTopUpSettingsSchema.parse({ ...valid, thresholdCents: 0 }).thresholdCents).toBe(0)
  })

  it('rejects amounts outside the manual top-up range', () => {
    expect(autoTopUpSettingsSchema.safeParse({ ...valid, amountCents: 499 }).success).toBe(false)
    expect(autoTopUpSettingsSchema.safeParse({ ...valid, amountCents: 50_001 }).success).toBe(false)
    expect(autoTopUpSettingsSchema.safeParse({ ...valid, thresholdCents: 50_001 }).success).toBe(false)
    expect(autoTopUpSettingsSchema.safeParse({ ...valid, monthlyLimitCents: 500_001 }).success).toBe(false)
    expect(autoTopUpSettingsSchema.safeParse({ ...valid, amountCents: 12.5 }).success).toBe(false)
  })

  it('requires the monthly limit to cover one top-up including its fee', () => {
    expect(autoTopUpSettingsSchema.safeParse({ ...valid, monthlyLimitCents: 2_688 }).success).toBe(true)
    expect(autoTopUpSettingsSchema.safeParse({ ...valid, monthlyLimitCents: 2_687 }).success).toBe(false)
  })

  it('lists automatic top-ups with credit purchases', () => {
    expect(isCreditOrderReason('purchase')).toBe(true)
    expect(isCreditOrderReason('auto_top_up')).toBe(true)
    expect(isCreditOrderReason('subscription_cycle')).toBe(false)
  })
})
