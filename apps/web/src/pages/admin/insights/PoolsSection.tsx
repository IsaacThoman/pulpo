import type { InsightsPools } from '@pulpo/contracts'
import { ChartCard, KpiTile } from '@/features/admin-analytics/components'
import { formatCount, formatMicros, formatPercent } from '@/features/admin-analytics/format'
import { VIZ_CATEGORICAL } from '@/features/admin-analytics/palette'
import type { AnalyticsSearch } from '@/features/admin-analytics/search-params'
import { ui } from '@/i18n/ui'
import { share, useInsights } from './query'
import { DataTable, KpiGrid, SectionError, ShareBar, type Column } from './shared'

type PoolRow = InsightsPools['pools'][number]

export function PoolsSection({ search }: { search: AnalyticsSearch }) {
  const query = useInsights<InsightsPools>('pools', search)
  const data = query.data
  if (query.isError && !data) return <SectionError error={query.error} />
  const loading = query.isPending
  const funding = data?.funding ?? { subscriptionMicros: 0, sharedAllowanceMicros: 0, creditMicros: 0 }
  const columns: Column<PoolRow>[] = [
    { key: 'owner', header: ui('Owner'), render: (row) => <span className="max-w-48 truncate">{row.ownerName}</span> },
    { key: 'members', header: ui('Members'), align: 'right', render: (row) => formatCount(row.members) },
    { key: 'users', header: ui('Active users'), align: 'right', render: (row) => formatCount(row.users) },
    { key: 'requests', header: ui('Requests'), align: 'right', render: (row) => formatCount(row.requests) },
    { key: 'spend', header: ui('Spend'), align: 'right', render: (row) => formatMicros(row.costMicros) },
  ]
  return (
    <div className="space-y-3">
      <KpiGrid>
        <KpiTile label={ui('Active pools')} value={formatCount(data?.activePools ?? 0)} loading={loading} />
        <KpiTile label={ui('Pooled users')} value={formatCount(data?.pooledUsers ?? 0)} loading={loading} />
        <KpiTile label={ui('Pooled requests')} value={formatCount(data?.pooledRequests ?? 0)} loading={loading} />
        <KpiTile label={ui('Pooled request share')} value={formatPercent(share(data?.pooledRequests ?? 0, data?.totalRequests ?? 0))} loading={loading} />
      </KpiGrid>
      <ChartCard title={ui('Spend by funding source')} description={ui('All usage in the range, regardless of filters.')}>
        <ShareBar loading={loading} segments={[
          { key: 'subscription', label: ui('Subscription allowance'), value: funding.subscriptionMicros, display: formatMicros(funding.subscriptionMicros), color: VIZ_CATEGORICAL[0] },
          { key: 'shared', label: ui('Shared pool allowance'), value: funding.sharedAllowanceMicros, display: formatMicros(funding.sharedAllowanceMicros), color: VIZ_CATEGORICAL[1] },
          { key: 'credit', label: ui('Credits'), value: funding.creditMicros, display: formatMicros(funding.creditMicros), color: VIZ_CATEGORICAL[2] },
        ]} />
      </ChartCard>
      <ChartCard title={ui('Top pools')}>
        <DataTable rows={data?.pools ?? []} columns={columns} rowKey={(row) => row.poolId} loading={loading} emptyText={ui('No pooled usage in this range')} />
      </ChartCard>
    </div>
  )
}
