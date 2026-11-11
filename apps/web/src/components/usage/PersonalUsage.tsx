import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { UsageCostItem } from '@pulpo/contracts'
import { useAuth } from '@/stores/auth'
import { formatBalance } from '@/lib/format'
import type { TimeRange, UsageRecord } from '@/lib/types'
import { flattenUsagePages, usageQueryParams } from '@/lib/usage-query'
import { apiRequest } from '@/lib/api'
import { fetchBillingSummary } from '@/lib/billing'
import { RecentUsagePanel } from '@/components/usage/UsagePanels'
import { UsageOverview, type UsageActivity } from '@/components/usage/UsageOverview'
import { ProfileHeaderRow } from '@/components/ProfileHeader'
import { SubscriptionUsageBars } from '@/components/SubscriptionUsageBars'
import { ui } from '@/i18n/ui'

interface PersonalActivity extends UsageActivity {
  balanceMicros: number
  balanceKind: 'account' | 'pool'
}

interface PersonalRecordRow {
  id: string
  createdAt: string
  userId: string
  modelId: string
  model: { id: string; name: string; logo: string | null }
  inputTokens: number
  outputTokens: number
  costMicros: number
  inferenceReferenceCostMicros: number
  subscriptionCoveredMicros: number
  costBreakdown: UsageCostItem[] | null
  latencyMs: number
  balanceAfterMicros: number | null
}

interface PersonalRecordsPage {
  data: PersonalRecordRow[]
  nextCursor: string | null
}

/** The signed-in user's own usage, with balance and limits beside their profile `identity`. */
export function PersonalUsage({ identity }: { identity: ReactNode }) {
  const authUser = useAuth((state) => state.user)
  const billingEnabled = useAuth((state) => state.billingEnabled)
  const userId = authUser?.id
  const [range, setRange] = useState<TimeRange>('30d')

  const activityQuery = useQuery({
    queryKey: ['usage', userId, range, 'activity'],
    enabled: Boolean(userId),
    queryFn: ({ signal }) => apiRequest<PersonalActivity>(`/api/usage/activity?${usageQueryParams(range)}`, { signal }),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const billingQuery = useQuery({
    queryKey: ['billing', userId],
    queryFn: fetchBillingSummary,
    enabled: Boolean(userId && billingEnabled),
    staleTime: 5_000,
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

  const activity = activityQuery.data
  const balance = (activity?.balanceMicros ?? authUser?.balanceMicros ?? 0) / 1_000_000
  const records = useMemo<UsageRecord[]>(() => flattenUsagePages(recordsQuery.data?.pages).map((row) => ({
    id: row.id,
    timestamp: Date.parse(row.createdAt),
    userId: row.userId,
    modelId: row.modelId,
    model: row.model,
    tokensIn: row.inputTokens,
    tokensOut: row.outputTokens,
    cost: row.costMicros / 1_000_000,
    inferenceReferenceCost: row.inferenceReferenceCostMicros / 1_000_000,
    subscriptionCoveredCost: row.subscriptionCoveredMicros / 1_000_000,
    costBreakdown: row.costBreakdown,
    balanceAfter: row.balanceAfterMicros === null ? null : row.balanceAfterMicros / 1_000_000,
    latencyMs: row.latencyMs,
  })), [recordsQuery.data])
  const nextCursor = recordsQuery.data?.pages.at(-1)?.nextCursor ?? null

  return (
    <div className="space-y-6">
      <ProfileHeaderRow identity={identity} aside={<>
        <SubscriptionUsageBars
          compact
          className="w-full sm:w-60 sm:border-r sm:pr-6"
          weekly={billingQuery.data?.weekly ?? null}
          fiveHour={billingQuery.data?.fiveHour ?? null}
          custom={billingQuery.data?.customLimits}
        />
        <div className="text-right">
          <div className="mb-1 text-xs text-muted-foreground">{activity?.balanceKind === 'pool' ? ui("Balance (pooled)") : ui("Balance")}</div>
          <div className="text-2xl font-medium text-emerald-600 dark:text-emerald-400">
            {formatBalance(balance)}
          </div>
          {billingEnabled && <Link
            to="/billing?topup=1"
            className="mt-1 inline-block text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          > {ui("Add credits")} </Link>}
        </div>
      </>} />

      <UsageOverview
        range={range}
        onRangeChange={setRange}
        activity={activity}
        activityLoading={activityQuery.isLoading}
        recordsLoading={recordsQuery.isLoading}
        error={activityQuery.error ?? recordsQuery.error}
        errorFallback={ui("Unable to load personal usage")}
        onRetry={() => { void activityQuery.refetch(); void recordsQuery.refetch() }}
        records={<RecentUsagePanel
          records={records}
          showBalance
          nextCursor={nextCursor}
          loadingMore={recordsQuery.isFetchingNextPage}
          error={recordsQuery.isFetchNextPageError ? (recordsQuery.error instanceof Error ? recordsQuery.error.message : 'Unable to load more usage') : null}
          onLoadMore={() => void recordsQuery.fetchNextPage()}
        />}
      />
    </div>
  )
}
