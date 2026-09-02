import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings, backupJobs } from '../database/schema.js'
import { maintenanceQueue } from '../jobs.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { parseBackupSettings } from '../settings/application-settings.js'
import { B2BackupStore } from './b2-backup-store.js'
import { ageRecipientDetails, normalizeBackupPrefix, readStoredBackupSettings, resolveBackupSettings } from './backup-settings.js'

const SCHEDULE_LOCK = 1_886_747_745

function objectKey(prefix: string, when: Date, id: string): string {
  const year = String(when.getUTCFullYear())
  const month = String(when.getUTCMonth() + 1).padStart(2, '0')
  const stamp = when.toISOString().replaceAll(/[-:.]/g, '')
  return `${normalizeBackupPrefix(prefix)}/${year}/${month}/${stamp}-${id}.tar.gz.age`
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
    const lockedUntil = new Date(createdAt.getTime() + settings.retentionDays * 86_400_000)
    await tx.insert(backupJobs).values({
      id,
      userId,
      operation: 'backup',
      destination: 'backblaze_b2',
      trigger,
      objectKey: objectKey(settings.prefix, scheduledFor ?? createdAt, id),
      storageEndpoint: settings.endpoint,
      storageBucket: settings.bucket,
      recipientFingerprint: recipient.fingerprint,
      scheduledFor,
      lockedUntil,
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
    const lockedUntil = new Date(now.getTime() + resolved.retentionDays * 86_400_000)
    await tx.insert(backupJobs).values({
      id,
      userId: null,
      operation: 'backup',
      destination: 'backblaze_b2',
      trigger: 'scheduled',
      objectKey: objectKey(resolved.prefix, due, id),
      storageEndpoint: resolved.endpoint,
      storageBucket: resolved.bucket,
      recipientFingerprint: recipient.fingerprint,
      scheduledFor: due,
      lockedUntil,
    })
    const next = nextScheduledRun(due, now, resolved.intervalHours)
    await tx.update(applicationSettings).set({ value: { ...settings, nextRunAt: next.toISOString() }, updatedAt: now })
      .where(eq(applicationSettings.key, 'backups'))
    queuedId = id
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
  const jobs = await db.select().from(backupJobs).where(and(
    eq(backupJobs.destination, 'backblaze_b2'),
    eq(backupJobs.status, 'completed'),
    isNull(backupJobs.deletedAt),
    lt(backupJobs.lockedUntil, now),
  ))
  if (!jobs.length) return

  let settings
  try {
    settings = resolveBackupSettings(await readStoredBackupSettings())
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error', service: 'pulpo-worker', event: 'backup.retention_credentials_unavailable',
      error: error instanceof Error ? error.message : String(error),
    }))
    return
  }
  const store = new B2BackupStore(settings)
  for (const job of jobs) {
    if (!job.objectKey || job.storageEndpoint !== settings.endpoint || job.storageBucket !== settings.bucket) continue
    try {
      await store.delete(job.objectKey)
      await db.update(backupJobs).set({ deletedAt: now, error: null, updatedAt: now }).where(eq(backupJobs.id, job.id))
    } catch (error) {
      await db.update(backupJobs).set({
        error: 'Remote deletion failed; the cleanup worker will retry', updatedAt: now,
      }).where(eq(backupJobs.id, job.id))
      console.error(JSON.stringify({
        level: 'error', service: 'pulpo-worker', event: 'backup.retention_delete_failed', jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }
}
