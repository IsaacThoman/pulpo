import { NativeModule, requireOptionalNativeModule } from 'expo'

export interface StoreKitProduct {
  id: string
  displayName: string
  description: string
  /** Localized by the App Store, e.g. "$9.99". */
  displayPrice: string
  periodUnit: 'day' | 'week' | 'month' | 'year' | null
  periodValue: number | null
}

/** A transaction StoreKit verified on the device. The server verifies `signedTransaction` again. */
export interface StoreKitTransaction {
  transactionId: string
  originalTransactionId: string
  productId: string
  signedTransaction: string
}

export type StoreKitPurchaseResult =
  | ({ status: 'purchased' } & StoreKitTransaction)
  | { status: 'cancelled' }
  | { status: 'pending' }

type PulpoStoreKitEvents = {
  onTransaction(transaction: StoreKitTransaction): void
}

declare class PulpoStoreKitModule extends NativeModule<PulpoStoreKitEvents> {
  /** `production`, `sandbox` (TestFlight and development builds), or `xcode`; null when unknown. */
  environment(): Promise<string | null>
  products(ids: string[]): Promise<StoreKitProduct[]>
  purchase(productId: string, appAccountToken: string): Promise<StoreKitPurchaseResult>
  finish(transactionId: string): Promise<void>
  unfinished(): Promise<StoreKitTransaction[]>
  currentEntitlements(): Promise<StoreKitTransaction[]>
  /** Asks the App Store for this Apple Account's purchases; may prompt the user to sign in. */
  sync(): Promise<void>
  showManageSubscriptions(): Promise<void>
}

export default requireOptionalNativeModule<PulpoStoreKitModule>('PulpoStoreKit')
