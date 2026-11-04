import { Section, Text } from '@expo/ui/swift-ui'
import { foregroundStyle } from '@expo/ui/swift-ui/modifiers'
import type { UsageLimits } from '@pulpo/contracts'
import { storeKit } from './storeKit'
import { useAppStoreOffer } from './useAppStoreOffer'

/**
 * A note on the Usage form (iOS, hosted Pulpo) for a subscription billed on the web, which the App
 * Store can't change. Pulpo Baby and App Store subscribers see the plan cards (`AppStorePlans`)
 * instead, and plans an administrator set show nothing.
 */
export function AppStoreSubscriptionSection({ limits }: { limits: UsageLimits }) {
  const offer = useAppStoreOffer()
  if (!offer || !storeKit || limits.subscription?.provider !== 'stripe') return null
  return <Section title="Subscription">
    <Text modifiers={[foregroundStyle('secondary')]}>Your subscription is managed outside the App Store.</Text>
  </Section>
}
