import type { TimeRange } from './types'

export function usageQueryParams(range: TimeRange): URLSearchParams {
  return new URLSearchParams({
    range,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  })
}

export function flattenUsagePages<T>(pages: Array<{ data: T[] }> | undefined): T[] {
  return pages?.flatMap((page) => page.data) ?? []
}

/**
 * Query keys for another person's usage on their profile. They are never persisted, and
 * friends and Pool changes refresh them, since either can change who may see it.
 */
export function profileUsageQueryKey(viewerId: string | undefined, username: string, range?: TimeRange, part?: 'activity' | 'records') {
  return ['profile-usage', viewerId, username, ...(range ? [range] : []), ...(part ? [part] : [])]
}
