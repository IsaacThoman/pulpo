import { useMemo } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import {
  Button as SwiftUIButton,
  Form as SwiftUIForm,
  HStack as SwiftUIHStack,
  Host as SwiftUIHost,
  ProgressView as SwiftUIProgressView,
  RNHostView as SwiftUIRNHostView,
  Section as SwiftUISection,
  Spacer as SwiftUISpacer,
  Text as SwiftUIText,
  VStack as SwiftUIVStack,
} from '@expo/ui/swift-ui'
import { accessibilityHint, accessibilityLabel, buttonStyle, contentShape, font, foregroundStyle, frame, lineLimit, monospacedDigit, refreshable, shapes, tint } from '@expo/ui/swift-ui/modifiers'
import { Card, PrimaryButton, SectionTitle, Segmented } from '../../mockup5/src/components/PrototypeUI'
import { ProfileAvatar } from '../../mockup5/src/components/ProfileAvatar'
import { useAppTheme } from '../../mockup5/src/theme'
import type { RootStackParamList } from '../../mockup5/src/navigation'
import { useFriendsContext } from '../friends/hooks'
import type { LeaderboardScope } from './api'
import { compactCount, metricLabel, rankLeaderboard, type RankedEntry, type UsageMetric } from './format'
import { useLeaderboard, type LeaderboardModel } from './hooks'
import { NativeCountHeader } from '../friends/FriendRows'
import { NativeNotice, NativeRecentUsageSection, NativeSegmented, NativeTopModelsSection, NativeUsageChartSection, NativeUsageControls, NativeUsageStatus, NativeUsageTotalsSection, NativeUsageYearSection } from './NativeUsage'
import { RecentUsageCard, TopModelsCard, UsageBody, UsageChartCard, UsageControls, UsageNotice, UsagePage, UsageTotalsCard, UsageYearCard } from './UsageCards'

const SCOPES: readonly { value: LeaderboardScope; label: string }[] = [
  { value: 'friends', label: 'Friends' },
  { value: 'pool', label: 'Pool' },
]

