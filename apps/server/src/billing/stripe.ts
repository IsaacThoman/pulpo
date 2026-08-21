import Stripe from 'stripe'
import { and, eq, inArray } from 'drizzle-orm'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { billingAccounts, billingCheckouts, billingSubscriptions, users } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import {
  chargeCentsForCredits,
  isPaidPlan,
  resolveSubscriptionChange,
  type BillingPlan,
  type PaidBillingPlan,
} from './plans.js'

const STRIPE_API_VERSION = '2026-07-29.dahlia' as const
let client: Stripe | undefined

export function getStripeClient(): Stripe {
  const config = getConfig()
  if (!config.PULPO_BILLING_ENABLED || !config.STRIPE_SECRET_KEY) {
    throw new AppError(404, 'billing_disabled', 'Billing is not available')
  }
  client ??= new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION })
  return client
}

export function verifyStripeWebhookSignature(
  rawBody: string | Buffer,
  signature: string,
  secret: string,
  stripe: Stripe = getStripeClient(),
): Stripe.Event {
  return stripe.webhooks.constructEvent(rawBody, signature, secret)
}

export function stripeMode(): 'test' | 'live' {
  return getConfig().STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test'
}

export function planForPriceId(priceId: string | null | undefined): PaidBillingPlan | null {
  if (!priceId) return null
  const config = getConfig()
  if (priceId === config.STRIPE_EIGHT_PRICE_ID) return 'eight'
  if (priceId === config.STRIPE_FAT_PRICE_ID) return 'fat'
  return null
}

export function priceIdForPlan(plan: PaidBillingPlan): string {
  const config = getConfig()
  const priceId = plan === 'eight' ? config.STRIPE_EIGHT_PRICE_ID : config.STRIPE_FAT_PRICE_ID
  if (!priceId) throw new AppError(500, 'billing_configuration_missing', 'Billing price configuration is missing')
  return priceId
}

async function checkoutUser(userId: string) {
  const [user] = await db.select({ id: users.id, name: users.name, email: users.email })
    .from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new AppError(404, 'user_not_found', 'User not found')
  return user
}

async function ensureCustomer(userId: string): Promise<string> {
  const [account] = await db.select({ stripeCustomerId: billingAccounts.stripeCustomerId })
    .from(billingAccounts).where(eq(billingAccounts.userId, userId)).limit(1)
  if (account?.stripeCustomerId) return account.stripeCustomerId
  const user = await checkoutUser(userId)
  const customer = await getStripeClient().customers.create({
    email: user.email,
    name: user.name,
    metadata: { pulpo_user_id: user.id },
  }, { idempotencyKey: `pulpo-customer-${user.id}` })
  await db.insert(billingAccounts).values({ userId, stripeCustomerId: customer.id })
    .onConflictDoUpdate({
      target: billingAccounts.userId,
      set: { stripeCustomerId: customer.id, updatedAt: new Date() },
    })
  return customer.id
}

async function existingCheckout(userId: string, idempotencyKey: string) {
  const [row] = await db.select().from(billingCheckouts).where(and(
    eq(billingCheckouts.userId, userId),
    eq(billingCheckouts.idempotencyKey, idempotencyKey),
  )).limit(1)
  return row
}

const checkoutCustomerUpdates = {
  address: 'auto',
  name: 'auto',
} as const

