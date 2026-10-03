import type { InsightsTools } from '@pulpo/contracts'
import { ChartCard, KpiTile, TimeSeriesChart } from '@/features/admin-analytics/components'
import { formatCount, formatMicros, formatPercent } from '@/features/admin-analytics/format'
import type { AnalyticsSearch } from '@/features/admin-analytics/search-params'
import { activeLocale, ui } from '@/i18n/ui'
import { share, useInsights } from './query'
import { DataTable, KpiGrid, SectionError, type Column } from './shared'

type ToolRow = InsightsTools['tools'][number]

export function ToolsSection({ search }: { search: AnalyticsSearch }) {
  const query = useInsights<InsightsTools>('tools', search)
  const data = query.data
  if (query.isError && !data) return <SectionError error={query.error} />
  const loading = query.isPending
  const bucket = data?.window.bucket ?? 'day'
  const rows = data?.series ?? []
  const agentRequests = data?.agentRequests ?? 0
  const perRequest = agentRequests > 0 ? (data?.toolCalls ?? 0) / agentRequests : 0
  const columns: Column<ToolRow>[] = [
    { key: 'tool', header: ui('Tool'), render: (row) => <span className="font-mono">{row.toolName}</span> },
    { key: 'calls', header: ui('Calls'), align: 'right', render: (row) => formatCount(row.calls) },
    { key: 'failures', header: ui('Failure rate'), align: 'right', render: (row) => formatPercent(share(row.failures, row.calls)) },
    { key: 'requests', header: ui('Requests'), align: 'right', render: (row) => formatCount(row.requests) },
    { key: 'cost', header: ui('Cost'), align: 'right', render: (row) => formatMicros(row.costMicros) },
  ]
  return (
    <div className="space-y-3">
      <KpiGrid>
        <KpiTile label={ui('Agent requests')} value={formatCount(agentRequests)} loading={loading} />
        <KpiTile label={ui('Agent share')} value={formatPercent(share(agentRequests, data?.totalRequests ?? 0))} loading={loading} />
        <KpiTile label={ui('Tool calls')} value={formatCount(data?.toolCalls ?? 0)} loading={loading} />
        <KpiTile label={ui('Tool calls per agent request')} value={perRequest.toLocaleString(activeLocale(), { maximumFractionDigits: 1 })} loading={loading} />
      </KpiGrid>
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title={ui('Agent requests')}>
          <TimeSeriesChart data={rows} bucket={bucket} loading={loading} height={180} series={[{ key: 'agentRequests', label: ui('Agent requests'), color: 'var(--viz-1)' }]} />
        </ChartCard>
        <ChartCard title={ui('Tool calls')}>
          <TimeSeriesChart data={rows} bucket={bucket} loading={loading} height={180} series={[{ key: 'toolCalls', label: ui('Tool calls'), color: 'var(--viz-1)' }]} />
        </ChartCard>
      </div>
      <ChartCard title={ui('Tools')}>
        <DataTable rows={data?.tools ?? []} columns={columns} rowKey={(row) => row.toolName} loading={loading} emptyText={ui('No tool calls in this range')} />
      </ChartCard>
    </div>
  )
}
