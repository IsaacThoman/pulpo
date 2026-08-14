import { useEffect, useRef, type UIEvent } from 'react'
import { BarChart3, Zap } from 'lucide-react'
import type { MonitorUser, UsageRecord } from '@/lib/types'
import { getCatalogModel } from '@/stores/catalog'
import { formatBalance, formatUsd, formatUsageTime } from '@/lib/format'
import { ModelIcon } from '@/components/ModelIcon'

/** Bordered panel with a scrollable, cursor-paginated records table. */
export function RecentUsagePanel({
  records,
  users,
  showUser = false,
  showBalance = false,
  displayName,
  nextCursor,
  loadingMore = false,
  error,
  onLoadMore,
}: {
  records: UsageRecord[]
  users?: MonitorUser[]
  showUser?: boolean
  showBalance?: boolean
  /** Optional custom display-name lookup. */
  displayName?: (u: MonitorUser) => string
  nextCursor?: string | null
  loadingMore?: boolean
  error?: string | null
  onLoadMore?: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const onLoadMoreRef = useRef(onLoadMore)
  useEffect(() => { onLoadMoreRef.current = onLoadMore }, [onLoadMore])

  const maybeLoadMore = (el: HTMLDivElement) => {
    if (!nextCursor || loadingMore || !onLoadMoreRef.current) return
    const { clientHeight, scrollHeight, scrollTop } = el
    if (scrollHeight - scrollTop - clientHeight < 160) onLoadMoreRef.current()
  }
  const onScroll = (event: UIEvent<HTMLDivElement>) => maybeLoadMore(event.currentTarget)

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !nextCursor || loadingMore || error) return
    if (el.scrollHeight <= el.clientHeight + 160) onLoadMoreRef.current?.()
  }, [records, nextCursor, loadingMore, error])

  const nameOf = (userId: string) => {
    const u = users?.find((x) => x.id === userId)
    if (!u) return '—'
    return displayName ? displayName(u) : u.name
  }

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Zap className="size-3" />
          <h3 className="text-xs font-medium">Recent usage</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {records.length.toLocaleString()} settled calls
        </span>
      </div>

      {records.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">No usage records yet</div>
      ) : (
        <>
          <div className="usage-records-head border-b">
            <table className="w-full table-fixed text-xs">
              <colgroup>
                <col className="w-[22%]" />
                <col />
                {showUser && <col className="w-[16%]" />}
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                {showBalance && <col className="w-[14%]" />}
              </colgroup>
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 font-normal">Time</th>
                  <th className="px-3 py-2 font-normal">Model</th>
                  {showUser && <th className="px-3 py-2 font-normal">User</th>}
                  <th className="px-3 py-2 text-right font-normal">Tokens</th>
                  <th className="px-3 py-2 text-right font-normal">Cost</th>
                  {showBalance && (
                    <th className="px-3 py-2 text-right font-normal">Balance after</th>
                  )}
                </tr>
              </thead>
            </table>
          </div>
          <div ref={scrollRef} className="max-h-96 overflow-y-scroll" onScroll={onScroll}>
            <table className="w-full table-fixed text-xs">
              <colgroup>
                <col className="w-[22%]" />
                <col />
                {showUser && <col className="w-[16%]" />}
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                {showBalance && <col className="w-[14%]" />}
              </colgroup>
              <tbody className="divide-y">
                {records.map((r) => {
                  const model = getCatalogModel(r.modelId)
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {formatUsageTime(r.timestamp)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <ModelIcon model={model} className="size-3.5 shrink-0 rounded-[2px]" />
                          <span className="truncate" title={model.name}>
                            {model.name}
                          </span>
                        </span>
                      </td>
                      {showUser && (
                        <td className="px-3 py-2">
                          <span className="block truncate">{nameOf(r.userId)}</span>
                        </td>
                      )}
                      <td className="px-3 py-2 text-right tabular-nums">
                        {(r.tokensIn + r.tokensOut).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatUsd(r.cost)}</td>
                      {showBalance && (
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {r.balanceAfter === null ? '—' : formatBalance(r.balanceAfter)}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {(loadingMore || error) && <div className="border-t p-2 text-center text-xs text-muted-foreground">
              {error
                ? <button type="button" className="text-destructive hover:underline" onClick={onLoadMore}>{error} — Retry</button>
                : 'Loading…'}
            </div>}
          </div>
        </>
      )}
    </div>
  )
}

export interface TopModelStat {
  modelId: string
  calls: number
  cost: number
}

/** Ranked model list: position, icon, name, call count and spend. */
export function TopModelsPanel({ models }: { models: TopModelStat[] }) {
  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <BarChart3 className="size-3" />
        <h3 className="text-xs font-medium">Top models</h3>
      </div>

      {models.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">No usage records yet</div>
      ) : (
        <div className="max-h-96 divide-y overflow-y-auto">
          {models.map((m, i) => {
            const model = getCatalogModel(m.modelId)
            return (
              <div key={m.modelId} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="flex w-4 shrink-0 justify-center text-xs text-muted-foreground">
                    {i + 1}
                  </span>
                  <ModelIcon model={model} className="size-4 shrink-0 rounded-[2px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs" title={model.name}>
                      {model.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.calls.toLocaleString()} calls</p>
                  </div>
                </div>
                <span className="shrink-0 text-xs tabular-nums">{formatUsd(m.cost)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
