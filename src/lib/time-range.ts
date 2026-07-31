import type { TimeRange } from './types'

export function rangeMs(r: TimeRange): number {
  switch (r) {
    case '24h':
      return 86_400_000
    case '7d':
      return 7 * 86_400_000
    case '30d':
      return 30 * 86_400_000
    case '90d':
      return 90 * 86_400_000
    case 'all':
      return Infinity
  }
}

/** days in the selected period (for per-day averages); 'all' uses days since first use */
export function periodDays(range: TimeRange, firstUse: number | null): number {
  if (range !== 'all') return rangeMs(range) / 86_400_000
  if (!firstUse) return 1
  const start = new Date(firstUse)
  start.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.max(1, Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1)
}
