import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Button, HStack, LabeledContent, Section, Spacer, Text as NativeText, VStack } from '@expo/ui/swift-ui'
import { accessibilityElement, disabled, font, foregroundStyle, monospacedDigit } from '@expo/ui/swift-ui/modifiers'
import type { CreditSummary, SignupPromoOffer } from '@pulpo/contracts'
import { useSessionStore } from '../../store/session'
import { useAppTheme, type AppTheme } from '../../mockup5/src/theme'
import { autoTopUpLabel, formatUsdMicros, paymentDetail, paymentTitle, promoResetLabel } from './format'
import { useCreditSummary, useOpenWebBilling, useSignupPromoClaim, useSignupPromoOffer } from './useCredits'

/** Payments listed in the app; the rest are on the web. */
const PAYMENT_ROWS = 10

const ON_HOLD_MESSAGE = 'Billing usage is on hold. Contact support so the payment reversal can be reviewed before starting more billable work.'

function hostname(instanceUrl: string): string {
  try { return new URL(instanceUrl).hostname } catch { return instanceUrl }
}

/** The credit lines under the balance: reserved, the Pool's balance, and auto top-up. */
function balanceDetails(summary: CreditSummary): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  if (summary.balancePendingMicros > 0) rows.push({ label: 'Reserved', value: formatUsdMicros(summary.balancePendingMicros) })
  if (summary.poolBalanceMicros !== null) rows.push({ label: 'Pool balance', value: formatUsdMicros(summary.poolBalanceMicros) })
  rows.push({ label: 'Auto top-up', value: autoTopUpLabel(summary.autoTopUp) })
  return rows
}

/** What the signup promo shows: a claim button, a confirmation, a used-up budget, or nothing. */
function promoState(offer: SignupPromoOffer | null | undefined, claimedMicros: number | null) {
  if (claimedMicros !== null) return { kind: 'claimed' as const, text: `${formatUsdMicros(claimedMicros)} in credits was added to your balance.` }
  if (!offer) return null
  const amount = formatUsdMicros(offer.amountMicros)
  if (!offer.available) return { kind: 'exhausted' as const, text: `Free credits are all claimed for now. Check back after ${promoResetLabel(offer.resetsAt)}.` }
  return { kind: 'available' as const, text: offer.message || `Welcome! Claim ${amount} in free credits to try things out.`, button: `Claim ${amount}` }
}

function useCreditsScreen() {
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const credits = useCreditSummary(true)
  const offer = useSignupPromoOffer(true)
  const claim = useSignupPromoClaim()
  const openBilling = useOpenWebBilling()
  return {
    host: hostname(instanceUrl),
    credits,
    summary: credits.data,
    promo: promoState(offer.data, claim.claimedMicros),
    claim,
    addCredits: () => void openBilling({ addCredits: true }),
    openBilling: () => void openBilling(),
  }
}

