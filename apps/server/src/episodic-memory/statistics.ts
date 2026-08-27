import { asc, gte, sql } from 'drizzle-orm'
import type { EpisodicMemoryStatistics, EpisodicMemoryStatisticsRange } from '@pulpo/contracts'
import { db } from '../database/client.js'
import {
  chatTurnEmbeddings,
  episodicMemoryGenerations,
  episodicMemoryMetricBuckets,
  savedMemoryEmbeddings,
} from '../database/schema.js'
import { embeddingQueue } from '../jobs.js'
import { summarizeEpisodicMemoryMetric } from './metrics.js'

const RANGE_HOURS: Record<EpisodicMemoryStatisticsRange, number> = { '24h': 24, '7d': 168, '30d': 720 }
type MetricRow = typeof episodicMemoryMetricBuckets.$inferSelect

function hourStart(value: Date): Date {
  const result = new Date(value)
  result.setUTCMinutes(0, 0, 0)
  return result
}

function series(rows: MetricRow[], range: EpisodicMemoryStatisticsRange, from: Date, to: Date) {
  const intervalMs = range === '24h' ? 3_600_000 : 86_400_000
  const first = new Date(from)
  if (range === '24h') first.setUTCMinutes(0, 0, 0)
  else first.setUTCHours(0, 0, 0, 0)
  const result: EpisodicMemoryStatistics['series'] = []
  for (let start = first.getTime(); start <= to.getTime(); start += intervalMs) {
    const end = start + intervalMs
    const bucketRows = rows.filter((row) => row.metric === 'automatic_recall' && row.bucketStart.getTime() >= start && row.bucketStart.getTime() < end)
    const recall = summarizeEpisodicMemoryMetric(bucketRows, 'automatic_recall')
    result.push({
      bucketStart: new Date(start).toISOString(),
      recallRequests: recall.events,
      recalled: bucketRows.reduce((sum, row) => sum + Number(row.recalledCount), 0),
      errors: recall.errors,
      p95RecallLatencyMs: recall.latency.p95Ms,
    })
  }
  return result
}

interface IndexStatisticsRow {
  [key: string]: unknown
  indexedChats: number
  indexedChunks: number
  indexedFacts: number
  indexedUsers: number
  pendingItems: number
  failedItems: number
  totalItems: number
  storageBytes: number
  lastIndexedAt: Date | string | null
}

async function currentIndexStatistics(): Promise<IndexStatisticsRow> {
  const rows = await db.execute<IndexStatisticsRow>(sql`
    with active_generation as (
      select id from ${episodicMemoryGenerations} where ${episodicMemoryGenerations.active} = true limit 1
    ), all_items as (
      select user_id, chat_id, status, indexed_at from ${chatTurnEmbeddings}
      where generation_id = (select id from active_generation)
      union all
      select user_id, null::uuid as chat_id, status, indexed_at from ${savedMemoryEmbeddings}
      where generation_id = (select id from active_generation)
    )
    select
      count(distinct chat_id) filter (where chat_id is not null and status = 'ready')::int as "indexedChats",
      count(*) filter (where chat_id is not null and status = 'ready')::int as "indexedChunks",
      count(*) filter (where chat_id is null and status = 'ready')::int as "indexedFacts",
      count(distinct user_id) filter (where status = 'ready')::int as "indexedUsers",
      count(*) filter (where status = 'pending')::int as "pendingItems",
      count(*) filter (where status = 'failed')::int as "failedItems",
      count(*)::int as "totalItems",
      (pg_total_relation_size('chat_turn_embeddings') + pg_total_relation_size('saved_memory_embeddings'))::bigint as "storageBytes",
      max(indexed_at) as "lastIndexedAt"
    from all_items
  `)
  return rows[0] ?? {
    indexedChats: 0, indexedChunks: 0, indexedFacts: 0, indexedUsers: 0,
    pendingItems: 0, failedItems: 0, totalItems: 0, storageBytes: 0, lastIndexedAt: null,
  }
}

