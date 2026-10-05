import type { AdminRequestsOverview } from '@pulpo/contracts'
import { ArrowRight } from 'lucide-react'
import { ChartCard, EmptyState, RankedList } from '@/features/admin-analytics/components'
import { formatCount, formatMs, formatPercent } from '@/features/admin-analytics/format'
import { Skeleton } from '@/components/ui/skeleton'
import { ui } from '@/i18n/ui'
import { modelName } from './filters'

function share(part: number, total: number): string {
  return total > 0 ? formatPercent(part / total) : '—'
}

function ReliabilityTable({ rows, onModel }: { rows: AdminRequestsOverview['reliability']; onModel: (modelId: string) => void }) {
  if (!rows.length) return <EmptyState />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-b text-left">
            <th className="py-1.5 pr-3 font-normal">{ui('Model')}</th>
            <th className="py-1.5 pr-3 text-right font-normal">{ui('Requests')}</th>
            <th className="py-1.5 pr-3 text-right font-normal">{ui('Failed')}</th>
            <th className="py-1.5 pr-3 text-right font-normal">{ui('Retried')}</th>
            <th className="py-1.5 pr-3 text-right font-normal">{ui('Fell back')}</th>
            <th className="py-1.5 text-right font-normal">{ui('TTFT p50')}</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((row) => (
            <tr key={row.modelId} className="border-b last:border-0">
              <td className="max-w-56 truncate py-1.5 pr-3">
                <button type="button" className="hover:underline" onClick={() => onModel(row.modelId)}>{row.modelName}</button>
              </td>
              <td className="py-1.5 pr-3 text-right">{formatCount(row.requests)}</td>
              <td className="py-1.5 pr-3 text-right">{share(row.failures, row.requests)}</td>
              <td className="py-1.5 pr-3 text-right">{share(row.retried, row.requests)}</td>
              <td className="py-1.5 pr-3 text-right">{share(row.fallbacks, row.requests)}</td>
              <td className="py-1.5 text-right">{formatMs(row.ttftP50Ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ReliabilityPanel({ overview, loading, onModel }: {
  overview: AdminRequestsOverview | undefined
  loading: boolean
  onModel: (modelId: string) => void
}) {
  const names = overview?.modelNames
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <ChartCard title={ui('Reliability by model')} description={ui('Share of each model’s requests')} className="lg:col-span-2">
        {loading
          ? <div className="space-y-2">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-5 w-full" />)}</div>
          : <ReliabilityTable rows={overview?.reliability ?? []} onModel={onModel} />}
      </ChartCard>
      <ChartCard title={ui('Fallback paths')} description={ui('Requested model to the model that answered')}>
        <RankedList
          loading={loading}
          emptyText={ui('No fallbacks in this range')}
          rows={(overview?.fallbackPaths ?? []).map((path) => ({
            key: `${path.fromModelId}>${path.toModelId}`,
            label: (
              <span className="inline-flex items-center gap-1">
                {modelName(names, path.fromModelId)}
                <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                {modelName(names, path.toModelId)}
              </span>
            ),
            value: path.count,
            display: formatCount(path.count),
          }))}
        />
      </ChartCard>
    </div>
  )
}
