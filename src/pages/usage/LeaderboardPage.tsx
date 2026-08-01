import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Save } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { useUsage } from '@/stores/usage'
import { useAuth } from '@/stores/auth'
import { formatBalance, formatUsd } from '@/lib/format'
import type { Metric, MonitorUser, TimeRange } from '@/lib/types'
import { ToggleGroup } from '@/components/usage/ToggleGroup'
import { StatsRow } from '@/components/usage/StatsRow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useSettings } from '@/stores/settings'
import { apiRequest } from '@/lib/api'
import { periodDays } from '@/lib/time-range'
import { toDailyModelUsage, type SettledDailyRow } from '@/lib/leaderboard-usage'
import { DailyUsageChart } from '@/components/usage/DailyUsageChart'
import {
  PublicRecentUsagePanel,
  PublicTopModelsPanel,
  type PublicTopModel,
  type PublicUsageRecord,
} from '@/components/usage/PublicUsagePanels'

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
  { id: 'water', label: 'Estimated water' },
]
const USAGE_METRICS: { id: Metric; label: string }[] = [
  { id: 'cost', label: 'USD' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'calls', label: 'Calls' },
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
  if (m === 'balance') return formatBalance(v)
  if (m === 'cost') return formatUsd(v)
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

interface LeaderboardActivity {
  summary: { calls: number; inputTokens: number; outputTokens: number; costMicros: number; firstUsedAt: string | null }
  daily: SettledDailyRow[]
  contribution: SettledDailyRow[]
  topModels: PublicTopModel[]
}

interface LeaderboardRecords {
  data: PublicUsageRecord[]
  nextCursor: string | null
}

function rangeDays(range: TimeRange): string {
  return range === '24h' ? '1' : range === '7d' ? '7' : range === '30d' ? '30' : range === '90d' ? '90' : 'all'
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
  const users = useUsage((s) => s.users)
  const currentUserId = useUsage((s) => s.currentUserId)
  const setLeaderboardPref = useUsage((s) => s.setLeaderboardPref)
  const loadLeaderboard = useUsage((s) => s.loadLeaderboard)
  const [range, setRange] = useState<TimeRange>('30d')
  const [rankingMetric, setRankingMetric] = useState<LBMetric>('cost')
  const [usageMetric, setUsageMetric] = useState<Metric>('cost')
  const [activity, setActivity] = useState<LeaderboardActivity | null>(null)
  const [records, setRecords] = useState<PublicUsageRecord[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  const authUser = useAuth((state) => state.user)
  const savedNickname = useSettings((state) => state.nickname)
  const savedVisibility = useSettings((state) => state.leaderboardVisible)
  const savedColor = useSettings((state) => state.leaderboardColor)
  const leaderboardMe = users.find((u) => u.id === currentUserId)
  const me = {
    id: authUser?.id ?? '', name: authUser?.name ?? 'Pulpo user', email: authUser?.email ?? '',
    nickname: savedNickname || null, role: authUser?.role ?? 'user', balance: (authUser?.balanceMicros ?? 0) / 1_000_000,
    joinedAt: authUser ? Date.parse(authUser.createdAt) : Date.now(), blocked: false,
    showOnLeaderboard: savedVisibility, barColor: savedColor,
    ...(leaderboardMe ? { balance: leaderboardMe.balance } : {}),
  }

  useEffect(() => { void loadLeaderboard(range) }, [loadLeaderboard, range])
  useEffect(() => {
    let active = true
    const days = rangeDays(range)
    setLoading(true)
    setError(null)
    setActivity(null)
    setRecords([])
    setNextCursor(null)
    setLoadMoreError(null)
    void Promise.all([
      apiRequest<LeaderboardActivity>(`/api/usage/leaderboard/activity?days=${days}`),
      apiRequest<LeaderboardRecords>(`/api/usage/leaderboard/records?days=${days}&limit=50`),
    ]).then(([activityResult, recordResult]) => {
      if (!active) return
      setActivity(activityResult)
      setRecords(recordResult.data)
      setNextCursor(recordResult.nextCursor)
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Unable to load leaderboard usage')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [range, reload])

  // preference editor state (saved explicitly)
  const [show, setShow] = useState(me.showOnLeaderboard)
  const [nickname, setNickname] = useState(me.nickname ?? me.name)
  const [color, setColor] = useState(me.barColor)
  useEffect(() => {
    setShow(savedVisibility)
    setNickname(savedNickname || authUser?.name || 'Pulpo user')
    setColor(savedColor)
  }, [authUser?.name, savedColor, savedNickname, savedVisibility])
  const normalizedNick = nickname.trim() === '' || nickname.trim() === me.name ? null : nickname.trim()
  const dirty =
    show !== me.showOnLeaderboard || normalizedNick !== me.nickname || color !== me.barColor
  const save = () => {
    useSettings.setState({ nickname: normalizedNick ?? '', leaderboardVisible: show, leaderboardColor: color })
    setLeaderboardPref(me.id, { showOnLeaderboard: show, nickname: normalizedNick, barColor: color })
  }

  const totals = {
    calls: activity?.summary.calls ?? 0,
    tokens: (activity?.summary.inputTokens ?? 0) + (activity?.summary.outputTokens ?? 0),
    cost: (activity?.summary.costMicros ?? 0) / 1_000_000,
  }
  const dailyUsage = useMemo(() => toDailyModelUsage(activity?.daily ?? []), [activity?.daily])
  const contributionUsage = useMemo(() => toDailyModelUsage(activity?.contribution ?? []), [activity?.contribution])

  const rows = useMemo<Row[]>(() => {
    return users
      .filter((u) => !u.blocked)
      .map((user) => ({
        user,
        calls: user.usageCalls ?? 0,
        tokens: user.usageTokens ?? 0,
        cost: user.usageCost ?? 0,
      }))
      .sort(
        (a, b) =>
          rowValue(b, rankingMetric) - rowValue(a, rankingMetric) ||
          b.cost - a.cost ||
          displayName(a.user).localeCompare(displayName(b.user))
      )
  }, [users, rankingMetric])

  const chartData = useMemo(
    () =>
      rows.map((r, i) => ({
        name: displayName(r.user),
        value: rowValue(r, rankingMetric),
        fill: barColor(r.user),
        rank: i + 1,
      })),
    [rows, rankingMetric]
  )

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setLoadMoreError(null)
    try {
      const result = await apiRequest<LeaderboardRecords>(`/api/usage/leaderboard/records?days=${rangeDays(range)}&limit=50&cursor=${encodeURIComponent(nextCursor)}`)
      setRecords((current) => [...current, ...result.data])
      setNextCursor(result.nextCursor)
    } catch (cause) {
      setLoadMoreError(cause instanceof Error ? cause.message : 'Unable to load more usage records')
    } finally {
      setLoadingMore(false)
    }
  }

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
          Show my name on the leaderboard
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
          <ToggleGroup options={USAGE_METRICS} value={usageMetric} onChange={setUsageMetric} />
        </div>
        <StatsRow calls={totals.calls} tokens={totals.tokens} cost={totals.cost} />
      </section>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-lg border text-xs text-muted-foreground">Loading settled usage…</div>
      ) : error ? (
        <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-lg border text-sm text-muted-foreground">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => setReload((value) => value + 1)}>Try again</Button>
        </div>
      ) : (
        <>
          <DailyUsageChart
            data={dailyUsage}
            contributionData={contributionUsage}
            metric={usageMetric}
            periodDayCount={periodDays(range, activity?.summary.firstUsedAt ? Date.parse(activity.summary.firstUsedAt) : null)}
            modelNames={{ other: 'Other' }}
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <PublicRecentUsagePanel records={records} nextCursor={nextCursor} loadingMore={loadingMore} error={loadMoreError} onLoadMore={() => void loadMore()} />
            </div>
            <PublicTopModelsPanel models={activity?.topModels ?? []} />
          </div>
        </>
      )}

      {/* leaderboard chart */}
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-medium">User ranking</h3>
          <ToggleGroup options={METRICS} value={rankingMetric} onChange={setRankingMetric} />
          <span className="ml-auto text-xs text-muted-foreground">{rows.length} users</span>
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
                    rankingMetric === 'balance'
                      ? formatBalance(v)
                      : rankingMetric === 'cost'
                        ? axisMoney(v)
                      : rankingMetric === 'water'
                        ? v < 0.1
                          ? v.toFixed(3)
                          : v.toFixed(2)
                        : v >= 1000
                          ? `${(v / 1000).toFixed(1)}k`
                          : String(Math.round(v))
                  }
                />
                <RTooltip cursor={{ fill: 'var(--muted)', fillOpacity: 0.5 }} content={<LeaderboardTip metric={rankingMetric} />} />
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

    </div>
  )
}
