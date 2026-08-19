import { validateEvent } from '@polar-sh/sdk/webhooks'
import { eq, inArray, sql } from 'drizzle-orm'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import {
  billingAccounts,
  billingCheckouts,
  billingOrders,
  billingSubscriptions,
  billingWebhookEvents,
  creditLedger,
  users,
} from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { publishStateChange } from '../responses/events.js'
import { PLAN_MONTHLY_CREDIT_MICROS } from './plans.js'
import { planForProductId } from './polar.js'

export type PolarWebhookEvent = ReturnType<typeof validateEvent>
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

type PolarCustomer = { id: string; externalId?: string | null }
type PolarSubscription = {
  id: string
  modifiedAt: Date | null
  productId: string
  status: string
  cancelAtPeriodEnd: boolean
  currentPeriodStart: Date
  currentPeriodEnd: Date
  customerId: string
  customer: PolarCustomer
}
type PolarOrder = {
  id: string
  createdAt: Date
  modifiedAt: Date | null
  status: string
  paid: boolean
  subtotalAmount: number
  discountAmount: number
  netAmount: number
  taxAmount: number
  totalAmount: number
  refundedAmount: number
  currency: string
  billingReason: string
  customerId: string
  productId: string | null
  subscriptionId: string | null
  checkoutId: string | null
  platformFeeAmount: number
  customer: PolarCustomer
  subscription: PolarSubscription | null
}
type PolarCheckout = {
  id: string
  status: string
  customerId: string | null
  externalCustomerId: string | null
  expiresAt: Date
}
type PolarRefund = {
  id: string
  status: string
  orderId: string
  customerId: string
  dispute: unknown | null
}

export function grantMicrosForPaidOrder(input: {
  isCreditPurchase: boolean
  requestedCreditCents: number | null | undefined
  plan: 'eight' | 'fat' | null
  billingReason: string
  alreadyGrantedMicros: number
}): number {
  if (input.alreadyGrantedMicros > 0) return 0
  if (input.isCreditPurchase) return (input.requestedCreditCents ?? 0) * 10_000
  if (!input.plan || (input.billingReason !== 'subscription_create' && input.billingReason !== 'subscription_cycle')) return 0
  return PLAN_MONTHLY_CREDIT_MICROS[input.plan]
}

export function isStaleProviderUpdate(existingModifiedAt: Date, providerModifiedAt: Date): boolean {
  return providerModifiedAt < existingModifiedAt
}

function maxDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right
  if (!right) return left
  return left > right ? left : right
}

async function userExists(tx: Transaction, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
  return row?.id ?? null
}

async function saveCustomer(tx: Transaction, userId: string, customerId: string | null | undefined): Promise<void> {
  if (!customerId) return
  await tx.insert(billingAccounts).values({ userId, polarCustomerId: customerId })
    .onConflictDoUpdate({
      target: billingAccounts.userId,
      set: { polarCustomerId: customerId, updatedAt: new Date() },
    })
}

async function resolveOrderUser(tx: Transaction, order: PolarOrder): Promise<string | null> {
  const [checkout] = order.checkoutId
    ? await tx.select({ userId: billingCheckouts.userId }).from(billingCheckouts)
      .where(eq(billingCheckouts.polarCheckoutId, order.checkoutId)).limit(1)
    : []
  const [subscription] = !checkout && order.subscriptionId
    ? await tx.select({ userId: billingSubscriptions.userId }).from(billingSubscriptions)
      .where(eq(billingSubscriptions.polarSubscriptionId, order.subscriptionId)).limit(1)
    : []
  const externalUserId = await userExists(tx, order.customer.externalId)
  const userId = checkout?.userId ?? subscription?.userId ?? externalUserId
  if (userId && externalUserId && userId !== externalUserId) {
    throw new Error(`Polar customer identity did not match checkout owner for order ${order.id}`)
  }
  return userId ?? null
}

async function upsertSubscriptionFromOrder(
  tx: Transaction,
  userId: string,
  subscription: PolarSubscription,
): Promise<void> {
  const plan = planForProductId(subscription.productId)
  if (!plan) return
  const modifiedAt = subscription.modifiedAt ?? new Date()
  const [existing] = await tx.select().from(billingSubscriptions)
    .where(eq(billingSubscriptions.polarSubscriptionId, subscription.id)).for('update')
  if (!existing) {
    await tx.insert(billingSubscriptions).values({
      polarSubscriptionId: subscription.id,
      userId,
      polarProductId: subscription.productId,
      plan,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      paidThrough: subscription.currentPeriodEnd,
      providerModifiedAt: modifiedAt,
    })
  } else {
    const providerIsNewer = !isStaleProviderUpdate(existing.providerModifiedAt, modifiedAt)
    await tx.update(billingSubscriptions).set({
      paidThrough: maxDate(existing.paidThrough, subscription.currentPeriodEnd),
      ...(providerIsNewer ? {
        polarProductId: subscription.productId,
        plan,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        providerModifiedAt: modifiedAt,
      } : {}),
      updatedAt: new Date(),
    }).where(eq(billingSubscriptions.polarSubscriptionId, subscription.id))
  }
}

