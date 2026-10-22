import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db, queryClient } from '../database/client.js'
import { applicationSettings, billingSubscriptions, users } from '../database/schema.js'

const stripe = vi.hoisted(() => ({ calls: 0, cancelled: [] as string[] }))

vi.mock('../config.js', async (original) => {
  const config = await original<typeof import('../config.js')>()
  return {
    ...config,
    getConfig: () => ({ ...config.getConfig(), PULPO_BILLING_ENABLED: true }),
  }
})
vi.mock('./stripe.js', async (original) => {
  const actual = await original<typeof import('./stripe.js')>()
  const client = {
    subscriptions: {
      retrieve: vi.fn(async (id: string) => ({ id, status: 'active' })),
      cancel: vi.fn(async (id: string) => { stripe.cancelled.push(id) }),
    },
  }
  return { ...actual, getStripeClient: () => { stripe.calls += 1; return client } }
})

const { changeSubscription, createSubscriptionCheckout } = await import('./stripe.js')
const { cancelAccountBilling } = await import('../account/stripe-deletion.js')
const { loadStorageEntitlement } = await import('./storage-entitlements.js')
const { parseBillingSettings } = await import('../settings/application-settings.js')

const enabled = process.env.PULPO_BUDGET_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_budget_test') {
  throw new Error('Billing provider tests require a migrated disposable database named pulpo_budget_test')
}
const userIds: string[] = []

async function subscriber(subscriptions: Array<{ id: string; provider: 'stripe' | 'app_store'; plan?: 'eight' | 'fat'; paidPlan?: 'eight' | 'fat' }>) {
  const userId = randomUUID()
  userIds.push(userId)
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, username: userId, name: 'Billing provider QA' })
  for (const subscription of subscriptions) {
    await db.insert(billingSubscriptions).values({
      providerSubscriptionId: subscription.id,
      provider: subscription.provider,
      userId,
      providerProductId: `${subscription.provider}-${subscription.plan ?? 'eight'}`,
      plan: subscription.plan ?? 'eight',
      paidPlan: subscription.paidPlan ?? subscription.plan ?? 'eight',
      status: 'active',
      paidThrough: new Date(Date.now() + 86_400_000),
      providerModifiedAt: new Date(),
    })
  }
  return userId
}

describe.skipIf(!enabled)('billing providers in PostgreSQL', () => {
  beforeEach(() => { stripe.calls = 0; stripe.cancelled = [] })
  afterAll(async () => {
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
    await queryClient.end()
  })

  it('refuses a Stripe checkout or plan change while an App Store subscription is active', async () => {
    const userId = await subscriber([{ id: `${Date.now()}1`, provider: 'app_store' }])

    await expect(createSubscriptionCheckout({ userId, plan: 'fat', idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ statusCode: 409, code: 'subscription_managed_by_app_store' })
    await expect(changeSubscription({ userId, plan: 'baby' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'subscription_managed_by_app_store' })
  })

  it('still refuses a second Stripe checkout for an active Stripe subscriber', async () => {
    const userId = await subscriber([{ id: `sub_${randomUUID()}`, provider: 'stripe' }])

    await expect(createSubscriptionCheckout({ userId, plan: 'fat', idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ statusCode: 409, code: 'subscription_exists' })
  })

  it('treats a user with Stripe and App Store subscriptions as a Stripe subscriber', async () => {
    const userId = await subscriber([
      { id: `${Date.now()}4`, provider: 'app_store', plan: 'fat' },
      { id: `sub_${randomUUID()}`, provider: 'stripe' },
    ])

    await expect(createSubscriptionCheckout({ userId, plan: 'fat', idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ statusCode: 409, code: 'subscription_exists' })
  })

  it('cancels only Stripe subscriptions when deleting an account', async () => {
    const stripeId = `sub_${randomUUID()}`
    const userId = await subscriber([
      { id: stripeId, provider: 'stripe' },
      { id: `${Date.now()}2`, provider: 'app_store', plan: 'fat' },
    ])

    await cancelAccountBilling(userId)

    expect(stripe.cancelled).toEqual([stripeId])
  })

  it('does not call Stripe for an account with only an App Store subscription', async () => {
    const userId = await subscriber([{ id: `${Date.now()}3`, provider: 'app_store' }])

    await cancelAccountBilling(userId)

    expect(stripe.calls).toBe(0)
  })

  it('keeps the paid plan storage after a downgrade until the period ends', async () => {
    const userId = await subscriber([{ id: `sub_${randomUUID()}`, provider: 'stripe', plan: 'eight', paidPlan: 'fat' }])
    const [setting] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
      .where(eq(applicationSettings.key, 'billing'))
    const settings = parseBillingSettings(setting?.value)

    const entitlement = await db.transaction((tx) => loadStorageEntitlement(tx, userId))

    expect(entitlement).toEqual({ storageLimitBytes: settings.fatStorageLimitBytes, storageLimitOverridden: false })
  })
})
