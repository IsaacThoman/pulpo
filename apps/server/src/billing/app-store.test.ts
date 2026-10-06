import { describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({
  PULPO_BILLING_ENABLED: true,
  APP_STORE_BILLING_ENABLED: true,
  APP_STORE_BUNDLE_ID: 'com.isaacthoman.pulpo',
  APP_STORE_APP_APPLE_ID: 6_740_000_000,
  APP_STORE_EIGHT_PRODUCT_ID: 'baby.pulpo.eight.monthly',
  APP_STORE_FAT_PRODUCT_ID: 'baby.pulpo.fat.monthly',
  APP_STORE_ACCEPT_SANDBOX: true,
}))

vi.mock('../config.js', () => ({ getConfig: () => config }))

import {
  AppStorePayloadError,
  appStorePaidThrough,
  appStoreSubscriptionStatus,
  appStoreSubscriptionSummary,
  decodeAppStoreNotification,
  decodeAppStoreTransaction,
  mergeAppStoreSubscription,
  planForAppStoreProduct,
  type AppStoreRenewalInfo,
  type AppStoreSubscriptionState,
  type AppStoreTransaction,
} from './app-store.js'
import { signTestAppStorePayload, testAppStoreRoot } from './fixtures/app-store/sign.js'
import { effectivePlan } from './plans.js'

const options = { trustedRoots: [testAppStoreRoot] }
const userId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
const day = 24 * 60 * 60 * 1_000
const now = new Date('2026-10-06T12:00:00Z')
const start = Date.parse('2026-10-01T00:00:00Z')

function transaction(overrides: Partial<AppStoreTransaction> = {}): AppStoreTransaction {
  return {
    transactionId: '2000000000000001',
    originalTransactionId: '2000000000000001',
    bundleId: 'com.isaacthoman.pulpo',
    productId: 'baby.pulpo.eight.monthly',
    type: 'Auto-Renewable Subscription',
    environment: 'Production',
    purchaseDate: start,
    expiresDate: start + 30 * day,
    signedDate: start,
    appAccountToken: userId,
    inAppOwnershipType: 'PURCHASED',
    transactionReason: 'PURCHASE',
    storefront: 'USA',
    currency: 'USD',
    price: 9_990,
    ...overrides,
  }
}

function renewal(overrides: Partial<AppStoreRenewalInfo> = {}): AppStoreRenewalInfo {
  return {
    originalTransactionId: '2000000000000001',
    environment: 'Production',
    signedDate: start,
    autoRenewProductId: 'baby.pulpo.eight.monthly',
    autoRenewStatus: 1,
    isInBillingRetryPeriod: false,
    ...overrides,
  }
}

function merge(existing: AppStoreSubscriptionState | null, next: AppStoreTransaction, renewalInfo: AppStoreRenewalInfo | null = null, at = now) {
  return mergeAppStoreSubscription(existing, { userId, transaction: next, renewalInfo }, at)
}

describe('App Store payload validation', () => {
  it('maps configured products to plans', () => {
    expect(planForAppStoreProduct('baby.pulpo.eight.monthly')).toBe('eight')
    expect(planForAppStoreProduct('baby.pulpo.fat.monthly')).toBe('fat')
    expect(planForAppStoreProduct('baby.pulpo.credits')).toBeNull()
  })

  it('accepts a signed subscription transaction for this app', () => {
    expect(decodeAppStoreTransaction(signTestAppStorePayload(transaction()), options)).toMatchObject({
      transactionId: '2000000000000001', productId: 'baby.pulpo.eight.monthly',
    })
  })

  it.each([
    ['another app', { bundleId: 'com.example.other' }, 'for another app'],
    ['a local StoreKit test', { environment: 'Xcode' }, 'Xcode App Store transactions are not accepted'],
    ['a consumable', { type: 'Consumable' }, 'not an auto-renewable subscription'],
    ['an unknown product', { productId: 'baby.pulpo.yearly' }, 'unknown product'],
    ['Family Sharing', { inAppOwnershipType: 'FAMILY_SHARED' }, 'Family Sharing'],
  ])('rejects %s', (_name, overrides, message) => {
    expect(() => decodeAppStoreTransaction(signTestAppStorePayload(transaction(overrides as Partial<AppStoreTransaction>)), options))
      .toThrow(message)
  })

  it('accepts sandbox purchases only while sandbox purchases are allowed', () => {
    const sandbox = signTestAppStorePayload(transaction({ environment: 'Sandbox' }))
    expect(decodeAppStoreTransaction(sandbox, options).environment).toBe('Sandbox')
    config.APP_STORE_ACCEPT_SANDBOX = false
    try {
      expect(() => decodeAppStoreTransaction(sandbox, options)).toThrow(AppStorePayloadError)
    } finally {
      config.APP_STORE_ACCEPT_SANDBOX = true
    }
  })

  it('checks the app of production notifications', () => {
    const notification = (data: Record<string, unknown>) => signTestAppStorePayload({
      notificationType: 'DID_RENEW',
      notificationUUID: 'b1b1b1b1-0000-4000-8000-000000000001',
      signedDate: start,
      data: { bundleId: 'com.isaacthoman.pulpo', ...data },
    })
    expect(decodeAppStoreNotification(notification({ environment: 'Production', appAppleId: 6_740_000_000 }), options).notificationType)
      .toBe('DID_RENEW')
    expect(decodeAppStoreNotification(notification({ environment: 'Sandbox' }), options).data?.environment).toBe('Sandbox')
    expect(() => decodeAppStoreNotification(notification({ environment: 'Production', appAppleId: 1 }), options)).toThrow('for another app')
    expect(() => decodeAppStoreNotification(notification({ environment: 'Production', bundleId: 'com.example.other' }), options))
      .toThrow('for another app')
  })
})

