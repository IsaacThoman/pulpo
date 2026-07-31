import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip } from 'recharts'
import { useUsage } from '@/stores/usage'
import { getCatalogModel, useCatalog } from '@/stores/catalog'
import { formatCost, formatDateTime, formatNumber } from '@/lib/format'
import type { TimeRange } from '@/lib/types'
import { ToggleGroup } from '@/components/usage/ToggleGroup'
import { StatCard } from '@/components/usage/StatCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ModelIcon } from '@/components/ModelIcon'

const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#64748b']

export function AnalyticsPage() {
  const records = useUsage((s) => s.records)
  const users = useUsage((s) => s.users)
  const catalogModels = useCatalog((s) => s.models)
  const loadAnalytics = useUsage((s) => s.loadAnalytics)
  useEffect(() => { void loadAnalytics() }, [loadAnalytics])
  const [range, setRange] = useState<TimeRange>('30d')
  const [page, setPage] = useState(0)
  const pageSize = 12

  const inRange = useMemo(() => {
    const ms =
      range === '24h'
        ? 86_400_000
        : range === '7d'
          ? 7 * 86_400_000
          : range === '30d'
            ? 30 * 86_400_000
            : range === '90d'
              ? 90 * 86_400_000
              : Infinity
    return records.filter((r) => Date.now() - r.timestamp <= ms)
  }, [records, range])

  const totals = useMemo(
    () => ({
      calls: inRange.length,
      tokens: inRange.reduce((a, r) => a + r.tokensIn + r.tokensOut, 0),
      cost: inRange.reduce((a, r) => a + r.cost, 0),
    }),
    [inRange]
  )

  const modelDist = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of inRange) m.set(r.modelId, (m.get(r.modelId) ?? 0) + r.cost)
    return [...m.entries()]
      .map(([id, cost]) => ({ id, name: getCatalogModel(id).name, value: Number(cost.toFixed(4)) }))
      .sort((a, b) => b.value - a.value)
  }, [inRange])

  const topUser = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of inRange) m.set(r.userId, (m.get(r.userId) ?? 0) + r.cost)
    const [uid, cost] = [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
    return uid ? { user: users.find((u) => u.id === uid)!, cost } : null
  }, [inRange, users])

  const pageCount = Math.max(1, Math.ceil(inRange.length / pageSize))
  const pageRows = inRange.slice(page * pageSize, (page + 1) * pageSize)

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Analytics</h2>
        <div className="flex-1" />
        <ToggleGroup
          options={(['24h', '7d', '30d', '90d', 'all'] as TimeRange[]).map((r) => ({ id: r, label: r }))}
          value={range}
          onChange={(r) => {
            setRange(r)
            setPage(0)
          }}
        />
        <Button variant="outline" size="sm">
          <Download />
          Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total spend" value={formatCost(totals.cost)} />
        <StatCard label="Tokens" value={formatNumber(totals.tokens)} />
        <StatCard label="Calls" value={formatNumber(totals.calls)} />
        <StatCard label="Active users" value={String(users.filter((u) => !u.blocked).length)} />
        <StatCard label="Models" value={String(catalogModels.filter((m) => m.enabled).length)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">Spend by model</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={modelDist}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {modelDist.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <RTooltip
                  contentStyle={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v) => [formatCost(Number(v)), 'spend']}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">Highlights</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {modelDist[0] && (
              <div className="rounded-lg border p-4">
                <div className="text-xs font-medium text-muted-foreground">Most used model</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <ModelIcon
                    model={getCatalogModel(modelDist[0].id)}
                    className="size-5 rounded-[3px]"
                  />
                  <span className="font-medium">{modelDist[0].name}</span>
                  <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                    {formatCost(modelDist[0].value)}
                  </span>
                </div>
              </div>
            )}
            {topUser && (
              <div className="rounded-lg border p-4">
                <div className="text-xs font-medium text-muted-foreground">Top user</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="font-medium">{topUser.user.nickname ?? topUser.user.name}</span>
                  <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                    {formatCost(topUser.cost)}
                  </span>
                </div>
              </div>
            )}
            <div className="rounded-lg border p-4">
              <div className="text-xs font-medium text-muted-foreground">Avg cost / call</div>
              <div className="mt-1.5 font-medium">
                {totals.calls ? formatCost(totals.cost / totals.calls) : '$0.00'}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* records table */}
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm">Usage records</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-6 py-2 font-medium">Time</th>
                <th className="py-2 font-medium">User</th>
                <th className="py-2 font-medium">Model</th>
                <th className="py-2 text-right font-medium">In</th>
                <th className="py-2 text-right font-medium">Out</th>
                <th className="py-2 text-right font-medium">Latency</th>
                <th className="px-6 py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const u = users.find((x) => x.id === r.userId)!
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-6 py-2 text-muted-foreground">{formatDateTime(r.timestamp)}</td>
                    <td className="py-2">{u.nickname ?? u.name}</td>
                    <td className="py-2">
                      <span className="flex items-center gap-1.5">
                        <ModelIcon model={getCatalogModel(r.modelId)} className="size-4 rounded-[2px]" />
                        {getCatalogModel(r.modelId).name}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatNumber(r.tokensIn)}</td>
                    <td className="py-2 text-right tabular-nums">{formatNumber(r.tokensOut)}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {(r.latencyMs / 1000).toFixed(1)}s
                    </td>
                    <td className="px-6 py-2 text-right tabular-nums">{formatCost(r.cost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t px-6 py-3 text-sm">
            <span className="text-muted-foreground">
              {inRange.length} records · page {page + 1} of {pageCount}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount - 1}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
