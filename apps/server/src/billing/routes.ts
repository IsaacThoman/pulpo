import { desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth/service.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import {
  applicationSettings,
  appStoreSubscriptions,
  billingCheckouts,
  billingOrders,
  billingSubscriptions,
} from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { parseBillingSettings } from '../settings/application-settings.js'
import {
  AppStorePayloadError,
  appStoreProductIds,
  appStoreSubscriptionSummary,
  processAppStoreNotification,
  syncAppStoreTransaction,
} from './app-store.js'
import { AppStoreSignatureError } from './app-store-signing.js'
import { getBillingEntitlements } from './entitlements.js'
import { loadOwnerSharedAllowance, sharedAllowanceBar } from './shared-allowance.js'
import { getAutoTopUpSummary, removeAutoTopUpPaymentMethod, updateAutoTopUpSettings } from './auto-top-up.js'
import {
  AUTO_TOP_UP_MAX_MONTHLY_LIMIT_CENTS,
  AUTO_TOP_UP_MAX_THRESHOLD_CENTS,
  chargeCentsForCredits,
  MAX_TOP_UP_CENTS,
  MIN_TOP_UP_CENTS,
  subscriptionPaidPlan,
  subscriptionPendingPlan,
} from './plans.js'
import {
  changeSubscription,
  createCreditCheckout,
  createCustomerPortalUrl,
  createPaymentMethodCheckout,
  createSubscriptionCheckout,
  verifyStripeWebhookSignature,
} from './stripe.js'
import { processStripeWebhookEvent } from './webhooks.js'
import { activePoolMembers, activePoolMembership, pendingFundingByUser } from '../pools/service.js'

const creditAmountSchema = z.number().int().min(MIN_TOP_UP_CENTS).max(MAX_TOP_UP_CENTS)
const checkoutInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  creditCents: creditAmountSchema,
  saveForAutoTopUp: z.boolean().optional(),
})
export const autoTopUpSettingsSchema = z.object({
  enabled: z.boolean(),
  thresholdCents: z.number().int().min(0).max(AUTO_TOP_UP_MAX_THRESHOLD_CENTS),
  amountCents: creditAmountSchema,
  monthlyLimitCents: z.number().int().min(MIN_TOP_UP_CENTS).max(AUTO_TOP_UP_MAX_MONTHLY_LIMIT_CENTS),
}).refine((value) => !creditAmountSchema.safeParse(value.amountCents).success
  || value.monthlyLimitCents >= chargeCentsForCredits(value.amountCents), {
  message: 'The monthly limit must cover at least one top-up including the platform fee',
  path: ['monthlyLimitCents'],
})
const paymentMethodCheckoutSchema = z.object({
  idempotencyKey: z.string().uuid(),
  enableAutoTopUp: z.boolean().optional(),
})
const subscriptionCheckoutSchema = z.object({
  idempotencyKey: z.string().uuid(),
  plan: z.enum(['eight', 'fat']),
})
const appStoreTransactionSchema = z.object({
  signedTransaction: z.string().min(1).max(64 * 1024),
  signedRenewalInfo: z.string().min(1).max(64 * 1024).nullable().optional(),
})
const appStoreNotificationSchema = z.object({ signedPayload: z.string().min(1).max(256 * 1024) })

export function isCreditOrderReason(billingReason: string): boolean {
  return billingReason === 'purchase' || billingReason === 'auto_top_up'
}

export function resolvedCheckoutStatus(
  checkoutStatus: string | null | undefined,
  orderStatus: string | null | undefined,
): string | null {
  if (orderStatus === 'paid') return 'succeeded'
  return checkoutStatus ?? null
}

export function selectSummarySubscription<T extends { plan: string; paidPlan?: string | null; status: string }>(
  subscriptions: T[],
  entitlementPlan: string,
): T | null {
  const actionable = subscriptions.filter((item) => item.status === 'active' || item.status === 'past_due')
  return actionable.find((item) => subscriptionPaidPlan(item) === entitlementPlan)
    ?? actionable[0]
    ?? null
}

export function stripeSubscriptionSummary(subscription: {
  plan: string
  paidPlan?: string | null
  status: string
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: Date | null
}) {
  return {
    provider: 'stripe' as const,
    // The plan whose benefits apply now; `pendingPlan` is the price the next renewal bills.
    plan: subscriptionPaidPlan(subscription) === 'fat' ? 'fat' as const : 'eight' as const,
    pendingPlan: subscriptionPendingPlan(subscription),
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
  }
}

export function availableBillingBalanceMicros(balanceMicros: number, pendingMicros: number): number {
  return Math.max(0, balanceMicros - pendingMicros)
}

export function billingLimitPercentage(amountMicros: number, limitMicros: number): number {
  if (limitMicros <= 0) return 0
  return Math.max(0, Math.min(100, (amountMicros / limitMicros) * 100))
}

export function fiveHourSummaryPercentages(input: {
  fiveHourLimitMicros: number
  fiveHourSpentMicros: number
  fiveHourPendingMicros: number
  fiveHourRemainingMicros: number
  weeklyLimitMicros: number
  weeklySpentMicros: number
  weeklyRemainingMicros: number
}): { remainingPercentage: number; availableBarPercentage: number; pendingMicros: number; pendingBarPercentage: number } {
  const availableMicros = Math.min(input.fiveHourRemainingMicros, input.weeklyRemainingMicros)
  const pendingMicros = Math.min(
    input.fiveHourPendingMicros,
    Math.max(0, input.fiveHourLimitMicros - input.fiveHourSpentMicros),
    Math.max(0, input.weeklyLimitMicros - input.weeklySpentMicros),
  )
  return {
    remainingPercentage: Math.round(billingLimitPercentage(availableMicros, input.fiveHourLimitMicros)),
    availableBarPercentage: billingLimitPercentage(availableMicros, input.fiveHourLimitMicros),
    pendingMicros,
    pendingBarPercentage: billingLimitPercentage(pendingMicros, input.fiveHourLimitMicros),
  }
}