/** Credits and payment history in the iOS Usage form, for accounts whose plan the App Store can't sell. */
export function NativeCreditsSections() {
  const theme = useAppTheme()
  const { host, credits, summary, promo, claim, addCredits, openBilling } = useCreditsScreen()
  const balance = summary ? formatUsdMicros(summary.balanceMicros) : credits.isError ? 'Unavailable' : 'Loading…'
  const payments = summary?.payments.slice(0, PAYMENT_ROWS) ?? []
  return <>
    <Section title="Credits" footer={<NativeText modifiers={[foregroundStyle('secondary')]}>{`Credits pay as you go for usage beyond your plan’s limits. Add Credits opens ${host} in your browser.`}</NativeText>}>
      <LabeledContent label="Balance"><NativeText modifiers={[foregroundStyle('secondary'), monospacedDigit()]}>{balance}</NativeText></LabeledContent>
      {summary ? balanceDetails(summary).map((row) => <LabeledContent key={row.label} label={row.label}><NativeText modifiers={[foregroundStyle('secondary'), monospacedDigit()]}>{row.value}</NativeText></LabeledContent>) : null}
      {summary?.onHold ? <NativeText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle(theme.red)]}>{ON_HOLD_MESSAGE}</NativeText> : null}
      {credits.isError ? <Button label="Credits could not be loaded. Tap to retry." onPress={() => void credits.refetch()} /> : null}
      {promo ? <NativeText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle(promo.kind === 'claimed' ? theme.green : 'secondary')]}>{promo.text}</NativeText> : null}
      {promo?.kind === 'available' ? <Button label={claim.claiming ? 'Claiming…' : promo.button} systemImage="gift" modifiers={[disabled(claim.claiming)]} onPress={() => void claim.claim()} /> : null}
      {claim.error ? <NativeText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle(theme.red)]}>{claim.error}</NativeText> : null}
      <Button label="Add Credits" systemImage="plus.circle" onPress={addCredits} />
      <Button label="Billing on the Web" systemImage="arrow.up.right.square" onPress={openBilling} />
    </Section>
    {summary ? <Section title="Payment history">
      {payments.length ? payments.map((payment) => <HStack key={payment.id} modifiers={[accessibilityElement('combine')]}>
        <VStack alignment="leading" spacing={2}>
          <NativeText>{paymentTitle(payment)}</NativeText>
          <NativeText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary')]}>{paymentDetail(payment)}</NativeText>
        </VStack>
        <Spacer />
        <NativeText modifiers={[foregroundStyle('secondary'), monospacedDigit()]}>{formatUsdMicros(payment.amountCents * 10_000)}</NativeText>
      </HStack>) : <NativeText modifiers={[foregroundStyle('secondary')]}>No payments yet.</NativeText>}
      {summary.payments.length > PAYMENT_ROWS ? <Button label="All Payments on the Web" systemImage="arrow.up.right.square" onPress={openBilling} /> : null}
    </Section> : null}
  </>
}

/** Credits on the App Store plans screen (`AppStorePlans`), which is built from React Native cards. */
export function CreditsCard({ surface }: { surface: string }) {
  const theme = useAppTheme()
  const { host, credits, summary, promo, claim, addCredits, openBilling } = useCreditsScreen()
  const cardStyle = [styles.card, { backgroundColor: surface, borderColor: theme.separator }]
  return <View style={styles.group}>
    <Text accessibilityRole="header" style={[styles.heading, { color: theme.secondary }]}>Credits</Text>
    <View style={cardStyle}>
      <Text style={[styles.label, { color: theme.secondary }]}>Balance</Text>
      {summary
        ? <Text style={[styles.balance, { color: theme.text }]}>{formatUsdMicros(summary.balanceMicros)}</Text>
        : credits.isError
          ? <Pressable accessibilityRole="button" onPress={() => void credits.refetch()} style={styles.linkTarget}><Text style={[styles.link, { color: theme.blue }]}>Credits couldn’t be loaded. Try Again</Text></Pressable>
          : <ActivityIndicator style={styles.loading} />}
      {summary ? <View style={styles.details}>
        {balanceDetails(summary).map((row) => <View key={row.label} style={styles.detailLine} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
          <Text style={[styles.detail, { color: theme.secondary }]}>{row.label}</Text>
          <Text style={[styles.detail, styles.amount, { color: theme.secondary }]}>{row.value}</Text>
        </View>)}
      </View> : null}
      {summary?.onHold ? <Text accessibilityRole="alert" style={[styles.note, { color: theme.red }]}>{ON_HOLD_MESSAGE}</Text> : null}
      {promo ? <Text accessibilityRole={promo.kind === 'claimed' ? 'alert' : undefined} style={[styles.note, { color: promo.kind === 'claimed' ? theme.green : theme.secondary }]}>{promo.text}</Text> : null}
      {claim.error ? <Text accessibilityRole="alert" style={[styles.note, { color: theme.red }]}>{claim.error}</Text> : null}
      {promo?.kind === 'available'
        ? <CardButton theme={theme} label={promo.button} busy={claim.claiming} prominent onPress={() => void claim.claim()} />
        : null}
      <CardButton theme={theme} label="Add Credits" prominent={promo?.kind !== 'available'} hint={`Opens ${host} in your browser`} onPress={addCredits} />
      <Pressable accessibilityRole="link" accessibilityHint={`Opens ${host} in your browser`} onPress={openBilling} style={[styles.linkTarget, styles.centered]}>
        <Text style={[styles.link, { color: theme.blue }]}>Billing on the Web</Text>
      </Pressable>
    </View>
    <Text style={[styles.footer, { color: theme.secondary }]}>{`Credits pay as you go for usage beyond your plan’s limits. Add Credits opens ${host} in your browser.`}</Text>
  </View>
}

