import { randomUUID } from 'node:crypto'
import { and, eq, gte, inArray, lt, or, sql } from 'drizzle-orm'
import { VerificationException } from '@apple/app-store-server-library'
import { db } from '../database/client.js'
import {
  billingAccounts,
  billingOrders,
  billingSubscriptions,
  billingWebhookEvents,
  users,
  type AppStoreEnvironment,
} from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import {
  acceptedAppStoreEnvironments,
  appStoreBillingReason,
  appStoreOrderAmounts,
  appStorePlanForProduct,
  appStoreSubscriptionState,
  appStoreVerificationError,
  claimedAppStoreEnvironment,
  getAppStoreGateway,
  isRefundedTransaction,
  statusFromTransaction,
  type AppStoreRenewalInfo,
  type AppStoreTransaction,
} from './app-store.js'
import { getBillingEntitlements } from './entitlements.js'
import { commitBillingChanges, isStaleProviderUpdate, placeBillingHold, publishBillingChanges, publishCommittedBillingChanges } from './webhooks.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Apple's state for one subscription at one moment. */
export type AppStoreSnapshot = {
  environment: AppStoreEnvironment
  status: number
  transaction: AppStoreTransaction
  renewal: AppStoreRenewalInfo | null
  signedAt: Date
}

export type AppStoreSnapshotResult =
  | 'applied'
  | 'stale'
  | 'unknown_owner'
  | 'other_account'
  | 'sandbox_not_allowed'
  | 'unknown_product'

// Reconciliation re-reads this much transaction history to catch missed renewals and refunds.
const HISTORY_WINDOW_MS = 35 * 24 * 60 * 60 * 1_000
// The sandbox sync looks at subscriptions renewing within this window. Sandbox months last minutes.
const SANDBOX_RENEWAL_WINDOW_MS = 10 * 60 * 1_000

function appleDate(value: number | undefined): Date | null {
  return typeof value === 'number' ? new Date(value) : null
}

function latestSignedDate(...values: Array<number | undefined>): Date {
  const dates = values.filter((value): value is number => typeof value === 'number')
  return new Date(dates.length ? Math.max(...dates) : Date.now())
}

/** The account's App Store token, created on first use. */
export async function appStoreAccountToken(userId: string): Promise<string> {
  const [account] = await db.insert(billingAccounts).values({ userId, appStoreAccountToken: randomUUID() })
    .onConflictDoUpdate({
      target: billingAccounts.userId,
      set: { appStoreAccountToken: sql`coalesce(${billingAccounts.appStoreAccountToken}, excluded.app_store_account_token)` },
    })
    .returning({ token: billingAccounts.appStoreAccountToken })
  return account!.token!
}

async function tokenOwner(tx: Transaction, token: string | undefined): Promise<string | null> {
  if (!token) return null
  const [account] = await tx.select({ userId: billingAccounts.userId }).from(billingAccounts)
    .where(eq(billingAccounts.appStoreAccountToken, token)).limit(1)
  return account?.userId ?? null
}

/**
 * Who a subscription belongs to. The first account to claim it keeps it. Otherwise the purchase's
 * account token decides, and an account that claims a purchase made with another account's token is refused.
 */
export function appStoreSubscriptionOwner(input: {
  boundUserId: string | null
  tokenUserId: string | null
  claimant: string | null
}): { userId: string } | 'other_account' | null {
  if (input.boundUserId) {
    return input.claimant && input.claimant !== input.boundUserId ? 'other_account' : { userId: input.boundUserId }
  }
  if (input.claimant) {
    return input.tokenUserId && input.tokenUserId !== input.claimant ? 'other_account' : { userId: input.claimant }
  }
  return input.tokenUserId ? { userId: input.tokenUserId } : null
}

async function activeAccount(tx: Transaction, userId: string): Promise<{ sandboxAllowed: boolean } | null> {
  const [user] = await tx.select({ deleting: users.deletionRequestedAt }).from(users)
    .where(eq(users.id, userId)).limit(1).for('share')
  if (!user || user.deleting) return null
  const [account] = await tx.select({ sandboxAllowed: billingAccounts.appStoreSandboxAllowed }).from(billingAccounts)
    .where(eq(billingAccounts.userId, userId)).limit(1)
  return { sandboxAllowed: account?.sandboxAllowed ?? false }
}

