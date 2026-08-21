import type Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { applicationSettings } from '../database/schema.js'
import { parseBillingSettings } from '../settings/application-settings.js'
import { getStripeClient, planForPriceId } from './stripe.js'
import { processStripeWebhookEvent } from './webhooks.js'

function syntheticEvent<T extends Stripe.Event.Type>(
  id: string,
  type: T,
  object: Stripe.Event.Data.Object,
  created: number,
): Stripe.Event {
  return {
    id,
    object: 'event',
    api_version: '2026-07-29.dahlia',
    created,
    data: { object },
    livemode: 'livemode' in object ? Boolean(object.livemode) : false,
    pending_webhooks: 0,
    request: null,
    type,
  } as Stripe.Event
}

async function saveReconciliationResult(error: string | null): Promise<void> {
  const [row] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, 'billing')).limit(1)
  const settings = parseBillingSettings(row?.value)
  await db.insert(applicationSettings).values({
    key: 'billing',
    value: {
      ...settings,
      lastReconciledAt: error ? settings.lastReconciledAt : new Date().toISOString(),
      lastReconcileError: error,
    },
  }).onConflictDoUpdate({
    target: applicationSettings.key,
    set: {
      value: {
        ...settings,
        lastReconciledAt: error ? settings.lastReconciledAt : new Date().toISOString(),
        lastReconcileError: error,
      },
      updatedAt: new Date(),
    },
  })
}

async function reconciliationStart(): Promise<number> {
  const [row] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, 'billing')).limit(1)
  const last = parseBillingSettings(row?.value).lastReconciledAt
  const fallback = Date.now() - 30 * 24 * 60 * 60 * 1_000
  const parsed = last ? Date.parse(last) : fallback
  const overlapStart = (Number.isNaN(parsed) ? fallback : parsed) - 48 * 60 * 60 * 1_000
  return Math.floor(overlapStart / 1_000)
}

export async function reconcileStripeBilling(): Promise<void> {
  if (!getConfig().PULPO_BILLING_ENABLED) return
  try {
    const stripe = getStripeClient()
    const createdGte = await reconciliationStart()

    for await (const subscription of stripe.subscriptions.list({ status: 'all', limit: 100 })) {
      const item = subscription.items.data[0]
      if (!planForPriceId(item?.price.id)) continue
      const version = [subscription.status, subscription.cancel_at_period_end, item?.price.id, item?.current_period_end].join(':')
      await processStripeWebhookEvent(syntheticEvent(
        `reconcile:subscription:${subscription.id}:${version}`,
        subscription.status === 'canceled' ? 'customer.subscription.deleted' : 'customer.subscription.updated',
        subscription,
        Math.floor(Date.now() / 1_000),
      ))
    }

    for await (const invoice of stripe.invoices.list({ status: 'paid', created: { gte: createdGte }, limit: 100 })) {
      await processStripeWebhookEvent(syntheticEvent(
        `reconcile:invoice:${invoice.id}:${invoice.status_transitions.paid_at ?? invoice.created}`,
        'invoice.paid',
        invoice,
        invoice.status_transitions.paid_at ?? invoice.created,
      ))
    }

    for await (const checkout of stripe.checkout.sessions.list({ created: { gte: createdGte }, limit: 100 })) {
      if (checkout.mode !== 'payment' || checkout.metadata?.pulpo_kind !== 'credits') continue
      if (checkout.status !== 'complete' && checkout.status !== 'expired') continue
      const type = checkout.status === 'expired' ? 'checkout.session.expired' : 'checkout.session.completed'
      await processStripeWebhookEvent(syntheticEvent(
        `reconcile:checkout:${checkout.id}:${checkout.status}:${checkout.payment_status}`,
        type,
        checkout,
        checkout.created,
      ))
    }

    for await (const paymentIntent of stripe.paymentIntents.list({ created: { gte: createdGte }, limit: 100 })) {
      if (paymentIntent.status !== 'succeeded' || paymentIntent.metadata.pulpo_kind !== 'credits') continue
      const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntent.id, limit: 1 })
      const checkout = sessions.data[0]
      if (!checkout) continue
      await processStripeWebhookEvent(syntheticEvent(
        `reconcile:payment-intent:${paymentIntent.id}:${paymentIntent.status}`,
        'checkout.session.completed',
        checkout,
        paymentIntent.created,
      ))
    }

    for await (const refund of stripe.refunds.list({ created: { gte: createdGte }, limit: 100 })) {
      await processStripeWebhookEvent(syntheticEvent(
        `reconcile:refund:${refund.id}:${refund.status}`,
        'refund.updated',
        refund,
        refund.created,
      ))
    }
    await saveReconciliationResult(null)
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000)
    await saveReconciliationResult(message)
    throw error
  }
}
