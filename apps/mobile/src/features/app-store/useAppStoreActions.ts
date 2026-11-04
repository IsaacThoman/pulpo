import { useState } from 'react'
import { Alert, Linking } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { mobileApi } from '../../api/client'
import { planName } from '../usage-limits/format'
import { APP_STORE_SUBSCRIPTIONS_URL, type AppStoreProductIds } from './availability'
import type { storeKit, StoreKitProduct } from './storeKit'
import { purchaseProduct, restorePurchases, type TransactionReport } from './transactions'

export type StoreKit = NonNullable<typeof storeKit>
export type PaidPlan = 'eight' | 'fat'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Please try again.'
}

function purchaseAlert(plan: PaidPlan, previous: PaidPlan | null, report: TransactionReport) {
  if (report.status === 'rejected') return Alert.alert('Purchase not applied', report.message)
  if (report.status === 'retry') return Alert.alert('Purchase received', 'Pulpo will apply your plan as soon as it can reach the server.')
  if (!previous) return Alert.alert(`You’re on ${planName(plan)}`, 'Your new usage limits apply now.')
  Alert.alert('Subscription updated', plan === 'fat' ? `${planName(plan)} applies now.` : `${planName(plan)} starts at your next renewal.`)
}

/** The App Store's products for both plans, with localized names and prices. */
export function useAppStoreProducts(kit: StoreKit, offer: AppStoreProductIds) {
  const products = useQuery({
    queryKey: ['app-store-products', offer.eight, offer.fat],
    queryFn: () => kit.products([offer.eight, offer.fat]),
    staleTime: 60 * 60 * 1_000,
    networkMode: 'always',
  })
  const product = (plan: PaidPlan): StoreKitProduct | undefined => products.data?.find((item) => item.id === offer[plan])
  return { products, product }
}

/** Buy, Restore Purchases, and Manage Subscription, one at a time, with their alerts. */
export function useAppStoreActions({ kit, offer, current, onChanged }: {
  kit: StoreKit
  offer: AppStoreProductIds
  current: PaidPlan | null
  onChanged: () => Promise<unknown>
}) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const reporter = { sync: mobileApi.syncAppStoreTransaction, finish: (id: string) => kit.finish(id) }
  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await action() } finally { setBusy(false) }
  }
  const buy = (plan: PaidPlan) => run(async () => {
    try {
      const outcome = await purchaseProduct(offer[plan], { ...reporter, accountToken: mobileApi.appStoreAccountToken, purchase: kit.purchase })
      if (outcome.status === 'pending') return Alert.alert('Purchase pending', 'Your plan changes once the purchase is approved.')
      if (outcome.status === 'cancelled') return
      await onChanged()
      purchaseAlert(plan, current, outcome.report)
    } catch (error) {
      Alert.alert('Couldn’t complete purchase', errorMessage(error))
    }
  })
  const restore = () => run(async () => {
    try {
      const outcome = await restorePurchases([offer.eight, offer.fat], {
        ...reporter,
        syncAppStore: () => kit.sync(),
        currentEntitlements: () => kit.currentEntitlements(),
      })
      if (outcome === 'cancelled') return
      if (outcome === 'nothing') return Alert.alert('No subscription found', 'This Apple Account has no active Pulpo subscription.')
      if (outcome === 'retry') return Alert.alert('Couldn’t restore purchases', 'Pulpo couldn’t be reached. Please try again.')
      if (typeof outcome === 'object') return Alert.alert('Couldn’t restore purchases', outcome.rejected)
      await onChanged()
      Alert.alert('Purchases restored', 'Your plan is up to date.')
    } catch (error) {
      Alert.alert('Couldn’t restore purchases', errorMessage(error))
    }
  })
  const manage = () => run(async () => {
    try { await kit.showManageSubscriptions() } catch { await Linking.openURL(APP_STORE_SUBSCRIPTIONS_URL) }
    await queryClient.invalidateQueries({ queryKey: ['usage-limits'] })
  })
  return { busy, buy, restore, manage }
}
