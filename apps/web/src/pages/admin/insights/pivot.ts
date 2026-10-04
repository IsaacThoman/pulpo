import type { AnalyticsBucket } from '@pulpo/contracts'
import { OTHER_SERIES_KEY } from '@/features/admin-analytics/palette'

export interface SeriesPoint { bucket: string; key: string; value: number }
export type PivotRow = Record<string, number | string> & { bucket: string }

const STEP_MS: Record<AnalyticsBucket, number> = { hour: 3_600_000, day: 86_400_000 }
const MAX_FILLED_BUCKETS = 5_000

/**
 * Every bucket between the first and last label. Labels are local wall-clock
 * `YYYY-MM-DDTHH:MI` strings, so they are stepped as if they were UTC to stay
 * independent of the viewer's DST transitions.
 */
export function fillBuckets(buckets: readonly string[], unit: AnalyticsBucket): string[] {
  const sorted = [...new Set(buckets)].sort()
  if (sorted.length < 2) return sorted
  const start = Date.parse(`${sorted[0]}:00Z`)
  const end = Date.parse(`${sorted.at(-1)}:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || (end - start) / STEP_MS[unit] > MAX_FILLED_BUCKETS) return sorted
  const filled = new Set(sorted)
  for (let time = start; time <= end; time += STEP_MS[unit]) filled.add(new Date(time).toISOString().slice(0, 16))
  return [...filled].sort()
}

/**
 * Pivots long `{bucket, key, value}` points into chart rows keyed by bucket.
 * Keeps the `maxSeries` largest keys (by total) and folds the rest, plus any
 * incoming "other", into a single "other" series stacked last.
 */
export function pivotSeries(points: readonly SeriesPoint[], unit: AnalyticsBucket, maxSeries = 8): { rows: PivotRow[]; keys: string[] } {
  const totals = new Map<string, number>()
  for (const point of points) totals.set(point.key, (totals.get(point.key) ?? 0) + point.value)
  const ranked = [...totals.entries()]
    .filter(([key]) => key !== OTHER_SERIES_KEY)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key)
  const kept = ranked.slice(0, maxSeries)
  const keptSet = new Set(kept)
  const keys = ranked.length > maxSeries || totals.has(OTHER_SERIES_KEY) ? [...kept, OTHER_SERIES_KEY] : kept
  const byBucket = new Map<string, PivotRow>()
  for (const bucket of fillBuckets(points.map((point) => point.bucket), unit)) {
    const row: PivotRow = { bucket }
    for (const key of keys) row[key] = 0
    byBucket.set(bucket, row)
  }
  for (const point of points) {
    const row = byBucket.get(point.bucket)
    if (!row) continue
    const key = keptSet.has(point.key) ? point.key : OTHER_SERIES_KEY
    row[key] = Number(row[key] ?? 0) + point.value
  }
  return { rows: [...byBucket.values()], keys }
}
