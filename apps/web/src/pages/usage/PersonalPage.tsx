import { useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { useAuth } from '@/stores/auth'
import { formatBalance, formatDate } from '@/lib/format'
import { periodDays } from '@/lib/time-range'
import type { Metric, TimeRange, UsageRecord } from '@/lib/types'
import { flattenUsagePages, usageQueryParams } from '@/lib/usage-query'
import { toDailyModelUsage, type SettledDailyRow } from '@/lib/leaderboard-usage'
import { apiRequest } from '@/lib/api'
import { ToggleGroup } from '@/components/usage/ToggleGroup'
import { StatsRow } from '@/components/usage/StatsRow'
import { DailyUsageChart } from '@/components/usage/DailyUsageChart'
import { RecentUsagePanel, TopModelsPanel } from '@/components/usage/UsagePanels'
import { Button } from '@/components/ui/button'

const RANGES: { id: TimeRange; label: string }[] = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: 'all', label: 'All' },
]
const METRICS: { id: Metric; label: string }[] = [
  { id: 'cost', label: 'USD' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'calls', label: 'Calls' },
]

interface PersonalActivity {
  summary: { calls: number; inputTokens: number; outputTokens: number; costMicros: number; firstUsedAt: string | null }
  daily: SettledDailyRow[]
  contribution: SettledDailyRow[]
  topModels: Array<{ modelId: string; calls: number; costMicros: number }>
  balanceMicros: number
}

interface PersonalRecordRow {
  id: string
  createdAt: string
  userId: string
  modelId: string
  inputTokens: number
  outputTokens: number
  costMicros: number
  latencyMs: number
  balanceAfterMicros: number | null
}

interface PersonalRecordsPage {
  data: PersonalRecordRow[]
  nextCursor: string | null
}

export function PersonalPage() {
  const authUser = useAuth((state) => state.user)
  const userId = authUser?.id
  const [range, setRange] = useState<TimeRange>('30d')
  const [metric, setMetric] = useState<Metric>('cost')

  const activityQuery = useQuery({
    queryKey: ['usage', userId, range, 'activity'],
    enabled: Boolean(userId),
    queryFn: ({ signal }) => apiRequest<PersonalActivity>(`/api/usage/activity?${usageQueryParams(range)}`, { signal }),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const recordsQuery = useInfiniteQuery({
    queryKey: ['usage', userId, range, 'records'],
    enabled: Boolean(userId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = usageQueryParams(range)
      params.set('limit', '50')
      if (pageParam) params.set('cursor', pageParam)
      return apiRequest<PersonalRecordsPage>(`/api/usage/records?${params}`, { signal })
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const me = {
    name: authUser?.name ?? 'Pulpo user',
    email: authUser?.email ?? '',
    balance: (activityQuery.data?.balanceMicros ?? authUser?.balanceMicros ?? 0) / 1_000_000,
    joinedAt: authUser ? Date.parse(authUser.createdAt) : Date.now(),
  }
  const activity = activityQuery.data
  const totals = {
    calls: activity?.summary.calls ?? 0,
    tokens: (activity?.summary.inputTokens ?? 0) + (activity?.summary.outputTokens ?? 0),
    cost: (activity?.summary.costMicros ?? 0) / 1_000_000,
  }
  const dailyUsage = useMemo(() => toDailyModelUsage(activity?.daily ?? []), [activity?.daily])
  const contributionUsage = useMemo(() => toDailyModelUsage(activity?.contribution ?? []), [activity?.contribution])
  const records = useMemo<UsageRecord[]>(() => flattenUsagePages(recordsQuery.data?.pages).map((row) => ({
    id: row.id,
    timestamp: Date.parse(row.createdAt),
    userId: row.userId,
    modelId: row.modelId,
    tokensIn: row.inputTokens,
    tokensOut: row.outputTokens,
    cost: row.costMicros / 1_000_000,
    balanceAfter: row.balanceAfterMicros === null ? null : row.balanceAfterMicros / 1_000_000,
    latencyMs: row.latencyMs,
  })), [recordsQuery.data])
  const nextCursor = recordsQuery.data?.pages.at(-1)?.nextCursor ?? null
  const error = activityQuery.error ?? recordsQuery.error

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-lg font-medium">{me.name}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {me.email} · Joined {formatDate(me.joinedAt)}
          </div>
        </div>
        <div className="text-right">
          <div className="mb-1 text-xs text-muted-foreground">Balance</div>
          <div className="text-2xl font-medium text-emerald-600 dark:text-emerald-400">
            {formatBalance(me.balance)}
          </div>
        </div>
      </div>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-xs font-medium">
              <Clock className="size-3" />
              Usage overview
            </span>
            <div className="h-4 w-px bg-border" />
            <ToggleGroup options={METRICS} value={metric} onChange={setMetric} />
          </div>
          <ToggleGroup options={RANGES} value={range} onChange={setRange} />
        </div>
        {!activityQuery.isLoading && !error && <StatsRow calls={totals.calls} tokens={totals.tokens} cost={totals.cost} />}
      </section>

      {activityQuery.isLoading || recordsQuery.isLoading ? (
        <div className="flex h-64 items-center justify-center rounded-lg border text-xs text-muted-foreground">Loading settled usage…</div>
      ) : error ? (
        <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-lg border text-sm text-muted-foreground">
          <span>{error instanceof Error ? error.message : 'Unable to load personal usage'}</span>
          <Button size="sm" variant="outline" onClick={() => { void activityQuery.refetch(); void recordsQuery.refetch() }}>Try again</Button>
        </div>
      ) : (
        <>
          <DailyUsageChart
            data={dailyUsage}
            contributionData={contributionUsage}
            metric={metric}
            periodDayCount={periodDays(range, activity?.summary.firstUsedAt ? Date.parse(activity.summary.firstUsedAt) : null)}
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RecentUsagePanel
                records={records}
                showBalance
                nextCursor={nextCursor}
                loadingMore={recordsQuery.isFetchingNextPage}
                error={recordsQuery.isFetchNextPageError ? (recordsQuery.error instanceof Error ? recordsQuery.error.message : 'Unable to load more usage') : null}
                onLoadMore={() => void recordsQuery.fetchNextPage()}
              />
            </div>
            <TopModelsPanel models={(activity?.topModels ?? []).map((model) => ({
              modelId: model.modelId,
              calls: model.calls,
              cost: model.costMicros / 1_000_000,
            }))} />
          </div>
        </>
      )}
    </div>
  )
}
