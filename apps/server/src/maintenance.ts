import { and, asc, eq, gt, inArray, lt, lte, sql } from 'drizzle-orm'
import { reconcileWorkspaceLeases } from './agent/controller.js'
import { db } from './database/client.js'
import {
  applicationSettings, attachments, backupJobs, chats, dailyUsageRollups, exportJobs, idempotencyRecords,
  passwordResetTokens, responses, sessions, usageEvents, users,
  requestLogs, ocrAttempts, ocrCacheEntries,
} from './database/schema.js'
import { getBlobStore } from './storage/index.js'
import { expireNormalChats, markExpiredChatsForPurge, purgePendingChats } from './chats/trash.js'
import { sanitizeContextForStorage } from './responses/public-output.js'
import { persistResponseItems } from './responses/storage.js'
import { parseBackupSettings, parseWebToolsSettings, publicWebToolsSettings } from './settings/application-settings.js'
import { purgeExpiredMemoryDocumentRevisions } from './memory-document/service.js'
import { deleteExpiredBackupObjects } from './admin/backup-retention.js'
import { deleteUnlockedOffsiteBackups } from './admin/backup-scheduler.js'
import { backupSettingsForExport } from './admin/backup-settings.js'
import { markExpiredNotesForPurge, purgePendingNotes } from './notes/service.js'

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
      const safeSettings = settings.filter((row) => row.key !== 'publicUrl').map((row) => {
        if (row.key === 'webTools') return [row.key, publicWebToolsSettings(parseWebToolsSettings(row.value))] as const
        if (row.key === 'ocr' && row.value && typeof row.value === 'object') {
          const { encryptedCustomApiKey, ...safe } = row.value as Record<string, unknown>
          return [row.key, { ...safe, ...(encryptedCustomApiKey ? { customApiKey: { configured: true } } : {}) }] as const
        }
        if (row.key === 'backups') {
          return [row.key, backupSettingsForExport(parseBackupSettings(row.value))] as const
        }
        return [row.key, row.value] as const
      })
      content = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings: Object.fromEntries(safeSettings) }, null, 2)
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
  await expireNormalChats(now)
  await markExpiredChatsForPurge(now)
  await markExpiredNotesForPurge(now)
  await db.delete(sessions).where(lt(sessions.expiresAt, now))
  await db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, now))
  await db.delete(idempotencyRecords).where(lt(idempotencyRecords.expiresAt, now))
  await db.update(requestLogs).set({ captureDetailedPayloads: false, requestPayload: null, responsePayload: null, updatedAt: now }).where(lte(requestLogs.payloadExpiresAt, now))
  await db.update(ocrAttempts).set({ requestPayload: null, responsePayload: null, updatedAt: now }).where(inArray(
    ocrAttempts.requestLogId,
    db.select({ id: requestLogs.id }).from(requestLogs).where(lte(requestLogs.payloadExpiresAt, now)),
  ))
  await db.delete(ocrCacheEntries).where(lt(ocrCacheEntries.expiresAt, now))
  await purgeExpiredMemoryDocumentRevisions(now)
  const expiredExports = await db.select().from(exportJobs).where(lt(exportJobs.expiresAt, now))
  for (const job of expiredExports) if (job.objectKey) await getBlobStore().delete(job.objectKey).catch(() => undefined)
  if (expiredExports.length) await db.delete(exportJobs).where(inArray(exportJobs.id, expiredExports.map((row) => row.id)))
  const expiredBackups = await db.select().from(backupJobs).where(lt(backupJobs.expiresAt, now))
  const deletedBackupIds = await deleteExpiredBackupObjects(expiredBackups, (key) => getBlobStore().delete(key))
  if (deletedBackupIds.length) await db.delete(backupJobs).where(inArray(backupJobs.id, deletedBackupIds))
  await deleteUnlockedOffsiteBackups(now)
  await reconcileWorkspaceLeases()
  await purgePendingChats()
  await purgePendingNotes()
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
