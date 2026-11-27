import { useState } from 'react'
import type { AdminSearchOverview, SearchKpis, SearchProviderLatency } from '@pulpo/contracts'
import { ToggleGroup } from '@/components/usage/ToggleGroup'
import { ChartCard, KpiTile, RankedList, TimeSeriesChart, type SeriesSpec } from '@/features/admin-analytics/components'
import { formatCount, formatMs, formatPercent, relativeChange } from '@/features/admin-analytics/format'
import { VIZ_OTHER } from '@/features/admin-analytics/palette'
import { ui } from '@/i18n/ui'
import { DataTable, ShareBar, type Column } from '../insights/shared'
import { PHASE_KEYS, categoryLabel, outcomeColor, outcomeLabel, phaseColor, phaseLabel, providerColor, providerLabel } from './labels'

function share(part: number, total: number): string {
  return total > 0 ? formatPercent(part / total) : '—'
}

export function SearchKpiRow({ current, previous, loading }: { current: SearchKpis | undefined; previous: SearchKpis | null | undefined; loading: boolean }) {
  const show = Boolean(current) && !loading
  const has = previous !== null && previous !== undefined
  const delta = (pick: (kpis: SearchKpis) => number | null) => {
    if (!current || !has) return undefined
    const value = pick(current)
    return value === null ? null : relativeChange(value, pick(previous))
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8 [&>*]:min-w-0">
      <KpiTile loading={!show} label={ui('Searches')} value={current ? formatCount(current.searches) : '—'} change={delta((k) => k.searches)} goodWhen="neutral" />
      <KpiTile loading={!show} label={ui('p50')} value={formatMs(current?.p50Ms)} change={delta((k) => k.p50Ms)} goodWhen="down" hint={ui('Median server time for searches that reached a provider')} />
      <KpiTile loading={!show} label={ui('p90')} value={formatMs(current?.p90Ms)} change={delta((k) => k.p90Ms)} goodWhen="down" />
      <KpiTile loading={!show} label={ui('p95')} value={formatMs(current?.p95Ms)} change={delta((k) => k.p95Ms)} goodWhen="down" />
      <KpiTile loading={!show} label={ui('Failure rate')} value={current ? formatPercent(current.failureRate) : '—'} change={delta((k) => k.failureRate)} goodWhen="down" hint={ui('Searches where every provider failed')} />
      <KpiTile loading={!show} label={ui('No results')} value={current ? formatPercent(current.emptyRate) : '—'} change={delta((k) => k.emptyRate)} goodWhen="down" />
      <KpiTile loading={!show} label={ui('Fallback rate')} value={current ? formatPercent(current.fallbackRate) : '—'} change={delta((k) => k.fallbackRate)} goodWhen="down" hint={ui('Searches that moved past their first provider')} />
      <KpiTile loading={!show} label={ui('Timeout rate')} value={current ? formatPercent(current.timeoutRate) : '—'} change={delta((k) => k.timeoutRate)} goodWhen="down" hint={ui('Provider attempts cut off by the time limit')} />
    </div>
  )
}

type Percentile = 'p50' | 'p90'
type ChartRow = Record<string, number | string | null>

/** Overall and per-provider latency on the gap-filled buckets of the overall series. */
function latencyRows(data: AdminSearchOverview | undefined, percentile: Percentile): { rows: ChartRow[]; providers: string[] } {
  const field = percentile === 'p50' ? 'p50Ms' : 'p90Ms'
  const byBucket = new Map<string, ChartRow>((data?.series ?? []).map((point) => [point.bucket, { bucket: point.bucket, all: point[field] }]))
  const providers = new Set<string>()
  for (const point of data?.providerSeries ?? []) {
    providers.add(point.provider)
    const row = byBucket.get(point.bucket) ?? { bucket: point.bucket, all: null }
    row[point.provider] = point[field]
    byBucket.set(point.bucket, row)
  }
  return { rows: [...byBucket.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))), providers: [...providers].sort() }
}

