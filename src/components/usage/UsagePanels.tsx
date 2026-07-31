import { useEffect, useState, type UIEvent } from 'react'
import { BarChart3, Zap } from 'lucide-react'
import type { MonitorUser, UsageRecord } from '@/lib/types'
import { getCatalogModel } from '@/stores/catalog'
import { formatUsd, formatUsageTime } from '@/lib/format'
import { ModelIcon } from '@/components/ModelIcon'

const PAGE_SIZE = 100

/** Bordered panel with a scrollable records table; loads more rows as you scroll. */
export function RecentUsagePanel({
  records,
  users,
  showUser = false,
  showBalance = false,
  displayName,
}: {
  records: UsageRecord[]
  users?: MonitorUser[]
  showUser?: boolean
  showBalance?: boolean
  /** anonymize / nickname-aware name lookup; defaults to nickname ?? name */
  displayName?: (u: MonitorUser) => string
}) {
  const [visible, setVisible] = useState(PAGE_SIZE)
  useEffect(() => setVisible(PAGE_SIZE), [records])
  const shown = records.slice(0, visible)

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const { clientHeight, scrollHeight, scrollTop } = e.currentTarget
    if (scrollHeight - scrollTop - clientHeight < 160 && visible < records.length) {
      setVisible((v) => v + PAGE_SIZE)
    }
  }

  const nameOf = (userId: string) => {
    const u = users?.find((x) => x.id === userId)
    if (!u) return '—'
    return displayName ? displayName(u) : (u.nickname ?? u.name)
  }

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Zap className="size-3" />
          <h3 className="text-xs font-medium">Recent usage</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          Showing {shown.length.toLocaleString()} of {records.length.toLocaleString()} records
        </span>
      </div>

      {records.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">No usage records yet</div>
      ) : (
        <div className="max-h-96 overflow-auto" onScroll={onScroll}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b text-left text-muted-foreground">
                <th className="bg-background px-3 py-2 font-normal">Time</th>
                <th className="bg-background px-3 py-2 font-normal">Model</th>
                {showUser && <th className="bg-background px-3 py-2 font-normal">User</th>}
                <th className="bg-background px-3 py-2 text-right font-normal">Tokens</th>
                <th className="bg-background px-3 py-2 text-right font-normal">Cost</th>
                {showBalance && (
                  <th className="bg-background px-3 py-2 text-right font-normal">Balance after</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((r) => {
                const model = getCatalogModel(r.modelId)
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {formatUsageTime(r.timestamp)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex max-w-[160px] items-center gap-1.5">
                        <ModelIcon model={model} className="size-3.5 shrink-0 rounded-[2px]" />
                        <span className="truncate" title={model.name}>
                          {model.name}
                        </span>
                      </span>
                    </td>
                    {showUser && (
                      <td className="px-3 py-2">
                        <span className="block max-w-[120px] truncate">{nameOf(r.userId)}</span>
                      </td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {(r.tokensIn + r.tokensOut).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUsd(r.cost)}</td>
                    {showBalance && (
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {formatUsd(r.balanceAfter)}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
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