/**
 * Stores one App Store transaction as an order. A refund marks the order refunded and places a
 * billing hold once; a reversed refund marks it paid again and leaves any hold for an admin.
 */
export async function recordAppStoreTransaction(tx: Transaction, input: {
  userId: string
  environment: AppStoreEnvironment
  transaction: AppStoreTransaction
}, changedUsers: Set<string>): Promise<void> {
  const transaction = input.transaction
  const plan = appStorePlanForProduct(transaction.productId)
  // Family members share a purchase without paying for it.
  if (!plan || !transaction.transactionId || !transaction.originalTransactionId || transaction.inAppOwnershipType === 'FAMILY_SHARED') return
  const amounts = appStoreOrderAmounts(transaction, { environment: input.environment, plan })
  const paidAt = appleDate(transaction.purchaseDate) ?? new Date()
  await tx.insert(billingOrders).values({
    providerPaymentId: transaction.transactionId,
    provider: 'app_store',
    userId: input.userId,
    providerSubscriptionId: transaction.originalTransactionId,
    providerProductId: transaction.productId!,
    billingReason: appStoreBillingReason(transaction),
    status: 'paid',
    currency: 'usd',
    subtotalAmountCents: amounts.netCents,
    netAmountCents: amounts.netCents,
    totalAmountCents: amounts.netCents,
    processingFeeAmountCents: amounts.feeCents,
    paidAt,
    createdAt: paidAt,
  }).onConflictDoNothing({ target: billingOrders.providerPaymentId })
  const [order] = await tx.select().from(billingOrders)
    .where(eq(billingOrders.providerPaymentId, transaction.transactionId)).for('update')
  if (!order || order.userId !== input.userId) return
  const refunded = isRefundedTransaction(transaction)
  if (refunded && order.status !== 'refunded') {
    await tx.update(billingOrders).set({
      status: 'refunded',
      refundedAmountCents: amounts.refundCents,
      refundedAt: appleDate(transaction.revocationDate),
      updatedAt: new Date(),
    }).where(eq(billingOrders.providerPaymentId, order.providerPaymentId))
    await placeBillingHold(tx, input.userId, 'payment_refunded', transaction.transactionId, changedUsers)
  } else if (!refunded && order.status === 'refunded') {
    await tx.update(billingOrders).set({ status: 'paid', refundedAmountCents: 0, refundedAt: null, updatedAt: new Date() })
      .where(eq(billingOrders.providerPaymentId, order.providerPaymentId))
    changedUsers.add(input.userId)
  }
}

/** Applies Apple's state for a subscription, recording its latest transaction as an order. */
export async function applyAppStoreSnapshot(
  tx: Transaction,
  snapshot: AppStoreSnapshot,
  options: { claimant?: string },
  changedUsers: Set<string>,
): Promise<AppStoreSnapshotResult> {
  const state = appStoreSubscriptionState(snapshot)
  const originalTransactionId = snapshot.transaction.originalTransactionId
  if (!state || !originalTransactionId) return 'unknown_product'
  const [existing] = await tx.select().from(billingSubscriptions)
    .where(eq(billingSubscriptions.providerSubscriptionId, originalTransactionId)).for('update')
  if (existing && existing.provider !== 'app_store') return 'unknown_product'
  const owner = appStoreSubscriptionOwner({
    boundUserId: existing?.userId ?? null,
    tokenUserId: await tokenOwner(tx, snapshot.transaction.appAccountToken ?? snapshot.renewal?.appAccountToken),
    claimant: options.claimant ?? null,
  })
  if (owner === 'other_account') return 'other_account'
  if (!owner) return 'unknown_owner'
  const account = await activeAccount(tx, owner.userId)
  if (!account) return 'unknown_owner'
  if (snapshot.environment === 'sandbox' && !account.sandboxAllowed) return 'sandbox_not_allowed'
  await recordAppStoreTransaction(tx, { userId: owner.userId, environment: snapshot.environment, transaction: snapshot.transaction }, changedUsers)
  if (existing && isStaleProviderUpdate(existing.providerModifiedAt, snapshot.signedAt)) return 'stale'
  const values = {
    userId: owner.userId,
    providerProductId: snapshot.transaction.productId!,
    providerEnvironment: snapshot.environment,
    plan: state.plan,
    paidPlan: state.paidPlan,
    paidPlanAt: snapshot.signedAt,
    status: state.status,
    cancelAtPeriodEnd: state.cancelAtPeriodEnd,
    currentPeriodStart: state.currentPeriodStart,
    currentPeriodEnd: state.currentPeriodEnd,
    paidThrough: state.paidThrough,
    providerModifiedAt: snapshot.signedAt,
    updatedAt: new Date(),
  }
  if (existing) {
    await tx.update(billingSubscriptions).set(values)
      .where(eq(billingSubscriptions.providerSubscriptionId, originalTransactionId))
  } else {
    await tx.insert(billingSubscriptions).values({ providerSubscriptionId: originalTransactionId, provider: 'app_store', ...values })
  }
  changedUsers.add(owner.userId)
  return 'applied'
}

