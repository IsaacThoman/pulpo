import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db, queryClient } from '../database/client.js'
import { autoTopUpAttempts, autoTopUpSettings, billingAccounts, billingOrders, budgetReservationFunders, budgetReservations, chats, creditLedger, models, poolMembers, pools, providerConnections, responses, users } from '../database/schema.js'
import { processAutoTopUp } from './auto-top-up-processor.js'
import { applyAutoTopUpSetup, autoTopUpSummary, topUpSpending, updateAutoTopUp } from './auto-top-up.js'
import { processStripeWebhookEvent } from './webhooks.js'

const state = vi.hoisted(() => ({ stripe: null as unknown as Stripe }))
vi.mock('./stripe.js', async original => ({ ...await original<typeof import('./stripe.js')>(), getStripeClient: () => state.stripe }))
vi.mock('./auto-top-up-queue.js', () => ({ enqueueAutoTopUps: vi.fn(), sweepAutoTopUps: vi.fn() }))
vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('../config.js', async original => {
  const config = await original<typeof import('../config.js')>()
  return { ...config, getConfig: () => ({ ...config.getConfig(), PULPO_BILLING_ENABLED: true, STRIPE_CREDIT_PRODUCT_ID: 'prod_credits' }) }
})
const enabled = process.env.PULPO_BILLING_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_billing_test') throw new Error('Billing tests require the disposable pulpo_billing_test database')
const userIds: string[] = []
const modelIds: string[] = [], providerIds: string[] = [], poolIds: string[] = []
function fixture() {
  const invoices = new Map<string, Stripe.Invoice>()
  const idempotency = new Map<string, string>()
  let tax = 0, losePayment = false, decline = false, loseCreate = false
  const stripe = {
    invoices: {
      list: vi.fn(async function* () { yield* invoices.values() }),
      create: vi.fn(async (params: Stripe.InvoiceCreateParams, options: Stripe.RequestOptions) => {
        const existing = idempotency.get(options.idempotencyKey!)
        if (existing) return structuredClone(invoices.get(existing)!)
        const id = `in_${randomUUID()}`
        const invoice = { id, customer: params.customer, currency: 'usd', status: 'draft', metadata: params.metadata,
          created: Math.floor(Date.now() / 1000), auto_advance: false, collection_method: 'charge_automatically',
          automatic_tax: { enabled: true, status: 'complete' }, lines: { data: [], has_more: false },
          subtotal: 0, total: 0, amount_due: 0, amount_paid: 0, attempted: false, total_discount_amounts: [], total_taxes: [],
          status_transitions: { paid_at: null }, parent: null,
        } as unknown as Stripe.Invoice
        invoices.set(id, invoice); idempotency.set(options.idempotencyKey!, id)
        if (loseCreate) { loseCreate = false; throw new Error('Lost creation response') }
        return structuredClone(invoice)
      }),
      retrieve: vi.fn(async (id: string) => structuredClone(invoices.get(id)!)),
      finalizeInvoice: vi.fn(async (id: string) => {
        const invoice = invoices.get(id)!; invoice.status = 'open'; invoice.amount_due = invoice.total = invoice.subtotal + tax
        invoice.total_excluding_tax = invoice.subtotal; invoice.total_taxes = [{ amount: tax }] as Stripe.Invoice.TotalTax[]
        return structuredClone(invoice)
      }),
      pay: vi.fn(async (id: string) => {
        const invoice = invoices.get(id)!; invoice.attempted = true
        if (decline) throw new Stripe.errors.StripeCardError({ message: 'Declined', code: 'card_declined' })
        invoice.status = 'paid'; invoice.amount_paid = invoice.amount_due; invoice.status_transitions.paid_at = Math.floor(Date.now() / 1000)
        if (losePayment) { losePayment = false; throw new Error('Lost payment response') }
        return structuredClone(invoice)
      }),
      voidInvoice: vi.fn(async (id: string) => { invoices.get(id)!.status = 'void'; return structuredClone(invoices.get(id)!) }),
      del: vi.fn(async (id: string) => { invoices.get(id)!.status = 'void' }),
    },
    invoiceItems: { create: vi.fn(async (params: Stripe.InvoiceItemCreateParams, options: Stripe.RequestOptions) => {
      if (idempotency.has(options.idempotencyKey!)) return
      idempotency.set(options.idempotencyKey!, 'line')
      const invoice = invoices.get(params.invoice!)!; invoice.subtotal = params.price_data!.unit_amount!
      invoice.lines.data = [{ quantity: 1, pricing: { price_details: { product: 'prod_credits' } } }] as Stripe.InvoiceLineItem[]
    }) },
    invoicePayments: { list: vi.fn(async (params: Stripe.InvoicePaymentListParams) => ({ data: [{ payment: { type: 'payment_intent', payment_intent: `pi_${params.invoice}` } }] })) },
    paymentIntents: { retrieve: vi.fn(async (id: string) => {
      const invoice = invoices.get(id.slice(3))!
      return { id, status: invoice.status === 'paid' ? 'succeeded' : 'requires_payment_method', latest_charge: { id: `ch_${invoice.id}`, amount: invoice.amount_paid, created: invoice.created, balance_transaction: { fee: 100 } } }
    }) },
    checkout: { sessions: { retrieve: vi.fn() } },
    setupIntents: { retrieve: vi.fn() }, paymentMethods: { retrieve: vi.fn() },
  }
  state.stripe = stripe as unknown as Stripe
  return { stripe, invoices, tax: (value: number) => { tax = value }, losePayment: () => { losePayment = true }, decline: () => { decline = true }, loseCreate: () => { loseCreate = true } }
}
async function account(options: { balance?: number; limit?: number } = {}) {
  const id = randomUUID(); userIds.push(id)
  await db.insert(users).values({ id, email: `${id}@example.test`, name: 'Billing QA', username: id, balanceMicros: options.balance ?? 0 })
  await db.insert(billingAccounts).values({ userId: id, stripeCustomerId: `cus_${id}` })
  await db.insert(autoTopUpSettings).values({ userId: id, enabled: true, paymentMethodId: `pm_${id}`, consentAt: new Date(), monthlyLimitCents: options.limit ?? 10000 })
  return id
}
async function attempts(id: string) { return db.select().from(autoTopUpAttempts).where(eq(autoTopUpAttempts.userId, id)) }
async function replay(invoice: Stripe.Invoice, suffix: string, type: 'invoice.paid' | 'invoice.payment_failed' = 'invoice.paid') {
  await processStripeWebhookEvent({ id: `test_${invoice.id}_${suffix}`, type, data: { object: invoice }, created: invoice.created } as Stripe.Event)
}