function RankRow({ entry, metric, own, last, onOpen }: { entry: RankedEntry; metric: UsageMetric; own: boolean; last: boolean; onOpen: () => void }) {
  const theme = useAppTheme()
  const handle = own ? `@${entry.username} · You` : `@${entry.username}`
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${entry.rank}. ${entry.displayName}, ${handle}, ${metricLabel(entry.value, metric)}`}
    accessibilityHint="Opens their profile"
    onPress={onOpen}
    style={({ pressed }) => [styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator }, pressed && { backgroundColor: theme.fill }]}
  >
    <Text style={[styles.rank, { color: theme.secondary }]}>{entry.rank}</Text>
    <ProfileAvatar size={36} user={{ id: entry.userId, name: entry.displayName, avatarUrl: entry.avatarUrl }} />
    <View style={styles.rowText}>
      <View style={styles.line}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{entry.displayName}</Text>
        <Text style={[styles.value, { color: theme.text }]}>{compactCount(entry.value)}</Text>
      </View>
      <Text style={[styles.handle, { color: theme.secondary }]} numberOfLines={1}>{handle}</Text>
      {/* Length against the leader's; the number beside the name is the value. */}
      <View style={[styles.meter, { backgroundColor: theme.fillStrong }]}>
        {entry.value > 0 ? <View style={[styles.meterFill, { backgroundColor: theme.blue, width: `${Math.max(1, entry.fraction * 100)}%` }]} /> : null}
      </View>
    </View>
  </Pressable>
}

interface LeaderboardView {
  model: LeaderboardModel
  ranked: RankedEntry[]
  viewerId: string | undefined
  poolsEnabled: boolean
  openProfile: (username: string) => void
  openFriends: () => void
  back: () => void
}

/** You and your friends, or your Pool, ranked by usage, with everyone's usage combined below. */
export function LeaderboardScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Leaderboard'>) {
  const { namespace, user, poolsEnabled } = useFriendsContext()
  const model = useLeaderboard({ namespace, initialScope: poolsEnabled && route.params?.scope === 'pool' ? 'pool' : 'friends' })
  const ranked = useMemo(() => rankLeaderboard(model.entries ?? [], model.metric), [model.metric, model.entries])
  const view: LeaderboardView = {
    model,
    ranked,
    viewerId: user?.id,
    poolsEnabled,
    openProfile: (username) => navigation.push('FriendProfile', { username }),
    openFriends: () => navigation.navigate('Friends'),
    back: () => navigation.goBack(),
  }
  if (Platform.OS === 'ios') return <NativeLeaderboard {...view} />
  return <MaterialLeaderboard {...view} />
}

const circleCopy = (pool: boolean) => ({
  caption: pool ? 'Settled usage across your Pool.' : 'Settled usage across you and your friends.',
  ranking: pool ? 'Pool ranking' : 'Friends ranking',
  empty: pool ? 'Add Pool members to compare usage.' : 'Add friends to compare usage.',
  action: pool ? 'Manage Pool' : 'Find Friends',
  combined: pool ? 'Pool usage' : 'Combined usage',
})

// iOS: a SwiftUI form, like Friends and Settings.

function NativeRankRow({ entry, metric, own, onOpen }: { entry: RankedEntry; metric: UsageMetric; own: boolean; onOpen: () => void }) {
  const theme = useAppTheme()
  const handle = own ? `@${entry.username} · You` : `@${entry.username}`
  return <SwiftUIButton onPress={onOpen} modifiers={[buttonStyle('plain'), accessibilityLabel(`${entry.rank}. ${entry.displayName}, ${handle}, ${metricLabel(entry.value, metric)}`), accessibilityHint('Opens their profile')]}>
    <SwiftUIHStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}>
      <SwiftUIText modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle('secondary'), monospacedDigit(), frame({ width: 22 })]}>{`${entry.rank}`}</SwiftUIText>
      <SwiftUIRNHostView matchContents><ProfileAvatar size={36} user={{ id: entry.userId, name: entry.displayName, avatarUrl: entry.avatarUrl }} /></SwiftUIRNHostView>
      <SwiftUIVStack alignment="leading" spacing={4}>
        <SwiftUIHStack>
          <SwiftUIText modifiers={[lineLimit(1)]}>{entry.displayName}</SwiftUIText>
          <SwiftUISpacer />
          <SwiftUIText modifiers={[font({ textStyle: 'body', weight: 'semibold' }), monospacedDigit()]}>{compactCount(entry.value)}</SwiftUIText>
        </SwiftUIHStack>
        <SwiftUIText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary'), lineLimit(1)]}>{handle}</SwiftUIText>
        {/* Length against the leader's; the number beside the name is the value. */}
        <SwiftUIProgressView value={entry.fraction} modifiers={[tint(theme.blue)]} />
      </SwiftUIVStack>
    </SwiftUIHStack>
  </SwiftUIButton>
}

function NativeLeaderboard({ model, ranked, viewerId, poolsEnabled, openProfile, openFriends }: LeaderboardView) {
  const theme = useAppTheme()
  const { scope, range, metric, activity, updating } = model
  const hasOthers = ranked.some((entry) => entry.userId !== viewerId)
  const copy = circleCopy(scope === 'pool')
  const ready = !model.loading && !model.error
  return <SwiftUIHost modifiers={[tint(theme.blue)]} style={styles.flex}><SwiftUIForm modifiers={[refreshable(async () => { await model.refetch() })]}>
    <NativeUsageControls range={range} onRangeChange={model.setRange} metric={metric} onMetricChange={model.setMetric}>
      {poolsEnabled ? <NativeSegmented label="Circle" options={SCOPES} value={scope} onChange={model.setScope} /> : null}
    </NativeUsageControls>
    <NativeUsageStatus loading={model.loading} error={model.error} onRetry={() => void model.refetch()} />
    {ready ? <>
      <SwiftUISection
        header={hasOthers ? <NativeCountHeader title={copy.ranking} count={ranked.length} /> : <SwiftUIText>{copy.ranking}</SwiftUIText>}
        footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>{copy.caption}</SwiftUIText>}
      >
        {hasOthers
          ? ranked.map((entry) => <NativeRankRow key={entry.userId} entry={entry} metric={metric} own={entry.userId === viewerId} onOpen={() => openProfile(entry.username)} />)
          : <>
            <NativeNotice icon="person.2">{copy.empty}</NativeNotice>
            <SwiftUIButton label={copy.action} onPress={openFriends} />
          </>}
      </SwiftUISection>
      <NativeUsageChartSection title={copy.combined} activity={activity} range={range} metric={metric} updating={updating} />
      <NativeUsageTotalsSection activity={activity} range={range} updating={updating} />
      <NativeUsageYearSection activity={activity} metric={metric} updating={updating} />
      <NativeTopModelsSection activity={activity} metric={metric} updating={updating} />
      <NativeRecentUsageSection records={model.records} updating={updating} showParticipant onOpenProfile={openProfile} />
    </> : null}
  </SwiftUIForm></SwiftUIHost>
}

// Android: Material cards and rows, like Friends there.

function MaterialLeaderboard({ model, ranked, viewerId, poolsEnabled, openProfile, openFriends, back }: LeaderboardView) {
  const theme = useAppTheme()
  const { scope, range, metric, activity } = model
  // Alone, there is nobody to compare with.
  const hasOthers = ranked.some((entry) => entry.userId !== viewerId)
  const copy = circleCopy(scope === 'pool')

  return <UsagePage title="Leaderboard" onBack={back} onRefresh={model.refetch}>
    {poolsEnabled ? <View style={styles.scope}><Segmented label="Circle" options={SCOPES} value={scope} onChange={model.setScope} /></View> : null}
    <UsageControls range={range} onRangeChange={model.setRange} metric={metric} onMetricChange={model.setMetric} />
    <Text style={[styles.caption, { color: theme.secondary }]}>{copy.caption}</Text>
    <UsageBody loading={model.loading} updating={model.updating} error={model.error} onRetry={() => void model.refetch()}>
      <SectionTitle trailing={hasOthers ? <Text style={[styles.count, { color: theme.secondary }]}>{ranked.length}</Text> : undefined}>{copy.ranking}</SectionTitle>
      {hasOthers
        ? <Card>{ranked.map((entry, index) => <RankRow key={entry.userId} entry={entry} metric={metric} own={entry.userId === viewerId} last={index === ranked.length - 1} onOpen={() => openProfile(entry.username)} />)}</Card>
        : <Card style={styles.empty}>
          <UsageNotice icon="person.2">{copy.empty}</UsageNotice>
          <PrimaryButton label={copy.action} variant="plain" onPress={openFriends} />
        </Card>}
      <SectionTitle>{copy.combined}</SectionTitle>
      <UsageChartCard activity={activity} range={range} metric={metric} />
      <UsageTotalsCard activity={activity} range={range} />
      <SectionTitle>Activity</SectionTitle>
      <UsageYearCard activity={activity} metric={metric} />
      <SectionTitle>Top models</SectionTitle>
      <TopModelsCard activity={activity} metric={metric} />
      <SectionTitle>Recent usage</SectionTitle>
      <RecentUsageCard records={model.records} showParticipant onOpenProfile={openProfile} />
    </UsageBody>
  </UsagePage>
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scope: { marginBottom: 10 },
  caption: { fontSize: 13, lineHeight: 18, paddingHorizontal: 4 },
  count: { fontSize: 12, lineHeight: 18 },
  empty: { paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 12 },
  rank: { width: 20, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'], textAlign: 'center' },
  rowText: { minWidth: 0, flex: 1 },
  line: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '600' },
  value: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  handle: { fontSize: 12, lineHeight: 16, marginTop: 1 },
  meter: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 8 },
  meterFill: { height: 4, borderRadius: 2 },
})