async function applyPaidOrder(tx: Transaction, order: PolarOrder, eventAt: Date, changedUsers: Set<string>): Promise<void> {
  if (!order.paid || !order.productId || order.currency.toLowerCase() !== 'usd') return
  const userId = await resolveOrderUser(tx, order)
  if (!userId) return
  const [checkout] = order.checkoutId
    ? await tx.select().from(billingCheckouts).where(eq(billingCheckouts.polarCheckoutId, order.checkoutId)).limit(1)
    : []
  const plan = planForProductId(order.productId)
  const isCreditPurchase = checkout?.kind === 'credits'
  if (!isCreditPurchase && !plan) return
  if (isCreditPurchase) {
    if (order.productId !== getConfig().POLAR_CREDIT_PRODUCT_ID) {
      throw new Error(`Unexpected product for credit order ${order.id}`)
    }
    if (!checkout?.requestedCreditCents || checkout.chargeCents !== order.netAmount) {
      throw new Error(`Credit checkout amount did not match paid order ${order.id}`)
    }
  }

  await saveCustomer(tx, userId, order.customerId)
  if (order.subscription) await upsertSubscriptionFromOrder(tx, userId, order.subscription)
  await tx.insert(billingOrders).values({
    polarOrderId: order.id,
    userId,
    polarCheckoutId: order.checkoutId,
    polarSubscriptionId: order.subscriptionId,
    polarProductId: order.productId,
    billingReason: order.billingReason,
    status: order.status,
    currency: order.currency,
    subtotalAmountCents: order.subtotalAmount,
    discountAmountCents: order.discountAmount,
    netAmountCents: order.netAmount,
    taxAmountCents: order.taxAmount,
    totalAmountCents: order.totalAmount,
    platformFeeAmountCents: order.platformFeeAmount,
    refundedAmountCents: order.refundedAmount,
    requestedCreditCents: checkout?.requestedCreditCents,
    paidAt: eventAt,
    createdAt: order.createdAt,
  }).onConflictDoUpdate({
    target: billingOrders.polarOrderId,
    set: {
      status: order.status,
      subtotalAmountCents: order.subtotalAmount,
      discountAmountCents: order.discountAmount,
      netAmountCents: order.netAmount,
      taxAmountCents: order.taxAmount,
      totalAmountCents: order.totalAmount,
      platformFeeAmountCents: order.platformFeeAmount,
      refundedAmountCents: order.refundedAmount,
      updatedAt: new Date(),
    },
  })
  const [stored] = await tx.select().from(billingOrders)
    .where(eq(billingOrders.polarOrderId, order.id)).for('update')
  if (!stored) throw new Error(`Failed to store Polar order ${order.id}`)

  const grantMicros = grantMicrosForPaidOrder({
    isCreditPurchase,
    requestedCreditCents: checkout?.requestedCreditCents,
    plan,
    billingReason: order.billingReason,
    alreadyGrantedMicros: stored.grantedCreditMicros,
  })
  if (grantMicros > 0) {
    const [updatedUser] = await tx.update(users).set({
      balanceMicros: sql`${users.balanceMicros} + ${grantMicros}`,
      updatedAt: new Date(),
    }).where(eq(users.id, userId)).returning({ balanceMicros: users.balanceMicros })
    await tx.insert(creditLedger).values({
      id: newId(),
      userId,
      type: isCreditPurchase ? 'credit_purchase' : 'subscription_credit',
      amountMicros: grantMicros,
      balanceAfterMicros: updatedUser!.balanceMicros,
      metadata: { polarOrderId: order.id, billingReason: order.billingReason, plan },
    })
    await tx.update(billingOrders).set({ grantedCreditMicros: grantMicros, updatedAt: new Date() })
      .where(eq(billingOrders.polarOrderId, order.id))
  }
  if (order.checkoutId) {
    await tx.update(billingCheckouts).set({ status: 'succeeded', updatedAt: new Date() })
      .where(eq(billingCheckouts.polarCheckoutId, order.checkoutId))
  }
  changedUsers.add(userId)
}

async function applySubscription(
  tx: Transaction,
  subscription: PolarSubscription,
  eventType: string,
  eventAt: Date,
  changedUsers: Set<string>,
): Promise<void> {
  const plan = planForProductId(subscription.productId)
  if (!plan) return
  const [existing] = await tx.select().from(billingSubscriptions)
    .where(eq(billingSubscriptions.polarSubscriptionId, subscription.id)).for('update')
  const userId = existing?.userId ?? await userExists(tx, subscription.customer.externalId)
  if (!userId) return
  const providerModifiedAt = subscription.modifiedAt ?? eventAt
  if (existing && isStaleProviderUpdate(existing.providerModifiedAt, providerModifiedAt)) return
  const status = eventType === 'subscription.revoked' ? 'revoked' : subscription.status
  const values = {
    userId,
    polarProductId: subscription.productId,
    plan,
    status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    providerModifiedAt,
    updatedAt: new Date(),
  }
  if (existing) {
    await tx.update(billingSubscriptions).set(values)
      .where(eq(billingSubscriptions.polarSubscriptionId, subscription.id))
  } else {
    await tx.insert(billingSubscriptions).values({
      polarSubscriptionId: subscription.id,
      ...values,
      paidThrough: null,
    })
  }
  await saveCustomer(tx, userId, subscription.customerId)
  changedUsers.add(userId)
}

