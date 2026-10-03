import { useMemo } from 'react'
import type { InsightsFeatures, NamedCount } from '@pulpo/contracts'
import { ChartCard, KpiTile, RankedList, TimeSeriesChart, type SeriesSpec } from '@/features/admin-analytics/components'
import { formatCount, formatMicros, formatPercent } from '@/features/admin-analytics/format'
import { VIZ_OTHER, seriesColors } from '@/features/admin-analytics/palette'
import type { AnalyticsSearch } from '@/features/admin-analytics/search-params'
import { ui, uit } from '@/i18n/ui'
import { PLATFORMS, branchReasonLabel, originLabel, planLabel, platformLabel } from './labels'
import { pivotSeries } from './pivot'
import { share, useInsights } from './query'
import { CoverageNote, DataTable, KpiGrid, SectionError, type Column } from './shared'

type PlanRow = InsightsFeatures['plans'][number]

function shareRows(counts: NamedCount[], total: number, label: (id: string, fallback: string) => string = (_id, fallback) => fallback) {
  return counts.map((count) => ({
    key: count.id,
    label: label(count.id, count.label),
    value: count.count,
    display: formatPercent(share(count.count, total)),
    detail: formatCount(count.count),
  }))
}

export function FeaturesSection({ search }: { search: AnalyticsSearch }) {
  const query = useInsights<InsightsFeatures>('features', search)
  const data = query.data
  const bucket = data?.window.bucket ?? 'day'
  const pivot = useMemo(
    () => pivotSeries((data?.platformSeries ?? []).map((point) => ({ bucket: point.bucket, key: point.platform, value: point.requests })), bucket),
    [bucket, data?.platformSeries],
  )
  if (query.isError && !data) return <SectionError error={query.error} />
  const loading = query.isPending
  const total = data?.totalRequests ?? 0
  const captured = data?.featuresCaptured ?? 0
  // Colors come from the full platform list so a platform keeps its color under filters.
  const colors = seriesColors(PLATFORMS)
  const series: SeriesSpec[] = pivot.keys.map((key) => ({ key, label: platformLabel(key), color: colors.get(key) ?? VIZ_OTHER }))
  const planColumns: Column<PlanRow>[] = [
    { key: 'plan', header: ui('Plan'), render: (row) => planLabel(row.plan) },
    { key: 'requests', header: ui('Requests'), align: 'right', render: (row) => formatCount(row.requests) },
    { key: 'share', header: ui('Share'), align: 'right', render: (row) => formatPercent(share(row.requests, total)) },
    { key: 'users', header: ui('Users'), align: 'right', render: (row) => formatCount(row.users) },
    { key: 'spend', header: ui('Spend'), align: 'right', render: (row) => formatMicros(row.costMicros) },
  ]
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ChartCard title={ui('Requests by platform')}>
          <TimeSeriesChart data={pivot.rows} bucket={bucket} series={series} loading={loading} />
        </ChartCard>
        <ChartCard title={ui('Platforms')}>
          <RankedList
            loading={loading}
            rows={(data?.platforms ?? []).map((row) => ({
              key: row.platform,
              label: platformLabel(row.platform),
              value: row.requests,
              display: formatPercent(share(row.requests, total)),
              detail: uit`${formatCount(row.requests)} requests · ${formatCount(row.users)} users`,
            }))}
          />
        </ChartCard>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <ChartCard title={ui('Origins')}>
          <RankedList loading={loading} rows={shareRows(data?.origins ?? [], total, (id) => originLabel(id))} />
        </ChartCard>
        <ChartCard title={ui('Plans')}>
          <DataTable rows={data?.plans ?? []} columns={planColumns} rowKey={(row) => row.plan} loading={loading} />
        </ChartCard>
      </div>
      <CoverageNote captured={captured} total={total} />
      <KpiGrid>
        <KpiTile label={ui('Used dictation')} value={formatPercent(share(data?.dictation ?? 0, captured))} loading={loading} />
        <KpiTile label={ui('With attachments')} value={formatPercent(share(data?.withAttachments ?? 0, captured))} loading={loading} />
        <KpiTile label={ui('Regenerate rate')} value={formatPercent(share(data?.branchReasons.find((reason) => reason.id === 'regenerate')?.count ?? 0, total))} loading={loading} />
        <KpiTile label={ui('Edit rate')} value={formatPercent(share(data?.branchReasons.find((reason) => reason.id === 'user_edit')?.count ?? 0, total))} loading={loading} />
      </KpiGrid>
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title={ui('Attachment kinds')} description={ui('Share of requests with features captured.')}>
          <RankedList loading={loading} emptyText={ui('No attachments in this range')} rows={shareRows(data?.attachmentKinds ?? [], captured)} />
        </ChartCard>
        <ChartCard title={ui('Branch reasons')} description={ui('Share of all requests.')}>
          <RankedList loading={loading} rows={shareRows(data?.branchReasons ?? [], total, (id) => branchReasonLabel(id))} />
        </ChartCard>
      </div>
    </div>
  )
}