describe.skipIf(!enabled)('automatic top-up payments in PostgreSQL', () => {
  let f: ReturnType<typeof fixture>
  beforeEach(() => { f = fixture() })
  afterAll(async () => {
    if (userIds.length) await db.delete(chats).where(inArray(chats.userId, userIds))
    if (poolIds.length) await db.delete(pools).where(inArray(pools.id, poolIds))
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
    if (modelIds.length) await db.delete(models).where(inArray(models.id, modelIds))
    if (providerIds.length) await db.delete(providerConnections).where(inArray(providerConnections.id, providerIds))
    await queryClient.end()
  })
  it('charges and grants once with concurrent workers and webhook replays', async () => {
    const id = await account(); f.tax(200)
    await Promise.all([processAutoTopUp(id), processAutoTopUp(id)])
    const invoice = [...f.invoices.values()][0]!
    await replay(invoice, 'duplicate'); await replay(invoice, 'late_failure', 'invoice.payment_failed')
    expect(f.stripe.invoices.pay).toHaveBeenCalledTimes(1)
    expect(await attempts(id)).toMatchObject([{ status: 'succeeded', chargedCents: 2885, reservedCents: 0 }])
    expect((await db.select().from(users).where(eq(users.id, id)))[0]!.balanceMicros).toBe(25_000_000)
    expect(await db.select().from(creditLedger).where(eq(creditLedger.userId, id))).toHaveLength(1)
    expect(await db.select().from(billingOrders).where(eq(billingOrders.userId, id))).toMatchObject([{ billingReason: 'automatic_top_up', taxAmountCents: 200 }])
    expect(await autoTopUpSummary(id)).toMatchObject({ status: 'active', chargedCents: 2885 })
  })
  it('uses each pool funder’s personal available balance after reservations', async () => {
    const caller = await account({ balance: 100_000_000 }), funder = await account({ balance: 10_000_000 })
    const poolId = randomUUID(), providerId = randomUUID(), modelId = randomUUID(), chatId = randomUUID(), responseId = randomUUID(), reservationId = randomUUID()
    poolIds.push(poolId); providerIds.push(providerId); modelIds.push(modelId)
    await db.insert(providerConnections).values({ id: providerId, name: 'Billing QA', encryptedApiKey: 'test' })
    await db.insert(models).values({ id: modelId, providerConnectionId: providerId, upstreamModelId: 'test', name: 'Billing QA', contextWindow: 10000, maxOutputTokens: 1000 })
    await db.insert(chats).values({ id: chatId, userId: caller, modelId })
    await db.insert(responses).values({ id: responseId, chatId, userId: caller, modelId, input: [] })
    await db.insert(pools).values({ id: poolId, ownerUserId: caller })
    await db.insert(poolMembers).values([caller, funder].map(userId => ({ id: randomUUID(), poolId, userId })))
    await db.insert(budgetReservations).values({ id: reservationId, responseId, userId: caller, poolId, amountMicros: 6_000_000, balanceReservedMicros: 6_000_000 })
    await db.insert(budgetReservationFunders).values({ reservationId, userId: funder, reservedMicros: 6_000_000 })
    await processAutoTopUp(caller); await processAutoTopUp(funder)
    expect(await attempts(caller)).toHaveLength(0)
    expect(await attempts(funder)).toMatchObject([{ status: 'succeeded' }])
    expect(f.stripe.invoices.pay).toHaveBeenCalledTimes(1)
  })
  it('does not exhaust the connection pool with two independent workers', async () => {
    const ids = await Promise.all([account(), account()])
    await Promise.all(ids.map(id => processAutoTopUp(id)))
    expect(f.stripe.invoices.pay).toHaveBeenCalledTimes(2)
  })
  it('voids a tax-inclusive purchase that exceeds the cap and waits for reset', async () => {
    const id = await account({ limit: 2800 }); f.tax(200)
    await processAutoTopUp(id); await processAutoTopUp(id)
    expect(f.stripe.invoices.pay).not.toHaveBeenCalled()
    expect(f.stripe.invoices.create).toHaveBeenCalledTimes(1)
    expect(f.stripe.invoices.voidInvoice).toHaveBeenCalledTimes(1)
    expect(await autoTopUpSummary(id)).toMatchObject({ status: 'limit_reached', chargedCents: 0, pendingCents: 0 })
  })
  it('does not carry last month’s limit block forward when other settings are updated', async () => {
    const id = await account()
    const previousMonth = new Date(); previousMonth.setUTCDate(1); previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1)
    await db.update(autoTopUpSettings).set({ limitReachedAt: previousMonth, updatedAt: new Date() }).where(eq(autoTopUpSettings.userId, id))
    expect(await autoTopUpSummary(id)).toMatchObject({ status: 'active' })
    await processAutoTopUp(id)
    expect(f.stripe.invoices.pay).toHaveBeenCalledTimes(1)
  })
  it('permits the exact tax-inclusive limit and excludes manual purchases', async () => {
    const id = await account({ limit: 2885 }); f.tax(200)
    await db.insert(billingOrders).values({ stripePaymentId: `manual_${id}`, userId: id, stripePriceId: 'prod_credits', billingReason: 'purchase', status: 'paid', currency: 'usd', totalAmountCents: 5000, paidAt: new Date() })
    await processAutoTopUp(id)
    expect(await autoTopUpSummary(id)).toMatchObject({ chargedCents: 2885 })
    await db.update(users).set({ balanceMicros: 0 }).where(eq(users.id, id)); await processAutoTopUp(id)
    expect(f.stripe.invoices.pay).toHaveBeenCalledTimes(1)
  })
  it('recovers a lost response after Stripe accepted payment without charging again', async () => {
    const id = await account(); f.losePayment()
    await expect(processAutoTopUp(id)).rejects.toThrow('Lost payment response')
    expect(await autoTopUpSummary(id)).toMatchObject({ status: 'processing', pendingCents: 2685 })
    await processAutoTopUp(id)
    expect(f.stripe.invoices.pay).toHaveBeenCalledTimes(1)
    expect(await attempts(id)).toMatchObject([{ status: 'succeeded' }])
  })
  it('reuses the same Stripe invoice after a lost creation response', async () => {
    const id = await account(); f.loseCreate()
    await expect(processAutoTopUp(id)).rejects.toThrow('Lost creation response')
    await processAutoTopUp(id)
    expect(f.invoices.size).toBe(1); expect(f.stripe.invoices.pay).toHaveBeenCalledTimes(1)
  })
  it('reconciles an expired creation key and closes its orphan draft before a new attempt', async () => {
    const id = await account(); f.loseCreate()
    await expect(processAutoTopUp(id)).rejects.toThrow('Lost creation response')
    await db.update(autoTopUpAttempts).set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }).where(eq(autoTopUpAttempts.userId, id))
    await processAutoTopUp(id)
    expect(f.stripe.invoices.del).toHaveBeenCalledTimes(1)
    expect(f.stripe.invoices.pay).not.toHaveBeenCalled()
    expect(await attempts(id)).toMatchObject([{ status: 'canceled' }])
    await processAutoTopUp(id)
    expect(f.stripe.invoices.pay).toHaveBeenCalledTimes(1)
  })
  it('pauses a declined card and releases budget only after the invoice is void', async () => {
    const id = await account(); f.decline()
    await processAutoTopUp(id); await processAutoTopUp(id)
    expect(f.stripe.invoices.pay).toHaveBeenCalledTimes(1)
    expect(f.stripe.invoices.voidInvoice).toHaveBeenCalledTimes(1)
    expect(await autoTopUpSummary(id)).toMatchObject({ status: 'payment_issue', pendingCents: 0, chargedCents: 0 })
  })
  it('retains the reservation when a declined invoice cannot yet be voided', async () => {
    const id = await account(); f.decline()
    f.stripe.invoices.voidInvoice.mockRejectedValueOnce(new Error('Void timed out'))
    await expect(processAutoTopUp(id)).rejects.toThrow('Void timed out')
    expect(await topUpSpending(id)).toMatchObject({ pendingCents: 2685 })
    await processAutoTopUp(id)
    expect(await autoTopUpSummary(id)).toMatchObject({ status: 'payment_issue', pendingCents: 0 })
    expect(f.stripe.invoices.pay).toHaveBeenCalledTimes(1)
  })
  it('waits for a processing payment and pauses when authentication is required', async () => {
    const id = await account(); f.losePayment()
    await expect(processAutoTopUp(id)).rejects.toThrow('Lost payment response')
    const invoice = [...f.invoices.values()][0]!; invoice.status = 'open'; invoice.amount_paid = 0
    f.stripe.paymentIntents.retrieve.mockResolvedValueOnce({ id: `pi_${invoice.id}`, status: 'processing' } as never)
    await processAutoTopUp(id)
    expect(await topUpSpending(id)).toMatchObject({ pendingCents: 2685 })
    expect(f.stripe.invoices.voidInvoice).not.toHaveBeenCalled()
    f.stripe.paymentIntents.retrieve.mockResolvedValueOnce({ id: `pi_${invoice.id}`, status: 'requires_action' } as never)
    await processAutoTopUp(id)
    expect(await autoTopUpSummary(id)).toMatchObject({ status: 'payment_issue', pendingCents: 0 })
    expect(f.stripe.invoices.pay).toHaveBeenCalledTimes(1)
  })
  it('rejects modified invoice products before attempting payment', async () => {
    const id = await account()
    const finalize = f.stripe.invoices.finalizeInvoice.getMockImplementation()!
    f.stripe.invoices.finalizeInvoice.mockImplementationOnce(async invoiceId => {
      const invoice = await finalize(invoiceId)
      invoice.lines.data[0]!.pricing!.price_details!.product = 'prod_wrong'
      return invoice
    })
    await processAutoTopUp(id)
    expect(f.stripe.invoices.pay).not.toHaveBeenCalled()
    expect(await autoTopUpSummary(id)).toMatchObject({ status: 'payment_issue' })
  })
  it('rechecks balance immediately before charging', async () => {
    const id = await account()
    const finalize = f.stripe.invoices.finalizeInvoice.getMockImplementation()!
    f.stripe.invoices.finalizeInvoice.mockImplementationOnce(async invoiceId => {
      await db.update(users).set({ balanceMicros: 25_000_000 }).where(eq(users.id, id))
      return finalize(invoiceId)
    })
    await processAutoTopUp(id)
    expect(f.stripe.invoices.pay).not.toHaveBeenCalled()
    expect(await attempts(id)).toMatchObject([{ status: 'canceled', reservedCents: 0 }])
  })
  it('preserves spending after a refund and places the normal billing hold', async () => {
    const id = await account(); await processAutoTopUp(id)
    const invoice = [...f.invoices.values()][0]!
    await processStripeWebhookEvent({ id: `refund_${invoice.id}`, type: 'charge.refunded', created: invoice.created,
      data: { object: { id: `ch_${invoice.id}`, payment_intent: `pi_${invoice.id}`, amount_refunded: invoice.total, refunded: true } } } as Stripe.Event)
    expect(await topUpSpending(id)).toMatchObject({ chargedCents: 2685 })
    expect((await db.select().from(billingAccounts).where(eq(billingAccounts.userId, id)))[0]!.holdAt).not.toBeNull()
    await db.update(users).set({ balanceMicros: 0 }).where(eq(users.id, id)); await processAutoTopUp(id)
    expect(f.stripe.invoices.pay).toHaveBeenCalledTimes(1)
  })
  it('finishes a submitted payment while disabling and prevents future charges', async () => {
    const id = await account()
    let start!: () => void, release!: () => void
    const started = new Promise<void>(resolve => { start = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const pay = f.stripe.invoices.pay.getMockImplementation()!
    f.stripe.invoices.pay.mockImplementationOnce(async invoiceId => { start(); await gate; return pay(invoiceId) })
    const work = processAutoTopUp(id); await started
    const disable = updateAutoTopUp(id, { enabled: false, thresholdCents: 500, creditCents: 2500, monthlyLimitCents: 10000, revision: 0 })
    release(); await Promise.all([work, disable])
    await db.update(users).set({ balanceMicros: 0 }).where(eq(users.id, id)); await processAutoTopUp(id)
    expect(f.stripe.invoices.pay).toHaveBeenCalledTimes(1)
    expect(await autoTopUpSummary(id)).toMatchObject({ enabled: false, chargedCents: 2685 })
  })
  it('keeps unresolved reservations across UTC month rollover and rejects a lower cap', async () => {
    const id = await account(); f.losePayment()
    await expect(processAutoTopUp(id)).rejects.toThrow()
    await db.update(autoTopUpAttempts).set({ createdAt: new Date('2026-08-31T23:59:59Z') }).where(eq(autoTopUpAttempts.userId, id))
    expect(await topUpSpending(id, db, new Date('2026-10-01T00:00:00Z'))).toMatchObject({ chargedCents: 0, pendingCents: 2685 })
    await expect(updateAutoTopUp(id, { enabled: true, thresholdCents: 500, creditCents: 500, monthlyLimitCents: 2000, revision: 0 })).rejects.toMatchObject({ code: 'auto_top_up_limit_too_low' })
  })
  it('does not charge disabled, held, blocked, or sufficiently funded accounts', async () => {
    const funded = await account({ balance: 5_000_000 }), disabled = await account(), held = await account(), blocked = await account()
    await db.update(autoTopUpSettings).set({ enabled: false }).where(eq(autoTopUpSettings.userId, disabled))
    await db.update(billingAccounts).set({ holdAt: new Date() }).where(eq(billingAccounts.userId, held))
    await db.update(users).set({ blocked: true }).where(eq(users.id, blocked))
    for (const id of [funded, disabled, held, blocked]) await processAutoTopUp(id)
    expect(f.stripe.invoices.create).not.toHaveBeenCalled()
  })
  it('requires explicit consent and resume and rejects stale settings', async () => {
    const id = await account(); await db.update(autoTopUpSettings).set({ pausedReason: 'payment_failed', enabled: false }).where(eq(autoTopUpSettings.userId, id))
    const settings = { enabled: true, thresholdCents: 500, creditCents: 2500, monthlyLimitCents: 10000, revision: 0 }
    await expect(updateAutoTopUp(id, settings)).rejects.toMatchObject({ code: 'auto_top_up_consent_required' })
    expect(await updateAutoTopUp(id, { ...settings, consent: true })).toMatchObject({ status: 'payment_issue' })
    await expect(updateAutoTopUp(id, { ...settings, consent: true })).rejects.toMatchObject({ code: 'auto_top_up_changed' })
    expect(await updateAutoTopUp(id, { ...settings, revision: 1, consent: true, resume: true })).toMatchObject({ status: 'active' })
  })
  it('ignores stale setup sessions and verifies card ownership before activation', async () => {
    const id = await account(), setupId = randomUUID()
    await db.update(autoTopUpSettings).set({ enabled: false, paymentMethodId: null, setupId, setupEnable: true }).where(eq(autoTopUpSettings.userId, id))
    const session = { mode: 'setup', status: 'complete', metadata: { pulpo_auto_top_up_setup: randomUUID(), pulpo_user_id: id }, customer: `cus_${id}`, setup_intent: 'seti_test' } as unknown as Stripe.Checkout.Session
    await db.transaction(tx => applyAutoTopUpSetup(tx, session, new Set()))
    expect((await autoTopUpSummary(id)).enabled).toBe(false)
    session.metadata!.pulpo_auto_top_up_setup = setupId
    f.stripe.setupIntents.retrieve.mockResolvedValue({ status: 'succeeded', usage: 'off_session', customer: `cus_${id}`, payment_method: 'pm_test' })
    f.stripe.paymentMethods.retrieve.mockResolvedValue({ id: 'pm_test', customer: 'cus_other', card: {}, billing_details: { address: { country: 'US' } } })
    await expect(db.transaction(tx => applyAutoTopUpSetup(tx, session, new Set()))).rejects.toThrow('A card and billing address')
    f.stripe.paymentMethods.retrieve.mockResolvedValue({ id: 'pm_test', customer: `cus_${id}`, card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 }, billing_details: { address: { country: 'US' } } })
    await db.transaction(tx => applyAutoTopUpSetup(tx, session, new Set()))
    expect(await autoTopUpSummary(id)).toMatchObject({ enabled: true, card: { last4: '4242' } })
    await db.transaction(tx => applyAutoTopUpSetup(tx, session, new Set()))
    expect((await autoTopUpSummary(id)).revision).toBe(1)
  })
  it('does not let card replacement silently resume a paused account', async () => {
    const id = await account(), setupId = randomUUID()
    await db.update(autoTopUpSettings).set({ setupId, setupEnable: false, pausedReason: 'payment_failed' }).where(eq(autoTopUpSettings.userId, id))
    const session = { mode: 'setup', status: 'complete', metadata: { pulpo_auto_top_up_setup: setupId, pulpo_user_id: id }, customer: `cus_${id}`,
      setup_intent: { status: 'succeeded', usage: 'off_session', customer: `cus_${id}`, payment_method: {
        id: 'pm_new', customer: `cus_${id}`, card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 }, billing_details: { address: { country: 'US' } },
      } },
    } as unknown as Stripe.Checkout.Session
    await db.transaction(tx => applyAutoTopUpSetup(tx, session, new Set()))
    expect(await autoTopUpSummary(id)).toMatchObject({ enabled: true, status: 'payment_issue' })
  })

})
