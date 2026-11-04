import { Button, HStack, LabeledContent, Link, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { disabled, font, foregroundStyle } from '@expo/ui/swift-ui/modifiers'
import type { UsageLimits, UsageLimitsSubscription } from '@pulpo/contracts'
import { planName } from '../usage-limits/format'
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL, type AppStoreProductIds } from './availability'
import { priceLabel, SUBSCRIPTION_TERMS, subscriptionStatusLabel } from './format'
import { storeKit } from './storeKit'
import { useAppStoreActions, useAppStoreProducts, type StoreKit } from './useAppStoreActions'
import { useAppStoreOffer } from './useAppStoreOffer'

const PLANS = ['eight', 'fat'] as const

/**
 * The subscription on the Usage screen (iOS, hosted Pulpo). App Store subscribers can change plans
 * and manage the subscription; subscriptions billed elsewhere get a note. Accounts on Pulpo Baby see
 * the plan cards (`AppStorePlans`) instead, and plans an administrator set show nothing.
 */
export function AppStoreSubscriptionSection({ limits, onChanged }: { limits: UsageLimits; onChanged: () => Promise<unknown> }) {
  const offer = useAppStoreOffer()
  const subscription = limits.subscription
  if (!offer || !storeKit || !subscription) return null
  if (subscription.provider === 'stripe') return <Section title="Subscription">
    <Text modifiers={[foregroundStyle('secondary')]}>Your subscription is managed outside the App Store.</Text>
  </Section>
  return <Subscription kit={storeKit} offer={offer} subscription={subscription} onChanged={onChanged} />
}

function Subscription({ kit, offer, subscription, onChanged }: {
  kit: StoreKit
  offer: AppStoreProductIds
  subscription: UsageLimitsSubscription
  onChanged: () => Promise<unknown>
}) {
  const { products, product } = useAppStoreProducts(kit, offer)
  const { busy, buy, restore, manage } = useAppStoreActions({ kit, offer, current: subscription.plan, onChanged })
  const footer = <VStack alignment="leading" spacing={8}>
    <Text modifiers={[foregroundStyle('secondary')]}>{SUBSCRIPTION_TERMS}</Text>
    <HStack spacing={16}><Link label="Terms of Use" destination={TERMS_OF_USE_URL} /><Link label="Privacy Policy" destination={PRIVACY_POLICY_URL} /></HStack>
  </VStack>

  return <Section title="Subscription" footer={footer}>
    <LabeledContent label={planName(subscription.plan)}>
      <Text modifiers={[foregroundStyle('secondary')]}>{subscriptionStatusLabel(subscription)}</Text>
    </LabeledContent>
    {products.isError ? <Button label="Subscriptions couldn’t be loaded. Tap to retry." onPress={() => void products.refetch()} /> : null}
    {products.isPending ? <Text modifiers={[foregroundStyle('secondary')]}>Loading subscriptions…</Text> : null}
    {PLANS.map((plan) => {
      const item = product(plan)
      if (!item) return null
      const isCurrent = subscription.plan === plan
      const isPending = subscription.pendingPlan === plan
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
    <Button label="Manage Subscription" onPress={() => void manage()} modifiers={[disabled(busy)]} />
    <Button label="Restore Purchases" onPress={() => void restore()} modifiers={[disabled(busy)]} />
  </Section>
}
