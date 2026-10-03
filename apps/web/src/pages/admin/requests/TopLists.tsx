import type { AdminRequestsOverview, NamedCount } from '@pulpo/contracts'
import { ChartCard, RankedList } from '@/features/admin-analytics/components'
import { formatCount, formatMicros } from '@/features/admin-analytics/format'
import { ui } from '@/i18n/ui'

function rankedRows(items: NamedCount[], onSelect: (id: string) => void, active: string | null) {
  return items.map((item) => ({
    key: item.id,
    label: (
      <button
        type="button"
        className={item.id === active ? 'font-medium underline' : 'hover:underline'}
        onClick={() => onSelect(item.id)}
        aria-pressed={item.id === active}
      >
        {item.label}
      </button>
    ),
    value: item.count,
    display: formatCount(item.count),
    detail: item.costMicros !== undefined ? formatMicros(item.costMicros) : undefined,
  }))
}

export function TopLists({ overview, loading, filters, onFilter }: {
  overview: AdminRequestsOverview | undefined
  loading: boolean
  filters: { model: string | null; userId: string | null; apiKeyId: string | null }
  onFilter: (key: 'model' | 'userId' | 'apiKeyId', id: string) => void
}) {
  const hint = ui('Click a row to filter')
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <ChartCard title={ui('Top models')} description={hint}>
        <RankedList loading={loading} rows={rankedRows(overview?.topModels ?? [], (id) => onFilter('model', id), filters.model)} />
      </ChartCard>
      <ChartCard title={ui('Top users')} description={hint}>
        <RankedList loading={loading} rows={rankedRows(overview?.topUsers ?? [], (id) => onFilter('userId', id), filters.userId)} />
      </ChartCard>
      <ChartCard title={ui('Top API keys')} description={overview?.topApiKeys.length ? hint : ui('Requests made with API keys appear here')}>
        <RankedList loading={loading} emptyText={ui('No API key requests in this range')} rows={rankedRows(overview?.topApiKeys ?? [], (id) => onFilter('apiKeyId', id), filters.apiKeyId)} />
      </ChartCard>
    </div>
  )
}
