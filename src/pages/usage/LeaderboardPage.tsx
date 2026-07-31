import { useMemo, useState } from 'react'
import { BarChart3, Crown, Save } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { useUsage } from '@/stores/usage'
import { useAuth } from '@/stores/auth'
import { getModel, makeDailyModelUsage } from '@/lib/mock'
import { formatDate, formatUsd } from '@/lib/format'
import { periodDays, rangeMs } from '@/lib/time-range'
import type { Metric, MonitorUser, TimeRange } from '@/lib/types'
import { ToggleGroup } from '@/components/usage/ToggleGroup'
import { StatsRow } from '@/components/usage/StatsRow'
import { DailyUsageChart } from '@/components/usage/DailyUsageChart'
import { RecentUsagePanel, TopModelsPanel, type TopModelStat } from '@/components/usage/UsagePanels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

type LBMetric = Metric | 'balance' | 'water'

const RANGES: { id: TimeRange; label: string }[] = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: 'all', label: 'All' },
]
const METRICS: { id: LBMetric; label: string }[] = [
  { id: 'cost', label: 'USD' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'calls', label: 'Calls' },
  { id: 'balance', label: 'Balance' },
  { id: 'water', label: 'Water' },
]

const BAR_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444']

function metricLabel(m: LBMetric): string {
  switch (m) {
    case 'cost':
      return 'USD'
    case 'tokens':
      return 'Tokens'
    case 'calls':
      return 'Calls'
    case 'balance':
      return 'Balance'
    case 'water':
      return 'Water'
  }
}

function formatMetric(v: number, m: LBMetric): string {
  if (m === 'cost' || m === 'balance') return formatUsd(v)
  if (m === 'water') return `${v.toFixed(4)} Gal`
  return Math.round(v).toLocaleString()
}

/** adaptive axis decimals for small dollar amounts */
function axisMoney(v: number): string {
  if (v === 0) return '$0'
  if (v < 0.01) return `$${v.toFixed(3)}`
  if (v < 1) return `$${v.toFixed(2)}`
  return `$${v.toFixed(1)}`
}

interface Row {
  user: MonitorUser
  calls: number
  tokens: number
  cost: number
}

function rowValue(r: Row, m: LBMetric): number {
  if (m === 'tokens') return r.tokens
  if (m === 'calls') return r.calls
  if (m === 'balance') return r.user.balance
  if (m === 'water') return r.cost / 23.04
  return r.cost
}

function displayName(u: MonitorUser): string {
  return u.showOnLeaderboard ? (u.nickname ?? u.name) : 'Anonymous'
}

function barColor(u: MonitorUser): string {
  if (!u.showOnLeaderboard) return 'var(--muted-foreground)'
  return u.barColor === '#fafafa' ? 'var(--primary)' : u.barColor
}

interface TipPayloadItem {
  value?: number | string
  payload?: { name?: string; rank?: number }
}

function LeaderboardTip({
  active,
  payload,
  metric,
}: {
  active?: boolean
  payload?: readonly TipPayloadItem[]
  metric: LBMetric
}) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium">
        #{p.payload?.rank} {p.payload?.name}
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="text-muted-foreground">{metricLabel(metric)}</span>
        <span className="font-medium tabular-nums">{formatMetric(Number(p.value), metric)}</span>
      </div>
    </div>
  )
}

