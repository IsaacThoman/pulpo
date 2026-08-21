import type Stripe from 'stripe'
import { eq, inArray, or, sql } from 'drizzle-orm'
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
import { poolPeerIds } from '../pools/service.js'
import { publishStateChange } from '../responses/events.js'
import { PLAN_MONTHLY_CREDIT_MICROS } from './plans.js'
import { getStripeClient, planForPriceId } from './stripe.js'
import { refreshStorageLimit } from './storage-entitlements.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

type PaymentDetails = {
  paymentIntentId: string | null
  chargeId: string | null
  processingFeeCents: number
}

type EventContext = {
  checkoutSession?: Stripe.Checkout.Session
  invoice?: Stripe.Invoice
  subscription?: Stripe.Subscription
  payment?: PaymentDetails
}

function idOf(value: { id: string } | string | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

function unixDate(value: number | null | undefined): Date | null {
  return value ? new Date(value * 1_000) : null
}

function sumAmounts(values: Array<{ amount: number }> | null | undefined): number {
  return values?.reduce((total, item) => total + item.amount, 0) ?? 0
}

export function matchingStripeOwner(candidates: Array<string | null | undefined>, resourceId: string): string | null {
  const identities = candidates.filter(Boolean) as string[]
  const userId = identities[0]
  if (userId && identities.some((candidate) => candidate !== userId)) {
    throw new Error(`Stripe customer identity did not match checkout owner for ${resourceId}`)
  }
  return userId ?? null
}

export function validateCreditCheckoutPayment(input: {
  requestedCreditCents: number | null | undefined
  metadataCreditCents: string | null | undefined
  storedChargeCents: number | null | undefined
  subtotalCents: number
  currency: string | null | undefined
  productId: string | null
  expectedProductId: string
  checkoutId: string
}): void {
  const metadataCreditCents = Number(input.metadataCreditCents)
  if (
    !input.requestedCreditCents
    || metadataCreditCents !== input.requestedCreditCents
    || input.storedChargeCents !== input.subtotalCents
    || input.currency?.toLowerCase() !== 'usd'
  ) {
    throw new Error(`Credit checkout amount did not match paid Stripe session ${input.checkoutId}`)
  }
  if (input.productId !== input.expectedProductId) {
    throw new Error(`Unexpected product for Stripe credit checkout ${input.checkoutId}`)
  }
}

export function stripeCheckoutStatus(input: {
  mode: Stripe.Checkout.Session.Mode
  status: Stripe.Checkout.Session.Status | null
  paymentStatus: Stripe.Checkout.Session.PaymentStatus
}): string {
  if (input.status === 'expired') return 'expired'
  if (input.mode === 'payment' && input.status === 'complete' && input.paymentStatus === 'paid') return 'succeeded'
  if (input.mode === 'subscription' && input.status === 'complete') return 'processing'
  return input.status ?? 'open'
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

async function customerUser(tx: Transaction, customerId: string | null): Promise<string | null> {
  if (!customerId) return null
  const [row] = await tx.select({ userId: billingAccounts.userId }).from(billingAccounts)
    .where(eq(billingAccounts.stripeCustomerId, customerId)).limit(1)
  return row?.userId ?? null
}

async function saveCustomer(tx: Transaction, userId: string, customerId: string | null): Promise<void> {
  if (!customerId) return
  await tx.insert(billingAccounts).values({ userId, stripeCustomerId: customerId })
    .onConflictDoUpdate({
      target: billingAccounts.userId,
      set: { stripeCustomerId: customerId, updatedAt: new Date() },
    })
}

async function resolveUser(tx: Transaction, input: {
  checkoutSessionId?: string | null
  subscriptionId?: string | null
  customerId?: string | null
  metadataUserId?: string | null
  resourceId: string
}): Promise<string | null> {
  const [checkout] = input.checkoutSessionId
    ? await tx.select({ userId: billingCheckouts.userId }).from(billingCheckouts)
      .where(eq(billingCheckouts.stripeCheckoutSessionId, input.checkoutSessionId)).limit(1)
    : []
  const [subscription] = !checkout && input.subscriptionId
    ? await tx.select({ userId: billingSubscriptions.userId }).from(billingSubscriptions)
      .where(eq(billingSubscriptions.stripeSubscriptionId, input.subscriptionId)).limit(1)
    : []
  const metadataUserId = await userExists(tx, input.metadataUserId)
  const customerUserId = await customerUser(tx, input.customerId ?? null)
  return matchingStripeOwner(
    [checkout?.userId, subscription?.userId, metadataUserId, customerUserId],
    input.resourceId,
  )
}

function subscriptionPriceId(subscription: Stripe.Subscription | undefined): string | null {
  return subscription?.items.data[0]?.price.id ?? null
}

function subscriptionPeriod(subscription: Stripe.Subscription): { start: Date | null; end: Date | null } {
  const item = subscription.items.data[0]
  return { start: unixDate(item?.current_period_start), end: unixDate(item?.current_period_end) }
}

async function upsertSubscription(
  tx: Transaction,
  subscription: Stripe.Subscription,
  eventAt: Date,
  changedUsers: Set<string>,
): Promise<void> {
  const priceId = subscriptionPriceId(subscription)
  const plan = planForPriceId(priceId)
  if (!priceId || !plan) return
  const customerId = idOf(subscription.customer)
  const [existing] = await tx.select().from(billingSubscriptions)
    .where(eq(billingSubscriptions.stripeSubscriptionId, subscription.id)).for('update')
  const userId = existing?.userId ?? await resolveUser(tx, {
    subscriptionId: subscription.id,
    customerId,
    metadataUserId: subscription.metadata.pulpo_user_id,
    resourceId: subscription.id,
  })
  if (!userId) return
  if (existing && isStaleProviderUpdate(existing.providerModifiedAt, eventAt)) return
  const period = subscriptionPeriod(subscription)
  const values = {
    userId,
    stripePriceId: priceId,
    plan,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    providerModifiedAt: eventAt,
    updatedAt: new Date(),
  }
  if (existing) {
    await tx.update(billingSubscriptions).set(values)
      .where(eq(billingSubscriptions.stripeSubscriptionId, subscription.id))
  } else {
    await tx.insert(billingSubscriptions).values({
      stripeSubscriptionId: subscription.id,
      ...values,
      paidThrough: null,
    })
  }
  await saveCustomer(tx, userId, customerId)
  changedUsers.add(userId)
}

async function recordGrant(tx: Transaction, input: {
  orderId: string
  userId: string
  grantMicros: number
  isCreditPurchase: boolean
  billingReason: string
  plan: 'eight' | 'fat' | null
}): Promise<void> {
  if (input.grantMicros <= 0) return
  const [updatedUser] = await tx.update(users).set({
    balanceMicros: sql`${users.balanceMicros} + ${input.grantMicros}`,
    updatedAt: new Date(),
  }).where(eq(users.id, input.userId)).returning({ balanceMicros: users.balanceMicros })
  await tx.insert(creditLedger).values({
    id: newId(),
    userId: input.userId,
    type: input.isCreditPurchase ? 'credit_purchase' : 'subscription_credit',
    amountMicros: input.grantMicros,
    balanceAfterMicros: updatedUser!.balanceMicros,
    metadata: { stripePaymentId: input.orderId, billingReason: input.billingReason, plan: input.plan },
  })
  await tx.update(billingOrders).set({ grantedCreditMicros: input.grantMicros, updatedAt: new Date() })
    .where(eq(billingOrders.stripePaymentId, input.orderId))
}

async function applyPaidCheckout(
  tx: Transaction,
  checkout: Stripe.Checkout.Session,
  payment: PaymentDetails,
  eventAt: Date,
  changedUsers: Set<string>,
): Promise<void> {
  if (checkout.mode !== 'payment' || checkout.payment_status !== 'paid' || !payment.paymentIntentId) return
  const [storedCheckout] = await tx.select().from(billingCheckouts)
    .where(eq(billingCheckouts.stripeCheckoutSessionId, checkout.id)).limit(1)
  if (!storedCheckout || storedCheckout.kind !== 'credits') return
  const userId = await resolveUser(tx, {
    checkoutSessionId: checkout.id,
    customerId: idOf(checkout.customer),
    metadataUserId: checkout.metadata?.pulpo_user_id,
    resourceId: checkout.id,
  })
  if (!userId) return
  const requestedCreditCents = storedCheckout.requestedCreditCents
  const totalCents = checkout.amount_total ?? 0
  const taxCents = checkout.total_details?.amount_tax ?? 0
  const discountCents = checkout.total_details?.amount_discount ?? 0
  const subtotalCents = checkout.amount_subtotal ?? totalCents - taxCents
  const lineProduct = checkout.line_items?.data[0]?.price?.product
  validateCreditCheckoutPayment({
    requestedCreditCents,
    metadataCreditCents: checkout.metadata?.requested_credit_cents,
    storedChargeCents: storedCheckout.chargeCents,
    subtotalCents,
    currency: checkout.currency,
    productId: idOf(lineProduct),
    expectedProductId: getConfig().STRIPE_CREDIT_PRODUCT_ID!,
    checkoutId: checkout.id,
  })
  const creditCents = requestedCreditCents!
  const netCents = subtotalCents - discountCents
  await saveCustomer(tx, userId, idOf(checkout.customer))
  await tx.insert(billingOrders).values({
    stripePaymentId: payment.paymentIntentId,
    userId,
    stripeCheckoutSessionId: checkout.id,
    stripePaymentIntentId: payment.paymentIntentId,
    stripeChargeId: payment.chargeId,
    stripePriceId: getConfig().STRIPE_CREDIT_PRODUCT_ID!,
    billingReason: 'purchase',
    status: 'paid',
    currency: checkout.currency!,
    subtotalAmountCents: subtotalCents,
    discountAmountCents: discountCents,
    netAmountCents: netCents,
    taxAmountCents: taxCents,
    totalAmountCents: totalCents,
    platformFeeAmountCents: netCents - creditCents,
    processingFeeAmountCents: payment.processingFeeCents,
    requestedCreditCents: creditCents,
    paidAt: eventAt,
    createdAt: new Date(checkout.created * 1_000),
  }).onConflictDoUpdate({
    target: billingOrders.stripePaymentId,
    set: {
      status: 'paid',
      processingFeeAmountCents: payment.processingFeeCents,
      updatedAt: new Date(),
    },
  })
  const [order] = await tx.select().from(billingOrders)
    .where(eq(billingOrders.stripePaymentId, payment.paymentIntentId)).for('update')
  if (!order) throw new Error(`Failed to store Stripe payment ${payment.paymentIntentId}`)
  const grantMicros = grantMicrosForPaidOrder({
    isCreditPurchase: true,
    requestedCreditCents: creditCents,
    plan: null,
    billingReason: 'purchase',
    alreadyGrantedMicros: order.grantedCreditMicros,
  })
  await recordGrant(tx, {
    orderId: payment.paymentIntentId,
    userId,
    grantMicros,
    isCreditPurchase: true,
    billingReason: 'purchase',
    plan: null,
  })
  await tx.update(billingCheckouts).set({ status: 'succeeded', updatedAt: new Date() })
    .where(eq(billingCheckouts.stripeCheckoutSessionId, checkout.id))
  changedUsers.add(userId)
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription)
}

function invoicePriceId(invoice: Stripe.Invoice, subscription?: Stripe.Subscription): string | null {
  return subscriptionPriceId(subscription)
    ?? idOf(invoice.lines.data.find((line) => {
      const price = line.pricing?.price_details?.price
      return planForPriceId(idOf(price)) !== null
    })?.pricing?.price_details?.price)
}

async function applyPaidInvoice(
  tx: Transaction,
  invoice: Stripe.Invoice,
  subscription: Stripe.Subscription | undefined,
  payment: PaymentDetails,
  eventAt: Date,
  changedUsers: Set<string>,
): Promise<void> {
  if (invoice.status !== 'paid' || invoice.currency.toLowerCase() !== 'usd') return
  const subscriptionId = invoiceSubscriptionId(invoice)
  const priceId = invoicePriceId(invoice, subscription)
  const plan = planForPriceId(priceId)
  if (!subscriptionId || !priceId || !plan) return
  const metadata = invoice.parent?.subscription_details?.metadata
  const userId = await resolveUser(tx, {
    subscriptionId,
    customerId: idOf(invoice.customer),
    metadataUserId: metadata?.pulpo_user_id,
    resourceId: invoice.id,
  })
  if (!userId) return
  if (subscription) await upsertSubscription(tx, subscription, eventAt, changedUsers)
  await saveCustomer(tx, userId, idOf(invoice.customer))
  const taxCents = sumAmounts(invoice.total_taxes)
  const discountCents = sumAmounts(invoice.total_discount_amounts)
  await tx.insert(billingOrders).values({
    stripePaymentId: invoice.id,
    userId,
    stripeSubscriptionId: subscriptionId,
    stripePaymentIntentId: payment.paymentIntentId,
    stripeChargeId: payment.chargeId,
    stripePriceId: priceId,
    billingReason: invoice.billing_reason ?? 'subscription',
    status: invoice.status,
    currency: invoice.currency,
    subtotalAmountCents: invoice.subtotal,
    discountAmountCents: discountCents,
    netAmountCents: invoice.total_excluding_tax ?? invoice.total - taxCents,
    taxAmountCents: taxCents,
    totalAmountCents: invoice.total,
    processingFeeAmountCents: payment.processingFeeCents,
    paidAt: unixDate(invoice.status_transitions.paid_at) ?? eventAt,
    createdAt: new Date(invoice.created * 1_000),
  }).onConflictDoUpdate({
    target: billingOrders.stripePaymentId,
    set: {
      status: invoice.status,
      processingFeeAmountCents: payment.processingFeeCents,
      updatedAt: new Date(),
    },
  })
  const [order] = await tx.select().from(billingOrders)
    .where(eq(billingOrders.stripePaymentId, invoice.id)).for('update')
  if (!order) throw new Error(`Failed to store Stripe invoice ${invoice.id}`)
  const paidThrough = subscription ? subscriptionPeriod(subscription).end : unixDate(invoice.period_end)
  const [existingSubscription] = await tx.select().from(billingSubscriptions)
    .where(eq(billingSubscriptions.stripeSubscriptionId, subscriptionId)).for('update')
  if (existingSubscription) {
    await tx.update(billingSubscriptions).set({
      paidThrough: maxDate(existingSubscription.paidThrough, paidThrough),
      updatedAt: new Date(),
    }).where(eq(billingSubscriptions.stripeSubscriptionId, subscriptionId))
  }
  const billingReason = invoice.billing_reason ?? 'subscription'
  const grantMicros = grantMicrosForPaidOrder({
    isCreditPurchase: false,
    requestedCreditCents: null,
    plan,
    billingReason,
    alreadyGrantedMicros: order.grantedCreditMicros,
  })
  await recordGrant(tx, {
    orderId: invoice.id,
    userId,
    grantMicros,
    isCreditPurchase: false,
    billingReason,
    plan,
  })
  const checkoutId = metadata?.pulpo_checkout_id
  if (checkoutId) {
    await tx.update(billingCheckouts).set({ status: 'succeeded', updatedAt: new Date() })
      .where(eq(billingCheckouts.id, checkoutId))
  }
  changedUsers.add(userId)
}

async function applyFailedInvoice(tx: Transaction, invoice: Stripe.Invoice, changedUsers: Set<string>): Promise<void> {
  const subscriptionId = invoiceSubscriptionId(invoice)
  if (!subscriptionId) return
  const [subscription] = await tx.update(billingSubscriptions).set({ status: 'past_due', updatedAt: new Date() })
    .where(eq(billingSubscriptions.stripeSubscriptionId, subscriptionId)).returning({ userId: billingSubscriptions.userId })
  if (subscription) changedUsers.add(subscription.userId)
}

async function applyCheckoutStatus(tx: Transaction, checkout: Stripe.Checkout.Session): Promise<void> {
  const status = stripeCheckoutStatus({
    mode: checkout.mode,
    status: checkout.status,
    paymentStatus: checkout.payment_status,
  })
  await tx.update(billingCheckouts).set({
    status,
    expiresAt: new Date(checkout.expires_at * 1_000),
    updatedAt: new Date(),
  }).where(eq(billingCheckouts.stripeCheckoutSessionId, checkout.id))
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

async function orderForPaymentReference(tx: Transaction, input: {
  paymentIntentId?: string | null
  chargeId?: string | null
}) {
  const conditions = [
    input.paymentIntentId ? eq(billingOrders.stripePaymentIntentId, input.paymentIntentId) : undefined,
    input.chargeId ? eq(billingOrders.stripeChargeId, input.chargeId) : undefined,
  ].filter(Boolean) as Array<ReturnType<typeof eq>>
  if (conditions.length === 0) return null
  const condition = conditions.length === 1 ? conditions[0]! : or(...conditions)!
  const [order] = await tx.select().from(billingOrders).where(condition).limit(1)
  return order ?? null
}

async function applyRefund(tx: Transaction, refund: Stripe.Refund, eventAt: Date, changedUsers: Set<string>): Promise<void> {
  if (refund.status !== 'succeeded') return
  const order = await orderForPaymentReference(tx, {
    paymentIntentId: idOf(refund.payment_intent),
    chargeId: idOf(refund.charge),
  })
  if (!order) return
  const refundedAmountCents = Math.max(order.refundedAmountCents, refund.amount)
  await tx.update(billingOrders).set({
    status: 'refunded', refundedAmountCents, refundedAt: eventAt, updatedAt: new Date(),
  }).where(eq(billingOrders.stripePaymentId, order.stripePaymentId))
  await placeBillingHold(tx, order.userId, 'payment_refunded', refund.id, changedUsers)
}

async function applyRefundedCharge(tx: Transaction, charge: Stripe.Charge, eventAt: Date, changedUsers: Set<string>): Promise<void> {
  if (charge.amount_refunded <= 0) return
  const order = await orderForPaymentReference(tx, {
    paymentIntentId: idOf(charge.payment_intent), chargeId: charge.id,
  })
  if (!order) return
  await tx.update(billingOrders).set({
    status: charge.refunded ? 'refunded' : order.status,
    refundedAmountCents: charge.amount_refunded,
    refundedAt: eventAt,
    updatedAt: new Date(),
  }).where(eq(billingOrders.stripePaymentId, order.stripePaymentId))
  await placeBillingHold(tx, order.userId, 'payment_reversed', charge.id, changedUsers)
}

async function applyDispute(tx: Transaction, dispute: Stripe.Dispute, changedUsers: Set<string>): Promise<void> {
  const order = await orderForPaymentReference(tx, {
    paymentIntentId: idOf(dispute.payment_intent), chargeId: idOf(dispute.charge),
  })
  if (order) await placeBillingHold(tx, order.userId, 'payment_dispute', dispute.id, changedUsers)
}

async function paymentDetailsForIntent(value: string | Stripe.PaymentIntent | null): Promise<PaymentDetails> {
  const paymentIntentId = idOf(value)
  if (!paymentIntentId) return { paymentIntentId: null, chargeId: null, processingFeeCents: 0 }
  const paymentIntent = value && typeof value === 'object' && value.latest_charge && typeof value.latest_charge !== 'string'
    ? value
    : await getStripeClient().paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge.balance_transaction'],
    })
  if (!paymentIntent) return { paymentIntentId, chargeId: null, processingFeeCents: 0 }
  const charge = typeof paymentIntent.latest_charge === 'object' ? paymentIntent.latest_charge : null
  const balanceTransaction = charge && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null
  return {
    paymentIntentId,
    chargeId: charge?.id ?? idOf(paymentIntent.latest_charge),
    processingFeeCents: balanceTransaction?.fee ?? 0,
  }
}

