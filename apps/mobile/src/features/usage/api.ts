import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { deviceTimeZone } from '@pulpo/client-core'
import { apiRequest } from '../../api/client'
import type { LeaderboardEntry, UsageActivity, UsageRange, UsageRecord } from './format'

export type LeaderboardScope = 'friends' | 'pool'

interface UsageRecordsPage {
  data: UsageRecord[]
  nextCursor: string | null
}

const RECORDS_PAGE_SIZE = 20

/**
 * Query keys, scoped to the account's cache namespace. The viewer's own usage refreshes with the
 * realtime `billing` scope, which is when usage settles. Other people's usage and the leaderboard
 * sit under the `friends` prefix: friends and Pool changes refresh them, since either can change
 * whose usage the viewer may see (providers/realtimeSync.ts).
 */
export const usageKeys = {
  own: (namespace: string) => ['usage', namespace] as const,
  profile: (namespace: string, username: string) => ['friends', namespace, 'profile-usage', username.trim().toLowerCase()] as const,
  leaderboards: (namespace: string) => ['friends', namespace, 'leaderboard'] as const,
}

function usageParams(range: UsageRange): URLSearchParams {
  // Days are counted in the viewer's time zone, so a late-night call lands on the day they made it.
  return new URLSearchParams({ range, timeZone: deviceTimeZone() ?? 'UTC' })
}

function recordsQuery(queryKey: readonly unknown[], path: string, range: UsageRange, scope?: LeaderboardScope) {
  return infiniteQueryOptions({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = usageParams(range)
      if (scope) params.set('scope', scope)
      params.set('limit', `${RECORDS_PAGE_SIZE}`)
      if (pageParam) params.set('cursor', pageParam)
      return apiRequest<UsageRecordsPage>(`${path}?${params}`, { signal })
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 0,
  })
}

/**
 * One person's usage: the viewer's own (`username` null), with every model named, or someone
 * else's when they share it with the viewer. A 403 means they do not.
 */
export function personUsageActivityQuery(namespace: string, username: string | null, range: UsageRange) {
  const normalized = username?.trim().toLowerCase() ?? null
  const key: readonly unknown[] = normalized === null ? usageKeys.own(namespace) : usageKeys.profile(namespace, normalized)
  const path = normalized === null ? '/api/usage/activity' : `/api/profiles/${encodeURIComponent(normalized)}/usage/activity`
  return queryOptions({
    queryKey: [...key, 'activity', range],
    queryFn: ({ signal }) => apiRequest<UsageActivity>(`${path}?${usageParams(range)}`, { signal }),
    staleTime: 0,
  })
}

export function personUsageRecordsQuery(namespace: string, username: string | null, range: UsageRange) {
  const normalized = username?.trim().toLowerCase() ?? null
  const key: readonly unknown[] = normalized === null ? usageKeys.own(namespace) : usageKeys.profile(namespace, normalized)
  const path = normalized === null ? '/api/usage/records' : `/api/profiles/${encodeURIComponent(normalized)}/usage/records`
  return recordsQuery([...key, 'records', range], path, range)
}

/** The ranking and the circle's combined activity, loaded together so they never disagree. */
export function leaderboardQuery(namespace: string, scope: LeaderboardScope, range: UsageRange) {
  return queryOptions({
    queryKey: [...usageKeys.leaderboards(namespace), scope, range, 'overview'] as const,
    queryFn: async ({ signal }) => {
      const params = usageParams(range)
      params.set('scope', scope)
      const [ranking, activity] = await Promise.all([
        apiRequest<{ data: LeaderboardEntry[] }>(`/api/usage/leaderboard?${params}`, { signal }),
        apiRequest<UsageActivity>(`/api/usage/leaderboard/activity?${params}`, { signal }),
      ])
      return { entries: ranking.data, activity }
    },
    staleTime: 0,
  })
}

export function leaderboardRecordsQuery(namespace: string, scope: LeaderboardScope, range: UsageRange) {
  return recordsQuery([...usageKeys.leaderboards(namespace), scope, range, 'records'], '/api/usage/leaderboard/records', range, scope)
}
