import { useEffect, useMemo, useState } from 'react'
import { Droplets, Phone, TrendingUp, Wallet, Zap } from 'lucide-react'
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useUsage } from '@/stores/usage'
import { makeDailyUsage } from '@/lib/mock'
import { formatCost, formatDateTime, formatNumber, timeAgo } from '@/lib/format'
import type { Metric, TimeRange } from '@/lib/types'
import { StatCard } from '@/components/usage/StatCard'
import { Heatmap } from '@/components/usage/Heatmap'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ModelIcon } from '@/components/ModelIcon'
import { getModel } from '@/lib/mock'
import { cn } from '@/lib/utils'

const RANGES: TimeRange[] = ['24h', '7d', '30d', '90d', 'all']
const METRICS: { id: Metric; label: string }[] = [
  { id: 'cost', label: 'USD' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'calls', label: 'Calls' },
]

function rangeMs(r: TimeRange): number {
  switch (r) {
    case '24h':
      return 86_400_000
    case '7d':
      return 7 * 86_400_000
    case '30d':
      return 30 * 86_400_000
    case '90d':
      return 90 * 86_400_000
    case 'all':
      return Infinity
  }
}

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-lg border p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'cursor-pointer rounded-md px-2.5 py-1 text-xs transition-colors',
            value === o.id ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export { ToggleGroup }

export function PersonalPage() {
  const records = useUsage((s) => s.records)
  const userId = useUsage((s) => s.currentUserId)
  const users = useUsage((s) => s.users)
  const me = users.find((u) => u.id === userId)!
  const [range, setRange] = useState<TimeRange>('30d')
  const [metric, setMetric] = useState<Metric>('cost')
  const [detailsReady, setDetailsReady] = useState(false)

  useEffect(() => {
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setDetailsReady(true))
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
    }
  }, [])

  const mine = useMemo(() => records.filter((r) => r.userId === userId), [records, userId])
  const inRange = useMemo(
    () => mine.filter((r) => Date.now() - r.timestamp <= rangeMs(range)),
    [mine, range]
  )

  const totals = useMemo(() => {
    const calls = inRange.length
    const tokens = inRange.reduce((a, r) => a + r.tokensIn + r.tokensOut, 0)
    const cost = inRange.reduce((a, r) => a + r.cost, 0)
    return { calls, tokens, cost, avg: calls ? cost / calls : 0 }
  }, [inRange])

  const daily = useMemo(() => makeDailyUsage(mine, undefined), [mine])
  const dailyRange = useMemo(
    () => daily.filter((d) => Date.now() - new Date(d.date).getTime() <= rangeMs(range)),
    [daily, range]
  )

  const topModels = useMemo(() => {
    const m = new Map<string, { calls: number; cost: number }>()
    for (const r of inRange) {
      const e = m.get(r.modelId) ?? { calls: 0, cost: 0 }
      e.calls++
      e.cost += r.cost
      m.set(r.modelId, e)
    }
    return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost).slice(0, 5)
  }, [inRange])

  const water = totals.tokens * 0.0000022 // novelty gallons estimate

  return (
    <div className="space-y-5">
      {/* balance + profile */}
      <div className="flex items-center gap-4">
        <div>
          <div className="text-lg font-semibold">{me.name}</div>
          <div className="text-sm text-muted-foreground">
            joined {timeAgo(me.joinedAt)} · {me.email}
          </div>
        </div>
        <div className="flex-1" />
        <div className="rounded-xl border bg-card px-5 py-3 text-right">
          <div className="text-xs font-medium text-muted-foreground">Balance</div>
          <div className="text-2xl font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">
            {formatCost(me.balance)}
          </div>
        </div>
      </div>

      {/* controls */}
      <div className="flex items-center gap-2">
        <ToggleGroup options={RANGES.map((r) => ({ id: r, label: r }))} value={range} onChange={setRange} />
        <div className="flex-1" />
        <ToggleGroup options={METRICS} value={metric} onChange={setMetric} />
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Calls" value={formatNumber(totals.calls)} icon={<Phone className="size-3.5" />} />
        <StatCard label="Tokens" value={formatNumber(totals.tokens)} icon={<Zap className="size-3.5" />} />
        <StatCard label="Spend" value={formatCost(totals.cost)} icon={<Wallet className="size-3.5" />} />
        <StatCard
          label="Avg / call"
          value={formatCost(totals.avg)}
          icon={<TrendingUp className="size-3.5" />}
        />
        <StatCard
          label="Water use"
          value={`${water.toFixed(2)} gal`}
          sub="estimated cooling"
          icon={<Droplets className="size-3.5" />}
        />
      </div>

      {detailsReady ? (
        <>
          {/* daily bar chart */}
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-sm">Daily usage</CardTitle>
            </CardHeader>
            <CardContent className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyRange} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(d: string) => d.slice(5)}
                    minTickGap={30}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tickFormatter={(v: number) =>
                      metric === 'cost' ? `$${v.toFixed(2)}` : formatNumber(v)
                    }
                  />
                  <RTooltip
                    cursor={{ fill: 'var(--muted)' }}
                    contentStyle={{
                      background: 'var(--popover)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v) => [
                      metric === 'cost' ? formatCost(Number(v)) : formatNumber(Number(v)),
                      metric,
                    ]}
                  />
                  <Bar dataKey={metric} fill="var(--primary)" radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* heatmap */}
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-sm">Last 365 days</CardTitle>
            </CardHeader>
            <CardContent>
              <Heatmap data={daily} metric={metric} />
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="h-[378px]" aria-hidden="true" />
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* recent usage */}
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">Recent usage</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-6 py-2 font-medium">Time</th>
                  <th className="py-2 font-medium">Model</th>
                  <th className="py-2 text-right font-medium">Tokens</th>
                  <th className="px-6 py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {mine.slice(0, 10).map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-6 py-2 text-muted-foreground" title={formatDateTime(r.timestamp)}>
                      {timeAgo(r.timestamp)}
                    </td>
                    <td className="py-2">
                      <span className="flex items-center gap-1.5">
                        <ModelIcon model={getModel(r.modelId)} className="size-4 rounded-[2px]" />
                        <span className="truncate">{getModel(r.modelId).name}</span>
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatNumber(r.tokensIn + r.tokensOut)}
                    </td>
                    <td className="px-6 py-2 text-right tabular-nums">{formatCost(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* top models */}
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">Top models</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topModels.map(([modelId, stats]) => {
              const max = topModels[0]?.[1].cost || 1
              return (
                <div key={modelId} className="flex items-center gap-3">
                  <ModelIcon model={getModel(modelId)} className="size-5 rounded-[3px]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between text-sm">
                      <span className="truncate font-medium">{getModel(modelId).name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {stats.calls} calls · {formatCost(stats.cost)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(stats.cost / max) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
