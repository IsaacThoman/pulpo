import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings, backupJobs } from '../database/schema.js'
import { maintenanceQueue } from '../jobs.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { parseBackupSettings } from '../settings/application-settings.js'
import { B2BackupStore } from './b2-backup-store.js'
import { deleteUnlockedOffsiteBlobs } from './backup-blobs.js'
import { wholeSecondLock } from './backup-retention.js'
import { ageRecipientDetails, normalizeBackupPrefix, readStoredBackupSettings, resolveBackupSettings, type ResolvedBackupSettings } from './backup-settings.js'

const SCHEDULE_LOCK = 1_886_747_745
/** Multipart uploads unfinished after a week belong to a crashed worker, not a slow one. */
const STALE_UPLOAD_MS = 7 * 86_400_000

type BackupFormat = 'archive' | 'snapshot'
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

function objectKey(prefix: string, when: Date, id: string, format: BackupFormat): string {
  const year = String(when.getUTCFullYear())
  const month = String(when.getUTCMonth() + 1).padStart(2, '0')
  const stamp = when.toISOString().replaceAll(/[-:.]/g, '')
  return `${normalizeBackupPrefix(prefix)}/${year}/${month}/${stamp}-${id}${format === 'snapshot' ? '.snapshot' : ''}.tar.gz.age`
}

/**
 * Scheduled runs are incremental snapshots, plus a self-contained archive when
 * none was attempted within the configured interval. Counting failed attempts
 * keeps a broken archive from starving snapshots.
 */
async function scheduledFormat(tx: Transaction, settings: ResolvedBackupSettings, now: Date): Promise<BackupFormat> {
  if (!settings.fullArchiveIntervalDays) return 'snapshot'
  const [recent] = await tx.select({ id: backupJobs.id }).from(backupJobs).where(and(
    eq(backupJobs.destination, 'backblaze_b2'),
    eq(backupJobs.format, 'archive'),
    eq(backupJobs.storageEndpoint, settings.endpoint),
    eq(backupJobs.storageBucket, settings.bucket),
    gte(backupJobs.createdAt, new Date(now.getTime() - settings.fullArchiveIntervalDays * 86_400_000)),
  )).limit(1)
  return recent ? 'snapshot' : 'archive'
}

export function nextScheduledRun(due: Date, now: Date, intervalHours: 6 | 12 | 24): Date {
  const intervalMs = intervalHours * 3_600_000
  const elapsed = Math.max(0, now.getTime() - due.getTime())
  return new Date(due.getTime() + (Math.floor(elapsed / intervalMs) + 1) * intervalMs)
}

async function enqueue(jobId: string): Promise<void> {
  await maintenanceQueue.add('backup', { type: 'backup', payload: { jobId } }, {
    jobId: `backup-${jobId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  })
}

export async function createOffsiteBackup(
  trigger: 'manual' | 'scheduled',
  userId: string | null,
  scheduledFor: Date | null = null,
): Promise<{ id: string; status: 'queued' }> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SCHEDULE_LOCK})`)
    const [active] = await tx.select({ id: backupJobs.id }).from(backupJobs).where(and(
      eq(backupJobs.destination, 'backblaze_b2'),
      inArray(backupJobs.status, ['queued', 'in_progress']),
    )).limit(1)
    if (active) throw new AppError(409, 'backup_already_running', 'An offsite backup is already running')

    const [row] = await tx.select({ value: applicationSettings.value }).from(applicationSettings)
      .where(eq(applicationSettings.key, 'backups')).limit(1)
    const settings = resolveBackupSettings(parseBackupSettings(row?.value))
    const recipient = ageRecipientDetails(settings.recipient)
    const id = newId()
    const createdAt = new Date()
    const lockedUntil = wholeSecondLock(new Date(createdAt.getTime() + settings.retentionDays * 86_400_000))
    await tx.insert(backupJobs).values({
      id,
      userId,
      operation: 'backup',
      destination: 'backblaze_b2',
      format: 'snapshot',
      trigger,
      objectKey: objectKey(settings.prefix, scheduledFor ?? createdAt, id, 'snapshot'),
      storageEndpoint: settings.endpoint,
      storageBucket: settings.bucket,
      recipientFingerprint: recipient.fingerprint,
      scheduledFor,
      lockedUntil,
      createdAt,
      updatedAt: createdAt,
    })
    return { id, status: 'queued' as const }
  })
  await enqueue(result.id)
  return result
}

