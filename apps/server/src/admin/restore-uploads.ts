import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { backupJobs, restoreUploads } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { getBlobStore } from '../storage/index.js'
import { maintenanceQueue } from '../jobs.js'
import { isAgeEncryptedBackup } from './backup-encryption.js'

export const RESTORE_CHUNK_SIZE = 16 * 1024 * 1024
export const MAX_RESTORE_SIZE = 20 * 1024 * 1024 * 1024
const expiry = () => new Date(Date.now() + 24 * 60 * 60 * 1000)
type Upload = typeof restoreUploads.$inferSelect
const chunkKey = (id: string, index: number) => `restore-chunks/${id}/${index}`

export function expectedChunkSize(size: number, index: number): number {
  if (!Number.isSafeInteger(index) || index < 0 || index >= Math.ceil(size / RESTORE_CHUNK_SIZE)) {
    throw new AppError(400, 'invalid_chunk', 'Invalid upload chunk number')
  }
  return Math.min(RESTORE_CHUNK_SIZE, size - index * RESTORE_CHUNK_SIZE)
}

function assertOwner(upload: Upload | undefined, userId: string): asserts upload is Upload {
  if (!upload || upload.userId !== userId) throw notFound('Restore upload')
  if (upload.status === 'uploading' && upload.expiresAt < new Date()) {
    throw new AppError(410, 'upload_expired', 'This upload expired. Select the backup to start again.')
  }
}

export async function startRestoreUpload(userId: string, input: {
  id: string; originalName: string; sizeBytes: number; fingerprint: string
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`restore-upload:${userId}`}))`)
    const [existing] = await tx.select().from(restoreUploads).where(eq(restoreUploads.id, input.id))
    if (existing) {
      assertOwner(existing, userId)
      if (existing.sizeBytes !== input.sizeBytes || existing.fingerprint !== input.fingerprint || existing.originalName !== input.originalName) {
        throw new AppError(409, 'upload_mismatch', 'This upload belongs to a different backup file')
      }
      return existing
    }
    const active = await tx.select({ id: restoreUploads.id }).from(restoreUploads)
      .where(and(eq(restoreUploads.userId, userId), eq(restoreUploads.status, 'uploading'), gt(restoreUploads.expiresAt, new Date())))
    if (active.length >= 3) throw new AppError(409, 'too_many_uploads', 'Finish or discard an existing restore upload first')
    const [upload] = await tx.insert(restoreUploads).values({ ...input, userId, expiresAt: expiry() }).returning()
    return upload!
  })
}

export async function readRestoreUpload(id: string, userId: string) {
  const [upload] = await db.select().from(restoreUploads).where(eq(restoreUploads.id, id))
  assertOwner(upload, userId)
  const [job] = await db.select({ status: backupJobs.status, progress: backupJobs.progress, error: backupJobs.error })
    .from(backupJobs).where(eq(backupJobs.id, id))
  return { ...upload, chunkSize: RESTORE_CHUNK_SIZE, job: job ?? null }
}

export async function listRestoreUploads(userId: string) {
  return db.select({ id: restoreUploads.id, originalName: restoreUploads.originalName }).from(restoreUploads)
    .where(and(eq(restoreUploads.userId, userId), eq(restoreUploads.status, 'uploading'), gt(restoreUploads.expiresAt, new Date())))
}

export async function putRestoreChunk(id: string, userId: string, index: number, checksum: string, body: Uint8Array) {
  if (createHash('sha256').update(body).digest('hex') !== checksum) {
    throw new AppError(400, 'chunk_checksum_failed', 'Upload chunk checksum failed; retry this chunk')
  }
  await db.transaction(async (tx) => {
    const [upload] = await tx.select().from(restoreUploads).where(eq(restoreUploads.id, id)).for('update')
    assertOwner(upload, userId)
    if (upload.status !== 'uploading') throw new AppError(409, 'upload_finalized', 'This upload has already been finalized')
    if (body.byteLength !== expectedChunkSize(upload.sizeBytes, index)) throw new AppError(400, 'chunk_size_mismatch', 'Upload chunk size mismatch')
    if (index === 0 && isAgeEncryptedBackup(body)) {
      throw new AppError(400, 'backup_must_be_decrypted', 'Decrypt the .age backup locally before uploading its .tar.gz contents')
    }
    const previous = upload.parts[index]
    if (previous) {
      if (previous.checksum !== checksum) throw new AppError(409, 'chunk_conflict', 'This chunk belongs to a different file. Discard the upload and start again.')
      return
    }
    // The row lock also serializes finalization/cleanup. A crash between the
    // object write and metadata commit is safe: retries overwrite the same key.
    await getBlobStore().put(chunkKey(id, index), body, { contentType: 'application/octet-stream', contentLength: body.byteLength })
    await tx.update(restoreUploads).set({
      parts: { ...upload.parts, [index]: { size: body.byteLength, checksum } }, updatedAt: new Date(), expiresAt: expiry(),
    }).where(eq(restoreUploads.id, id))
  })
}

export async function completeRestoreUpload(id: string, userId: string) {
  const shouldEnqueue = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pulpo:restore-dispatch'))`)
    const [upload] = await tx.select().from(restoreUploads).where(eq(restoreUploads.id, id)).for('update')
    assertOwner(upload, userId)
    if (upload.status !== 'uploading') {
      const [job] = await tx.select().from(backupJobs).where(eq(backupJobs.id, id))
      return job?.status === 'queued'
    }
    for (let index = 0; index < Math.ceil(upload.sizeBytes / RESTORE_CHUNK_SIZE); index++) {
      if (upload.parts[index]?.size !== expectedChunkSize(upload.sizeBytes, index)) {
        throw new AppError(409, 'upload_incomplete', 'Some backup chunks are missing. Resume the upload before restoring.')
      }
    }
    const active = await tx.select({ id: backupJobs.id }).from(backupJobs).where(and(
      eq(backupJobs.operation, 'restore'), inArray(backupJobs.status, ['queued', 'in_progress']),
    )).limit(1)
    if (active.length) throw new AppError(409, 'restore_in_progress', 'Another restore is already running')
    await tx.insert(backupJobs).values({ id, userId, operation: 'restore', originalName: upload.originalName, archiveSizeBytes: upload.sizeBytes })
    await tx.update(restoreUploads).set({ status: 'queued', updatedAt: new Date() }).where(eq(restoreUploads.id, id))
    return true
  })
  // Stable BullMQ IDs make completion retryable if the response or enqueue is
  // lost. Cleanup also reconciles queued uploads after an API crash.
  if (shouldEnqueue) await maintenanceQueue.add('restore', { type: 'restore', payload: { jobId: id } }, { jobId: `restore-${id}` })
  return { id, status: 'queued' }
}

