import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { useUsage } from '@/stores/usage'
import { useAuth } from '@/stores/auth'
import { formatBalance, formatDate, formatUsd } from '@/lib/format'
import type { Metric, MonitorUser, TimeRange } from '@/lib/types'
import { ToggleGroup } from '@/components/usage/ToggleGroup'
import { StatsRow } from '@/components/usage/StatsRow'
import { Button } from '@/components/ui/button'
import { apiRequest } from '@/lib/api'
import { periodDays } from '@/lib/time-range'
import { toDailyModelUsage, type SettledDailyRow } from '@/lib/leaderboard-usage'
import { DailyUsageChart } from '@/components/usage/DailyUsageChart'
import { automaticProfileColor } from '@/lib/profile'
import {
  PublicRecentUsagePanel,
  PublicTopModelsPanel,
  type PublicTopModel,
  type PublicUsageRecord,
} from '@/components/usage/PublicUsagePanels'

type LBMetric = Metric | 'balance'

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
]
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
  }
}

function formatMetric(v: number, m: LBMetric): string {
  if (m === 'balance') return formatBalance(v)
  if (m === 'cost') return formatUsd(v)
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
  return r.cost
}

function displayName(u: MonitorUser): string {
  return u.name
}

function barColor(u: MonitorUser): string {
  return u.profileColor ?? automaticProfileColor(u.id)
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
  const loadLeaderboard = useUsage((s) => s.loadLeaderboard)
  const [range, setRange] = useState<TimeRange>('30d')
  const [metric, setMetric] = useState<LBMetric>('cost')
  const [records, setRecords] = useState<PublicUsageRecord[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)

  const authUser = useAuth((state) => state.user)
  const friendsUsageQuery = useQuery({
    queryKey: ['friends-usage', authUser?.id, range],
    enabled: Boolean(authUser?.id),
    queryFn: async () => {
      const days = rangeDays(range)
      const [, activity, recordPage] = await Promise.all([
        loadLeaderboard(range),
        apiRequest<LeaderboardActivity>(`/api/usage/leaderboard/activity?days=${days}`),
        apiRequest<LeaderboardRecords>(`/api/usage/leaderboard/records?days=${days}&limit=50`),
      ])
      return { activity, recordPage }
    },
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const leaderboardMe = users.find((u) => u.id === currentUserId)
  const me = {
    id: authUser?.id ?? '', name: authUser?.name ?? 'Pulpo user', email: authUser?.email ?? '',
    username: authUser?.username ?? 'pulpo', avatarUrl: authUser?.avatarUrl ?? null, profileColor: authUser?.profileColor ?? null,
    role: authUser?.role ?? 'user', balance: (authUser?.balanceMicros ?? 0) / 1_000_000,
    joinedAt: authUser ? Date.parse(authUser.createdAt) : Date.now(), blocked: false,
    ...(leaderboardMe ? { balance: leaderboardMe.balance } : {}),
  }

  useEffect(() => {
    setRecords([])
    setNextCursor(null)
    setLoadMoreError(null)
  }, [range])
  useEffect(() => {
    if (!friendsUsageQuery.data) return
    setRecords(friendsUsageQuery.data.recordPage.data)
    setNextCursor(friendsUsageQuery.data.recordPage.nextCursor)
    setLoadMoreError(null)
  }, [friendsUsageQuery.data])

  const activity = friendsUsageQuery.data?.activity ?? null
  const loading = friendsUsageQuery.isLoading
  const error = friendsUsageQuery.error

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
          rowValue(b, metric) - rowValue(a, metric) ||
          b.cost - a.cost ||
          displayName(a.user).localeCompare(displayName(b.user))
      )
  }, [users, metric])

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
  const hasAcceptedFriends = rows.some((row) => row.user.id !== currentUserId)

  // Balance is a point-in-time ranking, so the daily activity view uses spend.
  const dailyMetric: Metric = metric === 'tokens' || metric === 'calls' ? metric : 'cost'

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
      <div>
        <div className="text-lg font-medium">{me.name}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {me.email} · Joined {formatDate(me.joinedAt)}
        </div>
      </div>

      {/* usage overview (all users) */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-xs font-medium">
              <Clock className="size-3" />
              Usage overview
            </span>
            <div className="h-4 w-px bg-border" />
            <ToggleGroup options={METRICS} value={metric} onChange={setMetric} />
          </div>
          <ToggleGroup options={RANGES} value={range} onChange={setRange} />
        </div>
        <StatsRow calls={totals.calls} tokens={totals.tokens} cost={totals.cost} />
      </section>

      {/* user ranking — shares the overview metric picker, matching OpenWebUI Monitor */}
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="size-4" />
            Friends ranking
          </span>
          <span className="ml-auto text-xs text-muted-foreground">{rows.length} users</span>
        </div>
        {!hasAcceptedFriends ? (
          <div className="flex h-[250px] flex-col items-center justify-center gap-3 text-xs text-muted-foreground">
            <span>Add friends to compare usage</span>
            <Button asChild size="sm" variant="outline"><Link to="/friends">Find friends</Link></Button>
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
                    metric === 'balance'
                      ? formatBalance(v)
                      : metric === 'cost'
                        ? axisMoney(v)
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

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-lg border text-xs text-muted-foreground">Loading settled usage…</div>
      ) : error ? (
        <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-lg border text-sm text-muted-foreground">
          <span>{error instanceof Error ? error.message : 'Unable to load leaderboard usage'}</span>
          <Button size="sm" variant="outline" onClick={() => void friendsUsageQuery.refetch()}>Try again</Button>
        </div>
      ) : (
        <>
          <DailyUsageChart
            data={dailyUsage}
            contributionData={contributionUsage}
            metric={dailyMetric}
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

    </div>
  )
}