export async function runOffsiteBackupSchedule(now = new Date()): Promise<void> {
  let queuedId: string | null = null
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SCHEDULE_LOCK})`)
    const [row] = await tx.select().from(applicationSettings).where(eq(applicationSettings.key, 'backups')).limit(1)
    const settings = parseBackupSettings(row?.value)
    if (!settings.enabled || !settings.encryptedApplicationKey || !settings.endpoint || !settings.bucket || !settings.recipient) return
    const due = settings.nextRunAt ? new Date(settings.nextRunAt) : now
    if (due.getTime() > now.getTime()) return

    const [active] = await tx.select({ id: backupJobs.id }).from(backupJobs).where(and(
      eq(backupJobs.destination, 'backblaze_b2'),
      inArray(backupJobs.status, ['queued', 'in_progress']),
    )).limit(1)
    if (active) return

    const resolved = resolveBackupSettings(settings)
    const recipient = ageRecipientDetails(resolved.recipient)
    const id = newId()
    const lockedUntil = wholeSecondLock(new Date(now.getTime() + resolved.retentionDays * 86_400_000))
    const format = await scheduledFormat(tx, resolved, now)
    // An in-place restore can bring back a schedule whose slot this instance
    // already ran. Skip that slot instead of failing on it forever.
    const [inserted] = await tx.insert(backupJobs).values({
      id,
      userId: null,
      operation: 'backup',
      destination: 'backblaze_b2',
      format,
      trigger: 'scheduled',
      objectKey: objectKey(resolved.prefix, due, id, format),
      storageEndpoint: resolved.endpoint,
      storageBucket: resolved.bucket,
      recipientFingerprint: recipient.fingerprint,
      scheduledFor: due,
      lockedUntil,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().returning({ id: backupJobs.id })
    // A taken slot runs again on the next tick under a fresh slot.
    const next = inserted ? nextScheduledRun(due, now, resolved.intervalHours) : now
    await tx.update(applicationSettings).set({ value: { ...settings, nextRunAt: next.toISOString() }, updatedAt: now })
      .where(eq(applicationSettings.key, 'backups'))
    queuedId = inserted?.id ?? null
  })
  if (queuedId) await enqueue(queuedId)
}

export async function reconcileOffsiteBackupJobs(): Promise<void> {
  const rows = await db.select({ id: backupJobs.id, status: backupJobs.status }).from(backupJobs).where(and(
    eq(backupJobs.destination, 'backblaze_b2'),
    inArray(backupJobs.status, ['queued', 'in_progress']),
  ))
  for (const row of rows) {
    const existing = await maintenanceQueue.getJob(`backup-${row.id}`)
    if (existing) {
      const state = await existing.getState()
      if (['active', 'delayed', 'prioritized', 'waiting', 'waiting-children'].includes(state)) continue
      await existing.remove().catch(() => undefined)
    }
    if (row.status === 'in_progress') {
      await db.update(backupJobs).set({ status: 'queued', updatedAt: new Date() }).where(eq(backupJobs.id, row.id))
    }
    await enqueue(row.id)
  }
}

export async function deleteUnlockedOffsiteBackups(now = new Date()): Promise<void> {
  // Removing the configuration intentionally leaves locked objects in Backblaze.
  const stored = await readStoredBackupSettings()
  if (!stored.encryptedApplicationKey || !stored.endpoint || !stored.bucket) return
  // Failed jobs are included: a final attempt can fail after its object was stored.
  const jobs = await db.select().from(backupJobs).where(and(
    eq(backupJobs.destination, 'backblaze_b2'),
    inArray(backupJobs.status, ['completed', 'failed']),
    isNull(backupJobs.deletedAt),
    lt(backupJobs.lockedUntil, now),
  ))

  let settings
  try {
    settings = resolveBackupSettings(stored)
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error', service: 'pulpo-worker', event: 'backup.retention_credentials_unavailable',
      error: error instanceof Error ? error.message : String(error),
    }))
    return
  }
  const store = new B2BackupStore(settings)
  let snapshotDeletionFailed = false
  for (const job of jobs) {
    if (!job.objectKey || job.storageEndpoint !== settings.endpoint || job.storageBucket !== settings.bucket) continue
    // A failed job keeps its error and timestamp so cleanup never resurfaces it as the latest failure.
    const failed = job.status === 'failed'
    try {
      await store.delete(job.objectKey)
      await db.update(backupJobs).set(failed ? { deletedAt: now } : { deletedAt: now, error: null, updatedAt: now }).where(eq(backupJobs.id, job.id))
    } catch (error) {
      snapshotDeletionFailed = true
      if (!failed) {
        await db.update(backupJobs).set({
          error: 'Remote deletion failed; the cleanup worker will retry', updatedAt: now,
        }).where(eq(backupJobs.id, job.id))
      }
      console.error(JSON.stringify({
        level: 'error', service: 'pulpo-worker', event: 'backup.retention_delete_failed', jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }
  // A snapshot whose deletion failed is still listed for download; keep its blobs until it is gone.
  if (!snapshotDeletionFailed) await deleteUnlockedOffsiteBlobs(store, settings, now)
  try {
    await store.abortStaleUploads(`${settings.prefix}/`, new Date(now.getTime() - STALE_UPLOAD_MS))
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error', service: 'pulpo-worker', event: 'backup.stale_upload_abort_failed',
      error: error instanceof Error ? error.message : String(error),
    }))
  }
}
