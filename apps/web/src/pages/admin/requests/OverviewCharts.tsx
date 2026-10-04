import { useState } from 'react'
import type { AdminRequestsOverview } from '@pulpo/contracts'
import { ToggleGroup } from '@/components/usage/ToggleGroup'
import { ChartCard, TimeSeriesChart, type SeriesSpec } from '@/features/admin-analytics/components'
import { formatMicros, formatMs } from '@/features/admin-analytics/format'
import { VIZ_CATEGORICAL, VIZ_STATUS } from '@/features/admin-analytics/palette'
import { ui } from '@/i18n/ui'

type ChartRow = Record<string, number | string | null>

function chartRows(overview: AdminRequestsOverview | undefined): ChartRow[] {
  return (overview?.series ?? []).map((point) => ({ ...point }))
}

export function RequestsOverTimeChart({ overview, loading }: { overview: AdminRequestsOverview | undefined; loading: boolean }) {
  const series: SeriesSpec[] = [
    { key: 'completed', label: ui('Completed'), color: VIZ_STATUS.completed },
    { key: 'failed', label: ui('Failed'), color: VIZ_STATUS.failed },
    { key: 'incomplete', label: ui('Incomplete'), color: VIZ_STATUS.incomplete },
    { key: 'cancelled', label: ui('Cancelled'), color: VIZ_STATUS.cancelled },
    { key: 'inFlight', label: ui('In flight'), color: VIZ_STATUS.inFlight },
  ]
  return (
    <ChartCard title={ui('Requests over time')} description={ui('By final status')}>
      <TimeSeriesChart data={chartRows(overview)} bucket={overview?.window.bucket ?? 'hour'} series={series} loading={loading} />
    </ChartCard>
  )
}

type LatencyMetric = 'ttft' | 'duration'

export function LatencyChart({ overview, loading }: { overview: AdminRequestsOverview | undefined; loading: boolean }) {
  const [metric, setMetric] = useState<LatencyMetric>('ttft')
  const series: SeriesSpec[] = metric === 'ttft'
    ? [
      { key: 'ttftP50Ms', label: ui('p50'), color: VIZ_CATEGORICAL[0] },
      { key: 'ttftP95Ms', label: ui('p95'), color: VIZ_CATEGORICAL[1] },
    ]
    : [
      { key: 'durationP50Ms', label: ui('p50'), color: VIZ_CATEGORICAL[0] },
      { key: 'durationP95Ms', label: ui('p95'), color: VIZ_CATEGORICAL[1] },
    ]
  return (
    <ChartCard
      title={ui('Latency over time')}
      description={metric === 'ttft' ? ui('Time to first token') : ui('Total request duration')}
      actions={(
        <ToggleGroup
          value={metric}
          onChange={setMetric}
          options={[{ id: 'ttft', label: ui('TTFT') }, { id: 'duration', label: ui('Duration') }]}
        />
      )}
    >
      <TimeSeriesChart data={chartRows(overview)} bucket={overview?.window.bucket ?? 'hour'} series={series} kind="line" format={formatMs} loading={loading} />
    </ChartCard>
  )
}

export function SpendOverTimeChart({ overview, loading }: { overview: AdminRequestsOverview | undefined; loading: boolean }) {
  const series: SeriesSpec[] = [{ key: 'costMicros', label: ui('Spend'), color: VIZ_CATEGORICAL[0] }]
  return (
    <ChartCard title={ui('Spend over time')}>
      <TimeSeriesChart data={chartRows(overview)} bucket={overview?.window.bucket ?? 'hour'} series={series} format={formatMicros} loading={loading} height={160} />
    </ChartCard>
  )
}
