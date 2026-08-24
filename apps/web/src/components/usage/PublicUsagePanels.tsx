import { useEffect, useRef, type UIEvent } from 'react'
import { BarChart3, MoreHorizontal, Zap } from 'lucide-react'
import { getCatalogModel } from '@/stores/catalog'
import { ModelIcon } from '@/components/ModelIcon'
import { formatUsd } from '@/lib/format'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { SubscriptionCoverageCost } from './SubscriptionCoverageCost'

export interface PublicUsageRecord {
  id: string
  createdAt: string
  participant: { id: string; displayName: string; username: string; avatarUrl: string | null; profileColor: string | null }
  model: { id: string; name: string; logo: string | null }
  inputTokens: number
  outputTokens: number
  costMicros: number
  subscriptionCoveredMicros: number
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const onLoadMoreRef = useRef(onLoadMore)
  useEffect(() => { onLoadMoreRef.current = onLoadMore }, [onLoadMore])

  const maybeLoadMore = (el: HTMLDivElement) => {
    if (!nextCursor || loadingMore) return
    const { clientHeight, scrollHeight, scrollTop } = el
    if (scrollHeight - scrollTop - clientHeight < 160) onLoadMoreRef.current()
  }

  const onScroll = (e: UIEvent<HTMLDivElement>) => maybeLoadMore(e.currentTarget)

  // if content doesn't fill the scroll area, keep loading until it does or we run out
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !nextCursor || loadingMore || error) return
    if (el.scrollHeight <= el.clientHeight + 160) onLoadMoreRef.current()
  }, [records, nextCursor, loadingMore, error])

  return <div className="rounded-lg border">
    <div className="flex items-center justify-between border-b px-3 py-2">
      <div className="flex items-center gap-2"><Zap className="size-3" /><h3 className="text-xs font-medium">Recent usage</h3></div>
      <span className="text-xs text-muted-foreground">{records.length.toLocaleString()} settled calls</span>
    </div>
    {records.length === 0 ? <div className="p-6 text-center text-xs text-muted-foreground">No settled usage in this period</div> : <>
      <div className="usage-records-head border-b">
        <table className="data-table table-fixed">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[18%]" />
            <col />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2 font-normal">Time</th>
              <th className="px-3 py-2 font-normal">User</th>
              <th className="px-3 py-2 font-normal">Model</th>
              <th className="px-3 py-2 text-right font-normal">Tokens</th>
              <th className="px-3 py-2 text-right font-normal">Cost</th>
            </tr>
          </thead>
        </table>
      </div>
      <div ref={scrollRef} className="max-h-96 overflow-y-scroll" onScroll={onScroll}>
        <table className="data-table table-fixed">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[18%]" />
            <col />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
          </colgroup>
          <tbody className="divide-y">{records.map((record) => <tr key={record.id}>
            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{new Date(record.createdAt).toLocaleString()}</td>
            <td className="px-3 py-2"><span className="flex min-w-0 items-center gap-1.5"><ProfileAvatar name={record.participant.displayName} avatarUrl={record.participant.avatarUrl} className="size-5" fallbackClassName="text-[8px]" /><span className="truncate">{record.participant.displayName}</span></span></td>
            <td className="px-3 py-2"><span className="flex min-w-0 items-center gap-1.5"><UsageModelIcon modelId={record.model.id} /><span className="truncate">{record.model.name}</span></span></td>
            <td className="px-3 py-2 text-right tabular-nums">{(record.inputTokens + record.outputTokens).toLocaleString()}</td>
            <td className="px-3 py-2 text-right tabular-nums">
              <SubscriptionCoverageCost
                costUsd={record.costMicros / 1_000_000}
                subscriptionCoveredUsd={record.subscriptionCoveredMicros / 1_000_000}
              />
            </td>
          </tr>)}</tbody>
        </table>
        {(loadingMore || error) && <div className="border-t p-2 text-center text-xs text-muted-foreground">
          {error ? <button type="button" className="text-destructive hover:underline" onClick={() => onLoadMore()}>{error} — Retry</button> : 'Loading…'}
        </div>}
      </div>
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