export async function readEpisodicMemoryStatistics(
  range: EpisodicMemoryStatisticsRange = '24h',
  now = new Date(),
): Promise<EpisodicMemoryStatistics> {
  const hours = RANGE_HOURS[range]
  const from = new Date(now.getTime() - hours * 3_600_000)
  const queueStatistics = Promise.all([
    embeddingQueue.getJobCounts('waiting', 'active', 'delayed', 'prioritized', 'failed'),
    embeddingQueue.getJobs(['waiting', 'active', 'delayed', 'prioritized'], 0, 1_000, true),
  ]).then(([jobCounts, jobs]) => ({ available: true as const, jobCounts, jobs }))
    .catch(() => ({ available: false as const, jobCounts: {} as Record<string, number>, jobs: [] }))
  const [rows, rawIndexStats, queue] = await Promise.all([
    db.select().from(episodicMemoryMetricBuckets).where(gte(episodicMemoryMetricBuckets.bucketStart, hourStart(from)))
      .orderBy(asc(episodicMemoryMetricBuckets.bucketStart)),
    currentIndexStatistics(),
    queueStatistics,
  ])
  const indexStats = {
    ...rawIndexStats,
    indexedChats: Number(rawIndexStats.indexedChats),
    indexedChunks: Number(rawIndexStats.indexedChunks),
    indexedFacts: Number(rawIndexStats.indexedFacts),
    indexedUsers: Number(rawIndexStats.indexedUsers),
    pendingItems: Number(rawIndexStats.pendingItems),
    failedItems: Number(rawIndexStats.failedItems),
    totalItems: Number(rawIndexStats.totalItems),
    storageBytes: Number(rawIndexStats.storageBytes),
  }
  const recall = summarizeEpisodicMemoryMetric(rows, 'automatic_recall')
  const retrieval = summarizeEpisodicMemoryMetric(rows, 'retrieval')
  const databaseSearch = summarizeEpisodicMemoryMetric(rows, 'database_search')
  const embedding = summarizeEpisodicMemoryMetric(rows, 'embedding')
  const indexing = summarizeEpisodicMemoryMetric(rows, 'indexing')
  const agentSearch = summarizeEpisodicMemoryMetric(rows, 'agent_search')
  const agentRead = summarizeEpisodicMemoryMetric(rows, 'agent_read')
  const allEvents = recall.events + retrieval.events + databaseSearch.events + embedding.events + indexing.events + agentSearch.events + agentRead.events
  const allErrors = recall.errors + retrieval.errors + databaseSearch.errors + embedding.errors + indexing.errors + agentSearch.errors + agentRead.errors
  const readyItems = indexStats.indexedChunks + indexStats.indexedFacts
  const recalled = rows.filter((row) => row.metric === 'automatic_recall').reduce((sum, row) => sum + Number(row.recalledCount), 0)
  const abstained = rows.filter((row) => row.metric === 'automatic_recall').reduce((sum, row) => sum + Number(row.abstainedCount), 0)
  const fallbacks = rows.filter((row) => row.metric === 'retrieval').reduce((sum, row) => sum + Number(row.fallbackCount), 0)
  const oldestJobAt = queue.jobs.reduce((oldest, job) => Math.min(oldest, job.timestamp), now.getTime())
  return {
    range,
    from: from.toISOString(),
    to: now.toISOString(),
    current: {
      indexedChats: indexStats.indexedChats,
      indexedChunks: indexStats.indexedChunks,
      indexedFacts: indexStats.indexedFacts,
      indexedUsers: indexStats.indexedUsers,
      pendingItems: indexStats.pendingItems,
      failedItems: indexStats.failedItems,
      coverage: indexStats.totalItems ? readyItems / indexStats.totalItems : 0,
      storageBytes: indexStats.storageBytes,
      lastIndexedAt: indexStats.lastIndexedAt ? new Date(indexStats.lastIndexedAt).toISOString() : null,
      queue: {
        available: queue.available,
        pending: (queue.jobCounts.waiting ?? 0) + (queue.jobCounts.delayed ?? 0) + (queue.jobCounts.prioritized ?? 0),
        active: queue.jobCounts.active ?? 0,
        failed: queue.jobCounts.failed ?? 0,
        oldestJobAgeMs: queue.jobs.length ? Math.max(0, now.getTime() - oldestJobAt) : 0,
      },
    },
    summary: {
      recall: {
        ...recall,
        recalled,
        abstained,
        recallRate: recall.events ? recalled / recall.events : 0,
        abstentionRate: recall.events ? abstained / recall.events : 0,
      },
      retrieval: {
        ...retrieval,
        fallbacks,
        fallbackRate: retrieval.events ? fallbacks / retrieval.events : 0,
      },
      databaseSearch,
      embedding,
      indexing: { ...indexing, itemsPerHour: indexing.items / hours },
      agentSearch,
      agentRead,
      totalErrorRate: allEvents ? allErrors / allEvents : 0,
    },
    series: series(rows, range, from, now),
  }
}
