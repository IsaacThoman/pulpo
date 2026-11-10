import { useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Card, ListRow, PageHeader, PrimaryButton, SectionTitle, Segmented } from '../../mockup5/src/components/PrototypeUI'
import { ProfileAvatar } from '../../mockup5/src/components/ProfileAvatar'
import { SymbolView } from '../../platform/SymbolView'
import { useAppTheme } from '../../mockup5/src/theme'
import { SETTINGS_CONTENT_MAX } from '../../responsive'
import {
  USAGE_METRICS,
  USAGE_RANGES,
  averageLabel,
  compactCount,
  metricLabel,
  niceCeiling,
  rankedModels,
  recordTimeLabel,
  tokensOf,
  usageTotals,
  type ChartBar,
  type ContributionCell,
  type ContributionYear,
  type UsageActivity,
  type UsageMetric,
  type UsageRange,
  type UsageRecord,
} from './format'
import type { UsageRecordsModel } from './hooks'
import { heatLevels, useRecordPaging, useUsageChart, useUsageYear } from './usageViews'

const CHART_HEIGHT = 148
/** Room beside the bars for the scale's values. */
const AXIS_WIDTH = 38
const MAX_BAR_WIDTH = 24
const AXIS_LINE = 14
const HEAT_CELL = 12
const HEAT_GAP = 3
const HEAT_STEP = HEAT_CELL + HEAT_GAP
const HEAT_HEADER = 16
/** What the bars, their scale and their dates take up, for hosting the chart in a SwiftUI form. */
export const BAR_CHART_HEIGHT = CHART_HEIGHT + 8 + AXIS_LINE
/** The year grid's height, month labels included. */
export const YEAR_GRID_HEIGHT = HEAT_HEADER + 7 * HEAT_STEP - HEAT_GAP
export const NO_USAGE = 'No usage in this period.'
export const MODELS_SHOWN = 8

/** A scrolling page for usage with its own header, for Android. Pulling down reloads what the page shows. */
export function UsagePage({ title, onBack, onRefresh, children }: { title: string; onBack: () => void; onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const theme = useAppTheme()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = () => {
    setRefreshing(true)
    void onRefresh().catch(() => undefined).finally(() => setRefreshing(false))
  }
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.flex, { backgroundColor: theme.background }]}>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.secondary} />}>
      <PageHeader title={title} onBack={onBack} />
      {children}
    </ScrollView>
  </SafeAreaView>
}

/** What to count, and over how long. */
export function UsageControls({ range, onRangeChange, metric, onMetricChange }: {
  range: UsageRange
  onRangeChange: (range: UsageRange) => void
  metric: UsageMetric
  onMetricChange: (metric: UsageMetric) => void
}) {
  return <View style={styles.controls}>
    <Segmented label="Measure" options={USAGE_METRICS} value={metric} onChange={onMetricChange} />
    <Segmented label="Period" options={USAGE_RANGES} value={range} onChange={onRangeChange} />
  </View>
}

/** A lock, a line of text: usage that is not shown, or a list with nothing in it. */
export function UsageNotice({ icon, children }: { icon?: string; children: string }) {
  const theme = useAppTheme()
  return <View style={styles.notice}>
    {icon ? <SymbolView name={icon as never} size={20} tintColor={theme.secondary} /> : null}
    <Text style={[styles.noticeText, { color: theme.secondary }]}>{children}</Text>
  </View>
}

