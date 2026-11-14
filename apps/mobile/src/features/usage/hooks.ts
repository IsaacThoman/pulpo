import { useCallback, useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api/client'
import { friendsKeys } from '../friends/api'
import { leaderboardQuery, leaderboardRecordsQuery, personUsageActivityQuery, personUsageRecordsQuery, type LeaderboardScope } from './api'
import type { UsageMetric, UsageRange } from './format'

const isForbidden = (error: unknown) => error instanceof ApiError && error.status === 403

/**
 * One person's usage for their profile: the viewer's own when `username` is null, someone else's
 * otherwise. `usagePrivate` turns true when they stop sharing it while the profile is open.
 */
export function usePersonUsage({ namespace, username, enabled }: { namespace: string; username: string | null; enabled: boolean }) {
  const queryClient = useQueryClient()
  const [range, setRange] = useState<UsageRange>('30d')
  const [metric, setMetric] = useState<UsageMetric>('calls')
  const active = enabled && Boolean(namespace)
  // Another period keeps the last one on screen until it arrives, so the page holds its place.
  const activity = useQuery({ ...personUsageActivityQuery(namespace, username, range), enabled: active, placeholderData: keepPreviousData })
  const records = useInfiniteQuery({ ...personUsageRecordsQuery(namespace, username, range), enabled: active, placeholderData: keepPreviousData })
  const usagePrivate = username !== null && (isForbidden(activity.error) || isForbidden(records.error))

  // The profile says whether usage is shared; reload it so the screen settles on the notice.
  useEffect(() => {
    if (usagePrivate && username) void queryClient.invalidateQueries({ queryKey: friendsKeys.profile(namespace, username.trim().toLowerCase()) })
  }, [namespace, queryClient, usagePrivate, username])

  const items = useMemo(() => records.data?.pages.flatMap((page) => page.data) ?? [], [records.data])
  const { refetch: refetchActivity } = activity
  const { refetch: refetchRecords } = records
  const refetch = useCallback(() => Promise.all([refetchActivity(), refetchRecords()]), [refetchActivity, refetchRecords])

  return {
    range,
    setRange,
    metric,
    setMetric,
    activity: activity.data,
    loading: activity.isLoading || records.isLoading,
    /** What is shown belongs to the period chosen before; the new one is on its way. */
    updating: activity.isPlaceholderData || records.isPlaceholderData,
    error: activity.error ?? (records.isFetchNextPageError ? null : records.error),
    usagePrivate,
    records: {
      items,
      hasMore: records.hasNextPage,
      loadingMore: records.isFetchingNextPage,
      loadMoreError: records.isFetchNextPageError ? records.error?.message ?? 'Could not load more usage.' : null,
      loadMore: () => void records.fetchNextPage(),
    },
    refetch,
  }
}

export type PersonUsageModel = ReturnType<typeof usePersonUsage>
export type UsageRecordsModel = PersonUsageModel['records']

/** The friends or Pool ranking with the circle's combined usage. */
export function useLeaderboard({ namespace, initialScope }: { namespace: string; initialScope: LeaderboardScope }) {
  const [scope, setScope] = useState<LeaderboardScope>(initialScope)
  const [range, setRange] = useState<UsageRange>('30d')
  const [metric, setMetric] = useState<UsageMetric>('calls')
  const active = Boolean(namespace)
  const overview = useQuery({ ...leaderboardQuery(namespace, scope, range), enabled: active, placeholderData: keepPreviousData })
  const records = useInfiniteQuery({ ...leaderboardRecordsQuery(namespace, scope, range), enabled: active, placeholderData: keepPreviousData })
  const items = useMemo(() => records.data?.pages.flatMap((page) => page.data) ?? [], [records.data])
  const { refetch: refetchOverview } = overview
  const { refetch: refetchRecords } = records
  const refetch = useCallback(() => Promise.all([refetchOverview(), refetchRecords()]), [refetchOverview, refetchRecords])

  return {
    scope,
    setScope,
    range,
    setRange,
    metric,
    setMetric,
    entries: overview.data?.entries,
    activity: overview.data?.activity,
    loading: overview.isLoading || records.isLoading,
    updating: overview.isPlaceholderData || records.isPlaceholderData,
    error: overview.error ?? (records.isFetchNextPageError ? null : records.error),
    records: {
      items,
      hasMore: records.hasNextPage,
      loadingMore: records.isFetchingNextPage,
      loadMoreError: records.isFetchNextPageError ? records.error?.message ?? 'Could not load more usage.' : null,
      loadMore: () => void records.fetchNextPage(),
    },
    refetch,
  }
}

export type LeaderboardModel = ReturnType<typeof useLeaderboard>
