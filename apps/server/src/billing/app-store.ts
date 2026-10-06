import type { X509Certificate } from 'node:crypto'
import { eq, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { appStoreSubscriptions, appStoreTransactions, billingWebhookEvents, users } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { AppStoreSignatureError, verifyAppStoreSignedPayload } from './app-store-signing.js'
import type { PaidBillingPlan } from './plans.js'
import { publishBillingChanges, recordBillingChanges } from './state-changes.js'
import { placeBillingHold } from './webhooks.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type VerifyOptions = { trustedRoots?: X509Certificate[] }

const millis = z.number().int().nonnegative()

const transactionPayloadSchema = z.looseObject({
  transactionId: z.string().min(1).max(64),
  originalTransactionId: z.string().min(1).max(64),
  bundleId: z.string(),
  productId: z.string().min(1).max(200),
  type: z.string(),
  environment: z.string(),
  purchaseDate: millis,
  expiresDate: millis.optional(),
  signedDate: millis,
  appAccountToken: z.string().optional(),
  inAppOwnershipType: z.string().optional(),
  isUpgraded: z.boolean().optional(),
  revocationDate: millis.optional(),
  revocationReason: z.number().int().optional(),
  transactionReason: z.string().max(32).optional(),
  storefront: z.string().max(8).optional(),
  currency: z.string().max(8).optional(),
  price: z.number().int().optional(),
})
export type AppStoreTransaction = z.infer<typeof transactionPayloadSchema> & { expiresDate: number }

const renewalInfoPayloadSchema = z.looseObject({
  originalTransactionId: z.string().min(1).max(64),
  environment: z.string(),
  signedDate: millis,
  autoRenewProductId: z.string().max(200).optional(),
  autoRenewStatus: z.number().int().optional(),
  isInBillingRetryPeriod: z.boolean().optional(),
  gracePeriodExpiresDate: millis.optional(),
})
export type AppStoreRenewalInfo = z.infer<typeof renewalInfoPayloadSchema>

const notificationPayloadSchema = z.looseObject({
  notificationType: z.string().min(1).max(64),
  subtype: z.string().max(64).optional(),
  notificationUUID: z.string().min(1).max(64),
  signedDate: millis,
  data: z.looseObject({
    environment: z.string(),
    bundleId: z.string(),
    appAppleId: z.number().int().optional(),
    signedTransactionInfo: z.string().optional(),
    signedRenewalInfo: z.string().optional(),
  }).optional(),
})
export type AppStoreNotification = z.infer<typeof notificationPayloadSchema>

/** A verified App Store payload that Pulpo does not accept, such as another app's or a Family Sharing transaction. */
export class AppStorePayloadError extends Error {
  override name = 'AppStorePayloadError'
}

export type AppStoreSubscriptionStatus = 'active' | 'past_due' | 'expired' | 'revoked'

export interface AppStoreSubscriptionState {
  userId: string
  environment: string
  productId: string
  plan: PaidBillingPlan
  paidPlan: PaidBillingPlan
  status: AppStoreSubscriptionStatus
  autoRenew: boolean
  inBillingRetry: boolean
  latestTransactionId: string
  currentPeriodStart: Date
  expiresAt: Date
  gracePeriodExpiresAt: Date | null
  paidThrough: Date | null
  revokedAt: Date | null
  transactionSignedAt: Date
  renewalSignedAt: Date | null
}

export function appStoreProductIds(): Record<PaidBillingPlan, string> | null {
  const config = getConfig()
  if (!config.PULPO_BILLING_ENABLED || !config.APP_STORE_BILLING_ENABLED) return null
  return { eight: config.APP_STORE_EIGHT_PRODUCT_ID!, fat: config.APP_STORE_FAT_PRODUCT_ID! }
}

export function planForAppStoreProduct(productId: string | null | undefined): PaidBillingPlan | null {
  const products = appStoreProductIds()
  if (!products || !productId) return null
  if (productId === products.eight) return 'eight'
  if (productId === products.fat) return 'fat'
  return null
}

function acceptedEnvironment(environment: string): boolean {
  return environment === 'Production' || (environment === 'Sandbox' && getConfig().APP_STORE_ACCEPT_SANDBOX)
}

export function decodeAppStoreTransaction(signedTransaction: string, options: VerifyOptions = {}): AppStoreTransaction {
  const parsed = transactionPayloadSchema.safeParse(verifyAppStoreSignedPayload(signedTransaction, options))
  if (!parsed.success) throw new AppStorePayloadError('The App Store transaction is malformed')
  const transaction = parsed.data
  if (transaction.bundleId !== getConfig().APP_STORE_BUNDLE_ID) throw new AppStorePayloadError('The App Store transaction is for another app')
  if (!acceptedEnvironment(transaction.environment)) throw new AppStorePayloadError(`${transaction.environment} App Store transactions are not accepted`)
  if (transaction.type !== 'Auto-Renewable Subscription' || transaction.expiresDate === undefined) {
    throw new AppStorePayloadError('The App Store transaction is not an auto-renewable subscription')
  }
  if (!planForAppStoreProduct(transaction.productId)) throw new AppStorePayloadError('The App Store transaction is for an unknown product')
  // Pulpo plans belong to one account; Family Sharing should stay off for these products.
  if (transaction.inAppOwnershipType !== undefined && transaction.inAppOwnershipType !== 'PURCHASED') {
    throw new AppStorePayloadError('Family Sharing App Store subscriptions are not supported')
  }
  return transaction as AppStoreTransaction
}

export function decodeAppStoreRenewalInfo(signedRenewalInfo: string, options: VerifyOptions = {}): AppStoreRenewalInfo {
  const parsed = renewalInfoPayloadSchema.safeParse(verifyAppStoreSignedPayload(signedRenewalInfo, options))
  if (!parsed.success) throw new AppStorePayloadError('The App Store renewal info is malformed')
  if (!acceptedEnvironment(parsed.data.environment)) throw new AppStorePayloadError(`${parsed.data.environment} App Store renewal info is not accepted`)
  return parsed.data
}

export function decodeAppStoreNotification(signedPayload: string, options: VerifyOptions = {}): AppStoreNotification {
  const parsed = notificationPayloadSchema.safeParse(verifyAppStoreSignedPayload(signedPayload, options))
  if (!parsed.success) throw new AppStorePayloadError('The App Store notification is malformed')
  const notification = parsed.data
  const config = getConfig()
  if (notification.data) {
    if (notification.data.bundleId !== config.APP_STORE_BUNDLE_ID) throw new AppStorePayloadError('The App Store notification is for another app')
    if (notification.data.environment === 'Production' && notification.data.appAppleId !== config.APP_STORE_APP_APPLE_ID) {
      throw new AppStorePayloadError('The App Store notification is for another app')
    }
  }
  return notification
}

/** The transaction and renewal info of one subscription, checked to agree with each other. */
function decodeSubscriptionUpdate(signedTransaction: string, signedRenewalInfo: string | null | undefined, options: VerifyOptions) {
  const transaction = decodeAppStoreTransaction(signedTransaction, options)
  const renewalInfo = signedRenewalInfo ? decodeAppStoreRenewalInfo(signedRenewalInfo, options) : null
  if (renewalInfo && renewalInfo.originalTransactionId !== transaction.originalTransactionId) {
    throw new AppStorePayloadError('The App Store renewal info is for another subscription')
  }
  return { transaction, renewalInfo }
}

export function appStoreSubscriptionStatus(
  state: Pick<AppStoreSubscriptionState, 'revokedAt' | 'expiresAt' | 'gracePeriodExpiresAt' | 'inBillingRetry'>,
  now = new Date(),
): AppStoreSubscriptionStatus {
  if (state.revokedAt) return 'revoked'
  if (state.expiresAt > now) return 'active'
  if (state.gracePeriodExpiresAt && state.gracePeriodExpiresAt > now) return 'past_due'
  return state.inBillingRetry ? 'past_due' : 'expired'
}

/** Plan access runs to expiry, or to the end of a billing grace period, and ends at once on refund. */
export function appStorePaidThrough(state: Pick<AppStoreSubscriptionState, 'revokedAt' | 'expiresAt' | 'gracePeriodExpiresAt'>): Date | null {
  if (state.revokedAt) return null
  return state.gracePeriodExpiresAt && state.gracePeriodExpiresAt > state.expiresAt ? state.gracePeriodExpiresAt : state.expiresAt
}

/**
 * Folds a transaction and optional renewal info into the stored subscription. Payloads can
 * arrive late, twice, or out of order, so a transaction only replaces the stored one when
 * it covers a later period or is a newer signing of the same transaction (a refund, for
 * example), and renewal info only applies when Apple signed it after the stored copy.
 * Returns null when nothing changes, including for a payload that was already applied.
 */
export function mergeAppStoreSubscription(
  existing: AppStoreSubscriptionState | null,
  update: { userId: string; transaction: AppStoreTransaction; renewalInfo: AppStoreRenewalInfo | null },
  now = new Date(),
): AppStoreSubscriptionState | null {
  const { transaction, renewalInfo } = update
  const transactionSignedAt = new Date(transaction.signedDate)
  const expiresAt = new Date(transaction.expiresDate)
  // An upgraded transaction is replaced by the upgrade's own transaction.
  const transactionApplies = !transaction.isUpgraded && (!existing || (
    transaction.transactionId === existing.latestTransactionId
      ? transactionSignedAt > existing.transactionSignedAt
      : expiresAt > existing.expiresAt
  ))
  const renewalApplies = renewalInfo !== null
    && (!existing?.renewalSignedAt || renewalInfo.signedDate > existing.renewalSignedAt.getTime())
  if (existing && !transactionApplies && !renewalApplies) return null
  if (!existing && !transactionApplies) return null

  const paidPlan = planForAppStoreProduct(transaction.productId)!
  const base: AppStoreSubscriptionState = transactionApplies ? {
    userId: update.userId,
    environment: transaction.environment,
    productId: transaction.productId,
    // A new product means an upgrade or a renewal into a downgrade; either way the next
    // renewal bills that product until newer renewal info says otherwise.
    plan: existing && existing.productId === transaction.productId ? existing.plan : paidPlan,
    paidPlan,
    status: 'active',
    autoRenew: existing?.autoRenew ?? true,
    inBillingRetry: existing?.inBillingRetry ?? false,
    latestTransactionId: transaction.transactionId,
    currentPeriodStart: new Date(transaction.purchaseDate),
    expiresAt,
    gracePeriodExpiresAt: existing?.gracePeriodExpiresAt ?? null,
    paidThrough: null,
    revokedAt: transaction.revocationDate === undefined ? null : new Date(transaction.revocationDate),
    transactionSignedAt,
    renewalSignedAt: existing?.renewalSignedAt ?? null,
  } : { ...existing! }

  const next: AppStoreSubscriptionState = renewalApplies ? {
    ...base,
    plan: planForAppStoreProduct(renewalInfo.autoRenewProductId) ?? base.paidPlan,
    autoRenew: renewalInfo.autoRenewStatus === 1,
    inBillingRetry: renewalInfo.isInBillingRetryPeriod ?? false,
    gracePeriodExpiresAt: renewalInfo.gracePeriodExpiresDate === undefined ? null : new Date(renewalInfo.gracePeriodExpiresDate),
    renewalSignedAt: new Date(renewalInfo.signedDate),
  } : base
  return { ...next, status: appStoreSubscriptionStatus(next, now), paidThrough: appStorePaidThrough(next) }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function normalizedAccountToken(value: string | undefined): string | null {
  const token = value?.trim().toLowerCase()
  return token && UUID.test(token) ? token : null
}

function subscriptionState(row: typeof appStoreSubscriptions.$inferSelect): AppStoreSubscriptionState {
  return {
    userId: row.userId,
    environment: row.environment,
    productId: row.productId,
    plan: row.plan as PaidBillingPlan,
    paidPlan: row.paidPlan as PaidBillingPlan,
    status: row.status as AppStoreSubscriptionStatus,
    autoRenew: row.autoRenew,
    inBillingRetry: row.inBillingRetry,
    latestTransactionId: row.latestTransactionId,
    currentPeriodStart: row.currentPeriodStart,
    expiresAt: row.expiresAt,
    gracePeriodExpiresAt: row.gracePeriodExpiresAt,
    paidThrough: row.paidThrough,
    revokedAt: row.revokedAt,
    transactionSignedAt: row.transactionSignedAt,
    renewalSignedAt: row.renewalSignedAt,
  }
}

/**
 * Records a verified subscription update. A purchase made in the app carries the buyer's
 * Pulpo user ID as its app account token, which must match the account syncing it. A
 * subscription without a token (an offer code redeemed in the App Store, for example)
 * belongs to the first account that syncs it. Notifications follow the stored owner.
 */
async function applySubscriptionUpdate(
  tx: Transaction,
  update: { transaction: AppStoreTransaction; renewalInfo: AppStoreRenewalInfo | null; claimedUserId: string | null },
  changedUsers: Set<string>,
  now = new Date(),
): Promise<AppStoreSubscriptionState | null> {
  const { transaction, renewalInfo } = update
  const originalTransactionId = transaction.originalTransactionId
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`app-store:${originalTransactionId}`}))`)
  const [existing] = await tx.select().from(appStoreSubscriptions)
    .where(eq(appStoreSubscriptions.originalTransactionId, originalTransactionId))
  const token = normalizedAccountToken(transaction.appAccountToken)
  let ownerId: string | null
  if (update.claimedUserId) {
    if ((token && token !== update.claimedUserId) || (existing && existing.userId !== update.claimedUserId)) {
      throw new AppError(409, 'app_store_account_mismatch', 'This App Store subscription belongs to a different Pulpo account.')
    }
    ownerId = update.claimedUserId
  } else {
    ownerId = existing?.userId ?? token
  }
  if (!ownerId) return null
  const [owner] = await tx.select({ id: users.id, deleting: users.deletionRequestedAt }).from(users)
    .where(eq(users.id, ownerId)).limit(1).for('share')
  if (!owner || owner.deleting) return null

  const plan = planForAppStoreProduct(transaction.productId)!
  const transactionValues = {
    originalTransactionId,
    userId: owner.id,
    environment: transaction.environment,
    productId: transaction.productId,
    plan,
    transactionReason: transaction.transactionReason ?? null,
    storefront: transaction.storefront ?? null,
    currency: transaction.currency ?? null,
    priceMilliunits: transaction.price ?? null,
    purchasedAt: new Date(transaction.purchaseDate),
    expiresAt: new Date(transaction.expiresDate),
    revokedAt: transaction.revocationDate === undefined ? null : new Date(transaction.revocationDate),
    revocationReason: transaction.revocationReason ?? null,
    signedAt: new Date(transaction.signedDate),
  }
  await tx.insert(appStoreTransactions).values({ transactionId: transaction.transactionId, ...transactionValues })
    .onConflictDoUpdate({
      target: appStoreTransactions.transactionId,
      set: { revokedAt: transactionValues.revokedAt, revocationReason: transactionValues.revocationReason, signedAt: transactionValues.signedAt, updatedAt: new Date() },
      setWhere: lte(appStoreTransactions.signedAt, transactionValues.signedAt),
    })

  const current = existing ? subscriptionState(existing) : null
  const next = mergeAppStoreSubscription(current, { userId: owner.id, transaction, renewalInfo }, now)
  if (!next) return current
  const { userId: _userId, ...values } = next
  if (existing) {
    await tx.update(appStoreSubscriptions).set({ ...values, updatedAt: new Date() })
      .where(eq(appStoreSubscriptions.originalTransactionId, originalTransactionId))
  } else {
    await tx.insert(appStoreSubscriptions).values({ originalTransactionId, userId: owner.id, ...values })
  }
  changedUsers.add(owner.id)
  return next
}

export type AppStoreSubscriptionSummary = {
  provider: 'app_store'
  plan: PaidBillingPlan
  pendingPlan: PaidBillingPlan | null
  status: AppStoreSubscriptionStatus
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string
}

export function appStoreSubscriptionSummary(
  state: Pick<AppStoreSubscriptionState, 'autoRenew' | 'revokedAt' | 'expiresAt' | 'gracePeriodExpiresAt' | 'inBillingRetry'> & { plan: string; paidPlan: string },
  now = new Date(),
): AppStoreSubscriptionSummary {
  const plan: PaidBillingPlan = state.plan === 'fat' ? 'fat' : 'eight'
  const paidPlan: PaidBillingPlan = state.paidPlan === 'fat' ? 'fat' : 'eight'
  return {
    provider: 'app_store',
    plan: paidPlan,
    pendingPlan: state.autoRenew && plan !== paidPlan ? plan : null,
    status: appStoreSubscriptionStatus(state, now),
    cancelAtPeriodEnd: !state.autoRenew,
    currentPeriodEnd: state.expiresAt.toISOString(),
  }
}

function invalidTransaction(error: unknown): never {
  if (error instanceof AppStoreSignatureError || error instanceof AppStorePayloadError) {
    throw new AppError(422, 'invalid_app_store_transaction', error.message)
  }
  throw error
}

/** Records a purchase, renewal, or restore that the iOS app reports for the signed-in user. */
export async function syncAppStoreTransaction(
  userId: string,
  input: { signedTransaction: string; signedRenewalInfo?: string | null },
  options: VerifyOptions = {},
): Promise<AppStoreSubscriptionSummary | null> {
  let update: ReturnType<typeof decodeSubscriptionUpdate>
  try {
    update = decodeSubscriptionUpdate(input.signedTransaction, input.signedRenewalInfo, options)
  } catch (error) {
    invalidTransaction(error)
  }
  const changedUsers = new Set<string>()
  const { state, revisions } = await db.transaction(async (tx) => {
    const state = await applySubscriptionUpdate(tx, { ...update, claimedUserId: userId }, changedUsers)
    return { state, revisions: await recordBillingChanges(tx, changedUsers, new Date()) }
  })
  await publishBillingChanges(revisions)
  return state ? appStoreSubscriptionSummary(state) : null
}

/**
 * Applies an App Store Server Notification (version 2). Notifications are stored by UUID so
 * Apple's retries are applied once. A verified notification Pulpo cannot attribute or does
 * not support is acknowledged without changes so Apple stops retrying it.
 */
export async function processAppStoreNotification(signedPayload: string, options: VerifyOptions = {}): Promise<void> {
  const notification = decodeAppStoreNotification(signedPayload, options)
  const data = notification.data
  let update: ReturnType<typeof decodeSubscriptionUpdate> | null = null
  if (data?.signedTransactionInfo && acceptedEnvironment(data.environment)) {
    try {
      update = decodeSubscriptionUpdate(data.signedTransactionInfo, data.signedRenewalInfo, options)
    } catch (error) {
      if (!(error instanceof AppStorePayloadError)) throw error
    }
  }
  const providerEventId = `app_store:${notification.notificationUUID}`
  const type = ['app_store', notification.notificationType, notification.subtype].filter(Boolean).join('.')
  const resourceId = update?.transaction.originalTransactionId ?? null
  const changedUsers = new Set<string>()
  try {
    const revisions = await db.transaction(async (tx) => {
      await tx.insert(billingWebhookEvents).values({ providerEventId, type, resourceId }).onConflictDoNothing()
      const [stored] = await tx.select().from(billingWebhookEvents)
        .where(eq(billingWebhookEvents.providerEventId, providerEventId)).for('update')
      if (stored?.status === 'processed') return []
      await tx.update(billingWebhookEvents).set({ status: 'processing', error: null, updatedAt: new Date() })
        .where(eq(billingWebhookEvents.providerEventId, providerEventId))
      if (update) {
        const state = await applySubscriptionUpdate(tx, { ...update, claimedUserId: null }, changedUsers)
        const ownerId = state?.userId ?? null
        // Refunds put the account on a billing hold, as Stripe refunds do.
        if (ownerId && notification.notificationType === 'REFUND') {
          await placeBillingHold(tx, ownerId, 'payment_refunded', `app_store:${update.transaction.transactionId}`, changedUsers)
        }
      }
      const revisions = await recordBillingChanges(tx, changedUsers, new Date(notification.signedDate))
      await tx.update(billingWebhookEvents).set({ status: 'processed', processedAt: new Date(), updatedAt: new Date() })
        .where(eq(billingWebhookEvents.providerEventId, providerEventId))
      return revisions
    })
    await publishBillingChanges(revisions)
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000)
    await db.insert(billingWebhookEvents).values({ providerEventId, type, resourceId, status: 'failed', error: message })
      .onConflictDoUpdate({
        target: billingWebhookEvents.providerEventId,
        set: { status: 'failed', error: message, updatedAt: new Date() },
      })
    throw error
  }
}
