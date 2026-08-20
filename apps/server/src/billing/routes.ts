import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks'
import { desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth/service.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import {
  billingCheckouts,
  billingOrders,
  billingSubscriptions,
} from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { getBillingEntitlements } from './entitlements.js'
import {
  chargeCentsForCredits,
  MAX_TOP_UP_CENTS,
  MIN_TOP_UP_CENTS,
} from './plans.js'
import {
  changeSubscription,
  createCreditCheckout,
  createCustomerPortalUrl,
  createSubscriptionCheckout,
} from './polar.js'
import { processPolarWebhookEvent } from './webhooks.js'
import { activePoolMembership, poolBalanceMicros } from '../pools/service.js'

const creditAmountSchema = z.number().int().min(MIN_TOP_UP_CENTS).max(MAX_TOP_UP_CENTS)
const checkoutInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  creditCents: creditAmountSchema,
})
const subscriptionCheckoutSchema = z.object({
  idempotencyKey: z.string().uuid(),
  plan: z.enum(['eight', 'fat']),
})

function normalizedWebhookHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).flatMap(([key, value]) => {
    if (typeof value === 'string') return [[key, value]]
    if (Array.isArray(value)) return [[key, value.join(',')]]
    return []
  }))
}

export async function registerBillingRoutes(app: FastifyInstance): Promise<void> {
  const config = getConfig()
  if (!config.PULPO_BILLING_ENABLED) return

  app.get('/api/billing/summary', async (request) => {
    const user = requireUser(request)
    const [entitlements, subscriptions, orders, poolBalance] = await Promise.all([
      getBillingEntitlements(user.id),
      db.select().from(billingSubscriptions).where(eq(billingSubscriptions.userId, user.id))
        .orderBy(desc(billingSubscriptions.updatedAt)),
      db.select().from(billingOrders).where(eq(billingOrders.userId, user.id))
        .orderBy(desc(billingOrders.createdAt)).limit(50),
      db.transaction(async (tx) => {
        const membership = await activePoolMembership(tx, user.id)
        return membership ? poolBalanceMicros(tx, membership.pool.id) : null
      }),
    ])
    const subscription = subscriptions.find((item) => item.plan === entitlements.plan) ?? null
    return {
      plan: entitlements.plan,
      balanceMicros: user.balanceMicros,
      poolBalanceMicros: poolBalance,
      weekly: entitlements.weeklyRemainingPercentage === null ? null : {
        remainingPercentage: entitlements.weeklyRemainingPercentage,
        resetsAt: entitlements.weeklyResetAt.toISOString(),
      },
      onHold: entitlements.onHold,
      subscription: subscription ? {
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      } : null,
      payments: orders.map((order) => ({
        id: order.polarOrderId,
        kind: order.billingReason === 'purchase' ? 'credits' : 'subscription',
        plan: order.polarProductId === config.POLAR_FAT_PRODUCT_ID
          ? 'fat'
          : order.polarProductId === config.POLAR_EIGHT_PRODUCT_ID
            ? 'eight'
            : null,
        requestedCreditCents: order.requestedCreditCents,
        amountCents: order.totalAmountCents,
        taxCents: order.taxAmountCents,
        status: order.refundedAmountCents > 0 ? 'refunded' : order.status,
        createdAt: order.createdAt.toISOString(),
      })),
    }
  })

  app.post('/api/billing/credit-quote', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request) => {
    requireUser(request)
    const { creditCents } = z.object({ creditCents: creditAmountSchema }).parse(request.body)
    return { creditCents, chargeCents: chargeCentsForCredits(creditCents), currency: 'usd', taxExclusive: true }
  })

  app.post('/api/billing/checkouts/credits', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = requireUser(request)
    const input = checkoutInputSchema.parse(request.body)
    const result = await createCreditCheckout({ userId: user.id, ...input })
    reply.code(201)
    return result
  })

  app.post('/api/billing/checkouts/subscription', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = requireUser(request)
    const input = subscriptionCheckoutSchema.parse(request.body)
    const result = await createSubscriptionCheckout({ userId: user.id, ...input })
    reply.code(201)
    return result
  })

  app.patch('/api/billing/subscription', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = requireUser(request)
    const { plan } = z.object({ plan: z.enum(['baby', 'eight', 'fat']) }).parse(request.body)
    return changeSubscription({ userId: user.id, plan })
  })

  app.post('/api/billing/portal', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = requireUser(request)
    return { url: await createCustomerPortalUrl(user.id) }
  })

  app.get('/api/billing/checkouts/:id', async (request) => {
    const user = requireUser(request)
    const { id } = z.object({ id: z.string().min(1).max(200) }).parse(request.params)
    const [checkout] = await db.select({ status: billingCheckouts.status, userId: billingCheckouts.userId })
      .from(billingCheckouts).where(eq(billingCheckouts.polarCheckoutId, id)).limit(1)
    if (!checkout || checkout.userId !== user.id) throw new AppError(404, 'checkout_not_found', 'Checkout not found')
    return { status: checkout.status }
  })

  app.post('/api/billing/webhooks/polar', async (request, reply) => {
    const rawBody = request.rawBody
    const eventId = request.headers['webhook-id']
    if (!rawBody || typeof eventId !== 'string') throw new AppError(400, 'invalid_webhook', 'Invalid webhook request')
    try {
      const event = validateEvent(rawBody, normalizedWebhookHeaders(request.headers), config.POLAR_WEBHOOK_SECRET!)
      await processPolarWebhookEvent(eventId, event)
    } catch (error) {
      if (error instanceof WebhookVerificationError) throw new AppError(400, 'invalid_webhook_signature', 'Invalid webhook signature')
      throw error
    }
    reply.code(204)
  })
}
