import { useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { BarChart3, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '@/stores/auth'
import { formatBalance, formatChartNumber, formatDate, formatUsd } from '@/lib/format'
import type { Metric, MonitorUser, TimeRange } from '@/lib/types'
import { ToggleGroup } from '@/components/usage/ToggleGroup'
import { StatsRow } from '@/components/usage/StatsRow'
import { Button } from '@/components/ui/button'
import { apiRequest } from '@/lib/api'
import { periodDays } from '@/lib/time-range'
import { toDailyModelUsage, type SettledDailyRow } from '@/lib/leaderboard-usage'
import { DailyUsageChart } from '@/components/usage/DailyUsageChart'
import { automaticProfileColor } from '@/lib/profile'
import { flattenUsagePages, usageQueryParams } from '@/lib/usage-query'
import {
  PublicRecentUsagePanel,
  PublicTopModelsPanel,
  type PublicTopModel,
  type PublicUsageRecord,
} from '@/components/usage/PublicUsagePanels'
import { ui, uit, activeLocale } from '@/i18n/ui'
import { useSettings } from '@/stores/settings'
import { DEFAULT_CHART_ANIMATION_DURATION_MS, scaledAnimationDuration } from '@/lib/animation-speed'

type LBMetric = Metric | 'balance'

const RANGES: { id: TimeRange; label: string }[] = [
  { id: '24h', label: "24h" },
  { id: '7d', label: "7d" },
  { id: '30d', label: "30d" },
  { id: '90d', label: "90d" },
  { id: 'all', label: "All" },
]
const METRICS: { id: LBMetric; label: string }[] = [
  { id: 'tokens', label: "Tokens" },
  { id: 'cost', label: "USD" },
  { id: 'calls', label: "Calls" },
  { id: 'balance', label: "Balance" },
]
function metricLabel(m: LBMetric): string {
  switch (m) {
    case 'cost':
      return 'USD'
    case 'tokens':
      return ui("Tokens")
    case 'calls':
      return ui("Calls")
    case 'balance':
      return ui("Balance")
  }
}

function formatMetric(v: number, m: LBMetric): string {
  if (m === 'balance') return formatBalance(v)
  if (m === 'cost') return formatUsd(v)
  return Math.round(v).toLocaleString(activeLocale())
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

interface LeaderboardResponse {
  data: Array<{
    userId: string
    displayName: string
    username: string
    avatarUrl: string | null
    profileColor: string | null
    balanceMicros: number
    calls: number
    tokens: number
    costMicros: number
  }>
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

export function LeaderboardPage({ scope = 'friends' }: { scope?: 'friends' | 'pool' | 'instance' }) {
  const [range, setRange] = useState<TimeRange>('30d')
  const [metric, setMetric] = useState<LBMetric>('tokens')
  const animationSpeed = useSettings((state) => state.animationSpeed)
  const animationDuration = scaledAnimationDuration(DEFAULT_CHART_ANIMATION_DURATION_MS, animationSpeed)
  const instanceMode = scope === 'instance'
  const queryKey = scope === 'pool' ? 'pool-usage' : instanceMode ? 'instance-usage' : 'friends-usage'
  const leaderboardEndpoint = instanceMode ? '/api/admin/usage/leaderboard' : '/api/usage/leaderboard'

  const authUser = useAuth((state) => state.user)
  const circleUsageQuery = useQuery({
    queryKey: [queryKey, authUser?.id, range, 'overview'],
    enabled: Boolean(authUser?.id),
    queryFn: async ({ signal }) => {
      const params = usageQueryParams(range)
      if (!instanceMode) params.set('scope', scope)
      const [leaderboard, activity] = await Promise.all([
        apiRequest<LeaderboardResponse>(`${leaderboardEndpoint}?${params}`, { signal }),
        apiRequest<LeaderboardActivity>(`${leaderboardEndpoint}/activity?${params}`, { signal }),
      ])
      return { leaderboard, activity }
    },
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const recordsQuery = useInfiniteQuery({
    queryKey: [queryKey, authUser?.id, range, 'records'],
    enabled: Boolean(authUser?.id),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = usageQueryParams(range)
      if (!instanceMode) params.set('scope', scope)
      params.set('limit', '50')
      if (pageParam) params.set('cursor', pageParam)
      return apiRequest<LeaderboardRecords>(`${leaderboardEndpoint}/records?${params}`, { signal })
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
  const currentUserId = authUser?.id ?? ''
  const users = useMemo<MonitorUser[]>(() => circleUsageQuery.data?.leaderboard.data.map((row) => ({
    id: row.userId,
    name: row.displayName,
    username: row.username,
    avatarUrl: row.avatarUrl,
    profileColor: row.profileColor,
    email: '',
    role: 'user',
    balance: row.balanceMicros / 1_000_000,
    joinedAt: 0,
    blocked: false,
    usageCalls: row.calls,
    usageTokens: row.tokens,
    usageCost: row.costMicros / 1_000_000,
  })) ?? [], [circleUsageQuery.data?.leaderboard.data])
  const records = useMemo(() => flattenUsagePages(recordsQuery.data?.pages), [recordsQuery.data])
  const nextCursor = recordsQuery.data?.pages.at(-1)?.nextCursor ?? null
  const leaderboardMe = users.find((u) => u.id === currentUserId)
  const me = {
    id: authUser?.id ?? '', name: authUser?.name ?? 'Pulpo user', email: authUser?.email ?? '',
    username: authUser?.username ?? 'pulpo', avatarUrl: authUser?.avatarUrl ?? null, profileColor: authUser?.profileColor ?? null,
    role: authUser?.role ?? 'user', balance: (authUser?.balanceMicros ?? 0) / 1_000_000,
    joinedAt: authUser ? Date.parse(authUser.createdAt) : Date.now(), blocked: false,
    ...(leaderboardMe ? { balance: leaderboardMe.balance } : {}),
  }

  const activity = circleUsageQuery.data?.activity ?? null
  const loading = circleUsageQuery.isLoading || recordsQuery.isLoading
  const error = circleUsageQuery.error ?? recordsQuery.error

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
  const hasOtherParticipants = rows.some((row) => row.user.id !== currentUserId)
  const hasRankingParticipants = instanceMode ? rows.length > 0 : hasOtherParticipants

  // Balance is a point-in-time ranking, so the daily activity view uses spend.
  const dailyMetric: Metric = metric === 'tokens' || metric === 'calls' ? metric : 'cost'

  return (
    <div className="space-y-6">
      {instanceMode ? <div>
        <div className="text-lg font-medium">{ui("Instance leaderboard")}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {circleUsageQuery.isLoading ? ui("Loading active participants…") : uit`${users.length.toLocaleString(activeLocale())} active users with settled usage in this period`}
        </div>
      </div> : <div>
        <div className="text-lg font-medium">{me.name}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {me.email} {ui("· Joined")} {formatDate(me.joinedAt)}
        </div>
      </div>}

      {/* usage overview (all users) */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-xs font-medium">
              <Clock className="size-3" /> {ui("Usage overview")} </span>
            <div className="h-4 w-px bg-border" />
            <ToggleGroup options={METRICS.map((option) => ({ ...option, label: ui(option.label) }))} value={metric} onChange={setMetric} />
          </div>
          <ToggleGroup options={RANGES.map((option) => ({ ...option, label: ui(option.label) }))} value={range} onChange={setRange} />
        </div>
        {!loading && !error && <StatsRow calls={totals.calls} tokens={totals.tokens} cost={totals.cost} />}
      </section>

      {/* user ranking — shares the overview metric picker, matching OpenWebUI Monitor */}
      {!loading && !error && <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="size-4" />
            {scope === 'pool' ? ui("Pool") : instanceMode ? ui("Instance") : ui("Friends")} {ui("ranking")} </span>
          <span className="ml-auto text-xs text-muted-foreground">{rows.length} {ui("users")}</span>
        </div>
        {!hasRankingParticipants ? (
          <div className="flex h-[250px] flex-col items-center justify-center gap-3 text-xs text-muted-foreground">
            <span>{instanceMode ? ui("No settled usage in this period") : scope === 'pool' ? ui("Add Pool members to compare usage") : ui("Add friends to compare usage")}</span>
            {!instanceMode && <Button asChild size="sm" variant="outline"><Link to={scope === 'pool' ? '/friends/pool' : '/friends'}>{scope === 'pool' ? ui("Manage Pool") : ui("Find friends")}</Link></Button>}
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
                        : formatChartNumber(v)
                  }
                />
                <RTooltip cursor={{ fill: 'var(--muted)', fillOpacity: 0.5 }} content={<LeaderboardTip metric={metric} />} />
                <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={48} animationDuration={animationDuration}>
                  {chartData.map((d) => (
                    <Cell key={d.rank} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>}

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-lg border text-xs text-muted-foreground">{ui("Loading settled usage…")}</div>
      ) : error ? (
        <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-lg border text-sm text-muted-foreground">
          <span>{error instanceof Error ? error.message : ui("Unable to load leaderboard usage")}</span>
          <Button size="sm" variant="outline" onClick={() => { void circleUsageQuery.refetch(); void recordsQuery.refetch() }}>{ui("Try again")}</Button>
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
              <PublicRecentUsagePanel
                records={records}
                nextCursor={nextCursor}
                loadingMore={recordsQuery.isFetchingNextPage}
                error={recordsQuery.isFetchNextPageError ? (recordsQuery.error instanceof Error ? recordsQuery.error.message : 'Unable to load more usage records') : null}
                onLoadMore={() => void recordsQuery.fetchNextPage()}
              />
            </div>
            <PublicTopModelsPanel models={activity?.topModels ?? []} />
          </div>
        </>
      )}

    </div>
  )
}