function snapshotFromTransaction(environment: AppStoreEnvironment, transaction: AppStoreTransaction): AppStoreSnapshot {
  return {
    environment,
    status: statusFromTransaction(transaction),
    transaction,
    renewal: null,
    signedAt: latestSignedDate(transaction.signedDate),
  }
}

/** Apple's current state for a subscription, or null when Apple has no record of it. */
async function currentSnapshot(environment: AppStoreEnvironment, originalTransactionId: string): Promise<AppStoreSnapshot | null> {
  const gateway = getAppStoreGateway()
  const status = await gateway.subscriptionStatus(environment, originalTransactionId)
  if (!status) return null
  const transaction = await gateway.verifyTransaction(environment, status.signedTransactionInfo)
  const renewal = status.signedRenewalInfo ? await gateway.verifyRenewalInfo(environment, status.signedRenewalInfo) : null
  return {
    environment,
    status: status.status,
    transaction,
    renewal,
    signedAt: latestSignedDate(transaction.signedDate, renewal?.signedDate),
  }
}

/**
 * Grants the plan for a purchase or restore the app reports. The posted transaction is verified
 * locally, then Apple's current status decides the plan, since the posted one may be an old renewal.
 */
export async function syncAppStorePurchase(userId: string, signedTransaction: string): Promise<{ plan: string }> {
  const environment = claimedAppStoreEnvironment(signedTransaction, 'transaction')
  if (!environment || !acceptedAppStoreEnvironments().includes(environment)) {
    throw new AppError(403, 'app_store_environment_not_supported', 'This server does not accept purchases from this build of Pulpo')
  }
  let transaction: AppStoreTransaction
  try {
    transaction = await getAppStoreGateway().verifyTransaction(environment, signedTransaction)
  } catch (error) {
    throw appStoreVerificationError(error)
  }
  const originalTransactionId = transaction.originalTransactionId
  if (!appStorePlanForProduct(transaction.productId) || !originalTransactionId) {
    throw new AppError(422, 'app_store_product_unknown', 'This purchase is not a Pulpo plan')
  }
  let snapshot: AppStoreSnapshot
  try {
    snapshot = await currentSnapshot(environment, originalTransactionId) ?? snapshotFromTransaction(environment, transaction)
  } catch (error) {
    if (error instanceof VerificationException) throw appStoreVerificationError(error)
    // The posted transaction is already verified, so grant from it; reconciliation catches up later.
    console.warn(JSON.stringify({
      event: 'app_store_status_unavailable',
      originalTransactionId,
      error: error instanceof Error ? error.message : String(error),
    }))
    snapshot = snapshotFromTransaction(environment, transaction)
  }
  const changedUsers = new Set<string>()
  const { result, changes } = await db.transaction(async (tx) => {
    const result = await applyAppStoreSnapshot(tx, snapshot, { claimant: userId }, changedUsers)
    if (result !== 'applied' && result !== 'stale') return { result, changes: [] }
    if (snapshot.transaction.transactionId !== transaction.transactionId) {
      await recordAppStoreTransaction(tx, { userId, environment, transaction }, changedUsers)
    }
    return { result, changes: await commitBillingChanges(tx, changedUsers, new Date()) }
  })
  await publishBillingChanges(changes)
  if (result === 'other_account') {
    throw new AppError(409, 'app_store_subscription_other_account', 'This App Store subscription belongs to another Pulpo account')
  }
  if (result === 'sandbox_not_allowed') {
    throw new AppError(403, 'app_store_sandbox_not_allowed', 'Sandbox purchases are not enabled for this account')
  }
  if (result === 'unknown_owner') throw new AppError(409, 'account_deleting', 'This account is being deleted')
  if (result === 'unknown_product') throw new AppError(422, 'app_store_product_unknown', 'This purchase is not a Pulpo plan')
  const entitlements = await getBillingEntitlements(userId)
  return { plan: entitlements.plan }
}

