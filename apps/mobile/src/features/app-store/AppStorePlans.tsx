import { useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { UsageLimits } from '@pulpo/contracts'
import { useAppTheme, type AppTheme } from '../../mockup5/src/theme'
import { UsageLimitCard } from '../usage-limits/UsageLimitsSettings'
import { usageLimitRows } from '../usage-limits/format'
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL, type AppStoreProductIds } from './availability'
import { FREE_TRIAL_TERMS, freeTrialLabel, freeTrialTermsLabel, periodLabel, planBenefits, planButtonColors, planFillColor, planTintColor, planTitleColor, priceLabel, SUBSCRIPTION_TERMS, subscriptionStatusLabel } from './format'
import type { StoreKitProduct } from './storeKit'
import { useAppStoreActions, useAppStoreProducts, type PaidPlan, type StoreKit } from './useAppStoreActions'

const PLANS = ['eight', 'fat'] as const
const SHORT_NAMES: Record<PaidPlan, string> = { eight: 'Eight', fat: 'Fat' }

/**
 * The Usage screen for an account that can subscribe in the App Store (iOS, hosted Pulpo): a card for
 * each plan with the App Store's price, the web's selling points, and a button that buys it. App Store
 * subscribers also see their usage limits, and their plan's card shows its renewal and opens Manage
 * Subscription.
 */
export function AppStorePlans({ kit, offer, limits, onChanged }: {
  kit: StoreKit
  offer: AppStoreProductIds
  limits: UsageLimits
  onChanged: () => Promise<unknown>
}) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const subscription = limits.subscription
  const { products, product } = useAppStoreProducts(kit, offer, { freeTrial: limits.appStoreFreeTrial })
  const { busy, buy, restore, manage } = useAppStoreActions({ kit, offer, current: subscription?.plan ?? null, onChanged })
  const [choosing, setChoosing] = useState<PaidPlan | null>(null)
  const choose = async (plan: PaidPlan, item: StoreKitProduct) => {
    setChoosing(plan)
    try { await buy(plan, item) } finally { setChoosing(null) }
  }
  const trialOffered = PLANS.some((plan) => product(plan)?.freeTrial)
  const rows = subscription ? usageLimitRows(limits) : []
  const surface = theme.isDark ? theme.elevated : '#FFFFFF'

  const card = (plan: PaidPlan) => {
    const item = product(plan)
    if (!item) return null
    const fill = planFillColor(plan, theme.isDark)
    const title = planTitleColor(plan, theme.isDark)
    const period = periodLabel(item)
    const trialTerms = freeTrialTermsLabel(item)
    const current = subscription?.plan === plan
    // A canceled subscription keeps the product it would have renewed as, but nothing starts at renewal.
    const pending = subscription?.pendingPlan === plan && !subscription.cancelAtPeriodEnd
    // The current plan's button manages the subscription, so it is tinted rather than filled.
    const button = current || pending
      ? { background: planTintColor(plan, theme.isDark), text: title }
      : planButtonColors(plan, theme.isDark)
    const label = current ? 'Manage Subscription'
      : pending ? 'Starts at renewal'
        : item.freeTrial ? `Try ${freeTrialLabel(item.freeTrial)} free`
          : `${subscription ? 'Switch to' : 'Choose'} ${SHORT_NAMES[plan]}`
    const disabled = busy || pending
    return <View key={plan} style={[styles.card, { backgroundColor: surface, borderColor: theme.separator }]}>
      <View style={styles.titleLine}>
        <Text accessibilityRole="header" style={[styles.title, { color: title }]}>{item.displayName}</Text>
        {current ? <View style={[styles.badge, { backgroundColor: planTintColor(plan, theme.isDark) }]}><Text style={[styles.badgeText, { color: title }]}>Current plan</Text></View> : null}
      </View>
      <View style={styles.priceLine} accessible accessibilityLabel={priceLabel(item)}>
        <Text style={[styles.price, { color: theme.text }]}>{item.displayPrice}</Text>
        {period ? <Text style={[styles.period, { color: theme.secondary }]}> {period}</Text> : null}
      </View>
      {trialTerms ? <Text style={[styles.status, { color: theme.secondary }]}>{trialTerms}</Text> : null}
      {current && subscription ? <Text style={[styles.status, { color: subscription.status === 'past_due' ? theme.red : theme.secondary }]}>{subscriptionStatusLabel(subscription)}</Text> : null}
      <View style={styles.benefits}>
        {planBenefits(plan, limits.plans).map((benefit) => <Check key={benefit} color={fill} theme={theme}>{benefit}</Check>)}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled, busy: choosing === plan }}
        accessibilityHint={current ? 'Opens your App Store subscription' : pending ? undefined : `Subscribes to ${item.displayName} for ${trialTerms ?? priceLabel(item)}`}
        disabled={disabled}
        onPress={() => void (current ? manage() : choose(plan, item))}
        style={({ pressed }) => [styles.button, { backgroundColor: button.background, opacity: (busy && choosing !== plan) || pending ? 0.5 : pressed ? 0.8 : 1 }]}
      >
        {choosing === plan
          ? <ActivityIndicator color={button.text} />
          : <Text style={[styles.buttonText, { color: button.text }]}>{label}</Text>}
      </Pressable>
    </View>
  }

  return <ScrollView
    style={{ backgroundColor: theme.isDark ? theme.background : '#F2F2F7' }}
    // Automatic content adjustment covers only the top and bottom; iPhone Duo's vertical bar takes a side.
    contentContainerStyle={[styles.scroll, { paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right }]}
    contentInsetAdjustmentBehavior="automatic"
  >
    {rows.length ? <View style={styles.group}>
      <Text accessibilityRole="header" style={[styles.heading, styles.groupHeading, { color: theme.secondary }]}>Usage limits</Text>
      <View style={[styles.limits, { backgroundColor: surface, borderColor: theme.separator }]}>
        {rows.map((row, index) => <UsageLimitCard key={row.key} row={row} last={index === rows.length - 1} />)}
      </View>
    </View> : null}
    {subscription ? <Text accessibilityRole="header" style={[styles.heading, { color: theme.secondary }]}>Plans</Text> : null}
    {products.isPending ? <ActivityIndicator style={styles.loading} /> : null}
    {products.isError ? <Pressable accessibilityRole="button" onPress={() => void products.refetch()} style={styles.retry}>
      <Text style={[styles.terms, { color: theme.secondary, fontSize: 15 }]}>Subscriptions couldn’t be loaded.</Text>
      <Text style={[styles.link, { color: theme.blue }]}>Try Again</Text>
    </Pressable> : null}
    {PLANS.map(card)}
    <View style={styles.legal}>
      <Text style={[styles.terms, { color: theme.secondary }]}>{trialOffered ? `${SUBSCRIPTION_TERMS} ${FREE_TRIAL_TERMS}` : SUBSCRIPTION_TERMS}</Text>
      <View style={styles.links}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => void restore()} style={[styles.linkTarget, busy && styles.linkDisabled]}>
          <Text style={[styles.link, { color: theme.blue }]}>Restore Purchases</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(TERMS_OF_USE_URL)} style={styles.linkTarget}>
          <Text style={[styles.link, { color: theme.blue }]}>Terms of Use</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)} style={styles.linkTarget}>
          <Text style={[styles.link, { color: theme.blue }]}>Privacy Policy</Text>
        </Pressable>
      </View>
    </View>
  </ScrollView>
}