export function invoicePaymentListParams(invoiceId: string): Stripe.InvoicePaymentListParams {
  return { invoice: invoiceId, status: 'paid', limit: 10 }
}

async function invoicePaymentDetails(invoiceId: string): Promise<PaymentDetails> {
  // Expanding through the list item, PaymentIntent, charge, and balance transaction
  // exceeds Stripe's four-level expansion limit. Retrieve the PaymentIntent separately.
  const payments = await getStripeClient().invoicePayments.list(invoicePaymentListParams(invoiceId))
  const paymentIntent = payments.data.find((item) => item.payment.type === 'payment_intent')?.payment.payment_intent
  return paymentDetailsForIntent(paymentIntent ?? null)
}

async function hydrateEvent(event: Stripe.Event): Promise<EventContext> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const source = event.data.object
      const checkoutSession = await getStripeClient().checkout.sessions.retrieve(source.id, {
        expand: ['line_items.data.price.product', 'payment_intent.latest_charge.balance_transaction'],
      })
      return { checkoutSession, payment: await paymentDetailsForIntent(checkoutSession.payment_intent) }
    }
    case 'checkout.session.expired':
      return { checkoutSession: event.data.object }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = event.data.object
      const subscriptionId = invoiceSubscriptionId(invoice)
      const subscription = subscriptionId ? await getStripeClient().subscriptions.retrieve(subscriptionId) : undefined
      const payment = event.type === 'invoice.paid' ? await invoicePaymentDetails(invoice.id) : undefined
      return { invoice, subscription, payment }
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return { subscription: event.data.object }
    default:
      return {}
  }
}

