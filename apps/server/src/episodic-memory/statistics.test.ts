import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  metricRows: [] as Array<Record<string, unknown>>,
  indexRows: [] as Array<Record<string, unknown>>,
  getJobCounts: vi.fn(),
  getJobs: vi.fn(),
}))

vi.mock('../database/client.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ orderBy: vi.fn(async () => mocks.metricRows) })),
      })),
    })),
    execute: vi.fn(async () => mocks.indexRows),
  },
}))

vi.mock('../jobs.js', () => ({
  embeddingQueue: {
    getJobCounts: mocks.getJobCounts,
    getJobs: mocks.getJobs,
  },
}))

import { readEpisodicMemoryStatistics } from './statistics.js'

function recallBucket() {
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
  }
}

describe('episodic-memory dashboard statistics', () => {
  beforeEach(() => {
    mocks.metricRows = [recallBucket()]
    mocks.indexRows = [{
      indexedChats: 4,
      indexedChunks: 8,
      indexedFacts: 2,
      indexedUsers: 3,
      pendingItems: 1,
      failedItems: 1,
      totalItems: 12,
      storageBytes: '1200000',
      lastIndexedAt: '2026-08-27T12:45:00.000Z',
    }]
    mocks.getJobCounts.mockReset().mockResolvedValue({ waiting: 2, active: 1, delayed: 1, prioritized: 1, failed: 4 })
    mocks.getJobs.mockReset().mockResolvedValue([{ timestamp: Date.parse('2026-08-27T12:59:55.000Z') }])
  })

  it('combines hourly metrics with live index and queue health', async () => {
    const statistics = await readEpisodicMemoryStatistics('24h', new Date('2026-08-27T13:00:00.000Z'))
    expect(statistics.current).toMatchObject({
      indexedChats: 4,
      coverage: 10 / 12,
      storageBytes: 1_200_000,
      queue: { available: true, pending: 4, active: 1, failed: 4, oldestJobAgeMs: 5_000 },
    })
    expect(statistics.summary.recall).toMatchObject({
      events: 10,
      errors: 1,
      recalled: 6,
      abstained: 3,
      recallRate: 0.6,
      abstentionRate: 0.3,
      latency: { averageMs: 300, p50Ms: 25, p95Ms: 1_000 },
    })
    expect(statistics.series.some((point) => point.recalled === 6)).toBe(true)
  })

  it('keeps the admin page available when queue health cannot be read', async () => {
    mocks.getJobCounts.mockRejectedValueOnce(new Error('Redis unavailable'))
    const statistics = await readEpisodicMemoryStatistics('7d', new Date('2026-08-27T13:00:00.000Z'))
    expect(statistics.current.queue).toEqual({
      available: false,
      pending: 0,
      active: 0,
      failed: 0,
      oldestJobAgeMs: 0,
    })
  })
})
