import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useAuth } from '@/stores/auth'
import { ApiError, apiRequest } from '@/lib/api'
import { queryClient } from '@/lib/query-client'
import type { TimeRange } from '@/lib/types'
import { flattenUsagePages, profileUsageQueryKey, usageQueryParams } from '@/lib/usage-query'
import { PublicRecentUsagePanel, type PublicUsageRecord } from '@/components/usage/PublicUsagePanels'
import { UsageOverview, type UsageActivity } from '@/components/usage/UsageOverview'
import { ui } from '@/i18n/ui'

interface ProfileRecordsPage {
  data: PublicUsageRecord[]
  nextCursor: string | null
}

/** A private or missing profile won't change on retry; anything else follows the app default. */
function retryUnlessDenied(failures: number, error: Error): boolean {
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return false
  const retry = queryClient.getDefaultOptions().queries?.retry
  return typeof retry === 'function' ? retry(failures, error) : Boolean(retry) && failures < 2
}

/** Another person's settled usage on their profile, without balances. */
export function ProfileUsage({ username }: { username: string }) {
  const viewerId = useAuth((state) => state.user?.id)
  const [range, setRange] = useState<TimeRange>('30d')
  const path = `/api/profiles/${encodeURIComponent(username)}/usage`

  const activityQuery = useQuery({
    queryKey: profileUsageQueryKey(viewerId, username, range, 'activity'),
    enabled: Boolean(viewerId && username),
    queryFn: ({ signal }) => apiRequest<UsageActivity>(`${path}/activity?${usageQueryParams(range)}`, { signal }),
    retry: retryUnlessDenied,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const recordsQuery = useInfiniteQuery({
    queryKey: profileUsageQueryKey(viewerId, username, range, 'records'),
    enabled: Boolean(viewerId && username),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = usageQueryParams(range)
      params.set('limit', '50')
      if (pageParam) params.set('cursor', pageParam)
      return apiRequest<ProfileRecordsPage>(`${path}/records?${params}`, { signal })
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: retryUnlessDenied,
  })
  const records = useMemo(() => flattenUsagePages(recordsQuery.data?.pages), [recordsQuery.data])
  const nextCursor = recordsQuery.data?.pages.at(-1)?.nextCursor ?? null
  const error = activityQuery.error ?? recordsQuery.error
  // They stopped sharing since the profile loaded: hide what was fetched and refresh the profile,
  // whose page then drops the cached usage.
  const usagePrivate = [activityQuery.error, recordsQuery.error].some((cause) => cause instanceof ApiError && cause.status === 403)

  useEffect(() => {
    if (usagePrivate) void queryClient.invalidateQueries({ queryKey: ['friend-profile', username] })
  }, [usagePrivate, username])

  if (usagePrivate) return null

  return (
    <UsageOverview
      range={range}
      onRangeChange={setRange}
      activity={activityQuery.data}
      activityLoading={activityQuery.isLoading}
      recordsLoading={recordsQuery.isLoading}
      error={error}
      errorFallback={ui("Unable to load usage")}
      onRetry={() => { void activityQuery.refetch(); void recordsQuery.refetch() }}
      records={<PublicRecentUsagePanel
        records={records}
        showParticipant={false}
        nextCursor={nextCursor}
        loadingMore={recordsQuery.isFetchingNextPage}
        error={recordsQuery.isFetchNextPageError ? (recordsQuery.error instanceof Error ? recordsQuery.error.message : 'Unable to load more usage records') : null}
        onLoadMore={() => void recordsQuery.fetchNextPage()}
      />}
    />
  )
}