async function applyEvent(
  tx: Transaction,
  event: Stripe.Event,
  context: EventContext,
  changedUsers: Set<string>,
): Promise<void> {
  const eventAt = new Date(event.created * 1_000)
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await applyCheckoutStatus(tx, context.checkoutSession!)
      await applyPaidCheckout(tx, context.checkoutSession!, context.payment!, eventAt, changedUsers)
      return
    case 'checkout.session.expired':
      await applyCheckoutStatus(tx, context.checkoutSession!)
      return
    case 'invoice.paid':
      await applyPaidInvoice(tx, context.invoice!, context.subscription, context.payment!, eventAt, changedUsers)
      return
    case 'invoice.payment_failed':
      await applyFailedInvoice(tx, context.invoice!, changedUsers)
      return
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await upsertSubscription(tx, context.subscription!, eventAt, changedUsers)
      return
    case 'refund.created':
    case 'refund.updated':
      await applyRefund(tx, event.data.object, eventAt, changedUsers)
      return
    case 'charge.refunded':
      await applyRefundedCharge(tx, event.data.object, eventAt, changedUsers)
      return
    case 'charge.dispute.created':
      await applyDispute(tx, event.data.object, changedUsers)
  }
}

export async function processStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  const providerEventId = event.id
  const context = await hydrateEvent(event)
  const changedUsers = new Set<string>()
  try {
    const changes = await db.transaction(async (tx) => {
      await tx.insert(billingWebhookEvents).values({
        providerEventId,
        type: event.type,
        resourceId: 'id' in event.data.object ? String(event.data.object.id) : null,
      }).onConflictDoNothing()
      const [stored] = await tx.select().from(billingWebhookEvents)
        .where(eq(billingWebhookEvents.providerEventId, providerEventId)).for('update')
      if (stored?.status === 'processed') return []
      await tx.update(billingWebhookEvents).set({ status: 'processing', error: null, updatedAt: new Date() })
        .where(eq(billingWebhookEvents.providerEventId, providerEventId))
      await applyEvent(tx, event, context, changedUsers)
      for (const userId of changedUsers) await refreshStorageLimit(tx, userId, new Date(event.created * 1_000))
      for (const userId of [...changedUsers]) for (const peerId of await poolPeerIds(tx, userId)) changedUsers.add(peerId)
      const revisions = changedUsers.size > 0
        ? await tx.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
          .where(inArray(users.id, [...changedUsers]))
          .returning({ userId: users.id, revision: users.stateRevision })
        : []
      await tx.update(billingWebhookEvents).set({
        status: 'processed', processedAt: new Date(), updatedAt: new Date(),
      }).where(eq(billingWebhookEvents.providerEventId, providerEventId))
      return revisions
    })
    await Promise.all(changes.map((change) => publishStateChange({
      ...change,
      scopes: ['usage', 'pool', 'billing'],
    })))
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000)
    await db.insert(billingWebhookEvents).values({
      providerEventId,
      type: event.type,
      resourceId: 'id' in event.data.object ? String(event.data.object.id) : null,
      status: 'failed',
      error: message,
    }).onConflictDoUpdate({
      target: billingWebhookEvents.providerEventId,
      set: { status: 'failed', error: message, updatedAt: new Date() },
    })
    throw error
  }
}
