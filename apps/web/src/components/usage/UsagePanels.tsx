import { useEffect, useRef, type UIEvent } from 'react'
import { Zap } from 'lucide-react'
import type { MonitorUser, UsageRecord } from '@/lib/types'
import { getCatalogModel } from '@/stores/catalog'
import { formatBalance, formatUsageTime } from '@/lib/format'
import { UsageCostBreakdown } from './UsageCostBreakdown'
import { UsageModelIcon } from './UsageModelIcon'
import { ui, activeLocale } from '@/i18n/ui'

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
    <div className="min-w-0 rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Zap className="size-3" />
          <h3 className="text-xs font-medium">{ui("Recent usage")}</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {records.length.toLocaleString(activeLocale())} {ui("settled calls")} </span>
      </div>

      {records.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">{ui("No usage records yet")}</div>
      ) : (
        <>
          <div ref={scrollRef} className="max-h-96 min-w-0 overflow-auto" onScroll={onScroll} tabIndex={0} role="region" aria-label={ui("Recent usage")}>
            <table className="data-table usage-records-table">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 font-normal">{ui("Time")}</th>
                  <th className="px-3 py-2 font-normal">{ui("Model")}</th>
                  {showUser && <th className="px-3 py-2 font-normal">{ui("User")}</th>}
                  <th className="px-3 py-2 text-right font-normal">{ui("Tokens")}</th>
                  <th className="px-3 py-2 text-right font-normal">{ui("Cost")}</th>
                  {showBalance && (
                    <th className="px-3 py-2 text-right font-normal">{ui("Balance after")}</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y">
                {records.map((r) => {
                  const model = r.model ?? getCatalogModel(r.modelId)
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {formatUsageTime(r.timestamp)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex min-w-0 max-w-48 items-center gap-1.5">
                          <UsageModelIcon modelId={model.id} logo={r.model?.logo} className="size-3.5 shrink-0 rounded-[2px]" />
                          <span className="truncate" title={model.name}>
                            {model.name}
                          </span>
                        </span>
                      </td>
                      {showUser && (
                        <td className="px-3 py-2">
                          <span className="block max-w-40 truncate">{nameOf(r.userId)}</span>
                        </td>
                      )}
                      <td className="px-3 py-2 text-right tabular-nums">
                        {(r.tokensIn + r.tokensOut).toLocaleString(activeLocale())}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <UsageCostBreakdown
                          costUsd={r.cost}
                          inferenceReferenceUsd={r.inferenceReferenceCost}
                          subscriptionCoveredUsd={r.subscriptionCoveredCost}
                          personal
                        />
                      </td>
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
                ? <button type="button" className="text-destructive hover:underline" onClick={onLoadMore}>{error} {ui("— Retry")}</button>
                : ui("Loading…")}
            </div>}
          </div>
        </>
      )}
    </div>
  )
}
