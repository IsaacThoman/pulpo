import { BarChart3, MoreHorizontal, Zap } from 'lucide-react'
import { getCatalogModel } from '@/stores/catalog'
import { ModelIcon } from '@/components/ModelIcon'
import { Button } from '@/components/ui/button'
import { formatDuration, formatUsd } from '@/lib/format'

export interface PublicUsageRecord {
  id: string
  createdAt: string
  participant: { name: string; anonymous: boolean }
  model: { id: string; name: string; logo: string | null }
  inputTokens: number
  outputTokens: number
  costMicros: number
  latencyMs: number
}

export interface PublicTopModel {
  modelId: string
  calls: number
  costMicros: number
}

function UsageModelIcon({ modelId }: { modelId: string }) {
  if (modelId === 'other') {
    return <span className="grid size-4 shrink-0 place-items-center rounded-[2px] bg-muted"><MoreHorizontal className="size-3" /></span>
  }
  return <ModelIcon model={getCatalogModel(modelId)} className="size-4 shrink-0 rounded-[2px]" />
}

export function PublicRecentUsagePanel({
  records,
  nextCursor,
  loadingMore,
  error,
  onLoadMore,
}: {
  records: PublicUsageRecord[]
  nextCursor: string | null
  loadingMore: boolean
  error?: string | null
  onLoadMore: () => void
}) {
  return <div className="rounded-lg border">
    <div className="flex items-center justify-between border-b px-3 py-2">
      <div className="flex items-center gap-2"><Zap className="size-3" /><h3 className="text-xs font-medium">Recent usage</h3></div>
      <span className="text-xs text-muted-foreground">{records.length.toLocaleString()} settled calls</span>
    </div>
    {records.length === 0 ? <div className="p-6 text-center text-xs text-muted-foreground">No settled usage in this period</div> : <>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-background"><tr className="border-b text-left text-muted-foreground">
            <th className="bg-background px-3 py-2 font-normal">Time</th><th className="bg-background px-3 py-2 font-normal">User</th><th className="bg-background px-3 py-2 font-normal">Model</th><th className="bg-background px-3 py-2 text-right font-normal">Tokens</th><th className="bg-background px-3 py-2 text-right font-normal">Latency</th><th className="bg-background px-3 py-2 text-right font-normal">Cost</th>
          </tr></thead>
          <tbody className="divide-y">{records.map((record) => <tr key={record.id}>
            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{new Date(record.createdAt).toLocaleString()}</td>
            <td className="px-3 py-2"><span className="block max-w-28 truncate">{record.participant.name}</span></td>
            <td className="px-3 py-2"><span className="flex max-w-40 items-center gap-1.5"><UsageModelIcon modelId={record.model.id} /><span className="truncate">{record.model.name}</span></span></td>
            <td className="px-3 py-2 text-right tabular-nums">{(record.inputTokens + record.outputTokens).toLocaleString()}</td>
            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatDuration(record.latencyMs)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatUsd(record.costMicros / 1_000_000)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {(nextCursor || error) && <div className="flex items-center justify-center gap-3 border-t p-2">
        {error && <span className="text-xs text-destructive">{error}</span>}
        {nextCursor && <Button size="sm" variant="ghost" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? 'Loading…' : error ? 'Retry' : 'Load more'}</Button>}
      </div>}
    </>}
  </div>
}

export function PublicTopModelsPanel({ models }: { models: PublicTopModel[] }) {
  return <div className="rounded-lg border">
    <div className="flex items-center gap-2 border-b px-3 py-2"><BarChart3 className="size-3" /><h3 className="text-xs font-medium">Top models</h3></div>
    {models.length === 0 ? <div className="p-6 text-center text-xs text-muted-foreground">No settled usage in this period</div> : <div className="max-h-96 divide-y overflow-y-auto">
      {models.map((model, index) => {
        const name = model.modelId === 'other' ? 'Other' : getCatalogModel(model.modelId).name
        return <div key={model.modelId} className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2"><span className="flex w-4 shrink-0 justify-center text-xs text-muted-foreground">{index + 1}</span><UsageModelIcon modelId={model.modelId} /><div className="min-w-0 flex-1"><p className="truncate text-xs">{name}</p><p className="text-xs text-muted-foreground">{model.calls.toLocaleString()} calls</p></div></div>
          <span className="shrink-0 text-xs tabular-nums">{formatUsd(model.costMicros / 1_000_000)}</span>
        </div>
      })}
    </div>}
  </div>
}
