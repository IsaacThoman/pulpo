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
