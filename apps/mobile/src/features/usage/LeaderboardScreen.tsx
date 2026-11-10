import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Card, PrimaryButton, SectionTitle, Segmented } from '../../mockup5/src/components/PrototypeUI'
import { ProfileAvatar } from '../../mockup5/src/components/ProfileAvatar'
import { useAppTheme } from '../../mockup5/src/theme'
import type { RootStackParamList } from '../../mockup5/src/navigation'
import { useFriendsContext } from '../friends/hooks'
import type { LeaderboardScope } from './api'
import { compactCount, metricLabel, rankLeaderboard, type RankedEntry, type UsageMetric } from './format'
import { useLeaderboard } from './hooks'
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

/** You and your friends, or your Pool, ranked by usage, with everyone's usage combined below. */
export function LeaderboardScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Leaderboard'>) {
  const theme = useAppTheme()
  const { namespace, user, poolsEnabled } = useFriendsContext()
  const model = useLeaderboard({ namespace, initialScope: poolsEnabled && route.params?.scope === 'pool' ? 'pool' : 'friends' })
  const { scope, range, metric, activity } = model
  const ranked = useMemo(() => rankLeaderboard(model.entries ?? [], metric), [metric, model.entries])
  // Alone, there is nobody to compare with.
  const hasOthers = ranked.some((entry) => entry.userId !== user?.id)
  const pool = scope === 'pool'

  return <UsagePage title="Leaderboard" onBack={() => navigation.goBack()} onRefresh={model.refetch}>
    {poolsEnabled ? <View style={styles.scope}><Segmented label="Circle" options={SCOPES} value={scope} onChange={model.setScope} /></View> : null}
    <UsageControls range={range} onRangeChange={model.setRange} metric={metric} onMetricChange={model.setMetric} />
    <Text style={[styles.caption, { color: theme.secondary }]}>{pool ? 'Settled usage across your Pool.' : 'Settled usage across you and your friends.'}</Text>
    <UsageBody loading={model.loading} updating={model.updating} error={model.error} onRetry={() => void model.refetch()}>
      <SectionTitle trailing={hasOthers ? <Text style={[styles.count, { color: theme.secondary }]}>{ranked.length}</Text> : undefined}>{pool ? 'Pool ranking' : 'Friends ranking'}</SectionTitle>
      {hasOthers
        ? <Card>{ranked.map((entry, index) => <RankRow key={entry.userId} entry={entry} metric={metric} own={entry.userId === user?.id} last={index === ranked.length - 1} onOpen={() => navigation.push('FriendProfile', { username: entry.username })} />)}</Card>
        : <Card style={styles.empty}>
          <UsageNotice icon="person.2">{pool ? 'Add Pool members to compare usage.' : 'Add friends to compare usage.'}</UsageNotice>
          <PrimaryButton label={pool ? 'Manage Pool' : 'Find Friends'} variant="plain" onPress={() => navigation.navigate('Friends')} />
        </Card>}
      <SectionTitle>{pool ? 'Pool usage' : 'Combined usage'}</SectionTitle>
      <UsageChartCard activity={activity} range={range} metric={metric} />
      <UsageTotalsCard activity={activity} range={range} />
      <SectionTitle>Activity</SectionTitle>
      <UsageYearCard activity={activity} metric={metric} />
      <SectionTitle>Top models</SectionTitle>
      <TopModelsCard activity={activity} metric={metric} />
      <SectionTitle>Recent usage</SectionTitle>
      <RecentUsageCard records={model.records} showParticipant onOpenProfile={(username) => navigation.push('FriendProfile', { username })} />
    </UsageBody>
  </UsagePage>
}

const styles = StyleSheet.create({
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
