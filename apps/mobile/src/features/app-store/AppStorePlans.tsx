import { useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { UsageLimitsPlans } from '@pulpo/contracts'
import { useAppTheme, type AppTheme } from '../../mockup5/src/theme'
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL, type AppStoreProductIds } from './availability'
import { periodLabel, planBenefits, planButtonColors, planFillColor, planTitleColor, priceLabel, SUBSCRIPTION_TERMS } from './format'
import { useAppStoreActions, useAppStoreProducts, type PaidPlan, type StoreKit } from './useAppStoreActions'

const PLANS = ['eight', 'fat'] as const
const SHORT_NAMES: Record<PaidPlan, string> = { eight: 'Eight', fat: 'Fat' }

/**
 * The Usage screen for an account on Pulpo Baby that can subscribe in the App Store (iOS, hosted
 * Pulpo): a card for each plan with the App Store's price, the web's selling points, and a button
 * that buys it.
 */
export function AppStorePlans({ kit, offer, plans, onChanged }: {
  kit: StoreKit
  offer: AppStoreProductIds
  plans: UsageLimitsPlans | null
  onChanged: () => Promise<unknown>
}) {
  const theme = useAppTheme()
  const { products, product } = useAppStoreProducts(kit, offer)
  const { busy, buy, restore } = useAppStoreActions({ kit, offer, current: null, onChanged })
  const [choosing, setChoosing] = useState<PaidPlan | null>(null)
  const choose = async (plan: PaidPlan) => {
    setChoosing(plan)
    try { await buy(plan) } finally { setChoosing(null) }
  }

  const card = (plan: PaidPlan) => {
    const item = product(plan)
    if (!item) return null
    const fill = planFillColor(plan, theme.isDark)
    const button = planButtonColors(plan, theme.isDark)
    const period = periodLabel(item)
    return <View key={plan} style={[styles.card, { backgroundColor: theme.isDark ? theme.elevated : '#FFFFFF', borderColor: theme.separator }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: planTitleColor(plan, theme.isDark) }]}>{item.displayName}</Text>
      <View style={styles.priceLine} accessible accessibilityLabel={priceLabel(item)}>
        <Text style={[styles.price, { color: theme.text }]}>{item.displayPrice}</Text>
        {period ? <Text style={[styles.period, { color: theme.secondary }]}> {period}</Text> : null}
      </View>
      <View style={styles.benefits}>
        {planBenefits(plan, plans).map((benefit) => <Check key={benefit} color={fill} theme={theme}>{benefit}</Check>)}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy, busy: choosing === plan }}
        accessibilityHint={`Subscribes to ${item.displayName} for ${priceLabel(item)}`}
        disabled={busy}
        onPress={() => void choose(plan)}
        style={({ pressed }) => [styles.button, { backgroundColor: button.background, opacity: busy && choosing !== plan ? 0.5 : pressed ? 0.8 : 1 }]}
      >
        {choosing === plan
          ? <ActivityIndicator color={button.text} />
          : <Text style={[styles.buttonText, { color: button.text }]}>{`Choose ${SHORT_NAMES[plan]}`}</Text>}
      </Pressable>
    </View>
  }

  return <ScrollView
    style={{ backgroundColor: theme.isDark ? theme.background : '#F2F2F7' }}
    contentContainerStyle={styles.scroll}
    contentInsetAdjustmentBehavior="automatic"
  >
    {products.isPending ? <ActivityIndicator style={styles.loading} /> : null}
    {products.isError ? <Pressable accessibilityRole="button" onPress={() => void products.refetch()} style={styles.retry}>
      <Text style={[styles.terms, { color: theme.secondary, fontSize: 15 }]}>Subscriptions couldn’t be loaded.</Text>
      <Text style={[styles.link, { color: theme.blue }]}>Try Again</Text>
    </Pressable> : null}
    {PLANS.map(card)}
    <View style={styles.legal}>
      <Text style={[styles.terms, { color: theme.secondary }]}>{SUBSCRIPTION_TERMS}</Text>
      <View style={styles.links}>
        <Text accessibilityRole="button" disabled={busy} onPress={() => void restore()} style={[styles.link, { color: theme.blue }]}>Restore Purchases</Text>
        <Text accessibilityRole="link" onPress={() => void Linking.openURL(TERMS_OF_USE_URL)} style={[styles.link, { color: theme.blue }]}>Terms of Use</Text>
        <Text accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)} style={[styles.link, { color: theme.blue }]}>Privacy Policy</Text>
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
  title: { fontSize: 22, fontWeight: '800' },
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
  links: { flexDirection: 'row', gap: 18 },
  link: { fontSize: 13, fontWeight: '600' },
})
