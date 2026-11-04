import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { mobileApi } from '../../api/client'
import { cacheNamespace } from '../../data/schema'
import { useSessionStore } from '../../store/session'
import { usageLimitsKey } from '../usage-limits/api'
import { storeKit, type StoreKitTransaction } from './storeKit'
import { reportTransactions } from './transactions'
import { useAppStoreOffer } from './useAppStoreOffer'

/**
 * Reports renewals, purchases approved later, and purchases left unfinished by an interrupted launch.
 * Runs only while signed in to hosted Pulpo, so other instances never see this Apple Account's purchases.
 */
export function AppStoreTransactionObserver() {
  const offer = useAppStoreOffer()
  const queryClient = useQueryClient()
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const userId = useSessionStore((state) => state.user?.id)
  const enabled = Boolean(offer && userId)

  useEffect(() => {
    const kit = storeKit
    if (!enabled || !kit || !userId) return
    const namespace = cacheNamespace(instanceUrl, userId)
    let queue = Promise.resolve()
    const report = (transactions: StoreKitTransaction[]) => {
      queue = queue.then(async () => {
        const reports = await reportTransactions(transactions, {
          sync: mobileApi.syncAppStoreTransaction,
          finish: (id) => kit.finish(id),
        })
        if (reports.some((item) => item.status === 'applied')) {
          await queryClient.invalidateQueries({ queryKey: usageLimitsKey(namespace) })
        }
      }).catch((error: unknown) => console.warn('App Store transaction report failed', error))
    }
    const subscription = kit.addListener('onTransaction', (transaction) => report([transaction]))
    void kit.unfinished().then(report, (error: unknown) => console.warn('Could not read unfinished App Store transactions', error))
    return () => subscription.remove()
  }, [enabled, instanceUrl, queryClient, userId])

  return null
}
