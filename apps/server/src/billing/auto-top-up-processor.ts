import Stripe from 'stripe'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '../database/schema.js'
import { db, queryClient } from '../database/client.js'
import { autoTopUpAttempts, autoTopUpSettings, billingAccounts, users } from '../database/schema.js'
import { getConfig } from '../config.js'
import { newId } from '../lib/ids.js'
import { pendingFundingByUser } from '../pools/service.js'
import { getStripeClient } from './stripe.js'
import { chargeCentsForCredits } from './plans.js'
import { ACTIVE_TOP_UP_STATUSES, belowTopUpThreshold, topUpFits, utcMonth } from './auto-top-up-policy.js'
import { notifyAutoTopUp, topUpLockKey, topUpSpending } from './auto-top-up.js'

// postgres.js reserved connections lack the driver's transaction helper. Explicit
// BEGIN/COMMIT keeps the user lock on the same session as the advisory lock.
async function reservedTransaction<T>(store: typeof db, operation: () => Promise<T>): Promise<T> {
  await store.execute(sql`begin`)
  try {
    const result = await operation()
    await store.execute(sql`commit`)
    return result
  } catch (error) {
    await store.execute(sql`rollback`)
    throw error
  }
}

type Attempt = typeof autoTopUpAttempts.$inferSelect
const idOf = (value: string | { id: string } | null | undefined) => typeof value === 'string' ? value : value?.id