/** Bars a day (or a few days) wide against a scale; tapping one selects it. */
export function BarChart({ bars, metric, selected, onSelect }: { bars: ChartBar[]; metric: UsageMetric; selected: number | null; onSelect: (index: number | null) => void }) {
  const theme = useAppTheme()
  const ceiling = niceCeiling(Math.max(0, ...bars.map((bar) => bar.value)))
  const half = ceiling / 2
  // A day a bar, with a gap of surface between neighbors; long ranges leave room for only a sliver.
  const gap = bars.length > 32 ? 1 : 2
  const radius = bars.length > 32 ? 1.5 : 3
  return <View>
    <View style={styles.chart}>
      <View style={styles.plot}>
        <View style={[styles.gridline, { top: 0, backgroundColor: theme.separator }]} />
        {Number.isInteger(half) ? <View style={[styles.gridline, { top: CHART_HEIGHT / 2, backgroundColor: theme.separator }]} /> : null}
        <View style={[styles.bars, { gap }]}>
          {bars.map((bar, index) => <Pressable
            key={bar.key}
            accessibilityRole="button"
            accessibilityLabel={`${bar.label}, ${metricLabel(bar.value, metric)}`}
            accessibilityState={{ selected: selected === index }}
            onPress={() => onSelect(selected === index ? null : index)}
            style={styles.barSlot}
          >
            <View style={{
              width: '100%',
              maxWidth: MAX_BAR_WIDTH,
              // Any usage shows, however small beside the busiest day.
              height: bar.value > 0 ? Math.max(2, Math.round((bar.value / ceiling) * CHART_HEIGHT)) : 0,
              borderTopLeftRadius: radius,
              borderTopRightRadius: radius,
              backgroundColor: theme.blue,
              opacity: selected === null || selected === index ? 1 : 0.35,
            }} />
          </Pressable>)}
        </View>
        <View style={[styles.gridline, { bottom: 0, backgroundColor: theme.tertiary }]} />
      </View>
      {/* Each value sits centered on its gridline. */}
      <View style={styles.axis} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text style={[styles.axisText, styles.axisLabel, { top: -AXIS_LINE / 2, color: theme.secondary }]}>{compactCount(ceiling)}</Text>
        {Number.isInteger(half) ? <Text style={[styles.axisText, styles.axisLabel, { top: (CHART_HEIGHT - AXIS_LINE) / 2, color: theme.secondary }]}>{compactCount(half)}</Text> : null}
        <Text style={[styles.axisText, styles.axisLabel, { top: CHART_HEIGHT - AXIS_LINE / 2, color: theme.secondary }]}>0</Text>
      </View>
    </View>
    <View style={styles.chartDates} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text style={[styles.axisText, { color: theme.secondary }]}>{bars[0]?.label ?? ''}</Text>
      {bars.length > 1 ? <Text style={[styles.axisText, { color: theme.secondary }]}>{bars[bars.length - 1]!.label}</Text> : null}
    </View>
  </View>
}

