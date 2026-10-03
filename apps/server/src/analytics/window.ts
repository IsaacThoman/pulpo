import { sql, type AnyColumn, type SQL } from 'drizzle-orm'
import type { AnalyticsBucket, AnalyticsRangeQuery, AnalyticsWindow } from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'

const RANGE_MS: Record<Exclude<AnalyticsRangeQuery['range'], 'all' | 'custom'>, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  '90d': 90 * 86_400_000,
}

/** Ranges up to this long are charted hourly; longer ones by day. */
const HOURLY_BUCKET_LIMIT_MS = 2 * 86_400_000

export interface ResolvedWindow {
  from: Date | null
  to: Date
  previousFrom: Date | null
  bucket: AnalyticsBucket
  timeZone: string
}

export function resolveWindow(query: AnalyticsRangeQuery, now = new Date()): ResolvedWindow {
  if (query.range === 'custom') {
    const from = new Date(query.from!)
    const to = query.to ? new Date(query.to) : now
    if (!(from < to)) throw new AppError(400, 'invalid_range', 'The range start must be before its end')
    const span = to.getTime() - from.getTime()
    return {
      from, to, timeZone: query.timeZone,
      previousFrom: new Date(from.getTime() - span),
      bucket: span <= HOURLY_BUCKET_LIMIT_MS ? 'hour' : 'day',
    }
  }
  if (query.range === 'all') return { from: null, to: now, previousFrom: null, bucket: 'day', timeZone: query.timeZone }
  const span = RANGE_MS[query.range]
  const from = new Date(now.getTime() - span)
  return {
    from, to: now, timeZone: query.timeZone,
    previousFrom: new Date(from.getTime() - span),
    bucket: span <= HOURLY_BUCKET_LIMIT_MS ? 'hour' : 'day',
  }
}

export function windowPayload(window: ResolvedWindow): AnalyticsWindow {
  return {
    from: window.from?.toISOString() ?? null,
    to: window.to.toISOString(),
    bucket: window.bucket,
    previousFrom: window.previousFrom?.toISOString() ?? null,
  }
}

/** Half-open `[from, to)` filter for a timestamp column. */
export function inWindow(column: AnyColumn | SQL, from: Date | null, to: Date): SQL {
  return from
    ? sql`(${column} >= ${from.toISOString()}::timestamptz and ${column} < ${to.toISOString()}::timestamptz)`
    : sql`${column} < ${to.toISOString()}::timestamptz`
}

/**
 * Local wall-clock bucket label (`YYYY-MM-DDTHH:MI`) for a timestamp column.
 * The bucket unit is interpolated from a closed enum, never user input.
 */
export function bucketLabel(column: AnyColumn | SQL, bucket: AnalyticsBucket, timeZone: string): SQL<string> {
  return sql<string>`to_char(date_trunc(${sql.raw(`'${bucket}'`)}, ${column} at time zone ${timeZone}::text), 'YYYY-MM-DD"T"HH24:MI')`
}

/** Every bucket label in the window, so charts show empty periods as zero. */
export function bucketSeriesSql(window: ResolvedWindow, earliest: Date | null): SQL | null {
  const start = window.from ?? earliest
  if (!start) return null
  const unit = sql.raw(`'${window.bucket}'`)
  const step = sql.raw(`'1 ${window.bucket}'`)
  return sql`select to_char(series, 'YYYY-MM-DD"T"HH24:MI') as bucket
    from generate_series(
      date_trunc(${unit}, ${start.toISOString()}::timestamptz at time zone ${window.timeZone}::text),
      date_trunc(${unit}, ${window.to.toISOString()}::timestamptz at time zone ${window.timeZone}::text),
      ${step}::interval
    ) as series`
}

export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function csvValues(value: string | undefined): string[] {
  return value ? [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))].slice(0, 50) : []
}
