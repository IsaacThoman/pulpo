import { eq } from 'drizzle-orm'
import type { AdminUsageEvent } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { requestLogs } from '../database/schema.js'
import { redis } from '../redis.js'
import { scheduleAnalyticsFinalization } from '../analytics/capture.js'

const THROTTLE_MS = 900
const lastPublished = new Map<string, number>()

/** Drops throttle entries for requests that stopped publishing without a terminal event. */
function pruneThrottle(now: number): void {
  if (lastPublished.size < 256) return
  for (const [id, publishedAt] of lastPublished) if (now - publishedAt > 60_000) lastPublished.delete(id)
}

export async function publishAdminUsage(requestLogId: string, force = false): Promise<void> {
  const now = Date.now()
  if (!force && now - (lastPublished.get(requestLogId) ?? 0) < THROTTLE_MS) return
  pruneThrottle(now)
  lastPublished.set(requestLogId, now)
  const [row] = await db.select().from(requestLogs).where(eq(requestLogs.id, requestLogId)).limit(1)
  if (!row) return
  const event: AdminUsageEvent = {
    requestId: row.id,
    responseId: row.responseId,
    status: row.status,
    elapsedMs: row.durationMs ?? Math.max(0, now - (row.startedAt ?? row.createdAt).getTime()),
    currentModelId: row.currentModelId,
    retryAttempt: row.currentRetryAttempt,
    turnNumber: row.currentTurnNumber,
    retryCount: row.retryCount,
    fallbackUsed: row.fallbackUsed,
    ocrStatus: row.ocrStatus,
    eventCount: row.eventCount,
    inputTokens: row.inputTokens,
    cachedInputTokens: row.cachedInputTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    outputTokens: row.outputTokens,
    updatedAt: row.updatedAt.toISOString(),
  }
  await redis.publish('pulpo:admin-usage', JSON.stringify(event))
  if (force && !['queued', 'in_progress'].includes(row.status)) {
    lastPublished.delete(requestLogId)
    scheduleAnalyticsFinalization(row.responseId)
  }
}