/** The period's total over its days; tapping a bar reads that day instead. */
export function UsageChartCard({ activity, range, metric }: { activity: UsageActivity | undefined; range: UsageRange; metric: UsageMetric }) {
  const theme = useAppTheme()
  const chart = useUsageChart(activity, range, metric)
  return <Card style={styles.padded}>
    <View accessible accessibilityLabel={chart.accessibilityLabel}>
      <Text style={[styles.caption, { color: theme.secondary }]}>{chart.caption}</Text>
      <Text style={[styles.hero, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>{chart.value}</Text>
    </View>
    {chart.total > 0
      ? <BarChart bars={chart.bars} metric={metric} selected={chart.selected} onSelect={chart.select} />
      : <View style={styles.chartEmpty}><Text style={[styles.noticeText, { color: theme.secondary }]}>{NO_USAGE}</Text></View>}
  </Card>
}

function Stat({ label, value }: { label: string; value: string }) {
  const theme = useAppTheme()
  return <View style={styles.stat} accessible accessibilityLabel={`${label}, ${value}`}>
    <Text style={[styles.caption, { color: theme.secondary }]}>{label}</Text>
    <Text style={[styles.statValue, { color: theme.text }]} numberOfLines={1}>{value}</Text>
  </View>
}

export function UsageTotalsCard({ activity, range }: { activity: UsageActivity | undefined; range: UsageRange }) {
  const totals = usageTotals(activity, range)
  return <Card style={styles.stats}>
    <Stat label="Calls" value={compactCount(totals.calls)} />
    <Stat label="Tokens" value={compactCount(totals.tokens)} />
    <Stat label="Calls per day" value={averageLabel(totals.callsPerDay)} />
    <Stat label="Tokens per day" value={averageLabel(totals.tokensPerDay)} />
  </Card>
}

/** A square a day, darker the more it was used, scrolled to the most recent weeks. */
export function YearGrid({ year, picked, onPick, summary }: { year: ContributionYear; picked: ContributionCell | null; onPick: (cell: ContributionCell | null) => void; summary: string }) {
  const theme = useAppTheme()
  const scroll = useRef<ScrollView>(null)
  const levels = heatLevels(theme)
  const width = year.weeks.length * HEAT_STEP - HEAT_GAP
  const pick = (event: GestureResponderEvent) => {
    const column = Math.floor(event.nativeEvent.locationX / HEAT_STEP)
    const row = Math.floor((event.nativeEvent.locationY - HEAT_HEADER) / HEAT_STEP)
    onPick(year.weeks[column]?.[row] ?? null)
  }
  return <ScrollView
    ref={scroll}
    horizontal
    showsHorizontalScrollIndicator={false}
    onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
  >
    <Pressable accessibilityRole="image" accessibilityLabel={`Activity over the last year. ${summary}.`} onPress={pick}>
      <View pointerEvents="none" style={{ width, height: YEAR_GRID_HEIGHT }}>
        {year.months.map((month) => <Text key={`${month.label}-${month.column}`} style={[styles.heatMonth, { left: month.column * HEAT_STEP, color: theme.secondary }]}>{month.label}</Text>)}
        <View style={styles.heatWeeks}>
          {year.weeks.map((week) => <View key={week[0]!.key} style={styles.heatWeek}>
            {week.map((cell) => <View key={cell.key} style={[
              styles.heatCell,
              cell.placeholder ? null : { backgroundColor: levels[cell.level] },
              picked?.key === cell.key ? { borderWidth: 1.5, borderColor: theme.text } : null,
            ]} />)}
          </View>)}
        </View>
      </View>
    </Pressable>
  </ScrollView>
}

/** The past year, a square a day, darker the more it was used. Opens on the most recent weeks. */
export function UsageYearCard({ activity, metric }: { activity: UsageActivity | undefined; metric: UsageMetric }) {
  const theme = useAppTheme()
  const { year, picked, pick, summary, detail } = useUsageYear(activity, metric)
  return <Card style={styles.padded}>
    <Text style={[styles.caption, { color: theme.secondary }]}>{summary}</Text>
    <View style={styles.heatScroll}><YearGrid year={year} picked={picked} onPick={pick} summary={summary} /></View>
    <View style={styles.heatFooter}>
      <Text style={[styles.axisText, styles.flexShrink, { color: theme.secondary }]} numberOfLines={2}>{detail}</Text>
      <View style={styles.heatLegend} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text style={[styles.axisText, { color: theme.secondary }]}>Less</Text>
        {heatLevels(theme).map((color, index) => <View key={index} style={[styles.heatLegendCell, { backgroundColor: color }]} />)}
        <Text style={[styles.axisText, { color: theme.secondary }]}>More</Text>
      </View>
    </View>
  </Card>
}

/** Models by the chosen measure, each with its share of the period. */
export function TopModelsCard({ activity, metric }: { activity: UsageActivity | undefined; metric: UsageMetric }) {
  const theme = useAppTheme()
  const models = rankedModels(activity, metric).slice(0, MODELS_SHOWN)
  if (!models.length) return <Card><UsageNotice>{NO_USAGE}</UsageNotice></Card>
  return <Card>
    {models.map((model, index) => <View
      key={model.modelId}
      accessible
      accessibilityLabel={`${index + 1}. ${model.name}, ${metricLabel(model.value, metric)}, ${Math.round(model.share * 100)}%`}
      style={[styles.model, index < models.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator }]}
    >
      <View style={styles.line}>
        <Text style={[styles.rowTitle, styles.flexShrink, { color: theme.text }]} numberOfLines={1}>{model.name}</Text>
        <Text style={[styles.rowValue, { color: theme.secondary }]}>{compactCount(model.value)}</Text>
      </View>
      <View style={[styles.meter, { backgroundColor: theme.fillStrong }]}>
        <View style={[styles.meterFill, { backgroundColor: theme.blue, width: `${Math.max(1, model.share * 100)}%` }]} />
      </View>
    </View>)}
  </Card>
}

function RecordRow({ record, last, showParticipant, onOpenProfile }: { record: UsageRecord; last: boolean; showParticipant: boolean; onOpenProfile?: (username: string) => void }) {
  const theme = useAppTheme()
  const person = showParticipant ? record.participant : undefined
  const tokens = metricLabel(tokensOf(record), 'tokens')
  const time = recordTimeLabel(record.createdAt)
  const body = <>
    {person ? <ProfileAvatar size={32} user={{ id: person.id, name: person.displayName, avatarUrl: person.avatarUrl }} /> : null}
    <View style={styles.rowText}>
      <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>{person ? person.displayName : record.model.name}</Text>
      <Text style={[styles.rowDetail, { color: theme.secondary }]} numberOfLines={2}>{person ? `${record.model.name} · ${time}` : time}</Text>
    </View>
    <Text style={[styles.rowValue, { color: theme.secondary }]}>{tokens}</Text>
  </>
  const style = [styles.record, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator }]
  const label = [person?.displayName, record.model.name, time, tokens].filter(Boolean).join(', ')
  if (person && onOpenProfile) return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Opens their profile" onPress={() => onOpenProfile(person.username)} style={({ pressed }) => [style, pressed && { backgroundColor: theme.fill }]}>{body}</Pressable>
  return <View accessible accessibilityLabel={label} style={style}>{body}</View>
}

