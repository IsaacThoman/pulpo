import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import { reconcileWorkspaceLeases } from './agent/controller.js'
import { db } from './database/client.js'
import {
  applicationSettings, attachments, chats, dailyUsageRollups, exportJobs, idempotencyRecords,
  passwordResetTokens, responses, sessions, usageEvents, users,
  requestLogs, ocrCacheEntries,
} from './database/schema.js'
import { getBlobStore } from './storage/index.js'
import { markExpiredChatsForPurge, purgePendingChats } from './chats/trash.js'
import { sanitizeContextForStorage } from './responses/public-output.js'
import { persistResponseItems } from './responses/storage.js'

const RESPONSE_CONTEXT_SCRUB_BATCH_SIZE = 100

export async function scrubPersistedResponseBinaryContext(): Promise<{ scanned: number; updated: number }> {
  let cursor: string | undefined
  let scanned = 0
  let updated = 0
  while (true) {
    const binaryCandidate = sql<boolean>`(
      ${responses.output}::text like '%data:image/%'
      or (${responses.output}::text like '%"type": "image"%' and ${responses.output}::text like '%"data":%')
    )`
    const rows = await db.select({ id: responses.id, output: responses.output })
      .from(responses)
      .where(and(
        inArray(responses.status, ['completed', 'failed', 'cancelled', 'incomplete']),
        binaryCandidate,
        cursor ? gt(responses.id, cursor) : undefined,
      ))
      .orderBy(asc(responses.id))
      .limit(RESPONSE_CONTEXT_SCRUB_BATCH_SIZE)
    if (!rows.length) break
    for (const row of rows) {
      scanned += 1
      const output = sanitizeContextForStorage(row.output as unknown[])
      if (JSON.stringify(output) === JSON.stringify(row.output)) continue
      // Rebuild projections first so a partial failure leaves the source row eligible for a retry.
      await persistResponseItems(row.id, output)
      await db.update(responses).set({ output, updatedAt: new Date() }).where(eq(responses.id, row.id))
      updated += 1
    }
    cursor = rows.at(-1)?.id
    if (rows.length < RESPONSE_CONTEXT_SCRUB_BATCH_SIZE) break
  }
  console.info(JSON.stringify({
    level: 'info', service: 'pulpo-worker', event: 'response_binary_context.scrubbed', scanned, updated,
  }))
  return { scanned, updated }
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0]!)
  return `${headers.map(csvCell).join(',')}\n${rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')).join('\n')}\n`
}

export async function createExport(exportId: string): Promise<void> {
  const [job] = await db.select().from(exportJobs).where(eq(exportJobs.id, exportId)).limit(1)
  if (!job || job.status === 'completed') return
  await db.update(exportJobs).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(exportJobs.id, exportId))
  try {
    let content: string
    let contentType: string
    if (job.type === 'config') {
      const settings = await db.select().from(applicationSettings)
      content = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings: Object.fromEntries(settings.map((row) => [row.key, row.value])) }, null, 2)
      contentType = 'application/json'
    } else if (job.type === 'chats') {
      const chatRows = await db.select().from(chats)
      const responseRows = await db.select().from(responses)
      content = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), chats: chatRows, responses: responseRows }, null, 2)
      contentType = 'application/json'
    } else if (job.type === 'users') {
      const rows = await db.select({ id: users.id, email: users.email, name: users.name, role: users.role, balanceMicros: users.balanceMicros, blocked: users.blocked, createdAt: users.createdAt }).from(users)
      content = csv(rows); contentType = 'text/csv'
    } else {
      const rows = await db.select().from(usageEvents)
      content = csv(rows); contentType = 'text/csv'
    }
    const objectKey = `exports/${job.userId}/${job.id}`
    const bytes = new TextEncoder().encode(content)
    await getBlobStore().put(objectKey, bytes, { contentType, contentLength: bytes.length, contentDisposition: 'attachment' })
    await db.update(exportJobs).set({ status: 'completed', objectKey, expiresAt: new Date(Date.now() + 7 * 86_400_000), updatedAt: new Date() }).where(eq(exportJobs.id, exportId))
  } catch (cause) {
    await db.update(exportJobs).set({ status: 'failed', error: cause instanceof Error ? cause.message : 'Export failed', updatedAt: new Date() }).where(eq(exportJobs.id, exportId))
    throw cause
  }
}

export async function runCleanup(): Promise<void> {
  const now = new Date()
  const abandonedBefore = new Date(now.getTime() - 24 * 86_400_000)
  const abandoned = await db.select().from(attachments).where(and(eq(attachments.status, 'pending'), lt(attachments.createdAt, abandonedBefore)))
  for (const attachment of abandoned) await getBlobStore().delete(attachment.objectKey).catch(() => undefined)
  if (abandoned.length) await db.update(attachments).set({ status: 'deleted', updatedAt: now }).where(inArray(attachments.id, abandoned.map((row) => row.id)))
  await markExpiredChatsForPurge(now)
  await db.delete(sessions).where(lt(sessions.expiresAt, now))
  await db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, now))
  await db.delete(idempotencyRecords).where(lt(idempotencyRecords.expiresAt, now))
  await db.update(requestLogs).set({ requestPayload: null, responsePayload: null, updatedAt: now }).where(lt(requestLogs.payloadExpiresAt, now))
  await db.execute(sql`update ocr_attempts set request_payload = null, response_payload = null, updated_at = ${now} where request_log_id in (select id from request_logs where payload_expires_at < ${now})`)
  await db.delete(ocrCacheEntries).where(lt(ocrCacheEntries.expiresAt, now))
  const expiredExports = await db.select().from(exportJobs).where(lt(exportJobs.expiresAt, now))
  for (const job of expiredExports) if (job.objectKey) await getBlobStore().delete(job.objectKey).catch(() => undefined)
  if (expiredExports.length) await db.delete(exportJobs).where(inArray(exportJobs.id, expiredExports.map((row) => row.id)))
  await reconcileWorkspaceLeases()
  await purgePendingChats()
}

export async function rebuildDailyRollups(): Promise<void> {
  await db.delete(dailyUsageRollups)
  await db.execute(sql`
    insert into daily_usage_rollups (day, user_id, model_id, calls, input_tokens, output_tokens, cost_micros)
    select date_trunc('day', created_at), user_id, model_id, count(*)::int,
      sum(input_tokens), sum(output_tokens), sum(cost_micros)
    from usage_events group by 1, 2, 3
  `)
}
