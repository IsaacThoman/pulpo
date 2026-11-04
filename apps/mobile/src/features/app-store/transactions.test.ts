import { describe, expect, it, vi } from 'vitest'
vi.mock('../../api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message) }
  },
}))
import { ApiError } from '../../api/client'
import { purchaseProduct, reportTransaction, restorePurchases } from './transactions'

const transaction = (id: string, productId = 'pulpoEight') => ({
  transactionId: id, originalTransactionId: 'original', productId, signedTransaction: `jws-${id}`,
})
const reporter = (sync = vi.fn().mockResolvedValue({ plan: 'eight' })) => ({ sync, finish: vi.fn().mockResolvedValue(undefined) })

describe('App Store transaction reports', () => {
  it('finishes a transaction once the server applies it', async () => {
    const deps = reporter()
    await expect(reportTransaction(transaction('1'), deps)).resolves.toEqual({ status: 'applied' })
    expect(deps.sync).toHaveBeenCalledWith('jws-1')
    expect(deps.finish).toHaveBeenCalledWith('1')
  })

  it('finishes a transaction the server settles by refusing it', async () => {
    const deps = reporter(vi.fn().mockRejectedValue(new ApiError(409, 'app_store_subscription_other_account', 'Belongs to another account')))
    await expect(reportTransaction(transaction('2'), deps)).resolves.toEqual({
      status: 'rejected', code: 'app_store_subscription_other_account', message: 'Belongs to another account',
    })
    expect(deps.finish).toHaveBeenCalledWith('2')
  })

  it('leaves a transaction unfinished when the server cannot be reached or fails', async () => {
    for (const error of [new TypeError('Network request failed'), new ApiError(503, 'app_store_unavailable', 'Try again'), new ApiError(409, 'account_deleting', 'Deleting')]) {
      const deps = reporter(vi.fn().mockRejectedValue(error))
      await expect(reportTransaction(transaction('3'), deps)).resolves.toMatchObject({ status: 'retry' })
      expect(deps.finish).not.toHaveBeenCalled()
    }
  })
})

describe('App Store purchases', () => {
  it('buys with the account token and reports the purchase', async () => {
    const deps = { ...reporter(), accountToken: vi.fn().mockResolvedValue('token'), purchase: vi.fn().mockResolvedValue({ status: 'purchased', ...transaction('4', 'pulpoFat') }) }
    await expect(purchaseProduct('pulpoFat', deps)).resolves.toEqual({ status: 'purchased', report: { status: 'applied' } })
    expect(deps.purchase).toHaveBeenCalledWith('pulpoFat', 'token')
    expect(deps.sync).toHaveBeenCalledWith('jws-4')
  })

  it('reports nothing when the purchase is cancelled or waiting for approval', async () => {
    for (const status of ['cancelled', 'pending'] as const) {
      const deps = { ...reporter(), accountToken: vi.fn().mockResolvedValue('token'), purchase: vi.fn().mockResolvedValue({ status }) }
      await expect(purchaseProduct('pulpoEight', deps)).resolves.toEqual({ status })
      expect(deps.sync).not.toHaveBeenCalled()
    }
  })
})

describe('Restore Purchases', () => {
  const restore = (entitlements: ReturnType<typeof transaction>[], sync = vi.fn().mockResolvedValue({ plan: 'eight' })) => {
    const deps = { ...reporter(sync), syncAppStore: vi.fn().mockResolvedValue(true), currentEntitlements: vi.fn().mockResolvedValue(entitlements) }
    return { deps, result: restorePurchases(['pulpoEight', 'pulpoFat'], deps) }
  }

  it('reports only Pulpo subscriptions after syncing with the App Store', async () => {
    const { deps, result } = restore([transaction('5'), transaction('6', 'someOtherProduct')])
    await expect(result).resolves.toBe('restored')
    expect(deps.syncAppStore).toHaveBeenCalled()
    expect(deps.sync).toHaveBeenCalledTimes(1)
  })

  it('says when there is nothing to restore, a refusal, or the server is unreachable', async () => {
    await expect(restore([]).result).resolves.toBe('nothing')
    await expect(restore([transaction('7')], vi.fn().mockRejectedValue(new ApiError(403, 'app_store_sandbox_not_allowed', 'Sandbox purchases are not enabled'))).result)
      .resolves.toEqual({ rejected: 'Sandbox purchases are not enabled' })
    await expect(restore([transaction('8')], vi.fn().mockRejectedValue(new TypeError('offline'))).result).resolves.toBe('retry')
  })

  it('stops quietly when the person declines to sign in to their Apple Account', async () => {
    const deps = { ...reporter(), syncAppStore: vi.fn().mockResolvedValue(false), currentEntitlements: vi.fn() }
    await expect(restorePurchases(['pulpoEight', 'pulpoFat'], deps)).resolves.toBe('cancelled')
    expect(deps.currentEntitlements).not.toHaveBeenCalled()
    expect(deps.sync).not.toHaveBeenCalled()
  })
})