// Never recreate a possibly successful external operation after Stripe's 24-hour
// idempotency retention window. Reconciliation must resolve it first.
function retryOptions(attempt: Attempt, step: string) {
  if (Date.now() - attempt.createdAt.getTime() > 23 * 60 * 60 * 1000) throw new Error(`Automatic top-up ${attempt.id} requires reconciliation before retrying ${step}`)
  return { idempotencyKey: `auto-top-up-${attempt.id}-${step}` }
}
async function saveAttempt(store: typeof db, attempt: Attempt, patch: Partial<Attempt>) {
  await store.update(autoTopUpAttempts).set({ ...patch, updatedAt: new Date() }).where(eq(autoTopUpAttempts.id, attempt.id))
  Object.assign(attempt, patch)
}
async function closeAttempt(store: typeof db, attempt: Attempt, stripe: Stripe, reason: string, failed = false) {
  if (attempt.invoiceId) {
    const invoice = await stripe.invoices.retrieve(attempt.invoiceId)
    if (invoice.status === 'paid') return invoice
    if (invoice.status === 'draft') await stripe.invoices.del(invoice.id)
    else if (invoice.status === 'open' || invoice.status === 'uncollectible') await stripe.invoices.voidInvoice(invoice.id)
    else if (invoice.status !== 'void') throw new Error('Invoice could not be closed')
  }
  // Release only after Stripe can no longer collect this invoice.
  await saveAttempt(store, attempt, { status: failed ? 'failed' : 'canceled', reservedCents: 0, failureReason: reason })
  if (failed) await store.update(autoTopUpSettings).set({ pausedReason: reason, updatedAt: new Date() }).where(eq(autoTopUpSettings.userId, attempt.userId))
  return null
}
export function validateAutoTopUpInvoice(attempt: Attempt, invoice: Stripe.Invoice) {
  if (invoice.id !== attempt.invoiceId || idOf(invoice.customer) !== attempt.customerId || invoice.currency !== 'usd'
    || invoice.metadata?.pulpo_auto_top_up_attempt !== attempt.id || invoice.metadata.pulpo_user_id !== attempt.userId
    || invoice.subtotal !== attempt.chargeCents || invoice.total_discount_amounts?.some(d => d.amount !== 0)
    || invoice.lines.data[0]?.pricing?.price_details?.product !== getConfig().STRIPE_CREDIT_PRODUCT_ID
    || invoice.lines.data.length !== 1 || invoice.lines.has_more || invoice.lines.data[0]?.quantity !== 1
    || invoice.auto_advance || invoice.collection_method !== 'charge_automatically'
    || !invoice.automatic_tax.enabled || invoice.automatic_tax.status !== 'complete'
    || invoice.amount_due > invoice.total
    || invoice.amount_due < 0 || invoice.amount_due > 2_147_483_647) throw new Error(`Unexpected automatic top-up invoice ${invoice.id}`)
}
async function processLocked(store: typeof db, userId: string, stripe: Stripe): Promise<Stripe.Invoice | null> {
  let [attempt] = await store.select().from(autoTopUpAttempts).where(and(eq(autoTopUpAttempts.userId, userId), inArray(autoTopUpAttempts.status, ACTIVE_TOP_UP_STATUSES)))
  const [settings] = await store.select().from(autoTopUpSettings).where(eq(autoTopUpSettings.userId, userId))
  const [account] = await store.select().from(billingAccounts).where(eq(billingAccounts.userId, userId))
  const [user] = await store.select().from(users).where(eq(users.id, userId))
  const eligible = user && !user.blocked && !user.deletionRequestedAt && settings?.enabled && !settings.pausedReason
    && settings.paymentMethodId && account?.stripeCustomerId && !(account.holdAt && !account.holdClearedAt)
  if (!attempt) {
    if (!eligible || (settings.limitReachedAt && settings.limitReachedAt >= utcMonth().start)) return null
    const pending = await pendingFundingByUser(store, [userId])
    if (!belowTopUpThreshold(user.balanceMicros, pending.get(userId) ?? 0, settings.thresholdCents)) return null
    const spending = await topUpSpending(userId, store)
    const chargeCents = chargeCentsForCredits(settings.creditCents)
    if (!topUpFits(settings.monthlyLimitCents, spending.chargedCents, spending.pendingCents, chargeCents)) {
      await store.update(autoTopUpSettings).set({ limitReachedAt: new Date(), updatedAt: new Date() }).where(eq(autoTopUpSettings.userId, userId))
      return null
    }
    const rows = await store.insert(autoTopUpAttempts).values({ id: newId(), userId, settingsRevision: settings.revision,
      customerId: account.stripeCustomerId!, paymentMethodId: settings.paymentMethodId!, creditCents: settings.creditCents, chargeCents,
    }).returning()
    attempt = rows[0]!
  }
  if (!attempt.invoiceId && Date.now() - attempt.createdAt.getTime() > 23 * 60 * 60 * 1000) {
    // Reconcile by metadata before Stripe can evict the original creation key.
    // Listing is authoritative; search indexing is eventually consistent.
    for await (const candidate of stripe.invoices.list({ customer: attempt.customerId, created: { gte: Math.floor(attempt.createdAt.getTime() / 1000) - 60 }, limit: 100 })) {
      if (candidate.metadata?.pulpo_auto_top_up_attempt === attempt.id) {
        await saveAttempt(store, attempt, { invoiceId: candidate.id })
        break
      }
    }
    if (!attempt.invoiceId) return closeAttempt(store, attempt, stripe, 'expired_creation')
  }
  let invoice = attempt.invoiceId ? await stripe.invoices.retrieve(attempt.invoiceId) : null
  if (invoice?.status === 'paid') return invoice
  if (invoice && !invoice.attempted && Date.now() - attempt.createdAt.getTime() > 23 * 60 * 60 * 1000) return closeAttempt(store, attempt, stripe, 'expired_attempt')
  // Once submitted, an unknown result keeps its reservation even if settings change.
  if (!eligible || (attempt.status !== 'paying' && settings.revision !== attempt.settingsRevision)) return closeAttempt(store, attempt, stripe, 'settings_changed')
  if (invoice?.status === 'void' || invoice?.status === 'uncollectible') return closeAttempt(store, attempt, stripe, 'payment_failed', true)
  if (!invoice) {
    invoice = await reservedTransaction(store, async () => {
      const [liveUser] = await store.select().from(users).where(eq(users.id, userId)).for('share')
      if (!liveUser || liveUser.blocked || liveUser.deletionRequestedAt) return null
      // Deletion waits for resource creation, then its Stripe cleanup can see it.
      // The attempt ID predates this transaction, so a crash can recover by key.
      const created = await stripe.invoices.create({ customer: attempt.customerId, currency: 'usd', collection_method: 'charge_automatically',
        auto_advance: false, automatic_tax: { enabled: true }, pending_invoice_items_behavior: 'exclude', discounts: '',
        default_payment_method: attempt.paymentMethodId, payment_settings: { payment_method_types: ['card'] },
        metadata: { pulpo_auto_top_up_attempt: attempt.id, pulpo_user_id: userId, requested_credit_cents: String(attempt.creditCents) },
      }, retryOptions(attempt, 'invoice'))
      await saveAttempt(store, attempt, { invoiceId: created.id })
      return created
    })
    if (!invoice) return closeAttempt(store, attempt, stripe, 'account_unavailable')
  }
  if (invoice.status === 'draft') {
    // Explicit invoice binding prevents this line from leaking onto subscriptions.
    await stripe.invoiceItems.create({ customer: attempt.customerId, invoice: invoice.id, quantity: 1,
      price_data: { currency: 'usd', product: getConfig().STRIPE_CREDIT_PRODUCT_ID!, unit_amount: attempt.chargeCents, tax_behavior: 'exclusive' },
      discountable: false,
    }, retryOptions(attempt, 'line'))
    try {
      invoice = await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false }, retryOptions(attempt, 'finalize'))
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError) return closeAttempt(store, attempt, stripe, 'billing_address_required', true)
      throw error
    }
  }
  try { validateAutoTopUpInvoice(attempt, invoice) } catch { return closeAttempt(store, attempt, stripe, 'invoice_validation_failed', true) }
  if (attempt.status !== 'paying') {
    const spending = await topUpSpending(userId, store)
    if (!settings || !topUpFits(settings.monthlyLimitCents, spending.chargedCents, spending.pendingCents - attempt.reservedCents, invoice.amount_due)) {
      await store.update(autoTopUpSettings).set({ limitReachedAt: new Date(), updatedAt: new Date() }).where(eq(autoTopUpSettings.userId, userId))
      return closeAttempt(store, attempt, stripe, 'monthly_limit')
    }
    await saveAttempt(store, attempt, { status: 'ready', reservedCents: invoice.amount_due })
  }
  if (invoice.status !== 'open') throw new Error(`Unexpected invoice status ${invoice.status}`)
  // A prior bank decline must never be retried by the recovery sweep.
  if (invoice.attempted) {
    const payments = await stripe.invoicePayments.list({ invoice: invoice.id, limit: 10 })
    const payment = payments.data.find(item => item.payment.type === 'payment_intent')?.payment.payment_intent
    const intent = typeof payment === 'string' ? await stripe.paymentIntents.retrieve(payment) : payment
    // Processing and successful intents may precede invoice.paid. Keep the cap
    // reserved while Stripe completes them, rather than voiding a pending charge.
    if (intent && ['processing', 'succeeded', 'requires_capture'].includes(intent.status)) return null
    if (intent && ['requires_action', 'requires_payment_method', 'canceled'].includes(intent.status)) return closeAttempt(store, attempt, stripe, 'payment_failed', true)
    throw new Error(`Automatic top-up ${attempt.id} has an unresolved payment`)
  }
  // Persist the commitment before calling Stripe. It survives process failure.
  await saveAttempt(store, attempt, { status: 'paying' })
  let failed = false
  let canceled = false
  const result = await reservedTransaction(store, async () => {
    // Coordinate with account deletion/blocking through the existing user lock.
    const [liveUser] = await store.select().from(users).where(eq(users.id, userId)).for('share')
    const [liveAccount] = await store.select().from(billingAccounts).where(eq(billingAccounts.userId, userId)).for('share')
    const [liveSettings] = await store.select().from(autoTopUpSettings).where(eq(autoTopUpSettings.userId, userId)).for('share')
    const pending = await pendingFundingByUser(store, [userId])
    if (!liveUser || liveUser.blocked || liveUser.deletionRequestedAt || liveAccount?.stripeCustomerId !== attempt.customerId || (liveAccount?.holdAt && !liveAccount.holdClearedAt)
      || !liveSettings?.enabled || liveSettings.pausedReason || liveSettings.revision !== attempt.settingsRevision
      || !belowTopUpThreshold(liveUser.balanceMicros, pending.get(userId) ?? 0, liveSettings.thresholdCents)) { canceled = true; return null }
    try {
      return await stripe.invoices.pay(invoice.id, { off_session: true, payment_method: attempt.paymentMethodId }, retryOptions(attempt, 'pay'))
    } catch (error) {
      if (error instanceof Stripe.errors.StripeCardError || (error instanceof Stripe.errors.StripeInvalidRequestError && ['resource_missing', 'payment_method_unexpected_state'].includes(error.code ?? ''))) { failed = true; return null }
      throw error
    }
  })
  if (canceled) return closeAttempt(store, attempt, stripe, 'eligibility_changed')
  if (failed) return closeAttempt(store, attempt, stripe, 'payment_failed', true)
  return result
}
export async function processAutoTopUp(userId: string, stripe?: Stripe) {
  if (!getConfig().PULPO_BILLING_ENABLED) return
  stripe ??= getStripeClient()
  const [setup] = await db.select().from(autoTopUpSettings).where(eq(autoTopUpSettings.userId, userId))
  if (setup?.setupSessionId) {
    const session = await stripe.checkout.sessions.retrieve(setup.setupSessionId)
    if (session.status === 'complete') {
      const { processStripeWebhookEvent } = await import('./webhooks.js')
      await processStripeWebhookEvent({ object: 'event', api_version: null, livemode: session.livemode, pending_webhooks: 0, request: null, id: `auto-top-up-setup:${session.id}`, type: 'checkout.session.completed', created: session.created, data: { object: session } } as Stripe.Event)
    } else if (session.status === 'expired') {
      await db.update(autoTopUpSettings).set({ setupId: null, setupSessionId: null, setupEnable: false }).where(and(eq(autoTopUpSettings.userId, userId), eq(autoTopUpSettings.setupSessionId, session.id)))
    }
  }
  // A session lock spans durable commits and external calls. Competing workers
  // skip rather than occupying every connection while waiting for this lock.
  const connection = await queryClient.reserve()
  let acquired = false
  let paid: Stripe.Invoice | null = null
  try {
    const [row] = await connection`select pg_try_advisory_lock(hashtext(${topUpLockKey(userId)})) as acquired`
    acquired = row?.acquired === true
    if (!acquired) return
    paid = await processLocked(drizzle(Object.assign(connection, { options: queryClient.options }), { schema }), userId, stripe)
  } finally {
    try { if (acquired) await connection`select pg_advisory_unlock(hashtext(${topUpLockKey(userId)}))` } finally { connection.release() }
  }
  if (paid?.status === 'paid') {
    const { processStripeWebhookEvent } = await import('./webhooks.js')
    await processStripeWebhookEvent({ id: `auto-top-up:${paid.id}:paid`, type: 'invoice.paid', created: Math.floor(Date.now() / 1000), data: { object: paid } } as Stripe.Event)
  }
  await notifyAutoTopUp(userId)
}
