import Stripe from 'stripe'
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { billingAccounts, billingAutoTopUps, users } from '../database/schema.js'
import { bumpAccountRevisions, publishScopedStateChanges } from '../friends/sync.js'
import { newId } from '../lib/ids.js'
import { pendingFundingByUser, type Transaction } from '../pools/service.js'
import { availableAccountBalanceMicros } from './allocation.js'
import { failAutoTopUpAttempt } from './auto-top-up-state.js'
import {
  autoTopUpDecision,
  autoTopUpState,
  chargeCentsForCredits,
  utcMonthEnd,
  utcMonthStart,
  type AutoTopUpState,
} from './plans.js'
import { syntheticEvent } from './reconciliation.js'
import { getStripeClient, isMissingStripeResource } from './stripe.js'
import { processStripeWebhookEvent } from './webhooks.js'

/** Attempts still processing after this long are resolved by the sweep. */
const STALE_ATTEMPT_MS = 10 * 60 * 1_000
/** Back-to-back top-ups per job, for balances that are still below the threshold. */
const MAX_TOP_UPS_PER_RUN = 5

type Attempt = {
  id: string
  userId: string
  creditCents: number
  chargeCents: number
  stripePaymentMethodId: string
  stripeCustomerId: string
}

export type AutoTopUpSummary = {
  enabled: boolean
  state: AutoTopUpState
  thresholdCents: number | null
  amountCents: number | null
  monthlyLimitCents: number | null
  monthSpentCents: number
  monthResetsAt: string
  paymentMethod: { brand: string | null; last4: string | null } | null
  lastAttempt: {
    status: string
    creditCents: number
    failureMessage: string | null
    createdAt: string
  } | null
}

function log(level: 'warn' | 'error', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, service: 'pulpo-billing', event, ...fields })
  if (level === 'error') console.error(line)
  else console.warn(line)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000)
}

async function monthSpentCents(tx: Transaction, userId: string, now: Date): Promise<number> {
  const [row] = await tx.select({ total: sql<number>`coalesce(sum(${billingAutoTopUps.chargeCents}), 0)::int` })
    .from(billingAutoTopUps).where(and(
      eq(billingAutoTopUps.userId, userId),
      inArray(billingAutoTopUps.status, ['processing', 'succeeded']),
      gte(billingAutoTopUps.createdAt, utcMonthStart(now)),
    ))
  return Number(row?.total ?? 0)
}

function isOnHold(account: { holdAt: Date | null; holdClearedAt: Date | null }): boolean {
  return Boolean(account.holdAt && !account.holdClearedAt)
}

/** Users among `userIds` whose balance is below their threshold and who can be charged now. */
async function dueAutoTopUpUsers(tx: Transaction, userIds: string[], now: Date): Promise<string[]> {
  if (!userIds.length) return []
  const rows = await tx.select({
    userId: users.id,
    balanceMicros: users.balanceMicros,
    blocked: users.blocked,
    deletionRequestedAt: users.deletionRequestedAt,
    account: billingAccounts,
  }).from(users).innerJoin(billingAccounts, eq(billingAccounts.userId, users.id)).where(and(
    inArray(users.id, userIds),
    eq(billingAccounts.autoTopUpEnabled, true),
    isNotNull(billingAccounts.stripePaymentMethodId),
  ))
  const candidates = rows.filter((row) => !row.blocked && !row.deletionRequestedAt
    && row.account.autoTopUpThresholdCents !== null
    && row.balanceMicros < row.account.autoTopUpThresholdCents * 10_000)
  if (!candidates.length) return []
  const pending = await pendingFundingByUser(tx, candidates.map((row) => row.userId))
  const due: string[] = []
  for (const row of candidates) {
    const decision = autoTopUpDecision({
      enabled: row.account.autoTopUpEnabled,
      hasPaymentMethod: Boolean(row.account.stripePaymentMethodId),
      onHold: isOnHold(row.account),
      availableMicros: availableAccountBalanceMicros({ balanceMicros: row.balanceMicros, pendingBalanceMicros: pending.get(row.userId) ?? 0 }),
      thresholdCents: row.account.autoTopUpThresholdCents,
      amountCents: row.account.autoTopUpAmountCents,
      monthlyLimitCents: row.account.autoTopUpMonthlyLimitCents,
      monthSpentCents: await monthSpentCents(tx, row.userId, now),
    })
    if (decision === 'charge') due.push(row.userId)
  }
  return due
}

