import { useState } from 'react'
import { Alert, Linking } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { mobileApi } from '../../api/client'
import { planName } from '../usage-limits/format'
import { APP_STORE_SUBSCRIPTIONS_URL, type AppStoreProductIds } from './availability'
import { freeTrialLabel } from './format'
import type { storeKit, StoreKitProduct } from './storeKit'
import { purchaseProduct, restorePurchases, type TransactionReport } from './transactions'

export type StoreKit = NonNullable<typeof storeKit>
export type PaidPlan = 'eight' | 'fat'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Please try again.'
}

function purchaseAlert(product: StoreKitProduct, plan: PaidPlan, previous: PaidPlan | null, report: TransactionReport) {
  if (report.status === 'rejected') return Alert.alert('Purchase not applied', report.message)
  if (report.status === 'retry') return Alert.alert('Purchase received', 'Pulpo will apply your plan as soon as it can reach the server.')
  if (!previous && product.freeTrial) return Alert.alert('Your free trial has started', `Enjoy ${planName(plan)} free for ${freeTrialLabel(product.freeTrial)}.`)
  if (!previous) return Alert.alert(`You’re on ${planName(plan)}`, 'Your new usage limits apply now.')
  Alert.alert('Subscription updated', plan === 'fat' ? `${planName(plan)} applies now.` : `${planName(plan)} starts at your next renewal.`)
}

/** Every product ID the app sells or restores, the free-trial Eight included. */
export function appStoreProductIds(offer: AppStoreProductIds): string[] {
  return [offer.eight, offer.fat, ...(offer.eightTrial ? [offer.eightTrial] : [])]
}

/**
 * The App Store's product for each plan, with localized names and prices. Eight is the free-trial
 * product when the server offers trials to this account and StoreKit says this Apple Account gets one.
 */
export function useAppStoreProducts(kit: StoreKit, offer: AppStoreProductIds, options: { freeTrial: boolean }) {
  const ids = appStoreProductIds(offer)
  const products = useQuery({
    queryKey: ['app-store-products', ...ids],
    queryFn: () => kit.products(ids),
    staleTime: 60 * 60 * 1_000,
    networkMode: 'always',
  })
  const find = (id: string | undefined) => (id ? products.data?.find((item) => item.id === id) : undefined)
  const product = (plan: PaidPlan): StoreKitProduct | undefined => {
    const trial = plan === 'eight' && options.freeTrial ? find(offer.eightTrial) : undefined
    if (trial?.freeTrial) return trial
    const regular = find(offer[plan])
    // StoreKit reports trials only to eligible Apple Accounts; the regular products never offer one.
    return regular ? { ...regular, freeTrial: null } : undefined
  }
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
  const buy = (plan: PaidPlan, product: StoreKitProduct) => run(async () => {
    try {
      const outcome = await purchaseProduct(product.id, { ...reporter, accountToken: mobileApi.appStoreAccountToken, purchase: kit.purchase })
      if (outcome.status === 'pending') return Alert.alert('Purchase pending', 'Your plan changes once the purchase is approved.')
      if (outcome.status === 'cancelled') return
      await onChanged()
      purchaseAlert(product, plan, current, outcome.report)
    } catch (error) {
      Alert.alert('Couldn’t complete purchase', errorMessage(error))
    }
  })
  const restore = () => run(async () => {
    try {
      const outcome = await restorePurchases(appStoreProductIds(offer), {
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