async function recordNotificationFailure(input: { id: string; type: string; resourceId: string | null; error: unknown }): Promise<void> {
  const message = input.error instanceof Error ? input.error.message.slice(0, 2_000) : String(input.error).slice(0, 2_000)
  await db.insert(billingWebhookEvents).values({
    providerEventId: input.id,
    provider: 'app_store',
    type: input.type,
    resourceId: input.resourceId,
    status: 'failed',
    error: message,
  }).onConflictDoUpdate({
    target: billingWebhookEvents.providerEventId,
    set: { status: 'failed', error: message, updatedAt: new Date() },
  })
}

/**
 * Handles an App Store Server Notification V2. Notifications for environments this server does not
 * accept, and for subscriptions no account here owns, are acknowledged and ignored so Apple stops retrying.
 */
export async function processAppStoreNotification(signedPayload: string): Promise<void> {
  const environment = claimedAppStoreEnvironment(signedPayload, 'notification')
  if (!environment || !acceptedAppStoreEnvironments().includes(environment)) return
  const gateway = getAppStoreGateway()
  let notification
  try {
    notification = await gateway.verifyNotification(environment, signedPayload)
  } catch (error) {
    throw appStoreVerificationError(error)
  }
  const id = notification.notificationUUID
  if (!id) throw new AppError(400, 'invalid_webhook', 'Invalid App Store notification')
  const type = [notification.notificationType, notification.subtype].filter(Boolean).join('.')
  const data = notification.data
  let snapshot: AppStoreSnapshot | null = null
  try {
    const transaction = data?.signedTransactionInfo ? await gateway.verifyTransaction(environment, data.signedTransactionInfo) : null
    const renewal = data?.signedRenewalInfo ? await gateway.verifyRenewalInfo(environment, data.signedRenewalInfo) : null
    snapshot = transaction ? {
      environment,
      status: typeof data?.status === 'number' ? data.status : statusFromTransaction(transaction),
      transaction,
      renewal,
      signedAt: latestSignedDate(notification.signedDate),
    } : null
  } catch (error) {
    throw appStoreVerificationError(error)
  }
  const resourceId = snapshot?.transaction.originalTransactionId ?? null
  const changedUsers = new Set<string>()
  let changes: Array<{ userId: string; revision: number }>
  try {
    changes = await db.transaction(async (tx) => {
      await tx.insert(billingWebhookEvents).values({ providerEventId: id, provider: 'app_store', type, resourceId }).onConflictDoNothing()
      const [stored] = await tx.select().from(billingWebhookEvents)
        .where(eq(billingWebhookEvents.providerEventId, id)).for('update')
      if (stored?.status === 'processed') return []
      await tx.update(billingWebhookEvents).set({ status: 'processing', error: null, updatedAt: new Date() })
        .where(eq(billingWebhookEvents.providerEventId, id))
      if (snapshot) await applyAppStoreSnapshot(tx, snapshot, {}, changedUsers)
      const revisions = await commitBillingChanges(tx, changedUsers, snapshot?.signedAt ?? new Date())
      await tx.update(billingWebhookEvents).set({ status: 'processed', processedAt: new Date(), updatedAt: new Date() })
        .where(eq(billingWebhookEvents.providerEventId, id))
      return revisions
    })
  } catch (error) {
    await recordNotificationFailure({ id, type, resourceId, error })
    throw error
  }
  await publishCommittedBillingChanges(changes, 'app_store')
}