export function LeaderboardPage() {
  const records = useUsage((s) => s.records)
  const users = useUsage((s) => s.users)
  const currentUserId = useUsage((s) => s.currentUserId)
  const setLeaderboardPref = useUsage((s) => s.setLeaderboardPref)
  const [range, setRange] = useState<TimeRange>('30d')
  const [metric, setMetric] = useState<LBMetric>('cost')

  const authUser = useAuth((state) => state.user)
  const me = users.find((u) => u.id === currentUserId) ?? {
    id: authUser?.id ?? '', name: authUser?.name ?? 'Pulpo user', email: authUser?.email ?? '',
    nickname: null, role: authUser?.role ?? 'user', balance: (authUser?.balanceMicros ?? 0) / 1_000_000,
    joinedAt: authUser ? Date.parse(authUser.createdAt) : Date.now(), blocked: false,
    showOnLeaderboard: true, barColor: '#10b981',
  }

  // preference editor state (saved explicitly)
  const [show, setShow] = useState(me.showOnLeaderboard)
  const [nickname, setNickname] = useState(me.nickname ?? '')
  const [color, setColor] = useState(me.barColor)
  const normalizedNick = nickname.trim() === '' || nickname.trim() === me.name ? null : nickname.trim()
  const dirty =
    show !== me.showOnLeaderboard || normalizedNick !== me.nickname || color !== me.barColor
  const save = () =>
    setLeaderboardPref(me.id, { showOnLeaderboard: show, nickname: normalizedNick, barColor: color })

  const inRange = useMemo(
    () => records.filter((r) => Date.now() - r.timestamp <= rangeMs(range)),
    [records, range]
  )

  const totals = useMemo(
    () => ({
      calls: inRange.length,
      tokens: inRange.reduce((a, r) => a + r.tokensIn + r.tokensOut, 0),
      cost: inRange.reduce((a, r) => a + r.cost, 0),
    }),
    [inRange]
  )

  const rows = useMemo<Row[]>(() => {
    const stats = new Map<string, { calls: number; tokens: number; cost: number }>()
    for (const r of inRange) {
      const e = stats.get(r.userId) ?? { calls: 0, tokens: 0, cost: 0 }
      e.calls++
      e.tokens += r.tokensIn + r.tokensOut
      e.cost += r.cost
      stats.set(r.userId, e)
    }
    return users
      .filter((u) => !u.blocked)
      .map((user) => ({ user, ...(stats.get(user.id) ?? { calls: 0, tokens: 0, cost: 0 }) }))
      .sort(
        (a, b) =>
          rowValue(b, metric) - rowValue(a, metric) ||
          b.cost - a.cost ||
          displayName(a.user).localeCompare(displayName(b.user))
      )
  }, [inRange, users, metric])

  const chartData = useMemo(
    () =>
      rows.map((r, i) => ({
        name: displayName(r.user),
        value: rowValue(r, metric),
        fill: barColor(r.user),
        rank: i + 1,
      })),
    [rows, metric]
  )

  const expensive = useMemo(() => [...inRange].sort((a, b) => b.cost - a.cost)[0], [inRange])

  const dailyAll = useMemo(() => makeDailyModelUsage(records), [records])
  const dailyRange = useMemo(
    () => dailyAll.filter((d) => Date.now() - new Date(`${d.date}T00:00:00`).getTime() <= rangeMs(range)),
    [dailyAll, range]
  )
  const chartMetric: Metric = metric === 'balance' || metric === 'water' ? 'cost' : metric

  const topModels = useMemo<TopModelStat[]>(() => {
    const m = new Map<string, { calls: number; cost: number }>()
    for (const r of inRange) {
      const e = m.get(r.modelId) ?? { calls: 0, cost: 0 }
      e.calls++
      e.cost += r.cost
      m.set(r.modelId, e)
    }
    return [...m.entries()]
      .map(([modelId, s]) => ({ modelId, ...s }))
      .sort((a, b) => b.cost - a.cost)
  }, [inRange])

  const firstUse = records.length > 0 ? records[records.length - 1].timestamp : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">Leaderboard</h2>
        <ToggleGroup options={RANGES} value={range} onChange={setRange} />
      </div>

      {/* your leaderboard preferences */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Switch checked={show} onCheckedChange={setShow} />
          Show me on the leaderboard
        </label>
        <Input
          className="w-[200px]"
          maxLength={40}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder={show ? me.name : 'Anonymous'}
          disabled={!show}
        />
        {show && (
          <div className="flex items-center gap-2">
            {BAR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Bar color ${c}`}
                onClick={() => setColor(c)}
                className={cn(
                  'size-4 cursor-pointer rounded-[3px] border border-border transition-all',
                  color === c && 'ring-2 ring-foreground ring-offset-1 ring-offset-background'
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        )}
        {dirty && (
          <Button size="sm" className="gap-2" onClick={save}>
            <Save className="size-3.5" />
            Save
          </Button>
        )}
      </div>

      {/* usage overview (all users) */}
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-xs font-medium">
            <BarChart3 className="size-3" />
            Usage overview
          </span>
          <div className="h-4 w-px bg-border" />
          <ToggleGroup options={METRICS} value={metric} onChange={setMetric} />
        </div>
        <StatsRow calls={totals.calls} tokens={totals.tokens} cost={totals.cost} />
      </section>

      {/* leaderboard chart */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium">Leaderboard</h3>
          <span className="text-xs text-muted-foreground">{rows.length} users</span>
        </div>
        {chartData.length === 0 ? (
          <div className="flex h-[250px] items-center justify-center text-xs text-muted-foreground">
            No users to show
          </div>
        ) : (
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  interval={0}
                  angle={chartData.length > 8 ? -35 : 0}
                  textAnchor={chartData.length > 8 ? 'end' : 'middle'}
                  height={chartData.length > 8 ? 60 : 30}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  width={48}
                  tickFormatter={(v: number) =>
                    metric === 'cost' || metric === 'balance'
                      ? axisMoney(v)
                      : metric === 'water'
                        ? v < 0.1
                          ? v.toFixed(3)
                          : v.toFixed(2)
                        : v >= 1000
                          ? `${(v / 1000).toFixed(1)}k`
                          : String(Math.round(v))
                  }
                />
                <RTooltip cursor={{ fill: 'var(--muted)', fillOpacity: 0.5 }} content={<LeaderboardTip metric={metric} />} />
                <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={48}>
                  {chartData.map((d) => (
                    <Cell key={d.rank} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* most expensive call */}
      {expensive && (
        <section>
          <div className="flex items-center gap-2">
            <Crown className="size-4 text-amber-500" />
            <h3 className="text-sm font-medium">Most expensive call</h3>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-5 md:gap-0 md:divide-x">
            {(() => {
              const u = users.find((x) => x.id === expensive.userId)
              const model = getModel(expensive.modelId)
              return (
                <>
                  <div className="p-3 md:first:pl-0">
                    <div className="mb-1 text-xs text-muted-foreground">User</div>
                    <div className="text-lg font-medium">{u ? displayName(u) : '—'}</div>
                  </div>
                  <div className="p-3">
                    <div className="mb-1 text-xs text-muted-foreground">Model</div>
                    <div className="truncate text-lg font-medium" title={model.name}>
                      {model.name}
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="mb-1 text-xs text-muted-foreground">Tokens</div>
                    <div className="text-lg font-medium">
                      {(expensive.tokensIn + expensive.tokensOut).toLocaleString()}
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="mb-1 text-xs text-muted-foreground">Cost</div>
                    <div className="text-lg font-medium text-amber-500">{formatUsd(expensive.cost)}</div>
                  </div>
                  <div className="p-3 md:last:pr-0">
                    <div className="mb-1 text-xs text-muted-foreground">Time</div>
                    <div className="text-sm font-medium md:pt-1">{formatDate(expensive.timestamp)}</div>
                  </div>
                </>
              )
            })()}
          </div>
        </section>
      )}

      {/* daily chart + contribution graph (all users) */}
      <DailyUsageChart
        data={dailyRange}
        contributionData={dailyAll}
        metric={chartMetric}
        periodDayCount={periodDays(range, firstUse)}
      />

      {/* records + model ranking (all users) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentUsagePanel records={inRange} users={users} showUser displayName={displayName} />
        </div>
        <TopModelsPanel models={topModels} />
      </div>
    </div>
  )
}
