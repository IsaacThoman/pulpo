import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AnalyticsRange } from '@pulpo/contracts'

export const ANALYTICS_RANGES: AnalyticsRange[] = ['1h', '24h', '7d', '30d', '90d', 'all', 'custom']

const RANGE_SET = new Set<string>(ANALYTICS_RANGES)

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export interface AnalyticsSearch {
  range: AnalyticsRange
  from: string | null
  to: string | null
  /** Current value of any other filter key, e.g. `status` or `platform`. */
  get: (key: string) => string | null
  /** Sets or clears (null/empty) keys in one history entry. */
  update: (changes: Record<string, string | null>) => void
  /** Range, time zone and the given filter keys, ready for an API query string. */
  query: (filterKeys: readonly string[]) => string
}

/**
 * Filters live in the URL so a dashboard view can be shared or bookmarked.
 * Unknown ranges fall back to `defaultRange`; custom ranges need `from`.
 */
export function useAnalyticsSearch(defaultRange: AnalyticsRange = '24h'): AnalyticsSearch {
  const [params, setParams] = useSearchParams()
  const rawRange = params.get('range')
  const from = params.get('from')
  const to = params.get('to')
  const range: AnalyticsRange = rawRange && RANGE_SET.has(rawRange) && (rawRange !== 'custom' || from)
    ? rawRange as AnalyticsRange
    : defaultRange

  const update = useCallback((changes: Record<string, string | null>) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
      }
      return next
    }, { replace: true })
  }, [setParams])

  const get = useCallback((key: string) => params.get(key), [params])

  const query = useCallback((filterKeys: readonly string[]) => {
    const next = new URLSearchParams({ range, timeZone: browserTimeZone() })
    if (range === 'custom' && from) {
      next.set('from', from)
      if (to) next.set('to', to)
    }
    for (const key of filterKeys) {
      const value = params.get(key)
      if (value) next.set(key, value)
    }
    return next.toString()
  }, [from, params, range, to])

  return useMemo(() => ({ range, from, to, get, update, query }), [from, get, query, range, to, update])
}
