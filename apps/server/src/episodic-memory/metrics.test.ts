import { describe, expect, it } from 'vitest'
import {
  durationHistogram,
  episodicMemoryLatencyQuantile,
  summarizeEpisodicMemoryMetric,
  type EpisodicMemoryMetricBucket,
} from './metrics.js'

function metricBucket(overrides: Partial<EpisodicMemoryMetricBucket> = {}): EpisodicMemoryMetricBucket {
  return {
    bucketStart: new Date('2026-08-27T12:00:00.000Z'),
    metric: 'automatic_recall',
    eventCount: 10,
    errorCount: 1,
    fallbackCount: 0,
    recalledCount: 6,
    abstainedCount: 3,
    itemCount: 14,
    durationSumMs: 3_000,
    durationMinMs: 5,
    durationMaxMs: 900,
    durationLe10: 1,
    durationLe25: 4,
    durationLe50: 0,
    durationLe100: 0,
    durationLe250: 0,
    durationLe500: 0,
    durationLe1000: 5,
    durationLe2500: 0,
    durationLe5000: 0,
    durationGt5000: 0,
    lastSuccessAt: new Date('2026-08-27T12:50:00.000Z'),
    lastErrorAt: new Date('2026-08-27T12:40:00.000Z'),
    updatedAt: new Date('2026-08-27T12:50:00.000Z'),
    ...overrides,
  }
}

describe('episodic-memory aggregate metrics', () => {
  it('assigns each observation to exactly one bounded latency bucket', () => {
    expect(Object.values(durationHistogram(25)).reduce((sum, value) => sum + value, 0)).toBe(1)
    expect(durationHistogram(25).durationLe25).toBe(1)
    expect(durationHistogram(5_001).durationGt5000).toBe(1)
    expect(durationHistogram(-50).durationLe10).toBe(1)
  })

  it('calculates approximate percentiles and operation totals from hourly aggregates', () => {
    const rows = [metricBucket()]
    expect(episodicMemoryLatencyQuantile(rows, 10, 0.5)).toBe(25)
    expect(episodicMemoryLatencyQuantile(rows, 10, 0.95)).toBe(1_000)
    expect(summarizeEpisodicMemoryMetric(rows, 'automatic_recall')).toEqual({
      events: 10,
      errors: 1,
      errorRate: 0.1,
      items: 14,
      latency: { averageMs: 300, p50Ms: 25, p95Ms: 1_000 },
    })
  })

  it('returns zeroes when an operation has no observations', () => {
    expect(summarizeEpisodicMemoryMetric([metricBucket()], 'embedding')).toEqual({
      events: 0,
      errors: 0,
      errorRate: 0,
      items: 0,
      latency: { averageMs: 0, p50Ms: 0, p95Ms: 0 },
    })
  })
})
