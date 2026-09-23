import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { db, queryClient } from '../database/client.js'
import { billingAccounts, billingAutoTopUps, billingOrders, creditLedger, users } from '../database/schema.js'

const stripe = vi.hoisted(() => ({
  payBehavior: 'succeed' as 'succeed' | 'decline' | 'slow',
  invoices: new Map<string, Record<string, unknown>>(),
  created: 0,
  voided: [] as string[],
}))

function paidInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
  const chargeCents = Number((invoice.item as { unit_amount: number }).unit_amount)
  return {
    ...invoice,
    status: 'paid',
    subtotal: chargeCents,
    total: chargeCents,
    total_excluding_tax: chargeCents,
    total_taxes: [],
    total_discount_amounts: [],
    status_transitions: { paid_at: Math.floor(Date.now() / 1_000) },
    lines: { data: [{ amount: chargeCents, pricing: { price_details: { product: 'prod_credit', price: 'price_inline' } } }] },
  }
}

vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('../jobs.js', () => ({ maintenanceQueue: { add: vi.fn() } }))
vi.mock('../config.js', async (original) => {
  const config = await original<typeof import('../config.js')>()
  return {
    ...config,
    getConfig: () => ({ ...config.getConfig(), PULPO_BILLING_ENABLED: true, STRIPE_CREDIT_PRODUCT_ID: 'prod_credit' }),
  }
})
vi.mock('./stripe.js', async (original) => {
  const actual = await original<typeof import('./stripe.js')>()
  const client = {
    invoices: {
      create: vi.fn(async (params: Record<string, unknown>) => {
        stripe.created += 1
        const invoice = {
          id: `in_${randomUUID()}`, object: 'invoice', status: 'draft', currency: 'usd', customer: params.customer,
          metadata: params.metadata, created: Math.floor(Date.now() / 1_000), parent: null, billing_reason: 'manual',
        }
        stripe.invoices.set(invoice.id, invoice)
        return invoice
      }),
      finalizeInvoice: vi.fn(async (id: string) => {
        const invoice = { ...stripe.invoices.get(id)!, status: 'open' }
        stripe.invoices.set(id, invoice)
        return invoice
      }),
      pay: vi.fn(async (id: string) => {
        if (stripe.payBehavior === 'decline') {
          throw Stripe.errors.StripeError.generate({ type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.', statusCode: 402 } as never)
        }
        if (stripe.payBehavior === 'slow') await new Promise((resolve) => setTimeout(resolve, 150))
        const invoice = paidInvoice(stripe.invoices.get(id)!)
        stripe.invoices.set(id, invoice)
        return invoice
      }),
      retrieve: vi.fn(async (id: string) => stripe.invoices.get(id)),
      voidInvoice: vi.fn(async (id: string) => { stripe.voided.push(id) }),
      del: vi.fn(async () => ({})),
      search: vi.fn(async () => ({ data: [] })),
    },
    invoiceItems: {
      create: vi.fn(async (params: { invoice: string; price_data: { unit_amount: number } }) => {
        stripe.invoices.set(params.invoice, { ...stripe.invoices.get(params.invoice)!, item: params.price_data })
        return { id: `ii_${randomUUID()}` }
      }),
    },
    invoicePayments: {
      list: vi.fn(async (params: { invoice: string }) => ({
        data: [{ payment: { type: 'payment_intent', payment_intent: `pi_${params.invoice}` } }],
      })),
    },
    paymentIntents: {
      retrieve: vi.fn(async (id: string) => ({ id, latest_charge: { id: `ch_${id}`, balance_transaction: { fee: 110 } } })),
    },
  }
  return { ...actual, getStripeClient: () => client }
})

const { queueAutoTopUpChecks, runAutoTopUp, sweepAutoTopUps, updateAutoTopUpSettings } = await import('./auto-top-up.js')
const { maintenanceQueue } = await import('../jobs.js')
const { processStripeWebhookEvent } = await import('./webhooks.js')
const { syntheticEvent } = await import('./reconciliation.js')

const enabled = process.env.PULPO_BUDGET_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_budget_test') {
  throw new Error('Auto top-up tests require a migrated disposable database named pulpo_budget_test')
}
const userIds: string[] = []

async function account(balanceMicros: number, settings: { thresholdCents?: number; amountCents?: number; monthlyLimitCents?: number } = {}) {
  const id = randomUUID()
  userIds.push(id)
  await db.insert(users).values({ id, email: `${id}@example.test`, username: id, name: 'Auto top-up QA', balanceMicros })
  await db.insert(billingAccounts).values({
    userId: id,
    stripeCustomerId: `cus_${id}`,
    stripePaymentMethodId: `pm_${id}`,
    paymentMethodBrand: 'visa',
    paymentMethodLast4: '4242',
    autoTopUpEnabled: true,
    autoTopUpThresholdCents: settings.thresholdCents ?? 500,
    autoTopUpAmountCents: settings.amountCents ?? 2_500,
    autoTopUpMonthlyLimitCents: settings.monthlyLimitCents ?? 10_000,
  })
  return id
}

async function balance(userId: string) {
  return (await db.select({ balanceMicros: users.balanceMicros }).from(users).where(eq(users.id, userId)))[0]!.balanceMicros
}

async function attempts(userId: string) {
  return db.select().from(billingAutoTopUps).where(eq(billingAutoTopUps.userId, userId))
}

describe.skipIf(!enabled)('automatic top-ups in PostgreSQL', () => {
  beforeEach(() => {
    stripe.payBehavior = 'succeed'
    stripe.created = 0
    stripe.voided = []
  })
  afterAll(async () => {
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
    await queryClient.end()
  })

  it('charges the saved card below the threshold and grants credit once', async () => {
    const userId = await account(1_000_000)
    expect(await runAutoTopUp(userId)).toBe(1)
    expect(await balance(userId)).toBe(26_000_000)
    const [attempt] = await attempts(userId)
    expect(attempt).toMatchObject({ status: 'succeeded', creditCents: 2_500, chargeCents: 2_685 })
    const [order] = await db.select().from(billingOrders).where(eq(billingOrders.userId, userId))
    expect(order).toMatchObject({ billingReason: 'auto_top_up', requestedCreditCents: 2_500, grantedCreditMicros: 25_000_000, platformFeeAmountCents: 185 })
    const ledger = await db.select().from(creditLedger).where(and(eq(creditLedger.userId, userId), eq(creditLedger.type, 'credit_purchase')))
    expect(ledger).toHaveLength(1)

    // Stripe's own invoice.paid webhook and reconciliation replays must not grant again.
    const invoice = stripe.invoices.get(attempt!.stripeInvoiceId!)!
    await processStripeWebhookEvent(syntheticEvent(`evt_${randomUUID()}`, 'invoice.paid', invoice as never, Math.floor(Date.now() / 1_000)))
    expect(await balance(userId)).toBe(26_000_000)
  })

  it('queues a top-up only for accounts below their threshold', async () => {
    const low = await account(4_999_999)
    const high = await account(5_000_000)
    const unconfigured = randomUUID()
    vi.mocked(maintenanceQueue.add).mockClear()
    await queueAutoTopUpChecks([low, high, unconfigured])
    expect(vi.mocked(maintenanceQueue.add).mock.calls).toEqual([[
      'auto-top-up',
      { type: 'auto-top-up', payload: { userId: low } },
      { jobId: `auto-top-up-${low}`, removeOnComplete: true, removeOnFail: true },
    ]])
  })

  it('does not charge above the threshold', async () => {
    const userId = await account(5_000_000)
    expect(await runAutoTopUp(userId)).toBe(0)
    expect(stripe.created).toBe(0)
  })

  it('keeps topping up while the balance stays below the threshold, within the monthly limit', async () => {
    const userId = await account(-60_000_000, { amountCents: 2_500, monthlyLimitCents: 6_000 })
    // Two $26.85 charges fit in $60; a third would exceed it.
    expect(await runAutoTopUp(userId)).toBe(2)
    expect(await balance(userId)).toBe(-10_000_000)
    expect((await attempts(userId)).map((row) => row.status)).toEqual(['succeeded', 'succeeded'])
  })

  it('skips a top-up that would exceed the monthly limit', async () => {
    const userId = await account(0, { monthlyLimitCents: 10_000 })
    await db.insert(billingAutoTopUps).values({ id: randomUUID(), userId, status: 'succeeded', creditCents: 7_000, chargeCents: 7_422, stripePaymentMethodId: `pm_${userId}` })
    expect(await runAutoTopUp(userId)).toBe(0)
    expect(stripe.created).toBe(0)
  })

  it('does not count attempts from earlier months', async () => {
    const userId = await account(0, { monthlyLimitCents: 10_000 })
    const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15))
    await db.insert(billingAutoTopUps).values({ id: randomUUID(), userId, status: 'succeeded', creditCents: 7_000, chargeCents: 7_422, stripePaymentMethodId: `pm_${userId}`, createdAt: lastMonth })
    expect(await runAutoTopUp(userId)).toBe(1)
  })

  it('makes one charge when two workers race', async () => {
    stripe.payBehavior = 'slow'
    const userId = await account(0)
    const results = await Promise.all([runAutoTopUp(userId), runAutoTopUp(userId)])
    expect(results.reduce((sum, value) => sum + value, 0)).toBe(1)
    expect(await attempts(userId)).toHaveLength(1)
    expect(await balance(userId)).toBe(25_000_000)
  })

  it('turns automatic top-ups off after a declined card', async () => {
    stripe.payBehavior = 'decline'
    const userId = await account(0)
    expect(await runAutoTopUp(userId)).toBe(0)
    const [attempt] = await attempts(userId)
    expect(attempt).toMatchObject({ status: 'failed', failureCode: 'insufficient_funds' })
    expect(stripe.voided).toEqual([attempt!.stripeInvoiceId])
    const [billing] = await db.select().from(billingAccounts).where(eq(billingAccounts.userId, userId))
    expect(billing).toMatchObject({ autoTopUpEnabled: false, autoTopUpDisabledReason: 'payment_failed' })
    expect(await balance(userId)).toBe(0)

    // Saving the settings again re-enables them.
    const summary = await updateAutoTopUpSettings(userId, { enabled: true, thresholdCents: 500, amountCents: 2_500, monthlyLimitCents: 10_000 })
    expect(summary).toMatchObject({ state: 'active', enabled: true, monthSpentCents: 0 })
  })

  it('records a charge that was paid before the worker stopped', async () => {
    const userId = await account(0)
    const attemptId = randomUUID()
    const invoiceId = `in_${randomUUID()}`
    stripe.invoices.set(invoiceId, paidInvoice({
      id: invoiceId, object: 'invoice', currency: 'usd', customer: `cus_${userId}`, created: Math.floor(Date.now() / 1_000),
      parent: null, billing_reason: 'manual', item: { unit_amount: 2_685 },
      metadata: { pulpo_kind: 'auto_top_up', pulpo_user_id: userId, pulpo_auto_top_up_id: attemptId, requested_credit_cents: '2500' },
    }))
    await db.insert(billingAutoTopUps).values({
      id: attemptId, userId, status: 'processing', creditCents: 2_500, chargeCents: 2_685,
      stripePaymentMethodId: `pm_${userId}`, stripeInvoiceId: invoiceId, createdAt: new Date(Date.now() - 20 * 60 * 1_000),
    })
    await sweepAutoTopUps()
    expect((await attempts(userId))[0]?.status).toBe('succeeded')
    expect(await balance(userId)).toBe(25_000_000)
  })
})