export async function createCreditCheckout(input: {
  userId: string
  creditCents: number
  idempotencyKey: string
}): Promise<{ url: string; checkoutId: string; chargeCents: number }> {
  const chargeCents = chargeCentsForCredits(input.creditCents)
  const prior = await existingCheckout(input.userId, input.idempotencyKey)
  if (prior?.checkoutUrl && prior.stripeCheckoutSessionId) {
    return { url: prior.checkoutUrl, checkoutId: prior.stripeCheckoutSessionId, chargeCents: prior.chargeCents! }
  }
  if (prior) throw new AppError(409, 'checkout_in_progress', 'This checkout is already being created')

  const config = getConfig()
  const customerId = await ensureCustomer(input.userId)
  const internalId = newId()
  await db.insert(billingCheckouts).values({
    id: internalId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    kind: 'credits',
    requestedCreditCents: input.creditCents,
    chargeCents,
  })
  const metadata = {
    pulpo_checkout_id: internalId,
    pulpo_user_id: input.userId,
    pulpo_kind: 'credits',
    requested_credit_cents: String(input.creditCents),
  }
  try {
    const checkout = await getStripeClient().checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      customer_update: checkoutCustomerUpdates,
      billing_address_collection: 'required',
      automatic_tax: { enabled: true },
      allow_promotion_codes: false,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: chargeCents,
          tax_behavior: 'exclusive',
          product: config.STRIPE_CREDIT_PRODUCT_ID!,
        },
      }],
      client_reference_id: internalId,
      metadata,
      payment_intent_data: { metadata },
      success_url: `${config.PUBLIC_URL}/billing?checkout=success&checkout_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.PUBLIC_URL}/billing`,
    }, { idempotencyKey: internalId })
    if (!checkout.url) throw new Error('Stripe did not return a checkout URL')
    await db.update(billingCheckouts).set({
      stripeCheckoutSessionId: checkout.id,
      checkoutUrl: checkout.url,
      status: checkout.status ?? 'open',
      expiresAt: new Date(checkout.expires_at * 1_000),
      updatedAt: new Date(),
    }).where(eq(billingCheckouts.id, internalId))
    return { url: checkout.url, checkoutId: checkout.id, chargeCents }
  } catch (error) {
    await db.update(billingCheckouts).set({ status: 'failed', updatedAt: new Date() })
      .where(eq(billingCheckouts.id, internalId))
    rethrowStripe(error)
  }
}

export async function createSubscriptionCheckout(input: {
  userId: string
  plan: PaidBillingPlan
  idempotencyKey: string
}): Promise<{ url: string; checkoutId: string }> {
  const [current] = await db.select({ id: billingSubscriptions.stripeSubscriptionId })
    .from(billingSubscriptions).where(and(
      eq(billingSubscriptions.userId, input.userId),
      inArray(billingSubscriptions.status, ['active', 'past_due']),
    )).limit(1)
  if (current) throw new AppError(409, 'subscription_exists', 'Choose an upgrade or switch to Baby from Compare plans')
  const prior = await existingCheckout(input.userId, input.idempotencyKey)
  if (prior?.checkoutUrl && prior.stripeCheckoutSessionId) return { url: prior.checkoutUrl, checkoutId: prior.stripeCheckoutSessionId }
  if (prior) throw new AppError(409, 'checkout_in_progress', 'This checkout is already being created')

  const config = getConfig()
  const customerId = await ensureCustomer(input.userId)
  const internalId = newId()
  await db.insert(billingCheckouts).values({
    id: internalId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    kind: 'subscription',
    plan: input.plan,
  })
  const metadata = {
    pulpo_checkout_id: internalId,
    pulpo_user_id: input.userId,
    pulpo_kind: 'subscription',
    pulpo_plan: input.plan,
  }
  try {
    const checkout = await getStripeClient().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      customer_update: checkoutCustomerUpdates,
      billing_address_collection: 'required',
      automatic_tax: { enabled: true },
      allow_promotion_codes: false,
      line_items: [{ quantity: 1, price: priceIdForPlan(input.plan) }],
      client_reference_id: internalId,
      metadata,
      subscription_data: { metadata },
      success_url: `${config.PUBLIC_URL}/billing?checkout=success&checkout_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.PUBLIC_URL}/billing`,
    }, { idempotencyKey: internalId })
    if (!checkout.url) throw new Error('Stripe did not return a checkout URL')
    await db.update(billingCheckouts).set({
      stripeCheckoutSessionId: checkout.id,
      checkoutUrl: checkout.url,
      status: checkout.status ?? 'open',
      expiresAt: new Date(checkout.expires_at * 1_000),
      updatedAt: new Date(),
    }).where(eq(billingCheckouts.id, internalId))
    return { url: checkout.url, checkoutId: checkout.id }
  } catch (error) {
    await db.update(billingCheckouts).set({ status: 'failed', updatedAt: new Date() })
      .where(eq(billingCheckouts.id, internalId))
    rethrowStripe(error)
  }
}

