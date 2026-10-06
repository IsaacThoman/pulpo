import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  finishTransaction: vi.fn(async () => undefined),
  unfinishedTransactions: vi.fn(async () => [] as unknown[]),
  currentEntitlements: vi.fn(async () => [] as unknown[]),
  sync: vi.fn(async () => undefined),
  syncAppStoreTransaction: vi.fn(async () => ({ subscription: null })),
}))

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo', () => ({
  NativeModule: class {},
  requireOptionalNativeModule: vi.fn(() => ({
    finishTransaction: mocks.finishTransaction,
    unfinishedTransactions: mocks.unfinishedTransactions,
    currentEntitlements: mocks.currentEntitlements,
    sync: mocks.sync,
  })),
}))
vi.mock('../../api/client', () => {
  class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message) }
  }
  return { ApiError, mobileApi: { syncAppStoreTransaction: mocks.syncAppStoreTransaction } }
})

import { ApiError } from '../../api/client'
import type { BillingSubscription } from '../../types'
import {
  appStorePlanOptions,
  billingPeriodLabel,
  planBenefits,
  restorePurchases,
  subscriptionStatusText,
  syncAccountEntitlements,
  syncStoreTransaction,
  syncUnfinishedTransactions,
} from './appStore'

const userId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
const transaction = (overrides: Record<string, unknown> = {}) => ({
  transactionId: '2000000000000001',
  originalTransactionId: '2000000000000001',
  productId: 'baby.pulpo.eight.monthly',
  signedTransaction: 'signed.transaction.jws',
  signedRenewalInfo: 'signed.renewal.jws',
  appAccountToken: userId,
  revoked: false,
  ...overrides,
})
const subscription = (overrides: Partial<BillingSubscription> = {}): BillingSubscription => ({
  provider: 'app_store', plan: 'eight', pendingPlan: null, status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: '2026-11-01T00:00:00.000Z', ...overrides,
})
const date = (iso: string) => iso.slice(0, 10)

describe('App Store plan choices', () => {
  it('offers both plans to someone without a subscription', () => {
    expect(appStorePlanOptions({ subscription: null })).toEqual({
      eight: { label: 'Subscribe', purchasable: true },
      fat: { label: 'Subscribe', purchasable: true },
    })
  })

  it('offers an upgrade or a downgrade at renewal within the App Store subscription', () => {
    expect(appStorePlanOptions({ subscription: subscription() })).toEqual({
      eight: { label: 'Current plan', purchasable: false },
      fat: { label: 'Upgrade', purchasable: true },
    })
    expect(appStorePlanOptions({ subscription: subscription({ plan: 'fat' }) })?.eight).toEqual({ label: 'Switch at renewal', purchasable: true })
    expect(appStorePlanOptions({ subscription: subscription({ plan: 'fat', pendingPlan: 'eight' }) })?.eight).toEqual({ label: 'Starts at renewal', purchasable: false })
  })

  it('offers nothing to buy over a plan billed outside the App Store', () => {
    expect(appStorePlanOptions({ subscription: subscription({ provider: 'stripe' }) })).toBeNull()
  })

  it('describes the plan and its renewal', () => {
    expect(subscriptionStatusText({ subscription: null, planOverridden: false }, date)).toBe('No subscription')
    expect(subscriptionStatusText({ subscription: null, planOverridden: true }, date)).toBe('Granted by an administrator')
    expect(subscriptionStatusText({ subscription: subscription(), planOverridden: false }, date)).toBe('Renews 2026-11-01')
    expect(subscriptionStatusText({ subscription: subscription({ cancelAtPeriodEnd: true }), planOverridden: false }, date)).toBe('Ends 2026-11-01')
    expect(subscriptionStatusText({ subscription: subscription({ plan: 'fat', pendingPlan: 'eight' }), planOverridden: false }, date))
      .toBe('Switches to Pulpo Eight on 2026-11-01')
    expect(subscriptionStatusText({ subscription: subscription({ status: 'past_due' }), planOverridden: false }, date)).toContain('update your payment method')
    expect(subscriptionStatusText({ subscription: subscription({ provider: 'stripe' }), planOverridden: false }, date)).toBe('Not billed through the App Store')
  })

  it('lists plan benefits and the billing period', () => {
    const summary = { planStorageLimitBytes: { baby: 5 * 1024 ** 3, eight: 25 * 1024 ** 3, fat: 100 * 1024 ** 3 }, sharedWeeklyPercent: 50 }
    expect(planBenefits('eight', summary)).toContain('25 GB of file storage')
    expect(planBenefits('fat', summary)).toContain('Share 50% of your weekly usage with your Pool')
    expect(billingPeriodLabel({ unit: 'month', value: 1 })).toBe('month')
    expect(billingPeriodLabel({ unit: 'month', value: 3 })).toBe('3 months')
    expect(billingPeriodLabel(undefined)).toBe('month')
  })
})