async function enqueueAutoTopUps(userIds: string[]): Promise<void> {
  if (!userIds.length) return
  // Imported lazily so request paths that never top up do not open a queue connection.
  const { maintenanceQueue } = await import('../jobs.js')
  await Promise.all(userIds.map((userId) => maintenanceQueue.add('auto-top-up', {
    type: 'auto-top-up',
    payload: { userId },
  }, { jobId: `auto-top-up-${userId}`, removeOnComplete: true, removeOnFail: true })))
}

/**
 * Queues an automatic top-up for each user whose balance fell below their threshold.
 * Called after balances drop; never throws so billing checks cannot fail a request.
 */
export async function queueAutoTopUpChecks(userIds: Iterable<string>): Promise<void> {
  if (!getConfig().PULPO_BILLING_ENABLED) return
  const ids = [...new Set(userIds)]
  if (!ids.length) return
  try {
    const due = await db.transaction((tx) => dueAutoTopUpUsers(tx, ids, new Date()))
    await enqueueAutoTopUps(due)
  } catch (error) {
    log('warn', 'auto_top_up.queue_failed', { userIds: ids, error: errorMessage(error) })
  }
}

async function publishBillingChange(userId: string): Promise<void> {
  const changes = await db.transaction((tx) => bumpAccountRevisions(tx, [userId]))
  await publishScopedStateChanges(changes, ['billing', 'usage'])
}

async function startAttempt(userId: string, now: Date): Promise<Attempt | null> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ balanceMicros: users.balanceMicros, blocked: users.blocked, deletionRequestedAt: users.deletionRequestedAt })
      .from(users).where(eq(users.id, userId)).limit(1)
    if (!user || user.blocked || user.deletionRequestedAt) return null
    // Serializes attempts per user; the partial unique index backs this up across workers.
    const [account] = await tx.select().from(billingAccounts).where(eq(billingAccounts.userId, userId)).for('update')
    if (!account?.stripeCustomerId || !account.stripePaymentMethodId || !account.autoTopUpAmountCents) return null
    const [inFlight] = await tx.select({ id: billingAutoTopUps.id }).from(billingAutoTopUps)
      .where(and(eq(billingAutoTopUps.userId, userId), eq(billingAutoTopUps.status, 'processing'))).limit(1)
    if (inFlight) return null
    const pending = await pendingFundingByUser(tx, [userId])
    const decision = autoTopUpDecision({
      enabled: account.autoTopUpEnabled,
      hasPaymentMethod: true,
      onHold: isOnHold(account),
      availableMicros: availableAccountBalanceMicros({ balanceMicros: user.balanceMicros, pendingBalanceMicros: pending.get(userId) ?? 0 }),
      thresholdCents: account.autoTopUpThresholdCents,
      amountCents: account.autoTopUpAmountCents,
      monthlyLimitCents: account.autoTopUpMonthlyLimitCents,
      monthSpentCents: await monthSpentCents(tx, userId, now),
    })
    if (decision !== 'charge') return null
    const attempt = {
      id: newId(),
      userId,
      creditCents: account.autoTopUpAmountCents,
      chargeCents: chargeCentsForCredits(account.autoTopUpAmountCents),
      stripePaymentMethodId: account.stripePaymentMethodId,
    }
    const [inserted] = await tx.insert(billingAutoTopUps).values(attempt).onConflictDoNothing().returning({ id: billingAutoTopUps.id })
    return inserted ? { ...attempt, stripeCustomerId: account.stripeCustomerId } : null
  })
}

