import { useMemo, useState } from 'react'
import type { AppTheme } from '../../mockup5/src/theme'
import { chartBars, compactCount, contributionYear, metricLabel, usageTotals, type ChartBar, type ContributionCell, type UsageActivity, type UsageMetric, type UsageRange } from './format'
import type { UsageRecordsModel } from './hooks'

// What the usage views show and remember, shared by the Android cards (UsageCards) and the iOS
// form sections (NativeUsage).

/** Records shown before "Show More", and how many each press adds. */
const RECORDS_FIRST = 8
const RECORDS_MORE = 20

/**
 * The period's bars and the one tapped, if any: the bar and the period's total, which the chart's
 * heading shows. A chosen bar belongs to the bars it was chosen from.
 */
export function useUsageChart(activity: UsageActivity | undefined, range: UsageRange, metric: UsageMetric) {
  const bars = useMemo(() => chartBars(activity?.daily ?? [], range, metric), [activity?.daily, metric, range])
  const [selection, setSelection] = useState<{ bars: ChartBar[]; index: number } | null>(null)
  const selected = selection?.bars === bars ? selection.index : null
  const totals = usageTotals(activity, range)
  const total = metric === 'tokens' ? totals.tokens : totals.calls
  const chosen = selected === null ? undefined : bars[selected]
  const title = metric === 'tokens' ? 'Tokens' : 'Calls'
  return {
    bars,
    selected,
    select: (index: number | null) => setSelection(index === null ? null : { bars, index }),
    total,
    caption: chosen ? chosen.label : title,
    value: compactCount(chosen ? chosen.value : total),
    accessibilityLabel: chosen ? `${chosen.label}, ${metricLabel(chosen.value, metric)}` : `${title}, ${metricLabel(total, metric)}`,
  }
}

/** One hue, light to dark: the same blue as the bars. */
export function heatLevels(theme: AppTheme): string[] {
  return [theme.fillStrong, `${theme.blue}66`, `${theme.blue}99`, `${theme.blue}CC`, theme.blue]
}

/** The past year and the day tapped in it, with the line that reads it. */
export function useUsageYear(activity: UsageActivity | undefined, metric: UsageMetric) {
  const year = useMemo(() => contributionYear(activity?.contribution ?? [], metric), [activity?.contribution, metric])
  const [picked, setPicked] = useState<ContributionCell | null>(null)
  return {
    year,
    picked,
    pick: (cell: ContributionCell | null) => setPicked(cell && !cell.placeholder && cell.key !== picked?.key ? cell : null),
    summary: `${year.activeDays} active ${year.activeDays === 1 ? 'day' : 'days'} in the last year`,
    detail: picked ? (picked.value > 0 ? `${metricLabel(picked.value, metric)} on ${picked.label}` : `No ${metric} on ${picked.label}`) : 'Tap a day to see its usage.',
  }
}

/** The latest settled calls, a few at first; "Show more" reveals and then loads older ones. */
export function useRecordPaging(records: UsageRecordsModel) {
  const [shown, setShown] = useState(RECORDS_FIRST)
  return {
    visible: records.items.slice(0, shown),
    more: records.items.length > shown || records.hasMore,
    showMore: () => {
      const next = shown + RECORDS_MORE
      setShown(next)
      if (next > records.items.length && records.hasMore && !records.loadingMore) records.loadMore()
    },
    moreLabel: records.loadMoreError ? 'Try Again' : 'Show More',
  }
}

