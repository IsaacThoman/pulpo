import type { AdminRequestsOverview } from '@pulpo/contracts'
import { ChartCard, EmptyState, RankedList } from '@/features/admin-analytics/components'
import { formatCount, formatTimestamp } from '@/features/admin-analytics/format'
import { VIZ_STATUS } from '@/features/admin-analytics/palette'
import { Skeleton } from '@/components/ui/skeleton'
import { ui } from '@/i18n/ui'
import { categoryLabel, modelName } from './filters'

type Errors = AdminRequestsOverview['errors']

function TopMessages({ messages, loading }: { messages: Errors['topMessages']; loading: boolean }) {
  if (loading) return <div className="space-y-2">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-8 w-full" />)}</div>
  if (!messages.length) return <EmptyState>{ui('No errors in this range')}</EmptyState>
  return (
    <ul className="divide-y text-xs">
      {messages.map((item) => (
        <li key={`${item.category ?? ''}:${item.message}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-1.5">
          <div className="min-w-0">
            <div className="truncate font-mono" title={item.message}>{item.message}</div>
            <div className="text-muted-foreground">
              {categoryLabel(item.category)} · {ui('last seen {{time}}', { time: formatTimestamp(item.lastSeenAt) })}
            </div>
          </div>
          <span className="tabular-nums text-muted-foreground">{formatCount(item.count)}</span>
        </li>
      ))}
    </ul>
  )
}

export function ErrorsPanel({ overview, loading, onCategory, onModel }: {
  overview: AdminRequestsOverview | undefined
  loading: boolean
  onCategory: (category: string) => void
  onModel: (modelId: string) => void
}) {
  const errors = overview?.errors
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <ChartCard title={ui('Errors by type')}>
        <RankedList
          loading={loading}
          color={VIZ_STATUS.failed}
          emptyText={ui('No errors in this range')}
          rows={(errors?.byCategory ?? []).map((item) => ({
            key: item.id,
            label: <button type="button" className="hover:underline" onClick={() => onCategory(item.id)}>{categoryLabel(item.label || item.id)}</button>,
            value: item.count,
            display: formatCount(item.count),
          }))}
        />
      </ChartCard>
      <ChartCard title={ui('Errors by model')}>
        <RankedList
          loading={loading}
          color={VIZ_STATUS.failed}
          emptyText={ui('No errors in this range')}
          rows={(errors?.byModel ?? []).map((item) => ({
            key: item.id,
            label: <button type="button" className="hover:underline" onClick={() => onModel(item.id)}>{item.label || modelName(overview?.modelNames, item.id)}</button>,
            value: item.count,
            display: formatCount(item.count),
          }))}
        />
      </ChartCard>
      <ChartCard title={ui('Top error messages')}>
        <TopMessages messages={errors?.topMessages ?? []} loading={loading} />
      </ChartCard>
    </div>
  )
}