/** Card declines and invalid requests end the attempt; outages leave it for the sweep. */
export function isTerminalStripeFailure(error: unknown): boolean {
  if (!(error instanceof Stripe.errors.StripeError)) return false
  if (error instanceof Stripe.errors.StripeCardError) return true
  if (error instanceof Stripe.errors.StripeIdempotencyError || error instanceof Stripe.errors.StripeRateLimitError) return false
  return error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500
}

function customerFacingFailure(error: unknown): { code: string; message: string } {
  if (error instanceof Stripe.errors.StripeError) {
    return {
      code: error.decline_code ?? error.code ?? 'stripe_error',
      message: error instanceof Stripe.errors.StripeCardError
        ? error.message || 'Your card was declined.'
        : 'Stripe could not charge the saved card.',
    }
  }
  return { code: 'payment_failed', message: 'The saved card could not be charged.' }
}

async function voidOpenInvoice(stripe: Stripe, invoiceId: string): Promise<void> {
  try {
    const invoice = await stripe.invoices.retrieve(invoiceId)
    if (invoice.status === 'open') await stripe.invoices.voidInvoice(invoiceId)
    else if (invoice.status === 'draft') await stripe.invoices.del(invoiceId)
  } catch (error) {
    log('warn', 'auto_top_up.void_failed', { invoiceId, error: errorMessage(error) })
  }
}

async function recordPaidInvoice(invoice: Stripe.Invoice): Promise<void> {
  const paidAt = invoice.status_transitions.paid_at ?? Math.floor(Date.now() / 1_000)
  await processStripeWebhookEvent(syntheticEvent(`auto-top-up:invoice:${invoice.id}:paid`, 'invoice.paid', invoice, paidAt))
}

async function chargeAttempt(attempt: Attempt): Promise<boolean> {
  const stripe = getStripeClient()
  const productId = getConfig().STRIPE_CREDIT_PRODUCT_ID!
  const metadata = {
    pulpo_kind: 'auto_top_up',
    pulpo_user_id: attempt.userId,
    pulpo_auto_top_up_id: attempt.id,
    requested_credit_cents: String(attempt.creditCents),
  }
  const key = (step: string) => `pulpo-auto-top-up-${attempt.id}-${step}`
  let invoiceId: string | null = null
  try {
    const invoice = await stripe.invoices.create({
      customer: attempt.stripeCustomerId,
      currency: 'usd',
      collection_method: 'charge_automatically',
      // Stripe must never retry the charge on its own; each attempt is ours to make.
      auto_advance: false,
      automatic_tax: { enabled: true },
      default_payment_method: attempt.stripePaymentMethodId,
      pending_invoice_items_behavior: 'exclude',
      description: 'Pulpo automatic credit top-up',
      metadata,
    }, { idempotencyKey: key('invoice') })
    invoiceId = invoice.id
    await db.update(billingAutoTopUps).set({ stripeInvoiceId: invoice.id, updatedAt: new Date() })
      .where(eq(billingAutoTopUps.id, attempt.id))
    await stripe.invoiceItems.create({
      customer: attempt.stripeCustomerId,
      invoice: invoice.id,
      price_data: {
        currency: 'usd',
        product: productId,
        unit_amount: attempt.chargeCents,
        tax_behavior: 'exclusive',
      },
      metadata,
    }, { idempotencyKey: key('item') })
    await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false }, { idempotencyKey: key('finalize') })
    const paid = await stripe.invoices.pay(invoice.id, {
      off_session: true,
      payment_method: attempt.stripePaymentMethodId,
    }, { idempotencyKey: key('pay') })
    if (paid.status !== 'paid') throw new Error(`Automatic top-up invoice ${paid.id} is ${paid.status}`)
    await recordPaidInvoice(paid)
    return true
  } catch (error) {
    if (!isTerminalStripeFailure(error)) {
      log('error', 'auto_top_up.charge_interrupted', { attemptId: attempt.id, userId: attempt.userId, invoiceId, error: errorMessage(error) })
      throw error
    }
    if (invoiceId) await voidOpenInvoice(stripe, invoiceId)
    const failure = customerFacingFailure(error)
    log('warn', 'auto_top_up.charge_failed', { attemptId: attempt.id, userId: attempt.userId, invoiceId, code: failure.code })
    const failedUserId = await db.transaction((tx) => failAutoTopUpAttempt(tx, { attemptId: attempt.id, ...failure }))
    if (failedUserId) await publishBillingChange(failedUserId)
    return false
  }
}

