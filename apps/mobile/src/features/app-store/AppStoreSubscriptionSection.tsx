import { useState } from 'react'
import { Alert, Linking } from 'react-native'
import { Button, HStack, LabeledContent, Link, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { disabled, font, foregroundStyle } from '@expo/ui/swift-ui/modifiers'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { UsageLimits } from '@pulpo/contracts'
import { mobileApi } from '../../api/client'
import { planName } from '../usage-limits/format'
import { APP_STORE_SUBSCRIPTIONS_URL, PRIVACY_POLICY_URL, TERMS_OF_USE_URL, type AppStoreProductIds } from './availability'
import { priceLabel, SUBSCRIPTION_TERMS, subscriptionStatusLabel } from './format'
import { storeKit, type StoreKitProduct } from './storeKit'
import { purchaseProduct, restorePurchases, type TransactionReport } from './transactions'
import { useAppStoreOffer } from './useAppStoreOffer'

const PLANS = ['eight', 'fat'] as const
type Plan = typeof PLANS[number]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Please try again.'
}

function purchaseAlert(plan: Plan, previous: Plan | null, report: TransactionReport) {
  if (report.status === 'rejected') return Alert.alert('Purchase not applied', report.message)
  if (report.status === 'retry') return Alert.alert('Purchase received', 'Pulpo will apply your plan as soon as it can reach the server.')
  if (!previous) return Alert.alert(`You’re on ${planName(plan)}`, 'Your new usage limits apply now.')
  Alert.alert('Subscription updated', plan === 'fat' ? `${planName(plan)} applies now.` : `${planName(plan)} starts at your next renewal.`)
}

/**
 * App Store subscriptions on the Usage screen (iOS). Shown only on hosted Pulpo, and only to accounts
 * the App Store can bill: subscriptions billed elsewhere and plans an administrator set are left alone.
 */
export function AppStoreSubscriptionSection({ limits, onChanged }: { limits: UsageLimits; onChanged: () => Promise<unknown> }) {
  const offer = useAppStoreOffer()
  if (!offer || !storeKit) return null
  const subscription = limits.subscription
  if (subscription?.provider === 'stripe') return <Section title="Subscription">
    <Text modifiers={[foregroundStyle('secondary')]}>Your subscription is managed outside the App Store.</Text>
  </Section>
  if (!subscription && limits.plan !== 'baby') return null
  return <Offer kit={storeKit} offer={offer} current={subscription ? subscription.plan : null} limits={limits} onChanged={onChanged} />
}

function Offer({ kit, offer, current, limits, onChanged }: {
  kit: NonNullable<typeof storeKit>
  offer: AppStoreProductIds
  current: Plan | null
  limits: UsageLimits
  onChanged: () => Promise<unknown>
}) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const products = useQuery({
    queryKey: ['app-store-products', offer.eight, offer.fat],
    queryFn: () => kit.products([offer.eight, offer.fat]),
    staleTime: 60 * 60 * 1_000,
    networkMode: 'always',
  })
  const product = (plan: Plan): StoreKitProduct | undefined => products.data?.find((item) => item.id === offer[plan])
  const subscription = limits.subscription
  const reporter = { sync: mobileApi.syncAppStoreTransaction, finish: (id: string) => kit.finish(id) }

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await action() } finally { setBusy(false) }
  }
  const buy = (plan: Plan) => run(async () => {
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

  const footer = <VStack alignment="leading" spacing={8}>
    <Text modifiers={[foregroundStyle('secondary')]}>{SUBSCRIPTION_TERMS}</Text>
    <HStack spacing={16}><Link label="Terms of Use" destination={TERMS_OF_USE_URL} /><Link label="Privacy Policy" destination={PRIVACY_POLICY_URL} /></HStack>
  </VStack>

  return <Section title={subscription ? 'Subscription' : 'Upgrade'} footer={footer}>
    {subscription ? <LabeledContent label={planName(subscription.plan)}>
      <Text modifiers={[foregroundStyle('secondary')]}>{subscriptionStatusLabel(subscription)}</Text>
    </LabeledContent> : null}
    {products.isError ? <Button label="Subscriptions couldn’t be loaded. Tap to retry." onPress={() => void products.refetch()} /> : null}
    {products.isPending ? <Text modifiers={[foregroundStyle('secondary')]}>Loading subscriptions…</Text> : null}
    {PLANS.map((plan) => {
      const item = product(plan)
      if (!item) return null
      const isCurrent = current === plan
      const isPending = subscription?.pendingPlan === plan
      return <Button key={plan} onPress={() => void buy(plan)} modifiers={[disabled(busy || isCurrent || isPending)]}>
        <HStack spacing={12}>
          <VStack alignment="leading" spacing={2}>
            <Text>{item.displayName}</Text>
            {item.description ? <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary')]}>{item.description}</Text> : null}
          </VStack>
          <Spacer />
          <Text modifiers={[foregroundStyle(isCurrent || isPending ? 'secondary' : 'primary')]}>{isCurrent ? 'Current plan' : isPending ? 'At renewal' : priceLabel(item)}</Text>
        </HStack>
      </Button>
    })}
    {subscription ? <Button label="Manage Subscription" onPress={() => void manage()} modifiers={[disabled(busy)]} /> : null}
    <Button label="Restore Purchases" onPress={() => void restore()} modifiers={[disabled(busy)]} />
  </Section>
}
