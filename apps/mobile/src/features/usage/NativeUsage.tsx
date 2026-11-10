import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import {
  Button,
  HStack,
  Label,
  LabeledContent,
  Picker,
  ProgressView,
  RNHostView,
  RoundedRectangle,
  Section,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui'
import {
  accessibilityElement,
  accessibilityHidden,
  accessibilityLabel,
  buttonStyle,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  opacity,
  pickerStyle,
  shapes,
  tag,
  tint,
} from '@expo/ui/swift-ui/modifiers'
import { ProfileAvatar } from '../../mockup5/src/components/ProfileAvatar'
import { useAppTheme } from '../../mockup5/src/theme'
import { USAGE_METRICS, USAGE_RANGES, averageLabel, compactCount, metricLabel, rankedModels, recordTimeLabel, tokensOf, usageTotals, type UsageActivity, type UsageMetric, type UsageRange, type UsageRecord } from './format'
import type { UsageRecordsModel } from './hooks'
import { BAR_CHART_HEIGHT, BarChart, MODELS_SHOWN, NO_USAGE, YEAR_GRID_HEIGHT, YearGrid } from './UsageCards'
import { heatLevels, useRecordPaging, useUsageChart, useUsageYear } from './usageViews'

// iOS: usage as SwiftUI form sections, like Settings and Friends. The bars and the year grid have
// no SwiftUI control that can select a day, so they are drawn in React Native inside their rows.

/** While another period loads, the last one stays in place, dimmed. */
const dim = (updating: boolean) => (updating ? [opacity(0.5)] : [])

/** A segmented control in a form row. */
export function NativeSegmented<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return <Picker label={label} selection={value} onSelectionChange={(selection) => onChange(selection as T)} modifiers={[pickerStyle('segmented')]}>
    {options.map((option) => <Text key={option.value} modifiers={[tag(option.value)]}>{option.label}</Text>)}
  </Picker>
}

/** What to count, and over how long; with `children`, other choices above them. */
export function NativeUsageControls({ title, range, onRangeChange, metric, onMetricChange, children }: {
  title?: string
  range: UsageRange
  onRangeChange: (range: UsageRange) => void
  metric: UsageMetric
  onMetricChange: (metric: UsageMetric) => void
  children?: ReactNode
}) {
  return <Section title={title}>
    {children}
    <NativeSegmented label="Measure" options={USAGE_METRICS} value={metric} onChange={onMetricChange} />
    <NativeSegmented label="Period" options={USAGE_RANGES} value={range} onChange={onRangeChange} />
  </Section>
}

/** A line of secondary text, with an icon when it explains something missing. */
export function NativeNotice({ icon, children }: { icon?: string; children: string }) {
  if (icon) return <Label title={children} systemImage={icon as never} modifiers={[foregroundStyle('secondary')]} />
  return <Text modifiers={[foregroundStyle('secondary')]}>{children}</Text>
}

/** Loading, or a failure with a way to retry; nothing once usage is here. */
export function NativeUsageStatus({ loading, error, onRetry }: { loading: boolean; error: Error | null; onRetry: () => void }) {
  if (loading) return <Section><HStack spacing={10}><ProgressView /><Text modifiers={[foregroundStyle('secondary')]}>Loading usage…</Text></HStack></Section>
  if (error) return <Section footer={<Text modifiers={[foregroundStyle('secondary')]}>{`Usage could not be loaded. ${error.message}`}</Text>}>
    <Button label="Try Again" systemImage="arrow.clockwise" onPress={onRetry} />
  </Section>
  return null
}

/** The period's total, then its bars; tapping a bar reads that day instead. */
export function NativeUsageChartSection({ title, activity, range, metric, updating }: { title?: string; activity: UsageActivity | undefined; range: UsageRange; metric: UsageMetric; updating: boolean }) {
  const chart = useUsageChart(activity, range, metric)
  return <Section title={title} modifiers={dim(updating)}>
    <VStack alignment="leading" spacing={2} modifiers={[accessibilityElement('combine'), accessibilityLabel(chart.accessibilityLabel)]}>
      <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle('secondary')]}>{chart.caption}</Text>
      <Text modifiers={[font({ textStyle: 'largeTitle', weight: 'bold' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.5)]}>{chart.value}</Text>
    </VStack>
    {chart.total > 0
      ? <VStack modifiers={[frame({ maxWidth: Infinity, height: BAR_CHART_HEIGHT })]}>
        <RNHostView><View style={styles.fill}><BarChart bars={chart.bars} metric={metric} selected={chart.selected} onSelect={chart.select} /></View></RNHostView>
      </VStack>
      : <NativeNotice>{NO_USAGE}</NativeNotice>}
  </Section>
}

function NativeStat({ label, value }: { label: string; value: string }) {
  return <LabeledContent label={label}><Text modifiers={[foregroundStyle('secondary'), monospacedDigit()]}>{value}</Text></LabeledContent>
}

export function NativeUsageTotalsSection({ activity, range, updating }: { activity: UsageActivity | undefined; range: UsageRange; updating: boolean }) {
  const totals = usageTotals(activity, range)
  return <Section modifiers={dim(updating)}>
    <NativeStat label="Calls" value={compactCount(totals.calls)} />
    <NativeStat label="Tokens" value={compactCount(totals.tokens)} />
    <NativeStat label="Calls per day" value={averageLabel(totals.callsPerDay)} />
    <NativeStat label="Tokens per day" value={averageLabel(totals.tokensPerDay)} />
  </Section>
}