export async function registerBillingRoutes(app: FastifyInstance): Promise<void> {
  const config = getConfig()
  if (!config.PULPO_BILLING_ENABLED) return

  app.get('/api/billing/summary', async (request) => {
    const user = requireUser(request)
    const [entitlements, subscriptions, appStoreRows, orders, poolBalance, autoTopUp, [billingSetting]] = await Promise.all([
      getBillingEntitlements(user.id),
      db.select().from(billingSubscriptions).where(eq(billingSubscriptions.userId, user.id)),
      db.select().from(appStoreSubscriptions).where(eq(appStoreSubscriptions.userId, user.id)),
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
      getAutoTopUpSummary(user.id),
      db.select({ value: applicationSettings.value }).from(applicationSettings)
        .where(eq(applicationSettings.key, 'billing')).limit(1),
    ])
    const settings = parseBillingSettings(billingSetting?.value)
    const sharedAllowance = poolBalance ? await db.transaction((tx) => loadOwnerSharedAllowance(tx, user.id, entitlements, settings)) : null
    const now = new Date()
    const candidates = [
      ...subscriptions.map((row) => ({ summary: stripeSubscriptionSummary(row), updatedAt: row.updatedAt })),
      ...appStoreRows.map((row) => ({ summary: appStoreSubscriptionSummary(row, now), updatedAt: row.updatedAt })),
    ].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()).map((candidate) => candidate.summary)
    const subscription = selectSummarySubscription(candidates, entitlements.subscriptionPlan)
    const appStoreProducts = appStoreProductIds()
    const fiveHour = entitlements.fiveHourRemainingPercentage === null
      ? null
      : fiveHourSummaryPercentages(entitlements)
    return {
      plan: entitlements.plan,
      planOverridden: entitlements.planOverridden,
      balanceMicros: user.balanceMicros,
      balancePendingMicros: entitlements.balancePendingMicros,
      availableBalanceMicros: availableBillingBalanceMicros(user.balanceMicros, entitlements.balancePendingMicros),
      poolBalanceMicros: poolBalance?.balanceMicros ?? null,
      poolBalancePendingMicros: poolBalance?.pendingMicros ?? null,
      availablePoolBalanceMicros: poolBalance?.availableMicros ?? null,
      weekly: entitlements.weeklyRemainingPercentage === null ? null : {
        remainingPercentage: entitlements.weeklyRemainingPercentage,
        availableBarPercentage: billingLimitPercentage(entitlements.weeklyRemainingMicros, entitlements.weeklyLimitMicros),
        pendingMicros: entitlements.weeklyPendingMicros,
        pendingBarPercentage: billingLimitPercentage(entitlements.weeklyPendingMicros, entitlements.weeklyLimitMicros),
        resetsAt: entitlements.weeklyResetAt.toISOString(),
      },
      fiveHour: fiveHour ? {
        ...fiveHour,
        resetsAt: entitlements.fiveHourResetAt?.toISOString() ?? null,
      } : null,
      // How much of this user's weekly usage pool members can still draw on.
      shared: sharedAllowance ? sharedAllowanceBar(sharedAllowance) : null,
      sharedWeeklyPercent: settings.fatSharedWeeklyPercent,
      onHold: entitlements.onHold,
      planStorageLimitBytes: {
        baby: settings.babyStorageLimitBytes,
        eight: settings.eightStorageLimitBytes,
        fat: settings.fatStorageLimitBytes,
      },
      subscription,
      // Products the iOS app sells, when App Store purchases are enabled.
      appStore: appStoreProducts ? { productIds: appStoreProducts } : null,
      autoTopUp,
      payments: orders.map((order) => ({
        id: order.stripePaymentId,
        kind: isCreditOrderReason(order.billingReason) ? 'credits' : 'subscription',
        automatic: order.billingReason === 'auto_top_up',
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

  app.post('/api/billing/checkouts/payment-method', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = requireUser(request)
    const input = paymentMethodCheckoutSchema.parse(request.body)
    const result = await createPaymentMethodCheckout({ userId: user.id, ...input })
    reply.code(201)
    return result
  })

  app.put('/api/billing/auto-top-up', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = requireUser(request)
    return updateAutoTopUpSettings(user.id, autoTopUpSettingsSchema.parse(request.body))
  })

  app.delete('/api/billing/payment-method', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = requireUser(request)
    return removeAutoTopUpPaymentMethod(user.id)
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

  app.post('/api/billing/app-store/transactions', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = requireUser(request)
    if (!appStoreProductIds()) throw new AppError(404, 'app_store_billing_disabled', 'App Store purchases are not available')
    const input = appStoreTransactionSchema.parse(request.body)
    return { subscription: await syncAppStoreTransaction(user.id, input) }
  })

  // App Store Server Notifications V2. Apple retries until it receives a 200 response.
  app.post('/api/billing/webhooks/app-store', async (request) => {
    if (!appStoreProductIds()) throw new AppError(404, 'app_store_billing_disabled', 'App Store purchases are not available')
    const { signedPayload } = appStoreNotificationSchema.parse(request.body)
    try {
      await processAppStoreNotification(signedPayload)
    } catch (error) {
      if (error instanceof AppStoreSignatureError || error instanceof AppStorePayloadError) {
        throw new AppError(400, 'invalid_app_store_notification', error.message)
      }
      throw error
    }
    return { received: true }
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
