import { Platform, StyleSheet, Text, View } from 'react-native'
import { Button, HStack, LabeledContent, ProgressView, Section, Spacer, Text as NativeText, VStack } from '@expo/ui/swift-ui'
import { accessibilityElement, accessibilityLabel, accessibilityValue, font, foregroundStyle, monospacedDigit, tint } from '@expo/ui/swift-ui/modifiers'
import { useQuery } from '@tanstack/react-query'
import { cacheNamespace } from '../../data/schema'
import { useSessionStore } from '../../store/session'
import { useAppTheme } from '../../mockup5/src/theme'
import { Card, ListRow, SectionTitle } from '../../mockup5/src/components/PrototypeUI'
import { AppStoreSubscriptionSection } from '../app-store/AppStoreSubscriptionSection'
import { usageLimitsQuery } from './api'
import { planName, remainingLabel, usageLimitRows, type UsageLimitRow } from './format'

const FOOTER = 'Usage limits refresh as responses finish.'

function NativeUsageLimit({ row }: { row: UsageLimitRow }) {
  const theme = useAppTheme()
  return <VStack alignment="leading" spacing={6} modifiers={[accessibilityElement('combine'), accessibilityLabel(row.label), accessibilityValue(`${remainingLabel(row)}. ${row.reset}`)]}>
    <HStack><NativeText>{row.label}</NativeText><Spacer /><NativeText modifiers={[foregroundStyle('secondary'), monospacedDigit()]}>{remainingLabel(row)}</NativeText></HStack>
    <ProgressView value={row.availableBarPercentage / 100} modifiers={[tint(theme.green)]} />
    {row.hint ? <NativeText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary')]}>{row.hint}</NativeText> : null}
    <NativeText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary')]}>{row.reset}</NativeText>
  </VStack>
}

export function UsageLimitCard({ row, last }: { row: UsageLimitRow; last: boolean }) {
  const theme = useAppTheme()
  return <View
    accessible
    accessibilityRole="progressbar"
    accessibilityLabel={row.label}
    accessibilityValue={{ min: 0, max: 100, now: row.remainingPercentage, text: remainingLabel(row) }}
    style={[styles.limit, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator }]}
  >
    <View style={styles.line}><Text style={[styles.title, { color: theme.text }]}>{row.label}</Text><Text style={[styles.percent, { color: theme.secondary }]}>{remainingLabel(row)}</Text></View>
    <View style={[styles.track, { backgroundColor: theme.fillStrong }]}>
      <View style={{ backgroundColor: theme.green, width: `${row.availableBarPercentage}%` }} />
      {/* Material maps green and orange to the same tertiary role, so fade the reserved segment to keep it distinct. */}
      <View style={{ backgroundColor: theme.orange, opacity: 0.45, width: `${row.pendingBarPercentage}%` }} />
    </View>
    {row.hint ? <Text style={[styles.helper, { color: theme.secondary }]}>{row.hint}</Text> : null}
    <Text style={[styles.helper, { color: theme.secondary }]}>{row.reset}</Text>
  </View>
}

/** Plan and usage limit sections, embedded in the Usage settings form (iOS) or screen (Android). */
export function UsageLimitsSettings() {
  const theme = useAppTheme()
  const instanceUrl = useSessionStore(s => s.instanceUrl)
  const userId = useSessionStore(s => s.user?.id)
  const namespace = userId ? cacheNamespace(instanceUrl, userId) : ''
  const limits = useQuery({ ...usageLimitsQuery(namespace), enabled: Boolean(namespace) })
  const rows = limits.data ? usageLimitRows(limits.data) : []
  const plan = limits.data ? planName(limits.data.plan) : limits.isError ? 'Unavailable' : 'Loading…'

  if (Platform.OS === 'ios') return <>
    <Section title="Plan">
      <LabeledContent label="Plan"><NativeText modifiers={[foregroundStyle('secondary')]}>{plan}</NativeText></LabeledContent>
      {limits.isError ? <Button label="Usage limits could not be loaded. Tap to retry." onPress={() => void limits.refetch()} /> : null}
    </Section>
    {limits.data ? <AppStoreSubscriptionSection limits={limits.data} /> : null}
    {rows.length ? <Section title="Usage limits" footer={<NativeText modifiers={[foregroundStyle('secondary')]}>{FOOTER}</NativeText>}>
      {rows.map(row => <NativeUsageLimit key={row.key} row={row} />)}
    </Section> : null}
  </>

  return <>
    <SectionTitle>Plan</SectionTitle>
    <Card>
      <ListRow title="Plan" value={plan} last={!limits.isError} />
      {limits.isError ? <ListRow icon="arrow.clockwise" iconColor={theme.blue} title="Usage limits could not be loaded" detail="Tap to retry." last onPress={() => void limits.refetch()} /> : null}
    </Card>
    {rows.length ? <>
      <SectionTitle>Usage limits</SectionTitle>
      <Card>{rows.map((row, index) => <UsageLimitCard key={row.key} row={row} last={index === rows.length - 1} />)}</Card>
      <Text style={[styles.helper, styles.footer, { color: theme.secondary }]}>{FOOTER}</Text>
    </> : null}
  </>
}

const styles = StyleSheet.create({
  limit: { padding: 15 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  title: { flexShrink: 1, fontSize: 14, fontWeight: '700' },
  percent: { fontSize: 12, fontVariant: ['tabular-nums'] },
  track: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', marginVertical: 11 },
  helper: { fontSize: 12, lineHeight: 18 },
  footer: { marginTop: 8 },
})