export async function openRestoreUpload(id: string): Promise<Readable> {
  const [upload] = await db.select().from(restoreUploads).where(eq(restoreUploads.id, id))
  if (!upload || upload.status !== 'queued') throw new Error('Restore upload is unavailable')
  return Readable.from((async function* () {
    for (let index = 0; index < Math.ceil(upload.sizeBytes / RESTORE_CHUNK_SIZE); index++) {
      const part = upload.parts[index]
      if (!part) throw new Error('Backup chunk is missing')
      const hash = createHash('sha256'); let size = 0
      const source = await getBlobStore().getStream(chunkKey(id, index))
      try {
        for await (const chunk of source) { hash.update(chunk); size += chunk.length; yield chunk }
      } finally { source.destroy() }
      if (size !== part.size || hash.digest('hex') !== part.checksum) throw new Error(`Backup chunk ${index + 1} failed integrity verification`)
    }
  })())
}

export async function finishRestoreUpload(id: string): Promise<void> {
  await db.update(restoreUploads).set({ status: 'finished', expiresAt: expiry(), updatedAt: new Date() }).where(eq(restoreUploads.id, id))
}

export async function discardRestoreUpload(id: string, userId?: string, expiredOnly = false): Promise<void> {
  await db.transaction(async (tx) => {
    const [upload] = await tx.select().from(restoreUploads).where(eq(restoreUploads.id, id)).for('update')
    if (!upload) return
    if (userId && upload.userId !== userId) throw notFound('Restore upload')
    if (expiredOnly && upload.expiresAt >= new Date()) return
    if (upload.status === 'queued') throw new AppError(409, 'restore_in_progress', 'This backup is queued for restore')
    // Include unacknowledged writes whose metadata transaction rolled back.
    for (let index = 0; index < Math.ceil(upload.sizeBytes / RESTORE_CHUNK_SIZE); index += 8) {
      await Promise.all(Array.from({ length: Math.min(8, Math.ceil(upload.sizeBytes / RESTORE_CHUNK_SIZE) - index) },
        (_, offset) => getBlobStore().delete(chunkKey(id, index + offset))))
    }
    await tx.delete(restoreUploads).where(eq(restoreUploads.id, id))
  })
}

export async function cleanupRestoreUploads(): Promise<void> {
  const queued = await db.select().from(restoreUploads).where(eq(restoreUploads.status, 'queued'))
  for (const upload of queued) {
    const [job] = await db.select().from(backupJobs).where(eq(backupJobs.id, upload.id))
    if (job && ['queued', 'in_progress'].includes(job.status)) {
      const queuedJob = await maintenanceQueue.getJob(`restore-${upload.id}`)
      const state = await queuedJob?.getState()
      if (state === 'failed' || (!queuedJob && job.status === 'in_progress')) {
        await db.update(backupJobs).set({ status: 'failed', error: 'Restore worker was interrupted. Check the instance before starting another restore.',
          expiresAt: new Date(Date.now() + 7 * 86_400_000), updatedAt: new Date(),
        }).where(and(eq(backupJobs.id, job.id), inArray(backupJobs.status, ['queued', 'in_progress'])))
        await finishRestoreUpload(upload.id)
        continue
      }
    }
    if (job?.status === 'queued') {
      await maintenanceQueue.add('restore', { type: 'restore', payload: { jobId: upload.id } }, { jobId: `restore-${upload.id}` })
    } else if (!job || ['failed', 'completed'].includes(job.status)) await finishRestoreUpload(upload.id)
  }
  const expired = await db.select({ id: restoreUploads.id }).from(restoreUploads).where(lt(restoreUploads.expiresAt, new Date()))
  for (const upload of expired) {
    // A queued/active restore owns its chunks until the worker finishes.
    try { await discardRestoreUpload(upload.id, undefined, true) } catch { /* Retain metadata for the next cleanup attempt. */ }
  }
}
