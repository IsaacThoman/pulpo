import { Platform } from 'react-native'
import PulpoStoreKit from '../../../modules/pulpo-storekit'

export type { StoreKitProduct, StoreKitPurchaseResult, StoreKitTransaction } from '../../../modules/pulpo-storekit'

/** StoreKit, or null on Android and in builds without the native module. */
export const storeKit = Platform.OS === 'ios' ? PulpoStoreKit : null
