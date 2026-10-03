import type { AnalyticsBucket } from '@pulpo/contracts'
import { activeLocale } from '@/i18n/ui'
import { formatCost, formatNumber } from '@/lib/format'

export function formatMicros(micros: number): string {
  return formatCost(micros / 1_000_000)
}

export function formatCount(value: number): string {
  return formatNumber(Math.round(value))
}

export function formatPercent(ratio: number, digits = 1): string {
  return new Intl.NumberFormat(activeLocale(), { style: 'percent', maximumFractionDigits: digits }).format(ratio)
}

/** Durations: "850 ms", "4.2 s", "3.1 min". */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  const locale = activeLocale()
  if (ms < 1_000) return `${Math.round(ms).toLocaleString(locale)} ms`
  if (ms < 60_000) return `${(ms / 1_000).toLocaleString(locale, { maximumFractionDigits: 1 })} s`
  return `${(ms / 60_000).toLocaleString(locale, { maximumFractionDigits: 1 })} min`
}

/** Relative change from `previous` to `current`, or null when there is no baseline. */
export function relativeChange(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null
  return (current - previous) / previous
}

/** Bucket labels arrive as local wall-clock `YYYY-MM-DDTHH:MI` strings. */
function bucketDate(bucket: string): Date {
  return new Date(`${bucket}:00`)
}

export function formatBucketTick(bucket: string, unit: AnalyticsBucket): string {
  const date = bucketDate(bucket)
  if (Number.isNaN(date.getTime())) return bucket
  return unit === 'hour'
    ? date.toLocaleTimeString(activeLocale(), { hour: 'numeric' })
    : date.toLocaleDateString(activeLocale(), { month: 'short', day: 'numeric' })
}

export function formatBucketLabel(bucket: string, unit: AnalyticsBucket): string {
  const date = bucketDate(bucket)
  if (Number.isNaN(date.getTime())) return bucket
  return unit === 'hour'
    ? date.toLocaleString(activeLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(activeLocale(), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(activeLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })
}
