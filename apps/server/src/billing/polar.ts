import { Polar } from '@polar-sh/sdk'
import { and, eq, inArray } from 'drizzle-orm'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { billingCheckouts, billingSubscriptions, users } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import {
  chargeCentsForCredits,
  type PaidBillingPlan,
} from './plans.js'

let client: Polar | undefined

export function getPolarClient(): Polar {
  const config = getConfig()
  if (!config.PULPO_BILLING_ENABLED || !config.POLAR_ACCESS_TOKEN || !config.POLAR_ENVIRONMENT) {
    throw new AppError(404, 'billing_disabled', 'Billing is not available')
  }
  client ??= new Polar({
    accessToken: config.POLAR_ACCESS_TOKEN,
    server: config.POLAR_ENVIRONMENT,
  })
  return client
}

export function planForProductId(productId: string | null | undefined): PaidBillingPlan | null {
  if (!productId) return null
  const config = getConfig()
  if (productId === config.POLAR_EIGHT_PRODUCT_ID) return 'eight'
  if (productId === config.POLAR_FAT_PRODUCT_ID) return 'fat'
  return null
}

export function productIdForPlan(plan: PaidBillingPlan): string {
  const config = getConfig()
  const productId = plan === 'eight' ? config.POLAR_EIGHT_PRODUCT_ID : config.POLAR_FAT_PRODUCT_ID
  if (!productId) throw new AppError(500, 'billing_configuration_missing', 'Billing product configuration is missing')
  return productId
}

async function checkoutUser(userId: string) {
  const [user] = await db.select({ id: users.id, name: users.name, email: users.email })
    .from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new AppError(404, 'user_not_found', 'User not found')
  return user
}

async function existingCheckout(userId: string, idempotencyKey: string) {
  const [row] = await db.select().from(billingCheckouts).where(and(
    eq(billingCheckouts.userId, userId),
    eq(billingCheckouts.idempotencyKey, idempotencyKey),
  )).limit(1)
  return row
}

export async function createCreditCheckout(input: {
  userId: string
  creditCents: number
  idempotencyKey: string
}): Promise<{ url: string; checkoutId: string; chargeCents: number }> {
  const chargeCents = chargeCentsForCredits(input.creditCents)
  const prior = await existingCheckout(input.userId, input.idempotencyKey)
  if (prior?.checkoutUrl && prior.polarCheckoutId) {
    return { url: prior.checkoutUrl, checkoutId: prior.polarCheckoutId, chargeCents: prior.chargeCents! }
  }
  if (prior) throw new AppError(409, 'checkout_in_progress', 'This checkout is already being created')

  const config = getConfig()
  const productId = config.POLAR_CREDIT_PRODUCT_ID!
  const user = await checkoutUser(input.userId)
  const internalId = newId()
  await db.insert(billingCheckouts).values({
    id: internalId,
    userId: user.id,
    idempotencyKey: input.idempotencyKey,
    kind: 'credits',
    requestedCreditCents: input.creditCents,
    chargeCents,
  })

  try {
    const checkout = await getPolarClient().checkouts.create({
      products: [productId],
      prices: {
        [productId]: [{
          amountType: 'fixed',
          priceAmount: chargeCents,
          priceCurrency: 'usd',
          taxBehavior: 'exclusive',
        }],
      },
      externalCustomerId: user.id,
      customerName: user.name,
      customerEmail: user.email,
      allowDiscountCodes: false,
      successUrl: `${config.PUBLIC_URL}/billing?checkout=success&checkout_id={CHECKOUT_ID}`,
      returnUrl: `${config.PUBLIC_URL}/billing`,
      metadata: {
        pulpo_checkout_id: internalId,
        pulpo_user_id: user.id,
        pulpo_kind: 'credits',
        requested_credit_cents: input.creditCents,
      },
    }, { headers: { 'Idempotency-Key': internalId } })
    await db.update(billingCheckouts).set({
      polarCheckoutId: checkout.id,
      checkoutUrl: checkout.url,
      status: checkout.status,
      expiresAt: checkout.expiresAt,
      updatedAt: new Date(),
    }).where(eq(billingCheckouts.id, internalId))
    return { url: checkout.url, checkoutId: checkout.id, chargeCents }
  } catch (error) {
    await db.update(billingCheckouts).set({ status: 'failed', updatedAt: new Date() })
      .where(eq(billingCheckouts.id, internalId))
    throw error
  }
}

export async function createSubscriptionCheckout(input: {
  userId: string
  plan: PaidBillingPlan
  idempotencyKey: string
}): Promise<{ url: string; checkoutId: string }> {
  const [current] = await db.select({ id: billingSubscriptions.polarSubscriptionId })
    .from(billingSubscriptions).where(and(
      eq(billingSubscriptions.userId, input.userId),
      inArray(billingSubscriptions.status, ['active', 'past_due']),
    )).limit(1)
  if (current) throw new AppError(409, 'subscription_exists', 'Manage your existing subscription from the billing portal')

  const prior = await existingCheckout(input.userId, input.idempotencyKey)
  if (prior?.checkoutUrl && prior.polarCheckoutId) return { url: prior.checkoutUrl, checkoutId: prior.polarCheckoutId }
  if (prior) throw new AppError(409, 'checkout_in_progress', 'This checkout is already being created')

  const config = getConfig()
  const user = await checkoutUser(input.userId)
  const productId = productIdForPlan(input.plan)
  const internalId = newId()
  await db.insert(billingCheckouts).values({
    id: internalId,
    userId: user.id,
    idempotencyKey: input.idempotencyKey,
    kind: 'subscription',
    plan: input.plan,
  })

  try {
    const checkout = await getPolarClient().checkouts.create({
      products: [productId],
      externalCustomerId: user.id,
      customerName: user.name,
      customerEmail: user.email,
      allowDiscountCodes: false,
      successUrl: `${config.PUBLIC_URL}/billing?checkout=success&checkout_id={CHECKOUT_ID}`,
      returnUrl: `${config.PUBLIC_URL}/billing`,
      metadata: {
        pulpo_checkout_id: internalId,
        pulpo_user_id: user.id,
        pulpo_kind: 'subscription',
        pulpo_plan: input.plan,
      },
    }, { headers: { 'Idempotency-Key': internalId } })
    await db.update(billingCheckouts).set({
      polarCheckoutId: checkout.id,
      checkoutUrl: checkout.url,
      status: checkout.status,
      expiresAt: checkout.expiresAt,
      updatedAt: new Date(),
    }).where(eq(billingCheckouts.id, internalId))
    return { url: checkout.url, checkoutId: checkout.id }
  } catch (error) {
    await db.update(billingCheckouts).set({ status: 'failed', updatedAt: new Date() })
      .where(eq(billingCheckouts.id, internalId))
    throw error
  }
}

export async function createCustomerPortalUrl(userId: string): Promise<string> {
  const config = getConfig()
  const session = await getPolarClient().customerSessions.create({
    externalCustomerId: userId,
    returnUrl: `${config.PUBLIC_URL}/billing`,
  })
  return session.customerPortalUrl
}