describe('App Store transaction sync', () => {
  beforeEach(() => vi.clearAllMocks())

  it('finishes a transaction once the server records it', async () => {
    expect(await syncStoreTransaction(transaction(), userId)).toBe(true)
    expect(mocks.syncAppStoreTransaction).toHaveBeenCalledWith('signed.transaction.jws', 'signed.renewal.jws')
    expect(mocks.finishTransaction).toHaveBeenCalledWith('2000000000000001')
  })

  it('leaves a transaction unfinished after a temporary failure so it is retried', async () => {
    mocks.syncAppStoreTransaction.mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Unavailable'))
    await expect(syncStoreTransaction(transaction(), userId)).rejects.toThrow('Unavailable')
    expect(mocks.finishTransaction).not.toHaveBeenCalled()
  })

  it('finishes a transaction the server permanently rejects', async () => {
    mocks.syncAppStoreTransaction.mockRejectedValueOnce(new ApiError(409, 'app_store_account_mismatch', 'Another account'))
    await expect(syncStoreTransaction(transaction(), userId)).rejects.toThrow('Another account')
    expect(mocks.finishTransaction).toHaveBeenCalledWith('2000000000000001')
  })

  it('does not send another account’s purchase to this account', async () => {
    expect(await syncStoreTransaction(transaction({ appAccountToken: '0199a1b2-0000-7000-8000-000000000000' }), userId)).toBe(false)
    expect(mocks.syncAppStoreTransaction).not.toHaveBeenCalled()
    expect(mocks.finishTransaction).toHaveBeenCalled()
  })

  it('syncs every unfinished transaction even when one fails', async () => {
    mocks.unfinishedTransactions.mockResolvedValueOnce([transaction(), transaction({ transactionId: '2000000000000002' })])
    mocks.syncAppStoreTransaction.mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Unavailable'))
    await syncUnfinishedTransactions(userId)
    expect(mocks.syncAppStoreTransaction).toHaveBeenCalledTimes(2)
    expect(mocks.finishTransaction).toHaveBeenCalledTimes(1)
  })

  it('re-sends only this account’s own subscriptions without asking', async () => {
    mocks.currentEntitlements.mockResolvedValueOnce([
      transaction(),
      transaction({ transactionId: '2', appAccountToken: undefined }),
      transaction({ transactionId: '3', appAccountToken: '0199a1b2-0000-7000-8000-000000000000' }),
    ])
    await syncAccountEntitlements(userId)
    expect(mocks.syncAppStoreTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.sync).not.toHaveBeenCalled()
  })

  it('restores this Apple Account’s subscription and reports one linked elsewhere', async () => {
    mocks.currentEntitlements.mockResolvedValueOnce([transaction({ appAccountToken: undefined })])
    expect(await restorePurchases(userId)).toBe('restored')
    expect(mocks.sync).toHaveBeenCalled()

    mocks.currentEntitlements.mockResolvedValueOnce([transaction({ appAccountToken: '0199a1b2-0000-7000-8000-000000000000' })])
    expect(await restorePurchases(userId)).toBe('other_account')

    mocks.currentEntitlements.mockResolvedValueOnce([transaction({ revoked: true })])
    expect(await restorePurchases(userId)).toBe('none')
  })
})
