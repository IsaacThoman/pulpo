import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSessionStore } from '../../store/session'
import { storeKit, syncStoreTransaction, syncUnfinishedTransactions } from './appStore'

/**
 * Records App Store transactions that arrive outside the subscription screen: purchases
 * interrupted before Pulpo confirmed them, Ask to Buy approvals, and changes made on
 * another device. Runs only for instances that accept App Store subscriptions.
 */
export function AppStoreTransactionSync() {
  const userId = useSessionStore((state) => state.status === 'authenticated' ? state.user?.id ?? null : null)
  const enabled = useSessionStore((state) => state.config?.capabilities.appStoreSubscriptions ?? false)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!storeKit || !enabled || !userId) return
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['billing'] })
    const subscription = storeKit.addListener('onTransactionUpdated', (transaction) => {
      void syncStoreTransaction(transaction, userId).then(refresh, () => undefined)
    })
    void syncUnfinishedTransactions(userId).then(refresh, () => undefined)
    return () => subscription.remove()
  }, [enabled, queryClient, userId])

  return null
}
