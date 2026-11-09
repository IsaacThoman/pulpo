import { useMemo, useState, type ReactNode } from 'react'
import { Clock } from 'lucide-react'
import type { Metric, TimeRange } from '@/lib/types'
import { periodDays } from '@/lib/time-range'
import { toDailyModelUsage, type SettledDailyRow } from '@/lib/leaderboard-usage'
import { ToggleGroup } from '@/components/usage/ToggleGroup'
import { StatsRow } from '@/components/usage/StatsRow'
import { DailyUsageChart } from '@/components/usage/DailyUsageChart'
import { PublicTopModelsPanel, type PublicTopModel } from '@/components/usage/PublicUsagePanels'
import { Button } from '@/components/ui/button'
import { ui } from '@/i18n/ui'

const RANGES: { id: TimeRange; label: string }[] = [
  { id: '24h', label: "24h" },
  { id: '7d', label: "7d" },
  { id: '30d', label: "30d" },
  { id: '90d', label: "90d" },
  { id: 'all', label: "All" },
]
const METRICS: { id: Metric; label: string }[] = [
  { id: 'calls', label: "Calls" },
  { id: 'cost', label: "USD" },
  { id: 'tokens', label: "Tokens" },
]

/** One person's settled usage, as `/api/usage/activity` and the profile usage endpoint return it. */
export interface UsageActivity {
  summary: { calls: number; inputTokens: number; outputTokens: number; costMicros: number; inferenceReferenceCostMicros: number; firstUsedAt: string | null }
  daily: SettledDailyRow[]
  contribution: SettledDailyRow[]
  topModels: PublicTopModel[]
  modelNames: Record<string, string>
}

/** One person's usage: metric and range pickers, stats, the daily chart, a records panel, and top models. */
export function UsageOverview({
  range,
  onRangeChange,
  activity,
  activityLoading,
  recordsLoading,
  error,
  errorFallback,
  onRetry,
  records,
}: {
  range: TimeRange
  onRangeChange: (range: TimeRange) => void
  activity: UsageActivity | undefined
  activityLoading: boolean
  recordsLoading: boolean
  error: unknown
  /** Shown when the error has no message of its own. */
  errorFallback: string
  onRetry: () => void
  /** The recent usage panel, shown beside top models. */
  records: ReactNode
}) {
  const [metric, setMetric] = useState<Metric>('calls')
  const totals = {
    calls: activity?.summary.calls ?? 0,
    tokens: (activity?.summary.inputTokens ?? 0) + (activity?.summary.outputTokens ?? 0),
    cost: (activity?.summary.costMicros ?? 0) / 1_000_000,
    inferenceReferenceCost: (activity?.summary.inferenceReferenceCostMicros ?? 0) / 1_000_000,
  }
  const dailyUsage = useMemo(() => toDailyModelUsage(activity?.daily ?? []), [activity?.daily])
  const contributionUsage = useMemo(() => toDailyModelUsage(activity?.contribution ?? []), [activity?.contribution])

  return (
    <>
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-xs font-medium">
              <Clock className="size-3" /> {ui("Usage overview")} </span>
            <div className="h-4 w-px bg-border" />
            <ToggleGroup options={METRICS.map((option) => ({ ...option, label: ui(option.label) }))} value={metric} onChange={setMetric} />
          </div>
          <ToggleGroup options={RANGES.map((option) => ({ ...option, label: ui(option.label) }))} value={range} onChange={onRangeChange} />
        </div>
        {!activityLoading && !error && <StatsRow
          calls={totals.calls}
          tokens={totals.tokens}
          cost={totals.cost}
          inferenceReferenceCost={totals.inferenceReferenceCost}
        />}
      </section>

      {activityLoading || recordsLoading ? (
        <div className="flex h-64 items-center justify-center rounded-lg border text-xs text-muted-foreground">{ui("Loading settled usage…")}</div>
      ) : error ? (
        <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-lg border text-sm text-muted-foreground">
          <span>{error instanceof Error ? error.message : errorFallback}</span>
          <Button size="sm" variant="outline" onClick={onRetry}>{ui("Try again")}</Button>
        </div>
      ) : (
        <>
          <DailyUsageChart
            data={dailyUsage}
            contributionData={contributionUsage}
            metric={metric}
            modelNames={activity?.modelNames}
            periodDayCount={periodDays(range, activity?.summary.firstUsedAt ? Date.parse(activity.summary.firstUsedAt) : null)}
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">{records}</div>
            <PublicTopModelsPanel models={activity?.topModels ?? []} />
          </div>
        </>
      )}
    </>
  )
}
