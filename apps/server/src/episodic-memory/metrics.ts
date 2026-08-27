import { sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { episodicMemoryMetricBuckets } from '../database/schema.js'

export type EpisodicMemoryMetric =
  | 'automatic_recall'
  | 'retrieval'
  | 'database_search'
  | 'embedding'
  | 'indexing'
  | 'agent_search'
  | 'agent_read'

export interface EpisodicMemoryMetricInput {
  metric: EpisodicMemoryMetric
  durationMs: number
  error?: boolean
  fallback?: boolean
  recalled?: boolean
  abstained?: boolean
  items?: number
  at?: Date
}

const HISTOGRAM = [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000] as const

export type EpisodicMemoryMetricBucket = typeof episodicMemoryMetricBuckets.$inferSelect

function hourStart(value: Date): Date {
  const result = new Date(value)
  result.setUTCMinutes(0, 0, 0)
  return result
}

export function durationHistogram(durationMs: number): Record<
  'durationLe10' | 'durationLe25' | 'durationLe50' | 'durationLe100' | 'durationLe250'
  | 'durationLe500' | 'durationLe1000' | 'durationLe2500' | 'durationLe5000' | 'durationGt5000', number
> {
  const duration = Math.max(0, Math.round(durationMs))
  return {
    durationLe10: duration <= 10 ? 1 : 0,
    durationLe25: duration > 10 && duration <= 25 ? 1 : 0,
    durationLe50: duration > 25 && duration <= 50 ? 1 : 0,
    durationLe100: duration > 50 && duration <= 100 ? 1 : 0,
    durationLe250: duration > 100 && duration <= 250 ? 1 : 0,
    durationLe500: duration > 250 && duration <= 500 ? 1 : 0,
    durationLe1000: duration > 500 && duration <= 1_000 ? 1 : 0,
    durationLe2500: duration > 1_000 && duration <= 2_500 ? 1 : 0,
    durationLe5000: duration > 2_500 && duration <= 5_000 ? 1 : 0,
    durationGt5000: duration > 5_000 ? 1 : 0,
  }
}

async function persistMetric(input: EpisodicMemoryMetricInput): Promise<void> {
  const at = input.at ?? new Date()
  const durationMs = Math.max(0, Math.round(input.durationMs))
  const histogram = durationHistogram(durationMs)
  const error = input.error ? 1 : 0
  const values = {
    bucketStart: hourStart(at),
    metric: input.metric,
    eventCount: 1,
    errorCount: error,
    fallbackCount: input.fallback ? 1 : 0,
    recalledCount: input.recalled ? 1 : 0,
    abstainedCount: input.abstained ? 1 : 0,
    itemCount: Math.max(0, Math.floor(input.items ?? 0)),
    durationSumMs: durationMs,
    durationMinMs: durationMs,
    durationMaxMs: durationMs,
    ...histogram,
    lastSuccessAt: error ? null : at,
    lastErrorAt: error ? at : null,
    updatedAt: at,
  }
  await db.insert(episodicMemoryMetricBuckets).values(values).onConflictDoUpdate({
    target: [episodicMemoryMetricBuckets.bucketStart, episodicMemoryMetricBuckets.metric],
    set: {
      eventCount: sql`${episodicMemoryMetricBuckets.eventCount} + 1`,
      errorCount: sql`${episodicMemoryMetricBuckets.errorCount} + ${values.errorCount}`,
      fallbackCount: sql`${episodicMemoryMetricBuckets.fallbackCount} + ${values.fallbackCount}`,
      recalledCount: sql`${episodicMemoryMetricBuckets.recalledCount} + ${values.recalledCount}`,
      abstainedCount: sql`${episodicMemoryMetricBuckets.abstainedCount} + ${values.abstainedCount}`,
      itemCount: sql`${episodicMemoryMetricBuckets.itemCount} + ${values.itemCount}`,
      durationSumMs: sql`${episodicMemoryMetricBuckets.durationSumMs} + ${durationMs}`,
      durationMinMs: sql`least(${episodicMemoryMetricBuckets.durationMinMs}, ${durationMs})`,
      durationMaxMs: sql`greatest(${episodicMemoryMetricBuckets.durationMaxMs}, ${durationMs})`,
      durationLe10: sql`${episodicMemoryMetricBuckets.durationLe10} + ${histogram.durationLe10}`,
      durationLe25: sql`${episodicMemoryMetricBuckets.durationLe25} + ${histogram.durationLe25}`,
      durationLe50: sql`${episodicMemoryMetricBuckets.durationLe50} + ${histogram.durationLe50}`,
      durationLe100: sql`${episodicMemoryMetricBuckets.durationLe100} + ${histogram.durationLe100}`,
      durationLe250: sql`${episodicMemoryMetricBuckets.durationLe250} + ${histogram.durationLe250}`,
      durationLe500: sql`${episodicMemoryMetricBuckets.durationLe500} + ${histogram.durationLe500}`,
      durationLe1000: sql`${episodicMemoryMetricBuckets.durationLe1000} + ${histogram.durationLe1000}`,
      durationLe2500: sql`${episodicMemoryMetricBuckets.durationLe2500} + ${histogram.durationLe2500}`,
      durationLe5000: sql`${episodicMemoryMetricBuckets.durationLe5000} + ${histogram.durationLe5000}`,
      durationGt5000: sql`${episodicMemoryMetricBuckets.durationGt5000} + ${histogram.durationGt5000}`,
      lastSuccessAt: error ? sql`${episodicMemoryMetricBuckets.lastSuccessAt}` : at,
      lastErrorAt: error ? at : sql`${episodicMemoryMetricBuckets.lastErrorAt}`,
      updatedAt: at,
    },
  })
}

export function recordEpisodicMemoryMetric(input: EpisodicMemoryMetricInput): void {
  void persistMetric(input).catch(() => undefined)
}

export async function measureEpisodicMemoryOperation<T>(
  metric: EpisodicMemoryMetric,
  operation: () => Promise<T>,
  items = 0,
): Promise<T> {
  const started = performance.now()
  try {
    const result = await operation()
    recordEpisodicMemoryMetric({ metric, durationMs: performance.now() - started, items })
    return result
  } catch (error) {
    recordEpisodicMemoryMetric({ metric, durationMs: performance.now() - started, items, error: true })
    throw error
  }
}

const histogramKeys = [
  'durationLe10', 'durationLe25', 'durationLe50', 'durationLe100', 'durationLe250',
  'durationLe500', 'durationLe1000', 'durationLe2500', 'durationLe5000', 'durationGt5000',
] as const satisfies ReadonlyArray<keyof EpisodicMemoryMetricBucket>

export function episodicMemoryLatencyQuantile(rows: EpisodicMemoryMetricBucket[], eventCount: number, percentile: number): number {
  if (!eventCount) return 0
  const target = Math.ceil(eventCount * percentile)
  let seen = 0
  for (let index = 0; index < histogramKeys.length; index += 1) {
    seen += Number(rows.reduce((sum, row) => sum + Number(row[histogramKeys[index]!] ?? 0), 0))
    if (seen >= target) return index < HISTOGRAM.length ? HISTOGRAM[index]! : Math.max(5_001, ...rows.map((row) => row.durationMaxMs))
  }
  return Math.max(0, ...rows.map((row) => row.durationMaxMs))
}

export function summarizeEpisodicMemoryMetric(rows: EpisodicMemoryMetricBucket[], metric: EpisodicMemoryMetric) {
  const selected = rows.filter((row) => row.metric === metric)
  const events = selected.reduce((sum, row) => sum + Number(row.eventCount), 0)
  const errors = selected.reduce((sum, row) => sum + Number(row.errorCount), 0)
  const items = selected.reduce((sum, row) => sum + Number(row.itemCount), 0)
  const duration = selected.reduce((sum, row) => sum + Number(row.durationSumMs), 0)
  return {
    events,
    errors,
    errorRate: events ? errors / events : 0,
    items,
    latency: {
      averageMs: events ? duration / events : 0,
      p50Ms: episodicMemoryLatencyQuantile(selected, events, 0.5),
      p95Ms: episodicMemoryLatencyQuantile(selected, events, 0.95),
    },
  }
}