function Check({ color, theme, children }: { color: string; theme: AppTheme; children: string }) {
  return <View style={styles.checkRow}>
    <View style={[styles.checkDot, { backgroundColor: color }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text style={[styles.checkMark, { color: theme.isDark ? '#000000' : '#FFFFFF' }]}>✓</Text>
    </View>
    <Text style={[styles.checkText, { color: theme.text }]}>{children}</Text>
  </View>
}

const styles = StyleSheet.create({
  scroll: { padding: 20, gap: 18, paddingBottom: 48 },
  loading: { marginVertical: 24 },
  retry: { alignItems: 'center', gap: 6, marginVertical: 12 },
  card: { borderRadius: 22, padding: 20, borderWidth: StyleSheet.hairlineWidth },
  group: { gap: 8 },
  // The page's gap is 18, which would leave "Plans" too far from its first card.
  heading: { fontSize: 17, fontWeight: '700', marginLeft: 4, marginBottom: -6 },
  groupHeading: { marginBottom: 4 },
  limits: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', paddingHorizontal: 5 },
  titleLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flexShrink: 1, fontSize: 22, fontWeight: '800' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 13, fontWeight: '700' },
  status: { fontSize: 14, marginTop: 4 },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', marginTop: 8 },
  price: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  period: { fontSize: 14 },
  benefits: { gap: 9, marginTop: 14 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkDot: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  checkMark: { fontSize: 12, fontWeight: '900' },
  checkText: { flex: 1, fontSize: 15 },
  button: { marginTop: 16, borderRadius: 14, paddingVertical: 15, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 17, fontWeight: '700' },
  legal: { gap: 10, alignItems: 'center' },
  terms: { fontSize: 11.5, lineHeight: 16, textAlign: 'center' },
  // Wraps at large text sizes; each link keeps a 44-point target.
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 10 },
  linkTarget: { minHeight: 44, maxWidth: '100%', justifyContent: 'center', paddingHorizontal: 4 },
  linkDisabled: { opacity: 0.5 },
  link: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
})
