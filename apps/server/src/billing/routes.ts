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
  verifyStripeWebhookSignature,
} from './stripe.js'
import { processStripeWebhookEvent } from './webhooks.js'
import { activePoolMembers, activePoolMembership, pendingFundingByUser } from '../pools/service.js'

const creditAmountSchema = z.number().int().min(MIN_TOP_UP_CENTS).max(MAX_TOP_UP_CENTS)
const checkoutInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  creditCents: creditAmountSchema,
})
const subscriptionCheckoutSchema = z.object({
  idempotencyKey: z.string().uuid(),
  plan: z.enum(['eight', 'fat']),
})

export function resolvedCheckoutStatus(
  checkoutStatus: string | null | undefined,
  orderStatus: string | null | undefined,
): string | null {
  if (orderStatus === 'paid') return 'succeeded'
  return checkoutStatus ?? null
}

export function selectSummarySubscription<T extends { plan: string; status: string }>(
  subscriptions: T[],
  entitlementPlan: string,
): T | null {
  const actionable = subscriptions.filter((item) => item.status === 'active' || item.status === 'past_due')
  return actionable.find((item) => item.plan === entitlementPlan)
    ?? actionable[0]
    ?? null
}

export function availableBillingBalanceMicros(balanceMicros: number, pendingMicros: number): number {
  return Math.max(0, balanceMicros - pendingMicros)
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
        if (!membership) return null
        const members = await activePoolMembers(tx, membership.pool.id)
        const pending = await pendingFundingByUser(tx, members.map((row) => row.user.id))
        const balanceMicros = members.reduce((sum, row) => sum + row.user.balanceMicros, 0)
        const pendingMicros = members.reduce((sum, row) => sum + (pending.get(row.user.id) ?? 0), 0)
        return {
          balanceMicros,
          pendingMicros,
          availableMicros: availableBillingBalanceMicros(balanceMicros, pendingMicros),
        }
      }),
    ])
    const subscription = selectSummarySubscription(subscriptions, entitlements.plan)
    return {
      plan: entitlements.plan,
      balanceMicros: user.balanceMicros,
      balancePendingMicros: entitlements.balancePendingMicros,
      availableBalanceMicros: availableBillingBalanceMicros(user.balanceMicros, entitlements.balancePendingMicros),
      poolBalanceMicros: poolBalance?.balanceMicros ?? null,
      poolBalancePendingMicros: poolBalance?.pendingMicros ?? null,
      availablePoolBalanceMicros: poolBalance?.availableMicros ?? null,
      weekly: entitlements.weeklyRemainingPercentage === null ? null : {
        remainingPercentage: entitlements.weeklyRemainingPercentage,
        pendingMicros: entitlements.weeklyPendingMicros,
        resetsAt: entitlements.weeklyResetAt.toISOString(),
      },
      onHold: entitlements.onHold,
      subscription: subscription ? {
        plan: subscription.plan === 'fat' ? 'fat' : 'eight',
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      } : null,
      payments: orders.map((order) => ({
        id: order.stripePaymentId,
        kind: order.billingReason === 'purchase' ? 'credits' : 'subscription',
        plan: order.stripePriceId === config.STRIPE_FAT_PRICE_ID
          ? 'fat'
          : order.stripePriceId === config.STRIPE_EIGHT_PRICE_ID
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
    const [[checkout], [order]] = await Promise.all([
      db.select({ status: billingCheckouts.status, userId: billingCheckouts.userId })
        .from(billingCheckouts).where(eq(billingCheckouts.stripeCheckoutSessionId, id)).limit(1),
      db.select({ status: billingOrders.status, userId: billingOrders.userId })
        .from(billingOrders).where(eq(billingOrders.stripeCheckoutSessionId, id)).limit(1),
    ])
    if (checkout && order && checkout.userId !== order.userId) {
      throw new AppError(409, 'checkout_identity_mismatch', 'Checkout ownership does not match its payment')
    }
    const ownerId = checkout?.userId ?? order?.userId
    const status = resolvedCheckoutStatus(checkout?.status, order?.status)
    if (!ownerId || ownerId !== user.id || !status) throw new AppError(404, 'checkout_not_found', 'Checkout not found')
    return { status }
  })

  app.post('/api/billing/webhooks/stripe', async (request, reply) => {
    const rawBody = request.rawBody
    const signature = request.headers['stripe-signature']
    if (!rawBody || typeof signature !== 'string') throw new AppError(400, 'invalid_webhook', 'Invalid webhook request')
    try {
      const event = verifyStripeWebhookSignature(rawBody, signature, config.STRIPE_WEBHOOK_SECRET!)
      await processStripeWebhookEvent(event)
    } catch (error) {
      if (error instanceof Error && error.name === 'StripeSignatureVerificationError') {
        throw new AppError(400, 'invalid_webhook_signature', 'Invalid webhook signature')
      }
      throw error
    }
    reply.code(204)
  })
}