async function reconcileAppStoreSubscription(row: {
  id: string
  userId: string
  environment: AppStoreEnvironment
}, includeHistory: boolean): Promise<void> {
  const gateway = getAppStoreGateway()
  const snapshot = await currentSnapshot(row.environment, row.id)
  const history: AppStoreTransaction[] = []
  if (includeHistory) {
    for await (const signed of gateway.transactionHistory(row.environment, row.id, new Date(Date.now() - HISTORY_WINDOW_MS))) {
      const transaction = await gateway.verifyTransaction(row.environment, signed)
      // History covers every subscription the Apple account bought in this app.
      if (transaction.originalTransactionId === row.id) history.push(transaction)
    }
  }
  const changedUsers = new Set<string>()
  const changes = await db.transaction(async (tx) => {
    const result = snapshot ? await applyAppStoreSnapshot(tx, snapshot, {}, changedUsers) : 'applied'
    if (result === 'applied' || result === 'stale') {
      for (const transaction of history) {
        await recordAppStoreTransaction(tx, { userId: row.userId, environment: row.environment, transaction }, changedUsers)
      }
    }
    return commitBillingChanges(tx, changedUsers, new Date())
  })
  await publishBillingChanges(changes)
}

/**
 * Re-reads Apple's state for App Store subscriptions this server tracks. The hourly run covers live
 * and recently ended subscriptions with their recent history. `sandboxRenewals` covers only sandbox
 * subscriptions about to renew, because sandbox months last minutes and this server may not receive
 * sandbox notifications.
 */
export async function reconcileAppStoreBilling(options: { sandboxRenewals?: boolean } = {}): Promise<void> {
  const environments = acceptedAppStoreEnvironments()
  if (environments.length === 0) return
  const now = Date.now()
  const live = inArray(billingSubscriptions.status, ['active', 'past_due'])
  const rows = await db.select({
    id: billingSubscriptions.providerSubscriptionId,
    userId: billingSubscriptions.userId,
    environment: billingSubscriptions.providerEnvironment,
  }).from(billingSubscriptions)
    .leftJoin(billingAccounts, eq(billingAccounts.userId, billingSubscriptions.userId))
    .where(and(
      eq(billingSubscriptions.provider, 'app_store'),
      inArray(billingSubscriptions.providerEnvironment, environments),
      or(eq(billingSubscriptions.providerEnvironment, 'production'), eq(billingAccounts.appStoreSandboxAllowed, true)),
      options.sandboxRenewals
        ? and(
          eq(billingSubscriptions.providerEnvironment, 'sandbox'),
          live,
          lt(billingSubscriptions.paidThrough, new Date(now + SANDBOX_RENEWAL_WINDOW_MS)),
        )
        : or(live, gte(billingSubscriptions.updatedAt, new Date(now - HISTORY_WINDOW_MS))),
    ))
  const failures: string[] = []
  for (const row of rows) {
    try {
      await reconcileAppStoreSubscription({ id: row.id, userId: row.userId, environment: row.environment! }, !options.sandboxRenewals)
    } catch (error) {
      failures.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failures.length) {
    throw new Error(`App Store reconciliation failed for ${failures.length} of ${rows.length} subscriptions: ${failures.slice(0, 3).join('; ')}`)
  }
}

/** Ends an account's sandbox subscriptions when an admin turns sandbox purchases off for it. */
export async function revokeSandboxSubscriptions(tx: Transaction, userId: string): Promise<boolean> {
  const revoked = await tx.update(billingSubscriptions).set({ status: 'canceled', paidThrough: null, updatedAt: new Date() })
    .where(and(
      eq(billingSubscriptions.userId, userId),
      eq(billingSubscriptions.provider, 'app_store'),
      eq(billingSubscriptions.providerEnvironment, 'sandbox'),
      inArray(billingSubscriptions.status, ['active', 'past_due']),
    ))
    .returning({ id: billingSubscriptions.providerSubscriptionId })
  return revoked.length > 0
}

/** Whether Apple will keep billing the account, which deleting it does not stop. */
export function hasRenewingAppStoreSubscription(subscriptions: Array<{ provider: string; status: string; cancelAtPeriodEnd: boolean }>): boolean {
  return subscriptions.some((item) => item.provider === 'app_store'
    && (item.status === 'active' || item.status === 'past_due')
    && !item.cancelAtPeriodEnd)
}

/** Whether deleting this account would leave Apple billing it. */
export async function appStoreSubscriptionRenews(userId: string): Promise<boolean> {
  const rows = await db.select({
    provider: billingSubscriptions.provider,
    status: billingSubscriptions.status,
    cancelAtPeriodEnd: billingSubscriptions.cancelAtPeriodEnd,
  }).from(billingSubscriptions)
    .where(and(eq(billingSubscriptions.userId, userId), eq(billingSubscriptions.provider, 'app_store')))
  return hasRenewingAppStoreSubscription(rows)
}