export async function createCustomerPortalUrl(userId: string): Promise<string> {
  const customerId = await ensureCustomer(userId)
  const session = await getStripeClient().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${getConfig().PUBLIC_URL}/billing`,
  })
  return session.url
}

async function currentPaidSubscription(userId: string) {
  const [current] = await db.select().from(billingSubscriptions).where(and(
    eq(billingSubscriptions.userId, userId),
    inArray(billingSubscriptions.status, ['active', 'past_due']),
  )).limit(1)
  return current ?? null
}

function rethrowStripe(error: unknown): never {
  if (error instanceof Stripe.errors.StripeError) {
    throw new AppError(
      error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 502,
      'stripe_request_failed',
      error.message || 'Could not update billing',
    )
  }
  throw error
}

export async function changeSubscription(input: {
  userId: string
  plan: BillingPlan
}): Promise<{ plan: BillingPlan; status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null }> {
  const current = await currentPaidSubscription(input.userId)
  const change = resolveSubscriptionChange(
    current && isPaidPlan(current.plan) ? { plan: current.plan, cancelAtPeriodEnd: current.cancelAtPeriodEnd } : null,
    input.plan,
  )
  if (change === 'missing') throw new AppError(409, 'subscription_missing', 'Subscribe to a paid plan first')
  if (change === 'unsupported') throw new AppError(409, 'subscription_change_unsupported', 'That plan change is not available')
  if (!current || change === 'noop') {
    return {
      plan: current?.plan === 'fat' ? 'fat' : current?.plan === 'eight' ? 'eight' : 'baby',
      status: current?.status ?? 'none',
      cancelAtPeriodEnd: current?.cancelAtPeriodEnd ?? false,
      currentPeriodEnd: current?.currentPeriodEnd?.toISOString() ?? null,
    }
  }

  try {
    let updated: Stripe.Subscription
    if (change === 'cancel' || change === 'renew') {
      updated = await getStripeClient().subscriptions.update(current.stripeSubscriptionId, {
        cancel_at_period_end: change === 'cancel',
      })
    } else {
      const stripe = getStripeClient()
      const subscription = await stripe.subscriptions.retrieve(current.stripeSubscriptionId)
      const item = subscription.items.data[0]
      if (!item) throw new AppError(409, 'subscription_item_missing', 'The subscription has no billable item')
      updated = await stripe.subscriptions.update(current.stripeSubscriptionId, {
        cancel_at_period_end: false,
        items: [{ id: item.id, price: priceIdForPlan(change === 'upgrade_fat' ? 'fat' : 'eight') }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
      })
    }
    const priceId = updated.items.data[0]?.price.id
    const plan = planForPriceId(priceId)
    if (!plan) throw new AppError(500, 'billing_unknown_price', 'Stripe returned an unknown price')
    const periodStart = updated.items.data[0]?.current_period_start
    const periodEnd = updated.items.data[0]?.current_period_end
    await db.update(billingSubscriptions).set({
      stripePriceId: priceId!,
      plan,
      status: updated.status,
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      currentPeriodStart: periodStart ? new Date(periodStart * 1_000) : null,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1_000) : null,
      providerModifiedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(billingSubscriptions.stripeSubscriptionId, current.stripeSubscriptionId))
    return {
      plan,
      status: updated.status,
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1_000).toISOString() : null,
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    rethrowStripe(error)
  }
}
