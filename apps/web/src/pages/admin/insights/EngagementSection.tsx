import type { InsightsEngagement } from '@pulpo/contracts'
import { ChartCard, KpiTile, RankedList, TimeSeriesChart } from '@/features/admin-analytics/components'
import { formatCount, formatMicros, formatPercent } from '@/features/admin-analytics/format'
import { VIZ_CATEGORICAL } from '@/features/admin-analytics/palette'
import type { AnalyticsSearch } from '@/features/admin-analytics/search-params'
import { ui, uit } from '@/i18n/ui'
import { CohortTable } from './CohortTable'
import { share, useInsights } from './query'
import { DataTable, KpiGrid, SectionError, ShareBar, type Column } from './shared'

type TopUser = InsightsEngagement['topUsers'][number]

export function EngagementSection({ search }: { search: AnalyticsSearch }) {
  const query = useInsights<InsightsEngagement>('engagement', search)
  const data = query.data
  if (query.isError && !data) return <SectionError error={query.error} />
  const loading = query.isPending
  const concentration = data?.concentration ?? { top1PctShare: 0, top10PctShare: 0, top10UsersShare: 0 }
  const columns: Column<TopUser>[] = [
    { key: 'name', header: ui('User'), render: (row) => <span className="max-w-48 truncate">{row.name}</span> },
    { key: 'requests', header: ui('Requests'), align: 'right', render: (row) => formatCount(row.requests) },
    { key: 'spend', header: ui('Spend'), align: 'right', render: (row) => formatMicros(row.costMicros) },
    { key: 'days', header: ui('Active days'), align: 'right', render: (row) => formatCount(row.activeDays) },
  ]
  return (
    <div className="space-y-3">
      <KpiGrid>
        <KpiTile label={ui('Daily active users')} value={formatCount(data?.dau ?? 0)} hint={ui('Users active in the 24 hours before the end of the range')} loading={loading} />
        <KpiTile label={ui('Weekly active users')} value={formatCount(data?.wau ?? 0)} hint={ui('Users active in the 7 days before the end of the range')} loading={loading} />
        <KpiTile label={ui('Monthly active users')} value={formatCount(data?.mau ?? 0)} hint={ui('Users active in the 30 days before the end of the range')} loading={loading} />
        <KpiTile label={ui('Stickiness (DAU/MAU)')} value={formatPercent(share(data?.dau ?? 0, data?.mau ?? 0))} loading={loading} />
      </KpiGrid>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ChartCard title={ui('Active users')}>
          <TimeSeriesChart
            kind="line"
            data={data?.activeSeries ?? []}
            bucket={data?.window.bucket ?? 'day'}
            loading={loading}
            series={[
              { key: 'users', label: ui('Active users'), color: VIZ_CATEGORICAL[0] },
              { key: 'newUsers', label: ui('New users'), color: VIZ_CATEGORICAL[1] },
            ]}
          />
        </ChartCard>
        <ChartCard title={ui('New vs returning')} description={uit`${formatCount(data?.activeUsers ?? 0)} active users in this range`}>
          <ShareBar loading={loading} segments={[
            { key: 'new', label: ui('New users'), value: data?.newUsers ?? 0, display: formatCount(data?.newUsers ?? 0), color: VIZ_CATEGORICAL[1] },
            { key: 'returning', label: ui('Returning users'), value: data?.returningUsers ?? 0, display: formatCount(data?.returningUsers ?? 0), color: VIZ_CATEGORICAL[0] },
          ]} />
        </ChartCard>
      </div>
      <ChartCard title={ui('Weekly retention')} description={ui('Share of each signup-week cohort active in later weeks.')}>
        <CohortTable cohorts={data?.cohorts ?? []} loading={loading} />
      </ChartCard>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <ChartCard title={ui('Spend concentration')} description={ui('Share of spend from the heaviest users.')}>
          <RankedList
            loading={loading}
            max={1}
            rows={[
              { key: 'top1', label: ui('Top 1% of users'), value: concentration.top1PctShare, display: formatPercent(concentration.top1PctShare) },
              { key: 'top10pct', label: ui('Top 10% of users'), value: concentration.top10PctShare, display: formatPercent(concentration.top10PctShare) },
              { key: 'top10', label: ui('Top 10 users'), value: concentration.top10UsersShare, display: formatPercent(concentration.top10UsersShare) },
            ]}
          />
        </ChartCard>
        <ChartCard title={ui('Top users')}>
          <DataTable rows={data?.topUsers ?? []} columns={columns} rowKey={(row) => row.userId} loading={loading} />
        </ChartCard>
      </div>
    </div>
  )
}
