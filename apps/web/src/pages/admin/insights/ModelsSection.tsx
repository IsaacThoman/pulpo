import { useMemo } from 'react'
import type { InsightsModels } from '@pulpo/contracts'
import { ChartCard, RankedList, TimeSeriesChart, type SeriesSpec } from '@/features/admin-analytics/components'
import { formatCount, formatMicros, formatMs, formatPercent, relativeChange } from '@/features/admin-analytics/format'
import { OTHER_SERIES_KEY, seriesColors } from '@/features/admin-analytics/palette'
import type { AnalyticsSearch } from '@/features/admin-analytics/search-params'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { pivotSeries } from './pivot'
import { useInsights } from './query'
import { DataTable, SectionError, type Column } from './shared'

type ModelRow = InsightsModels['models'][number]

function ChangeCell({ current, previous }: { current: number; previous: number | null }) {
  const change = relativeChange(current, previous)
  if (change === null) return <span className="text-muted-foreground">—</span>
  const sign = change > 0 ? '+' : change < 0 ? '−' : ''
  return <span className={cn(change === 0 && 'text-muted-foreground')}>{sign}{formatPercent(Math.abs(change))}</span>
}

export function ModelsSection({ search }: { search: AnalyticsSearch }) {
  const query = useInsights<InsightsModels>('models', search)
  const data = query.data
  const bucket = data?.window.bucket ?? 'day'
  const pivot = useMemo(
    () => pivotSeries((data?.series ?? []).map((point) => ({ bucket: point.bucket, key: point.modelId, value: point.requests })), bucket),
    [bucket, data?.series],
  )
  if (query.isError && !data) return <SectionError error={query.error} />
  const loading = query.isPending
  const names = data?.modelNames ?? {}
  const modelName = (id: string) => id === OTHER_SERIES_KEY ? ui('Other') : names[id] ?? id
  const colors = seriesColors(pivot.keys)
  const series: SeriesSpec[] = pivot.keys.map((key) => ({ key, label: modelName(key), color: colors.get(key) ?? 'var(--viz-other)' }))
  const columns: Column<ModelRow>[] = [
    {
      key: 'model',
      header: ui('Model'),
      render: (row) => (
        <span className="flex items-center gap-2">
          <span className="inline-block size-2 shrink-0 rounded-sm" style={{ background: colors.get(row.modelId) ?? 'var(--viz-other)' }} aria-hidden />
          <span className="max-w-56 truncate">{row.modelName}</span>
        </span>
      ),
    },
    { key: 'requests', header: ui('Requests'), align: 'right', render: (row) => formatCount(row.requests) },
    { key: 'change', header: ui('vs previous'), align: 'right', render: (row) => <ChangeCell current={row.requests} previous={row.previousRequests} /> },
    { key: 'users', header: ui('Users'), align: 'right', render: (row) => formatCount(row.users) },
    { key: 'spend', header: ui('Spend'), align: 'right', render: (row) => formatMicros(row.costMicros) },
    { key: 'avg', header: ui('Avg cost'), align: 'right', render: (row) => formatMicros(row.avgCostMicros) },
    { key: 'success', header: ui('Success'), align: 'right', render: (row) => formatPercent(row.successRate) },
    { key: 'ttft', header: ui('p50 TTFT'), align: 'right', render: (row) => formatMs(row.ttftP50Ms) },
    { key: 'duration', header: ui('p50 duration'), align: 'right', render: (row) => formatMs(row.durationP50Ms) },
  ]
  return (
    <div className="space-y-3">
      <ChartCard title={ui('Requests by model')} description={ui('Top 8 models; the rest are grouped as Other.')}>
        <TimeSeriesChart data={pivot.rows} bucket={bucket} series={series} loading={loading} height={240} />
      </ChartCard>
      <ChartCard title={ui('Models')}>
        <DataTable rows={data?.models ?? []} columns={columns} rowKey={(row) => row.modelId} loading={loading} />
      </ChartCard>
      <ChartCard title={ui('Requested → answered')} description={ui('Requests answered by a different model than the one asked for.')}>
        <RankedList
          loading={loading}
          emptyText={ui('No redirected requests')}
          rows={(data?.redirects ?? []).map((redirect) => ({
            key: `${redirect.requestedModelId}>${redirect.answeredModelId}`,
            label: `${modelName(redirect.requestedModelId)} → ${modelName(redirect.answeredModelId)}`,
            value: redirect.count,
            display: formatCount(redirect.count),
          }))}
        />
      </ChartCard>
    </div>
  )
}
