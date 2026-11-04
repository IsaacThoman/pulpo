import { ApiError } from '../../api/client'
import type { StoreKitTransaction } from './storeKit'

/**
 * Server answers that settle a transaction for good. Finishing it stops StoreKit redelivering it;
 * anything else (offline, a server error) leaves it unfinished to report again later.
 */
const SETTLED_CODES = new Set([
  'app_store_subscription_other_account',
  'app_store_sandbox_not_allowed',
  'app_store_environment_not_supported',
  'app_store_product_unknown',
  'invalid_app_store_transaction',
])

export type TransactionReport =
  | { status: 'applied' }
  | { status: 'rejected'; code: string; message: string }
  | { status: 'retry'; error: unknown }

export interface TransactionReporter {
  sync: (signedTransaction: string) => Promise<unknown>
  finish: (transactionId: string) => Promise<void>
}

/** Reports a transaction to Pulpo, then finishes it once the server has settled it. */
export async function reportTransaction(transaction: StoreKitTransaction, reporter: TransactionReporter): Promise<TransactionReport> {
  try {
    await reporter.sync(transaction.signedTransaction)
  } catch (error) {
    if (!(error instanceof ApiError) || !SETTLED_CODES.has(error.code)) return { status: 'retry', error }
    await reporter.finish(transaction.transactionId)
    return { status: 'rejected', code: error.code, message: error.message }
  }
  await reporter.finish(transaction.transactionId)
  return { status: 'applied' }
}

/** Reports transactions one at a time, so a renewal and its plan change apply in order. */
export async function reportTransactions(transactions: StoreKitTransaction[], reporter: TransactionReporter): Promise<TransactionReport[]> {
  const reports: TransactionReport[] = []
  for (const transaction of transactions) reports.push(await reportTransaction(transaction, reporter))
  return reports
}

export type PurchaseOutcome =
  | { status: 'purchased'; report: TransactionReport }
  | { status: 'cancelled' }
  | { status: 'pending' }

/** Buys a plan with this account's App Store token, then reports the purchase to Pulpo. */
export async function purchaseProduct(productId: string, deps: TransactionReporter & {
  accountToken: () => Promise<string>
  purchase: (productId: string, appAccountToken: string) => Promise<{ status: 'cancelled' | 'pending' } | ({ status: 'purchased' } & StoreKitTransaction)>
}): Promise<PurchaseOutcome> {
  const result = await deps.purchase(productId, await deps.accountToken())
  if (result.status !== 'purchased') return { status: result.status }
  return { status: 'purchased', report: await reportTransaction(result, deps) }
}

export type RestoreOutcome = 'restored' | 'nothing' | 'retry' | { rejected: string }

/** Reports this Apple Account's active Pulpo subscriptions, as Restore Purchases. */
export async function restorePurchases(productIds: string[], deps: TransactionReporter & {
  syncAppStore: () => Promise<void>
  currentEntitlements: () => Promise<StoreKitTransaction[]>
}): Promise<RestoreOutcome> {
  await deps.syncAppStore()
  const transactions = (await deps.currentEntitlements()).filter((item) => productIds.includes(item.productId))
  if (!transactions.length) return 'nothing'
  const reports = await reportTransactions(transactions, deps)
  if (reports.some((item) => item.status === 'applied')) return 'restored'
  const rejected = reports.find((item) => item.status === 'rejected')
  return rejected?.status === 'rejected' ? { rejected: rejected.message } : 'retry'
}