/** The latest settled calls, a few at first; "Show More" reveals and then loads older ones. */
export function RecentUsageCard({ records, showParticipant = false, onOpenProfile }: { records: UsageRecordsModel; showParticipant?: boolean; onOpenProfile?: (username: string) => void }) {
  const theme = useAppTheme()
  const { visible, more, showMore, moreLabel } = useRecordPaging(records)
  if (!records.items.length) return <Card><UsageNotice>{NO_USAGE}</UsageNotice></Card>
  return <Card>
    {visible.map((record, index) => <RecordRow key={record.id} record={record} last={!more && index === visible.length - 1} showParticipant={showParticipant} onOpenProfile={onOpenProfile} />)}
    {records.loadMoreError ? <Text accessibilityRole="alert" style={[styles.loadError, { color: theme.red }]}>{records.loadMoreError}</Text> : null}
    {more ? <View style={styles.more}><PrimaryButton label={moreLabel} variant="plain" loading={records.loadingMore} onPress={showMore} /></View> : null}
  </Card>
}

/**
 * Loading, a failure with a way to retry, or the usage itself. While another period or circle
 * loads, the last one stays in place, dimmed, so the page does not jump.
 */
export function UsageBody({ loading, updating = false, error, onRetry, children }: { loading: boolean; updating?: boolean; error: Error | null; onRetry: () => void; children: ReactNode }) {
  const theme = useAppTheme()
  if (loading) return <View style={styles.loading}><ActivityIndicator color={theme.secondary} /><Text style={[styles.noticeText, { color: theme.secondary }]}>Loading usage…</Text></View>
  if (error) return <Card><ListRow icon="arrow.clockwise" iconColor={theme.blue} title="Usage could not be loaded" detail={`${error.message} Tap to retry.`} last onPress={onRetry} /></Card>
  return <View accessibilityState={{ busy: updating }} style={updating ? styles.updating : undefined}>{children}</View>
}