export function SearchLatencyChart({ data, loading }: { data: AdminSearchOverview | undefined; loading: boolean }) {
  const [percentile, setPercentile] = useState<Percentile>('p50')
  const { rows, providers } = latencyRows(data, percentile)
  const series: SeriesSpec[] = [
    { key: 'all', label: ui('Whole search'), color: VIZ_OTHER },
    ...providers.map((provider) => ({ key: provider, label: providerLabel(provider), color: providerColor(provider) })),
  ]
  return (
    <ChartCard
      title={ui('Latency over time')}
      description={ui('Whole search on the server, and each provider call')}
      className="lg:col-span-2"
      actions={<ToggleGroup value={percentile} onChange={setPercentile} options={[{ id: 'p50', label: ui('p50') }, { id: 'p90', label: ui('p90') }]} />}
    >
      <TimeSeriesChart data={rows} bucket={data?.window.bucket ?? 'hour'} series={series} kind="line" format={formatMs} loading={loading} />
    </ChartCard>
  )
}

export function PhaseBreakdown({ data, loading }: { data: AdminSearchOverview | undefined; loading: boolean }) {
  const phases = data?.phases
  const segments = PHASE_KEYS.map((key) => ({
    key, label: phaseLabel(key), value: phases?.[key] ?? 0, display: formatMs(phases?.[key] ?? 0), color: phaseColor(key),
  }))
  const overhead = phases ? phases.totalMs - phases.providerMs : 0
  return (
    <ChartCard
      title={ui('Where the time goes')}
      description={phases && phases.totalMs > 0
        ? ui('Average {{total}} per search; {{overhead}} outside provider calls', { total: formatMs(phases.totalMs), overhead: formatMs(overhead) })
        : ui('Average time per search, by phase')}
    >
      <ShareBar segments={segments} loading={loading} />
    </ChartCard>
  )
}

export function OutcomeList({ data, loading }: { data: AdminSearchOverview | undefined; loading: boolean }) {
  const total = (data?.outcomes ?? []).reduce((sum, outcome) => sum + outcome.count, 0)
  return (
    <ChartCard title={ui('Outcomes')} description={ui('How searches ended')}>
      <RankedList
        loading={loading}
        rows={(data?.outcomes ?? []).map((outcome) => ({
          key: outcome.id,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full" style={{ background: outcomeColor(outcome.id) }} aria-hidden />
              {outcomeLabel(outcome.id)}
            </span>
          ),
          value: outcome.count,
          display: `${formatCount(outcome.count)} · ${share(outcome.count, total)}`,
        }))}
      />
    </ChartCard>
  )
}

export function ProviderLatencyTable({ data, loading }: { data: AdminSearchOverview | undefined; loading: boolean }) {
  const columns: Column<SearchProviderLatency>[] = [
    {
      key: 'provider', header: ui('Provider'), render: (row) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: providerColor(row.provider) }} aria-hidden />
          {providerLabel(row.provider)}
        </span>
      ),
    },
    { key: 'category', header: ui('Type'), render: (row) => categoryLabel(row.category) },
    { key: 'attempts', header: ui('Calls'), align: 'right', render: (row) => formatCount(row.attempts) },
    { key: 'p50', header: ui('p50'), align: 'right', render: (row) => formatMs(row.p50Ms) },
    { key: 'p90', header: ui('p90'), align: 'right', render: (row) => formatMs(row.p90Ms) },
    { key: 'p95', header: ui('p95'), align: 'right', render: (row) => formatMs(row.p95Ms) },
    { key: 'empty', header: ui('No results'), align: 'right', render: (row) => share(row.empty, row.attempts) },
    { key: 'errors', header: ui('Errors'), align: 'right', render: (row) => share(row.errors, row.attempts) },
    { key: 'timeouts', header: ui('Timeouts'), align: 'right', render: (row) => share(row.timeouts, row.attempts) },
  ]
  return (
    <ChartCard title={ui('Provider latency')} description={ui('Each provider call, by search type. Includes calls that failed or fell back.')}>
      <DataTable rows={data?.providers ?? []} columns={columns} rowKey={(row) => `${row.provider}:${row.category}`} loading={loading} emptyText={ui('No provider calls in this range')} />
    </ChartCard>
  )
}