/** The past year, a square a day, darker the more it was used. */
export function NativeUsageYearSection({ activity, metric, updating }: { activity: UsageActivity | undefined; metric: UsageMetric; updating: boolean }) {
  const theme = useAppTheme()
  const { year, picked, pick, summary, detail } = useUsageYear(activity, metric)
  return <Section title="Activity" footer={<Text modifiers={[foregroundStyle('secondary')]}>{detail}</Text>} modifiers={dim(updating)}>
    <VStack alignment="leading" spacing={10}>
      <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle('secondary')]}>{summary}</Text>
      <VStack modifiers={[frame({ maxWidth: Infinity, height: YEAR_GRID_HEIGHT })]}>
        <RNHostView><View style={styles.fill}><YearGrid year={year} picked={picked} onPick={pick} summary={summary} /></View></RNHostView>
      </VStack>
      <HStack spacing={3} modifiers={[accessibilityHidden(true)]}>
        <Spacer />
        <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle('secondary')]}>Less</Text>
        {heatLevels(theme).map((color, index) => <RoundedRectangle key={index} cornerRadius={2} modifiers={[foregroundStyle(color), frame({ width: 10, height: 10 })]} />)}
        <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle('secondary')]}>More</Text>
      </HStack>
    </VStack>
  </Section>
}

/** Models by the chosen measure, each with its share of the period. */
export function NativeTopModelsSection({ activity, metric, updating }: { activity: UsageActivity | undefined; metric: UsageMetric; updating: boolean }) {
  const theme = useAppTheme()
  const models = rankedModels(activity, metric).slice(0, MODELS_SHOWN)
  return <Section title="Top models" modifiers={dim(updating)}>
    {models.length ? models.map((model, index) => <VStack
      key={model.modelId}
      alignment="leading"
      spacing={6}
      modifiers={[accessibilityElement('combine'), accessibilityLabel(`${index + 1}. ${model.name}, ${metricLabel(model.value, metric)}, ${Math.round(model.share * 100)}%`)]}
    >
      <HStack>
        <Text modifiers={[lineLimit(1)]}>{model.name}</Text>
        <Spacer />
        <Text modifiers={[foregroundStyle('secondary'), monospacedDigit()]}>{compactCount(model.value)}</Text>
      </HStack>
      <ProgressView value={model.share} modifiers={[tint(theme.blue)]} />
    </VStack>) : <NativeNotice>{NO_USAGE}</NativeNotice>}
  </Section>
}

function NativeRecordRow({ record, showParticipant, onOpenProfile }: { record: UsageRecord; showParticipant: boolean; onOpenProfile?: (username: string) => void }) {
  const person = showParticipant ? record.participant : undefined
  const tokens = metricLabel(tokensOf(record), 'tokens')
  const time = recordTimeLabel(record.createdAt)
  const label = [person?.displayName, record.model.name, time, tokens].filter(Boolean).join(', ')
  const row = <HStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}>
    {person ? <RNHostView matchContents><ProfileAvatar size={32} user={{ id: person.id, name: person.displayName, avatarUrl: person.avatarUrl }} /></RNHostView> : null}
    <VStack alignment="leading" spacing={2}>
      <Text modifiers={[lineLimit(1)]}>{person ? person.displayName : record.model.name}</Text>
      <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary'), lineLimit(2)]}>{person ? `${record.model.name} · ${time}` : time}</Text>
    </VStack>
    <Spacer />
    <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle('secondary'), monospacedDigit()]}>{tokens}</Text>
  </HStack>
  if (person && onOpenProfile) return <Button onPress={() => onOpenProfile(person.username)} modifiers={[buttonStyle('plain'), accessibilityLabel(label)]}>{row}</Button>
  return <VStack modifiers={[accessibilityElement('combine'), accessibilityLabel(label)]}>{row}</VStack>
}

/** The latest settled calls, a few at first; "Show More" reveals and then loads older ones. */
export function NativeRecentUsageSection({ records, updating, showParticipant = false, onOpenProfile }: { records: UsageRecordsModel; updating: boolean; showParticipant?: boolean; onOpenProfile?: (username: string) => void }) {
  const theme = useAppTheme()
  const { visible, more, showMore, moreLabel } = useRecordPaging(records)
  return <Section
    title="Recent usage"
    footer={records.loadMoreError ? <Text modifiers={[foregroundStyle(theme.red)]}>{records.loadMoreError}</Text> : undefined}
    modifiers={dim(updating)}
  >
    {records.items.length ? <>
      {visible.map((record) => <NativeRecordRow key={record.id} record={record} showParticipant={showParticipant} onOpenProfile={onOpenProfile} />)}
      {more ? (records.loadingMore
        ? <HStack><Spacer /><ProgressView /><Spacer /></HStack>
        : <Button label={moreLabel} onPress={showMore} modifiers={[disabled(records.loadingMore)]} />) : null}
    </> : <NativeNotice>{NO_USAGE}</NativeNotice>}
  </Section>
}

/** One person's usage as form sections: what to count and over how long, the chart, totals, year, models and calls. */
export function NativePersonUsage({ usage }: { usage: {
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
  const { activity, range, metric, updating } = usage
  const ready = !usage.loading && !usage.error
  return <>
    <NativeUsageControls title="Usage" range={range} onRangeChange={usage.setRange} metric={metric} onMetricChange={usage.setMetric} />
    <NativeUsageStatus loading={usage.loading} error={usage.error} onRetry={() => void usage.refetch()} />
    {ready ? <>
      <NativeUsageChartSection activity={activity} range={range} metric={metric} updating={updating} />
      <NativeUsageTotalsSection activity={activity} range={range} updating={updating} />
      <NativeUsageYearSection activity={activity} metric={metric} updating={updating} />
      <NativeTopModelsSection activity={activity} metric={metric} updating={updating} />
      <NativeRecentUsageSection records={usage.records} updating={updating} />
    </> : null}
  </>
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