/** One person's usage: what to count and over how long, then the chart, totals, year, models and calls. */
export function PersonUsage({ usage }: { usage: {
  range: UsageRange
  setRange: (range: UsageRange) => void
  metric: UsageMetric
  setMetric: (metric: UsageMetric) => void
  activity: UsageActivity | undefined
  loading: boolean
  updating: boolean
  error: Error | null
  records: UsageRecordsModel
  refetch: () => Promise<unknown>
} }) {
  const { activity, range, metric } = usage
  return <>
    <UsageControls range={range} onRangeChange={usage.setRange} metric={metric} onMetricChange={usage.setMetric} />
    <UsageBody loading={usage.loading} updating={usage.updating} error={usage.error} onRetry={() => void usage.refetch()}>
      <UsageChartCard activity={activity} range={range} metric={metric} />
      <UsageTotalsCard activity={activity} range={range} />
      <SectionTitle>Activity</SectionTitle>
      <UsageYearCard activity={activity} metric={metric} />
      <SectionTitle>Top models</SectionTitle>
      <TopModelsCard activity={activity} metric={metric} />
      <SectionTitle>Recent usage</SectionTitle>
      <RecentUsageCard records={usage.records} />
    </UsageBody>
  </>
}

const android = Platform.OS === 'android'

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  page: { width: '100%', maxWidth: SETTINGS_CONTENT_MAX, alignSelf: 'center', paddingHorizontal: 18, paddingBottom: 32 },
  controls: { gap: 10, marginBottom: 14 },
  padded: { padding: 16 },
  caption: { fontSize: android ? 14 : 13, lineHeight: 18 },
  hero: { fontSize: 36, fontWeight: '700', letterSpacing: -0.6, fontVariant: ['tabular-nums'], marginTop: 2, marginBottom: 14 },
  chart: { flexDirection: 'row', height: CHART_HEIGHT },
  plot: { flex: 1, height: CHART_HEIGHT },
  gridline: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end' },
  barSlot: { flex: 1, height: CHART_HEIGHT, alignItems: 'center', justifyContent: 'flex-end' },
  axis: { width: AXIS_WIDTH, height: CHART_HEIGHT },
  axisText: { fontSize: 11, lineHeight: AXIS_LINE, fontVariant: ['tabular-nums'] },
  axisLabel: { position: 'absolute', right: 0 },
  chartDates: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginRight: AXIS_WIDTH },
  chartEmpty: { height: CHART_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, paddingVertical: 6 },
  stat: { width: '50%', paddingHorizontal: 16, paddingVertical: 10 },
  statValue: { fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'], marginTop: 2 },
  heatScroll: { marginTop: 12 },
  heatMonth: { position: 'absolute', top: 0, fontSize: 10, lineHeight: 12 },
  heatWeeks: { position: 'absolute', top: HEAT_HEADER, left: 0, flexDirection: 'row', gap: HEAT_GAP },
  heatWeek: { gap: HEAT_GAP },
  heatCell: { width: HEAT_CELL, height: HEAT_CELL, borderRadius: 3 },
  heatFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12 },
  heatLegend: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  heatLegendCell: { width: 10, height: 10, borderRadius: 2 },
  model: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  line: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  meter: { height: 4, borderRadius: 2, overflow: 'hidden' },
  meterFill: { height: 4, borderRadius: 2 },
  record: { minHeight: 60, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 11 },
  rowText: { minWidth: 0, flex: 1 },
  rowTitle: { fontSize: android ? 16 : 15, fontWeight: android ? '500' : '600' },
  rowDetail: { fontSize: android ? 14 : 12, lineHeight: android ? 20 : 16, marginTop: 2 },
  rowValue: { fontSize: 14, fontVariant: ['tabular-nums'] },
  more: { paddingHorizontal: 8, paddingVertical: 4 },
  loadError: { fontSize: 12, lineHeight: 18, paddingHorizontal: 16, paddingTop: 10, textAlign: 'center' },
  notice: { alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingVertical: 28 },
  noticeText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  loading: { alignItems: 'center', gap: 10, paddingVertical: 48 },
  updating: { opacity: 0.5 },
})
