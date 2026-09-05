import type Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { billingAccounts, billingCheckouts, billingSubscriptions } from '../database/schema.js'
import { getStripeClient, isMissingStripeResource } from '../billing/stripe.js'

export async function cancelAccountBilling(userId: string): Promise<void> {
  const [account] = await db.select().from(billingAccounts).where(eq(billingAccounts.userId, userId))
  const subscriptions = await db.select().from(billingSubscriptions).where(eq(billingSubscriptions.userId, userId))
  const checkouts = await db.select().from(billingCheckouts).where(eq(billingCheckouts.userId, userId))
  if (!account?.stripeCustomerId && !subscriptions.length && !checkouts.length) return
  await cancelStripeResources(getStripeClient(), account?.stripeCustomerId ?? null,
    subscriptions.map((row) => row.stripeSubscriptionId),
    checkouts.flatMap((row) => row.stripeCheckoutSessionId ? [row.stripeCheckoutSessionId] : []))
}

export async function cancelStripeResources(stripe: Stripe, customerId: string | null, subscriptions: string[], checkouts: string[]): Promise<void> {
  const subscriptionIds = new Set(subscriptions)
  const checkoutIds = new Set(checkouts)
  if (customerId) {
    try {
      for await (const checkout of stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 })) checkoutIds.add(checkout.id)
      for await (const subscription of stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })) subscriptionIds.add(subscription.id)
    } catch (error) {
      if (!isMissingStripeResource(error)) throw error
    }
  }
  // Close checkout links before cancelling subscriptions so they cannot restart billing.
  for (const id of checkoutIds) {
    try {
      const checkout = await stripe.checkout.sessions.retrieve(id)
      if (checkout.status === 'open') await stripe.checkout.sessions.expire(id)
    } catch (error) { if (!isMissingStripeResource(error)) throw error }
  }
  for (const id of subscriptionIds) {
    try {
      const subscription = await stripe.subscriptions.retrieve(id)
      if (!['canceled', 'incomplete_expired'].includes(subscription.status)) {
        await stripe.subscriptions.cancel(id, { invoice_now: false, prorate: false })
      }
    } catch (error) { if (!isMissingStripeResource(error)) throw error }
  }
}
