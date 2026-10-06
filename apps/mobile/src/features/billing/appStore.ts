import { Platform } from 'react-native'
import PulpoStoreKit, { type StoreKitTransaction } from '../../../modules/pulpo-store-kit'
import { ApiError, mobileApi } from '../../api/client'
import type { BillingPlan, MobileBillingSummary, PaidBillingPlan } from '../../types'

export const storeKit = Platform.OS === 'ios' ? PulpoStoreKit : null

export const PAID_PLANS: readonly PaidBillingPlan[] = ['eight', 'fat']

export const planNames: Record<BillingPlan, string> = {
  baby: 'Pulpo Baby',
  eight: 'Pulpo Eight',
  fat: 'Le Pulpo Fat',
}

/** Shown under each plan before the person subscribes, as App Review requires. */
export function planBenefits(plan: PaidBillingPlan, summary: Pick<MobileBillingSummary, 'planStorageLimitBytes' | 'sharedWeeklyPercent'>): string[] {
  const storage = `${formatStorage(summary.planStorageLimitBytes[plan])} of file storage`
  return plan === 'eight'
    ? ['Everything in Pulpo Baby', 'High weekly and five-hour usage limits', storage]
    : ['Everything in Pulpo Eight', 'Highest weekly and five-hour usage limits', `Share ${summary.sharedWeeklyPercent}% of your weekly usage with your Pool`, storage]
}

function formatStorage(bytes: number): string {
  const gigabytes = bytes / 1024 ** 3
  return gigabytes >= 1 ? `${Number(gigabytes.toFixed(1))} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

/** The subscription length StoreKit reports, such as `month` or `3 months`. */
export function billingPeriodLabel(period: { unit: 'day' | 'week' | 'month' | 'year'; value: number } | undefined): string {
  if (!period) return 'month'
  return period.value === 1 ? period.unit : `${period.value} ${period.unit}s`
}

export type PlanOption = { label: string; purchasable: boolean }

/**
 * What each plan's button does. Apple changes the plan within one subscription group: an
 * upgrade starts at once and refunds the unused time, while a downgrade starts at renewal.
 * Renewing a canceled plan or undoing a scheduled downgrade happens in the App Store's
 * subscription settings.
 */
export function appStorePlanOptions(summary: Pick<MobileBillingSummary, 'subscription'>): Record<PaidBillingPlan, PlanOption> | null {
  const subscription = summary.subscription
  // A plan billed elsewhere cannot be changed here, and buying would charge twice.
  if (subscription && subscription.provider !== 'app_store') return null
  const option = (plan: PaidBillingPlan): PlanOption => {
    if (!subscription) return { label: 'Subscribe', purchasable: true }
    if (plan === subscription.plan) return { label: 'Current plan', purchasable: false }
    if (plan === subscription.pendingPlan) return { label: 'Starts at renewal', purchasable: false }
    return plan === 'fat' ? { label: 'Upgrade', purchasable: true } : { label: 'Switch at renewal', purchasable: true }
  }
  return { eight: option('eight'), fat: option('fat') }
}

export function subscriptionStatusText(summary: Pick<MobileBillingSummary, 'subscription' | 'planOverridden'>, formatDate: (iso: string) => string): string {
  const subscription = summary.subscription
  if (!subscription) return summary.planOverridden ? 'Granted by an administrator' : 'No subscription'
  if (subscription.provider !== 'app_store') return 'Not billed through the App Store'
  const date = subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : null
  if (subscription.status === 'past_due') return 'Payment problem · update your payment method in the App Store'
  if (subscription.cancelAtPeriodEnd) return date ? `Ends ${date}` : 'Ends after this period'
  if (subscription.pendingPlan) return date ? `Switches to ${planNames[subscription.pendingPlan]} on ${date}` : `Switches to ${planNames[subscription.pendingPlan]} at renewal`
  return date ? `Renews ${date}` : 'Renews monthly'
}

/** A server rejection that retrying the same transaction will not fix. */
export function isPermanentSyncFailure(error: unknown): boolean {
  return error instanceof ApiError && [400, 403, 409, 422].includes(error.status)
}

function belongsToAnotherAccount(transaction: StoreKitTransaction, userId: string): boolean {
  return Boolean(transaction.appAccountToken && transaction.appAccountToken !== userId.toLowerCase())
}

/**
 * Records a transaction on the server, then finishes it so StoreKit stops redelivering it.
 * A transaction that failed to sync for a temporary reason stays unfinished and is retried
 * at the next launch. One bought for another Pulpo account is finished without syncing;
 * the server links it to that account from Apple's notifications.
 */
export async function syncStoreTransaction(transaction: StoreKitTransaction, userId: string): Promise<boolean> {
  if (!storeKit) return false
  if (belongsToAnotherAccount(transaction, userId)) {
    await storeKit.finishTransaction(transaction.transactionId)
    return false
  }
  try {
    await mobileApi.syncAppStoreTransaction(transaction.signedTransaction, transaction.signedRenewalInfo ?? null)
  } catch (error) {
    if (isPermanentSyncFailure(error)) await storeKit.finishTransaction(transaction.transactionId)
    throw error
  }
  await storeKit.finishTransaction(transaction.transactionId)
  return true
}

export async function syncUnfinishedTransactions(userId: string): Promise<void> {
  if (!storeKit) return
  for (const transaction of await storeKit.unfinishedTransactions()) {
    await syncStoreTransaction(transaction, userId).catch(() => undefined)
  }
}

/**
 * Re-sends this account's active App Store subscriptions to the server, in case it missed a
 * renewal or a purchase made on another device. Subscriptions without an account token are
 * only linked by Restore Purchases, which the person asks for.
 */
export async function syncAccountEntitlements(userId: string): Promise<void> {
  if (!storeKit) return
  for (const transaction of await storeKit.currentEntitlements()) {
    if (transaction.revoked || transaction.appAccountToken !== userId.toLowerCase()) continue
    await mobileApi.syncAppStoreTransaction(transaction.signedTransaction, transaction.signedRenewalInfo ?? null).catch(() => undefined)
  }
}

/** Whether this Apple Account already pays for a Pulpo subscription linked to another Pulpo account. */
export async function hasSubscriptionForAnotherAccount(userId: string): Promise<boolean> {
  if (!storeKit) return false
  const entitlements = await storeKit.currentEntitlements()
  return entitlements.some((transaction) => !transaction.revoked && belongsToAnotherAccount(transaction, userId))
}

/**
 * Restore Purchases: refreshes the App Store's transactions for this Apple Account and
 * links its active subscription to the signed-in Pulpo account.
 */
export async function restorePurchases(userId: string): Promise<'restored' | 'none' | 'other_account'> {
  if (!storeKit) return 'none'
  await storeKit.sync()
  let result: 'restored' | 'none' | 'other_account' = 'none'
  for (const transaction of await storeKit.currentEntitlements()) {
    if (transaction.revoked) continue
    if (belongsToAnotherAccount(transaction, userId)) {
      if (result === 'none') result = 'other_account'
      continue
    }
    try {
      await mobileApi.syncAppStoreTransaction(transaction.signedTransaction, transaction.signedRenewalInfo ?? null)
      result = 'restored'
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'app_store_account_mismatch')) throw error
      if (result === 'none') result = 'other_account'
    }
  }
  return result
}