async function placeBillingHold(
  tx: Transaction,
  userId: string,
  reason: string,
  reference: string,
  changedUsers: Set<string>,
): Promise<void> {
  const now = new Date()
  await tx.insert(billingAccounts).values({
    userId,
    holdAt: now,
    holdReason: reason,
    holdReference: reference,
  }).onConflictDoUpdate({
    target: billingAccounts.userId,
    set: {
      holdAt: now,
      holdReason: reason,
      holdReference: reference,
      holdClearedAt: null,
      holdClearedBy: null,
      updatedAt: now,
    },
  })
  changedUsers.add(userId)
}

async function applyRefundOrder(tx: Transaction, order: PolarOrder, eventAt: Date, changedUsers: Set<string>): Promise<void> {
  const userId = await resolveOrderUser(tx, order)
  if (!userId || order.refundedAmount <= 0) return
  await tx.update(billingOrders).set({
    status: order.status,
    refundedAmountCents: order.refundedAmount,
    refundedAt: eventAt,
    updatedAt: new Date(),
  }).where(eq(billingOrders.polarOrderId, order.id))
  await placeBillingHold(tx, userId, 'payment_reversed', order.id, changedUsers)
}

async function applyRefund(tx: Transaction, refund: PolarRefund, changedUsers: Set<string>): Promise<void> {
  if (refund.status !== 'succeeded' && !refund.dispute) return
  const [order] = await tx.select({ userId: billingOrders.userId }).from(billingOrders)
    .where(eq(billingOrders.polarOrderId, refund.orderId)).limit(1)
  if (!order) return
  await placeBillingHold(tx, order.userId, refund.dispute ? 'payment_dispute' : 'payment_refunded', refund.id, changedUsers)
}

async function applyCheckout(tx: Transaction, checkout: PolarCheckout): Promise<void> {
  await tx.update(billingCheckouts).set({
    status: checkout.status,
    expiresAt: checkout.expiresAt,
    updatedAt: new Date(),
  }).where(eq(billingCheckouts.polarCheckoutId, checkout.id))
}

async function applyEvent(tx: Transaction, event: PolarWebhookEvent, changedUsers: Set<string>): Promise<void> {
  switch (event.type) {
    case 'order.paid':
      await applyPaidOrder(tx, event.data as PolarOrder, event.timestamp, changedUsers)
      return
    case 'order.refunded':
      await applyRefundOrder(tx, event.data as PolarOrder, event.timestamp, changedUsers)
      return
    case 'refund.created':
    case 'refund.updated':
      await applyRefund(tx, event.data as PolarRefund, changedUsers)
      return
    case 'checkout.updated':
    case 'checkout.expired':
      await applyCheckout(tx, event.data as PolarCheckout)
      return
    case 'subscription.created':
    case 'subscription.updated':
    case 'subscription.active':
    case 'subscription.canceled':
    case 'subscription.uncanceled':
    case 'subscription.past_due':
    case 'subscription.revoked':
      await applySubscription(tx, event.data as PolarSubscription, event.type, event.timestamp, changedUsers)
  }
}

export async function processPolarWebhookEvent(providerEventId: string, event: PolarWebhookEvent): Promise<void> {
  const changedUsers = new Set<string>()
  try {
    const changes = await db.transaction(async (tx) => {
      await tx.insert(billingWebhookEvents).values({
        providerEventId,
        type: event.type,
        resourceId: 'id' in event.data ? String(event.data.id) : null,
      }).onConflictDoNothing()
      const [stored] = await tx.select().from(billingWebhookEvents)
        .where(eq(billingWebhookEvents.providerEventId, providerEventId)).for('update')
      if (stored?.status === 'processed') return []
      await tx.update(billingWebhookEvents).set({ status: 'processing', error: null, updatedAt: new Date() })
        .where(eq(billingWebhookEvents.providerEventId, providerEventId))
      await applyEvent(tx, event, changedUsers)
      const revisions = changedUsers.size > 0
        ? await tx.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
          .where(inArray(users.id, [...changedUsers]))
          .returning({ userId: users.id, revision: users.stateRevision })
        : []
      await tx.update(billingWebhookEvents).set({
        status: 'processed',
        processedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(billingWebhookEvents.providerEventId, providerEventId))
      return revisions
    })
    await Promise.all(changes.map((change) => publishStateChange({
      ...change,
      scopes: ['usage', 'billing'],
    })))
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000)
    await db.insert(billingWebhookEvents).values({
      providerEventId,
      type: event.type,
      resourceId: 'id' in event.data ? String(event.data.id) : null,
      status: 'failed',
      error: message,
    }).onConflictDoUpdate({
      target: billingWebhookEvents.providerEventId,
      set: { status: 'failed', error: message, updatedAt: new Date() },
    })
    throw error
  }
}
