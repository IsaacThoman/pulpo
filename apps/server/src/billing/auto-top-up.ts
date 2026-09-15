import type Stripe from 'stripe'
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { autoTopUpAttempts, autoTopUpSettings, billingAccounts, users } from '../database/schema.js'
import { getConfig } from '../config.js'
import { AppError } from '../lib/errors.js'
import { publishStateChange } from '../responses/events.js'
import { ensureCustomer, getStripeClient, withBillingAccount } from './stripe.js'
import { ACTIVE_TOP_UP_STATUSES, AUTO_TOP_UP_DEFAULTS, autoTopUpInputSchema, utcMonth } from './auto-top-up-policy.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export const topUpLockKey = (userId: string) => `auto-top-up:${userId}`
export async function lockTopUpSettings(tx: Transaction, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${topUpLockKey(userId)}))`)
}
export async function topUpSpending(userId: string, connection: Pick<typeof db, 'select'> = db, now = new Date()) {
  const { start, end } = utcMonth(now)
  const [row] = await connection.select({
    chargedCents: sql<number>`coalesce(sum(${autoTopUpAttempts.chargedCents}) filter (where ${gte(autoTopUpAttempts.chargedAt, start)} and ${lt(autoTopUpAttempts.chargedAt, end)}), 0)::bigint`,
    pendingCents: sql<number>`coalesce(sum(${autoTopUpAttempts.reservedCents}) filter (where ${inArray(autoTopUpAttempts.status, ACTIVE_TOP_UP_STATUSES)}), 0)::bigint`,
    processing: sql<boolean>`coalesce(bool_or(${inArray(autoTopUpAttempts.status, ACTIVE_TOP_UP_STATUSES)}), false)`,
  }).from(autoTopUpAttempts).where(eq(autoTopUpAttempts.userId, userId))
  return { chargedCents: Number(row?.chargedCents ?? 0), pendingCents: Number(row?.pendingCents ?? 0), processing: row?.processing ?? false, resetsAt: end.toISOString() }
}
export async function autoTopUpSummary(userId: string) {
  const [[settings], spending] = await Promise.all([
    db.select().from(autoTopUpSettings).where(eq(autoTopUpSettings.userId, userId)), topUpSpending(userId),
  ])
  const limitReached = settings?.limitReached && settings.updatedAt >= utcMonth().start
  return {
    ...AUTO_TOP_UP_DEFAULTS,
    ...(settings && { enabled: settings.enabled, thresholdCents: settings.thresholdCents, creditCents: settings.creditCents, monthlyLimitCents: settings.monthlyLimitCents }),
    revision: settings?.revision ?? 0,
    card: settings?.card ?? null,
    ...spending,
    status: spending.processing ? 'processing' : !settings?.enabled ? 'disabled' : settings.pausedReason ? 'payment_issue' : limitReached ? 'limit_reached' : 'active',
  }
}
export async function notifyAutoTopUp(userId: string) {
  const [change] = await db.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` }).where(eq(users.id, userId))
    .returning({ userId: users.id, revision: users.stateRevision })
  if (change) await publishStateChange({ ...change, scopes: ['billing'] })
}
export async function updateAutoTopUp(userId: string, body: unknown) {
  const input = autoTopUpInputSchema.parse(body)
  await db.transaction(async tx => {
    await lockTopUpSettings(tx, userId)
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('share')
    if (!user || user.blocked || user.deletionRequestedAt) throw new AppError(403, 'account_blocked', 'The account cannot make billing changes')
    await tx.insert(autoTopUpSettings).values({ userId }).onConflictDoNothing()
    const [settings] = await tx.select().from(autoTopUpSettings).where(eq(autoTopUpSettings.userId, userId)).for('update')
    if (settings!.revision !== input.revision) throw new AppError(409, 'auto_top_up_changed', 'Settings changed. Refresh Billing and try again.')
    const spending = await topUpSpending(userId, tx)
    if (input.monthlyLimitCents < spending.chargedCents + spending.pendingCents) throw new AppError(409, 'auto_top_up_limit_too_low', 'The limit cannot be below this month’s charges and pending payments')
    if (input.enabled && !settings!.paymentMethodId) throw new AppError(409, 'auto_top_up_card_required', 'Set up a card before enabling automatic top-ups')
    if (input.enabled && (!settings!.enabled || input.resume) && !input.consent) throw new AppError(400, 'auto_top_up_consent_required', 'Authorize automatic charges to enable top-ups')
    await tx.update(autoTopUpSettings).set({
      enabled: input.enabled, thresholdCents: input.thresholdCents, creditCents: input.creditCents, monthlyLimitCents: input.monthlyLimitCents,
      revision: settings!.revision + 1, setupId: null, setupSessionId: null, setupEnable: false,
      ...(input.consent && { consentAt: new Date() }),
      ...(input.resume && { pausedReason: null }), limitReached: false, updatedAt: new Date(),
    }).where(eq(autoTopUpSettings.userId, userId))
  })
  await notifyAutoTopUp(userId)
  return autoTopUpSummary(userId)
}
export async function createAutoTopUpSetup(userId: string, input: { revision: number; enable: boolean; consent: true; idempotencyKey: string }) {
  return withBillingAccount(userId, async () => {
    const customer = await ensureCustomer(userId)
    const setupId = input.idempotencyKey
    await db.transaction(async tx => {
      await lockTopUpSettings(tx, userId)
      await tx.insert(autoTopUpSettings).values({ userId }).onConflictDoNothing()
      const [settings] = await tx.select().from(autoTopUpSettings).where(eq(autoTopUpSettings.userId, userId)).for('update')
      if (settings!.setupId === setupId) return
      if (settings!.revision !== input.revision) throw new AppError(409, 'auto_top_up_changed', 'Settings changed. Refresh Billing and try again.')
      await tx.update(autoTopUpSettings).set({ setupId, setupSessionId: null, setupEnable: input.enable, consentAt: new Date(), revision: settings!.revision + 1, updatedAt: new Date() })
        .where(eq(autoTopUpSettings.userId, userId))
    })
    const session = await getStripeClient().checkout.sessions.create({
      mode: 'setup', customer, currency: 'usd', payment_method_types: ['card'], billing_address_collection: 'required',
      customer_update: { address: 'auto', name: 'auto' },
      setup_intent_data: { metadata: { pulpo_user_id: userId, pulpo_auto_top_up_setup: setupId } },
      metadata: { pulpo_user_id: userId, pulpo_auto_top_up_setup: setupId },
      custom_text: { submit: { message: 'Save this card for automatic Pulpo credit top-ups under your chosen monthly spending limit, including fees and tax.' } },
      success_url: `${getConfig().PUBLIC_URL}/billing?auto_top_up=setup`, cancel_url: `${getConfig().PUBLIC_URL}/billing`,
    }, { idempotencyKey: `auto-top-up-setup-${userId}-${setupId}` })
    await db.update(autoTopUpSettings).set({ setupSessionId: session.id }).where(and(eq(autoTopUpSettings.userId, userId), eq(autoTopUpSettings.setupId, setupId)))
    if (!session.url) throw new Error('Stripe did not return a card setup URL')
    return { url: session.url }
  })
}
export async function applyAutoTopUpSetup(tx: Transaction, session: Stripe.Checkout.Session, changedUsers: Set<string>) {
  const setupId = session.metadata?.pulpo_auto_top_up_setup
  const metadataUserId = session.metadata?.pulpo_user_id
  if (session.mode !== 'setup' || session.status !== 'complete' || !setupId || !/^[0-9a-f-]{36}$/i.test(setupId) || !metadataUserId || !/^[0-9a-f-]{36}$/i.test(metadataUserId)) return
  const [candidate] = await tx.select().from(autoTopUpSettings).where(and(eq(autoTopUpSettings.setupId, setupId), eq(autoTopUpSettings.userId, metadataUserId)))
  if (!candidate || candidate.userId !== session.metadata?.pulpo_user_id) return
  // Match the payment worker's user-before-settings lock order.
  const [user] = await tx.select().from(users).where(eq(users.id, candidate.userId)).for('update')
  const [settings] = await tx.select().from(autoTopUpSettings).where(and(eq(autoTopUpSettings.setupId, setupId), eq(autoTopUpSettings.userId, metadataUserId))).for('update')
  if (!settings) return
  const [account] = await tx.select().from(billingAccounts).where(eq(billingAccounts.userId, settings.userId))
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
  if (!user || user.blocked || user.deletionRequestedAt || customerId !== account?.stripeCustomerId) return
  const setup = typeof session.setup_intent === 'string' ? await getStripeClient().setupIntents.retrieve(session.setup_intent) : session.setup_intent
  if (!setup || setup.status !== 'succeeded' || setup.usage !== 'off_session' || setup.customer !== customerId || !setup.payment_method) throw new Error('Automatic top-up card setup is not verified')
  const method = typeof setup.payment_method === 'string' ? await getStripeClient().paymentMethods.retrieve(setup.payment_method) : setup.payment_method
  if (method.customer !== customerId || !method.card || !method.billing_details.address?.country) throw new Error('A card and billing address are required')
  await tx.update(autoTopUpSettings).set({ paymentMethodId: method.id,
    card: { brand: method.card.brand, last4: method.card.last4, expMonth: method.card.exp_month, expYear: method.card.exp_year },
    enabled: settings.setupEnable || settings.enabled, setupId: null, setupSessionId: null, setupEnable: false,
    pausedReason: settings.setupEnable ? null : settings.pausedReason, revision: settings.revision + 1, updatedAt: new Date(),
  }).where(eq(autoTopUpSettings.userId, settings.userId))
  changedUsers.add(settings.userId)
}