describe('App Store subscription state', () => {
  it('starts a subscription from its first transaction', () => {
    const state = merge(null, transaction(), renewal())!
    expect(state).toMatchObject({
      userId, plan: 'eight', paidPlan: 'eight', status: 'active', autoRenew: true,
      latestTransactionId: '2000000000000001', revokedAt: null,
    })
    expect(state.paidThrough).toEqual(new Date(start + 30 * day))
    expect(effectivePlan([state], now)).toBe('eight')
  })

  it('advances to a renewal and ignores the older transaction delivered late', () => {
    const first = merge(null, transaction(), renewal())!
    const renewed = merge(first, transaction({
      transactionId: '2000000000000002', purchaseDate: start + 30 * day, expiresDate: start + 60 * day,
      signedDate: start + 30 * day, transactionReason: 'RENEWAL',
    }))!
    expect(renewed.latestTransactionId).toBe('2000000000000002')
    expect(renewed.expiresAt).toEqual(new Date(start + 60 * day))
    expect(merge(renewed, transaction())).toBeNull()
  })

  it('revokes access when the latest transaction is refunded', () => {
    const state = merge(null, transaction(), renewal())!
    const refunded = merge(state, transaction({ signedDate: start + 2 * day, revocationDate: start + 2 * day, revocationReason: 0 }))!
    expect(refunded).toMatchObject({ status: 'revoked', paidThrough: null })
    expect(effectivePlan([refunded], now)).toBe('baby')
    // A reversed refund is signed again without the revocation.
    const restored = merge(refunded, transaction({ signedDate: start + 3 * day }))!
    expect(restored).toMatchObject({ status: 'active', revokedAt: null })
  })

  it('keeps Fat benefits until renewal after a downgrade', () => {
    const fat = merge(null, transaction({ productId: 'baby.pulpo.fat.monthly' }), renewal({ autoRenewProductId: 'baby.pulpo.fat.monthly' }))!
    const downgraded = merge(fat, transaction({ productId: 'baby.pulpo.fat.monthly' }), renewal({
      autoRenewProductId: 'baby.pulpo.eight.monthly', signedDate: start + day,
    }))!
    expect(downgraded).toMatchObject({ plan: 'eight', paidPlan: 'fat' })
    expect(effectivePlan([downgraded], now)).toBe('fat')
    expect(appStoreSubscriptionSummary(downgraded, now)).toMatchObject({ plan: 'fat', pendingPlan: 'eight', cancelAtPeriodEnd: false })
  })

  it('applies an upgrade immediately and renews at the upgraded plan', () => {
    const eight = merge(null, transaction(), renewal())!
    const upgraded = merge(eight, transaction({
      transactionId: '2000000000000002', productId: 'baby.pulpo.fat.monthly',
      purchaseDate: start + 5 * day, expiresDate: start + 35 * day, signedDate: start + 5 * day,
    }))!
    expect(upgraded).toMatchObject({ plan: 'fat', paidPlan: 'fat', productId: 'baby.pulpo.fat.monthly' })
    // The upgraded-from transaction cannot become the latest one again.
    expect(merge(upgraded, transaction({ isUpgraded: true, signedDate: start + 6 * day }))).toBeNull()
  })

  it('ignores renewal info older than the stored copy', () => {
    const canceled = merge(null, transaction(), renewal({ autoRenewStatus: 0, signedDate: start + day }))!
    expect(appStoreSubscriptionSummary(canceled, now)).toMatchObject({ cancelAtPeriodEnd: true, pendingPlan: null })
    expect(merge(canceled, transaction(), renewal({ autoRenewStatus: 1, signedDate: start }))).toBeNull()
  })

  it('keeps access through a billing grace period, but not through billing retry alone', () => {
    const expiresDate = start + 30 * day
    const later = new Date(expiresDate + 2 * day)
    const base = merge(null, transaction(), renewal())!
    const grace = merge(base, transaction(), renewal({
      isInBillingRetryPeriod: true, gracePeriodExpiresDate: expiresDate + 6 * day, signedDate: expiresDate,
    }), later)!
    expect(grace).toMatchObject({ status: 'past_due', paidThrough: new Date(expiresDate + 6 * day) })
    expect(effectivePlan([grace], later)).toBe('eight')

    const retry = merge(base, transaction(), renewal({ isInBillingRetryPeriod: true, signedDate: expiresDate }), later)!
    expect(retry).toMatchObject({ status: 'past_due', paidThrough: new Date(expiresDate) })
    expect(effectivePlan([retry], later)).toBe('baby')
  })

  it('reports status at the time it is read', () => {
    const state = { revokedAt: null, expiresAt: new Date(start + 30 * day), gracePeriodExpiresAt: null, inBillingRetry: false }
    expect(appStoreSubscriptionStatus(state, now)).toBe('active')
    expect(appStoreSubscriptionStatus(state, new Date(start + 31 * day))).toBe('expired')
    expect(appStorePaidThrough(state)).toEqual(new Date(start + 30 * day))
  })
})