/** Charges the saved card while the user's balance stays below their threshold. */
export async function runAutoTopUp(userId: string): Promise<number> {
  if (!getConfig().PULPO_BILLING_ENABLED) return 0
  let charged = 0
  for (let index = 0; index < MAX_TOP_UPS_PER_RUN; index += 1) {
    const attempt = await startAttempt(userId, new Date())
    if (!attempt) break
    if (!await chargeAttempt(attempt)) break
    charged += 1
  }
  return charged
}

async function findAttemptInvoice(stripe: Stripe, attemptId: string): Promise<Stripe.Invoice | null> {
  const result = await stripe.invoices.search({ query: `metadata['pulpo_auto_top_up_id']:'${attemptId}'`, limit: 1 })
  return result.data[0] ?? null
}

/** Settles attempts whose worker stopped before the charge finished. */
async function resolveStaleAttempts(now: Date): Promise<void> {
  const stale = await db.select().from(billingAutoTopUps).where(and(
    eq(billingAutoTopUps.status, 'processing'),
    lt(billingAutoTopUps.createdAt, new Date(now.getTime() - STALE_ATTEMPT_MS)),
  )).limit(100)
  if (!stale.length) return
  const stripe = getStripeClient()
  for (const attempt of stale) {
    try {
      const invoice = attempt.stripeInvoiceId
        ? await stripe.invoices.retrieve(attempt.stripeInvoiceId).catch((error) => {
          if (isMissingStripeResource(error)) return null
          throw error
        })
        : await findAttemptInvoice(stripe, attempt.id)
      if (invoice?.status === 'paid') {
        await recordPaidInvoice(invoice)
        continue
      }
      if (invoice) await voidOpenInvoice(stripe, invoice.id)
      // The card was never charged, so leave automatic top-ups on for the next check.
      const userId = await db.transaction((tx) => failAutoTopUpAttempt(tx, {
        attemptId: attempt.id,
        code: 'charge_interrupted',
        message: 'The automatic top-up was interrupted before the card was charged.',
        disable: false,
      }))
      if (userId) await publishBillingChange(userId)
    } catch (error) {
      log('error', 'auto_top_up.resolve_failed', { attemptId: attempt.id, error: errorMessage(error) })
    }
  }
}

/** Periodic safety net for missed balance checks and interrupted charges. */
export async function sweepAutoTopUps(now = new Date()): Promise<void> {
  if (!getConfig().PULPO_BILLING_ENABLED) return
  await resolveStaleAttempts(now)
  const enabled = await db.select({ userId: billingAccounts.userId }).from(billingAccounts).where(and(
    eq(billingAccounts.autoTopUpEnabled, true),
    isNotNull(billingAccounts.stripePaymentMethodId),
  ))
  for (let index = 0; index < enabled.length; index += 500) {
    const ids = enabled.slice(index, index + 500).map((row) => row.userId)
    await enqueueAutoTopUps(await db.transaction((tx) => dueAutoTopUpUsers(tx, ids, now)))
  }
}

