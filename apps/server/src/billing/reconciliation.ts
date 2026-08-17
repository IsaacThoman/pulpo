import { eq } from 'drizzle-orm'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { applicationSettings } from '../database/schema.js'
import { parseBillingSettings } from '../settings/application-settings.js'
import { getPolarClient } from './polar.js'
import { processPolarWebhookEvent, type PolarWebhookEvent } from './webhooks.js'

function eventVersion(value: Date | null | undefined, fallback: Date): string {
  return (value ?? fallback).toISOString()
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

export async function reconcilePolarBilling(): Promise<void> {
  const config = getConfig()
  if (!config.PULPO_BILLING_ENABLED) return
  try {
    const polar = getPolarClient()
    const subscriptions = await polar.subscriptions.list({
      productId: [config.POLAR_EIGHT_PRODUCT_ID!, config.POLAR_FAT_PRODUCT_ID!],
      limit: 100,
    })
    for await (const page of subscriptions) {
      for (const subscription of page.result.items) {
        const timestamp = subscription.modifiedAt ?? subscription.createdAt
        await processPolarWebhookEvent(
          `reconcile:subscription:${subscription.id}:${eventVersion(subscription.modifiedAt, subscription.createdAt)}`,
          { type: 'subscription.updated', timestamp, data: subscription } as PolarWebhookEvent,
        )
      }
    }

    const orders = await polar.orders.list({
      productId: [config.POLAR_CREDIT_PRODUCT_ID!, config.POLAR_EIGHT_PRODUCT_ID!, config.POLAR_FAT_PRODUCT_ID!],
      limit: 100,
      sorting: ['created_at'],
    })
    for await (const page of orders) {
      for (const order of page.result.items) {
        const timestamp = order.modifiedAt ?? order.createdAt
        if (order.paid) {
          await processPolarWebhookEvent(
            `reconcile:order-paid:${order.id}:${eventVersion(order.modifiedAt, order.createdAt)}`,
            { type: 'order.paid', timestamp, data: order } as PolarWebhookEvent,
          )
        }
        if (order.refundedAmount > 0) {
          await processPolarWebhookEvent(
            `reconcile:order-refunded:${order.id}:${eventVersion(order.modifiedAt, order.createdAt)}`,
            { type: 'order.refunded', timestamp, data: order } as PolarWebhookEvent,
          )
        }
      }
    }
    await saveReconciliationResult(null)
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000)
    await saveReconciliationResult(message)
    throw error
  }
}