/** Recent payments on the App Store plans screen, as the web's Payment history lists them. */
export function PaymentHistoryCard({ surface }: { surface: string }) {
  const theme = useAppTheme()
  const credits = useCreditSummary(true)
  const openBilling = useOpenWebBilling()
  const summary = credits.data
  if (!summary) return null
  const payments = summary.payments.slice(0, PAYMENT_ROWS)
  return <View style={styles.group}>
    <Text accessibilityRole="header" style={[styles.heading, { color: theme.secondary }]}>Payment history</Text>
    <View style={[styles.card, styles.list, { backgroundColor: surface, borderColor: theme.separator }]}>
      {payments.length ? payments.map((payment, index) => {
        const amount = formatUsdMicros(payment.amountCents * 10_000)
        return <View
          key={payment.id}
          accessible
          accessibilityLabel={`${paymentTitle(payment)}, ${amount}, ${paymentDetail(payment)}`}
          style={[styles.payment, index < payments.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator }]}
        >
          <View style={styles.flex}>
            <Text style={[styles.paymentTitle, { color: theme.text }]}>{paymentTitle(payment)}</Text>
            <Text style={[styles.detail, { color: theme.secondary }]}>{paymentDetail(payment)}</Text>
          </View>
          <Text style={[styles.paymentTitle, styles.amount, { color: theme.text }]}>{amount}</Text>
        </View>
      }) : <Text style={[styles.empty, { color: theme.secondary }]}>No payments yet.</Text>}
    </View>
    {summary.payments.length > PAYMENT_ROWS ? <Pressable accessibilityRole="link" onPress={() => void openBilling()} style={[styles.linkTarget, styles.centered]}>
      <Text style={[styles.link, { color: theme.blue }]}>All Payments on the Web</Text>
    </Pressable> : null}
  </View>
}

function CardButton({ theme, label, onPress, prominent, busy = false, hint }: { theme: AppTheme; label: string; onPress: () => void; prominent: boolean; busy?: boolean; hint?: string }) {
  const background = prominent ? theme.blue : theme.isDark ? 'rgba(10,132,255,0.22)' : 'rgba(0,122,255,0.12)'
  const color = prominent ? '#FFFFFF' : theme.blue
  return <Pressable
    accessibilityRole="button"
    accessibilityHint={hint}
    accessibilityState={{ disabled: busy, busy }}
    disabled={busy}
    onPress={onPress}
    style={({ pressed }) => [styles.button, { backgroundColor: background, opacity: pressed ? 0.8 : 1 }]}
  >
    {busy ? <ActivityIndicator color={color} /> : <Text style={[styles.buttonText, { color }]}>{label}</Text>}
  </Pressable>
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: 8 },
  heading: { fontSize: 17, fontWeight: '700', marginLeft: 4, marginBottom: 4 },
  card: { borderRadius: 22, padding: 20, borderWidth: StyleSheet.hairlineWidth },
  list: { paddingVertical: 4 },
  label: { fontSize: 14, fontWeight: '600' },
  balance: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'], marginTop: 2 },
  loading: { alignSelf: 'flex-start', marginVertical: 12 },
  details: { gap: 4, marginTop: 10 },
  detailLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  detail: { fontSize: 13, lineHeight: 18 },
  amount: { fontVariant: ['tabular-nums'] },
  note: { fontSize: 14, lineHeight: 20, marginTop: 12 },
  button: { marginTop: 14, borderRadius: 14, paddingVertical: 15, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 17, fontWeight: '700' },
  linkTarget: { minHeight: 44, justifyContent: 'center' },
  centered: { alignSelf: 'center', paddingHorizontal: 4 },
  link: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  footer: { fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
  payment: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  paymentTitle: { fontSize: 15, fontWeight: '600' },
  empty: { fontSize: 15, paddingVertical: 14, textAlign: 'center' },
})
