import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { EpisodicMemoryStatistics } from '@pulpo/contracts'
import { EpisodicStatisticsPanel } from './sections-episodic-memory'

const operation = {
  events: 10,
  errors: 1,
  errorRate: 0.1,
  items: 15,
  latency: { averageMs: 42, p50Ms: 25, p95Ms: 100 },
}

const statistics: EpisodicMemoryStatistics = {
  range: '24h',
  from: '2026-08-26T00:00:00.000Z',
  to: '2026-08-27T00:00:00.000Z',
  current: {
    indexedChats: 12,
    indexedChunks: 30,
    indexedUsers: 3,
    pendingItems: 2,
    failedItems: 1,
    coverage: 34 / 37,
    storageBytes: 1_000_000,
    lastIndexedAt: '2026-08-27T00:00:00.000Z',
    queue: { available: true, pending: 2, active: 1, failed: 1, oldestJobAgeMs: 4_000 },
  },
  summary: {
    recall: { ...operation, recalled: 6, abstained: 3, recallRate: 0.6, abstentionRate: 0.3 },
    retrieval: { ...operation, fallbacks: 2, fallbackRate: 0.2 },
    databaseSearch: operation,
    embedding: operation,
    indexing: { ...operation, itemsPerHour: 0.6 },
    agentSearch: operation,
    agentRead: operation,
    totalErrorRate: 0.1,
  },
  series: [{
    bucketStart: '2026-08-27T00:00:00.000Z',
    recallRequests: 10,
    recalled: 6,
    errors: 1,
    p95RecallLatencyMs: 100,
  }],
}

describe('episodic-memory operational statistics', () => {
  it('renders privacy copy, headline health metrics, index state, and agent operations', () => {
    const markup = renderToStaticMarkup(
      <EpisodicStatisticsPanel statistics={statistics} range="24h" onRangeChange={vi.fn()} />,
    )
    expect(markup).toContain('Hourly aggregates are retained without storing chat content.')
    expect(markup).toContain('P95 recall overhead')
    expect(markup).toContain('Index coverage')
    expect(markup).toContain('Queue active / failed')
    expect(markup).toContain('Queue status')
    expect(markup).toContain('search_chats')
    expect(markup).toContain('read_chat')
    expect(markup).toContain('<option value="7d">7d</option>')
    expect(markup).toContain('<option value="30d">30d</option>')
  })
})
