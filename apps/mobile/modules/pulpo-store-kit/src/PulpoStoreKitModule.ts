import { NativeModule, requireOptionalNativeModule } from 'expo'

export interface StoreKitProduct {
  id: string
  displayName: string
  description: string
  /** Localized price for the person's App Store storefront. */
  displayPrice: string
  period?: { unit: 'day' | 'week' | 'month' | 'year'; value: number }
}

export interface StoreKitTransaction {
  transactionId: string
  originalTransactionId: string
  productId: string
  /** Apple-signed JWS for the server to verify. */
  signedTransaction: string
  signedRenewalInfo?: string
  appAccountToken?: string
  /** Milliseconds since the epoch. */
  expiresAt?: number
  revoked: boolean
}

export type StoreKitPurchaseResult =
  | { status: 'purchased'; transaction?: StoreKitTransaction }
  | { status: 'pending' | 'cancelled' }

type PulpoStoreKitEvents = {
  onTransactionUpdated: (transaction: StoreKitTransaction) => void
}

declare class PulpoStoreKitModule extends NativeModule<PulpoStoreKitEvents> {
  canMakePayments(): Promise<boolean>
  getProducts(productIds: string[]): Promise<StoreKitProduct[]>
  purchase(productId: string, appAccountToken: string): Promise<StoreKitPurchaseResult>
  finishTransaction(transactionId: string): Promise<void>
  unfinishedTransactions(): Promise<StoreKitTransaction[]>
  currentEntitlements(): Promise<StoreKitTransaction[]>
  sync(): Promise<void>
  showManageSubscriptions(): Promise<void>
}

// iOS only; null on Android and in tests.
export default requireOptionalNativeModule<PulpoStoreKitModule>('PulpoStoreKit')