export async function getAutoTopUpSummary(userId: string, now = new Date()): Promise<AutoTopUpSummary> {
  return db.transaction(async (tx) => {
    const [[account], [lastAttempt], spentCents] = await Promise.all([
      tx.select().from(billingAccounts).where(eq(billingAccounts.userId, userId)).limit(1),
      tx.select().from(billingAutoTopUps).where(eq(billingAutoTopUps.userId, userId))
        .orderBy(desc(billingAutoTopUps.createdAt)).limit(1),
      monthSpentCents(tx, userId, now),
    ])
    const hasPaymentMethod = Boolean(account?.stripePaymentMethodId)
    return {
      enabled: account?.autoTopUpEnabled ?? false,
      state: autoTopUpState({
        enabled: account?.autoTopUpEnabled ?? false,
        hasPaymentMethod,
        disabledReason: account?.autoTopUpDisabledReason ?? null,
        amountCents: account?.autoTopUpAmountCents ?? null,
        monthlyLimitCents: account?.autoTopUpMonthlyLimitCents ?? null,
        monthSpentCents: spentCents,
      }),
      thresholdCents: account?.autoTopUpThresholdCents ?? null,
      amountCents: account?.autoTopUpAmountCents ?? null,
      monthlyLimitCents: account?.autoTopUpMonthlyLimitCents ?? null,
      monthSpentCents: spentCents,
      monthResetsAt: utcMonthEnd(now).toISOString(),
      paymentMethod: hasPaymentMethod
        ? { brand: account?.paymentMethodBrand ?? null, last4: account?.paymentMethodLast4 ?? null }
        : null,
      lastAttempt: lastAttempt ? {
        status: lastAttempt.status,
        creditCents: lastAttempt.creditCents,
        failureMessage: lastAttempt.failureMessage,
        createdAt: lastAttempt.createdAt.toISOString(),
      } : null,
    }
  })
}

export async function updateAutoTopUpSettings(userId: string, input: {
  enabled: boolean
  thresholdCents: number
  amountCents: number
  monthlyLimitCents: number
}): Promise<AutoTopUpSummary> {
  const now = new Date()
  const values = {
    autoTopUpEnabled: input.enabled,
    autoTopUpThresholdCents: input.thresholdCents,
    autoTopUpAmountCents: input.amountCents,
    autoTopUpMonthlyLimitCents: input.monthlyLimitCents,
    // Saving settings acknowledges an earlier failure.
    autoTopUpDisabledReason: null,
    autoTopUpDisabledAt: null,
  }
  await db.transaction(async (tx) => {
    await tx.insert(billingAccounts).values({ userId, ...values })
      .onConflictDoUpdate({ target: billingAccounts.userId, set: { ...values, updatedAt: now } })
  })
  await publishBillingChange(userId)
  // A balance already below the new threshold tops up right away.
  if (input.enabled) await queueAutoTopUpChecks([userId])
  return getAutoTopUpSummary(userId, now)
}

export async function removeAutoTopUpPaymentMethod(userId: string): Promise<AutoTopUpSummary> {
  const [account] = await db.select({ paymentMethodId: billingAccounts.stripePaymentMethodId })
    .from(billingAccounts).where(eq(billingAccounts.userId, userId)).limit(1)
  if (account?.paymentMethodId) {
    try {
      await getStripeClient().paymentMethods.detach(account.paymentMethodId)
    } catch (error) {
      if (!isMissingStripeResource(error) && !(error instanceof Stripe.errors.StripeInvalidRequestError)) throw error
    }
  }
  await db.update(billingAccounts).set({
    autoTopUpEnabled: false,
    autoTopUpDisabledReason: null,
    autoTopUpDisabledAt: null,
    stripePaymentMethodId: null,
    paymentMethodBrand: null,
    paymentMethodLast4: null,
    updatedAt: new Date(),
  }).where(eq(billingAccounts.userId, userId))
  await publishBillingChange(userId)
  return getAutoTopUpSummary(userId)
}
