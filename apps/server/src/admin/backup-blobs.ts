import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { and, eq, isNull, lt } from 'drizzle-orm'
import type { BackupSnapshotManifest } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { backupBlobs } from '../database/schema.js'
import { stageBackupBlob } from './backup-archive.js'
import { createAgeEncryptionStream } from './backup-encryption.js'
import type { B2BackupStore } from './b2-backup-store.js'
import { wholeSecondLock } from './backup-retention.js'

const DAY_MS = 86_400_000
/** Extending a lock costs one request per blob, so extend a little past the snapshot's own lock. */
const MAX_LOCK_SLACK_MS = 7 * DAY_MS
const BLOB_CONCURRENCY = 4

export interface OffsiteBlobDestination {
  endpoint: string
  bucket: string
  prefix: string
  recipient: string
  recipientFingerprint: string
}

export interface SnapshotBlobSource {
  objectKey: string
  checksum: string | null
}

export type SnapshotBlobEntry = BackupSnapshotManifest['blobs'][number]

type BackupBlobRow = typeof backupBlobs.$inferSelect

/** Normalize the hex, base64url, or base64 SHA-256 digests stored by different features. */
export function sha256Hex(checksum: string | null | undefined): string | null {
  if (!checksum) return null
  if (/^[0-9a-fA-F]{64}$/.test(checksum)) return checksum.toLowerCase()
  if (/^[A-Za-z0-9_-]{43}$/.test(checksum)) return Buffer.from(checksum, 'base64url').toString('hex')
  if (/^[A-Za-z0-9+/]{43}=$/.test(checksum)) return Buffer.from(checksum, 'base64').toString('hex')
  return null
}

/**
 * Lock target for blobs referenced by a snapshot locked until `lockedUntil`
 * with `retentionMs` of retention. It depends only on the snapshot, so a
 * retried job never asks for an earlier date than an attempt already applied.
 */
export function blobLockTarget(lockedUntil: Date, retentionMs: number): Date {
  const slack = Math.min(MAX_LOCK_SLACK_MS, Math.max(0, retentionMs))
  return wholeSecondLock(new Date(lockedUntil.getTime() + slack))
}

function isMissingObject(error: unknown): boolean {
  const name = error instanceof Error ? error.name : ''
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
  return name === 'NoSuchKey' || name === 'NotFound' || (status === 404 && name !== 'NoSuchBucket')
}

function inBucket(destination: Pick<OffsiteBlobDestination, 'endpoint' | 'bucket'>) {
  return and(eq(backupBlobs.storageEndpoint, destination.endpoint), eq(backupBlobs.storageBucket, destination.bucket))
}

/**
 * Upload each distinct blob once and keep it locked for at least as long as
 * every snapshot that references it. Retained snapshots therefore always find
 * their blobs: cleanup deletes a blob only after its lock, and so every
 * snapshot that referenced it, has expired.
 */
export async function ensureOffsiteBlobs(input: {
  jobId: string
  store: B2BackupStore
  destination: OffsiteBlobDestination
  lockedUntil: Date
  retentionMs: number
  sources: SnapshotBlobSource[]
  directory: string
  readSource: (objectKey: string) => Promise<Readable>
  onProgress?: (completed: number, total: number) => Promise<void>
  now?: () => Date
}): Promise<{ blobs: SnapshotBlobEntry[]; uploadedCount: number; uploadedBytes: number }> {
  const now = input.now ?? (() => new Date())
  const target = blobLockTarget(input.lockedUntil, input.retentionMs)
  const sources = [...new Map(input.sources.map(source => [source.objectKey, source])).values()]
  const byContent = new Map<string, Promise<BackupBlobRow>>()
  const entries: SnapshotBlobEntry[] = new Array(sources.length)
  let uploadedCount = 0, uploadedBytes = 0, completed = 0, staged = 0

  const live = (checksum: string) => and(
    inBucket(input.destination),
    eq(backupBlobs.storagePrefix, input.destination.prefix),
    eq(backupBlobs.recipientFingerprint, input.destination.recipientFingerprint),
    eq(backupBlobs.contentChecksum, checksum),
    isNull(backupBlobs.deletedAt),
  )

  /** Reuse an uploaded copy, extending its lock first when this snapshot outlives it. */
  async function reuse(checksum: string): Promise<BackupBlobRow | 'pending' | null> {
    return db.transaction(async (tx) => {
      // Cleanup locks the same row while deleting, so an object can never be
      // reused and deleted at the same time.
      const [row] = await tx.select().from(backupBlobs).where(live(checksum)).for('update').limit(1)
      if (!row) return null
      if (!row.uploadedAt) return 'pending'
      if (row.lockedUntil >= input.lockedUntil) return row
      let lockedUntil = target
      try {
        await input.store.extendRetention(row.objectKey, target)
      } catch (error) {
        if (isMissingObject(error)) {
          // Cleanup deleted the object but crashed before recording it. Remove
          // any remaining versions so nothing is left untracked, then replace it.
          await input.store.delete(row.objectKey)
          await tx.update(backupBlobs).set({ deletedAt: now(), updatedAt: now() }).where(eq(backupBlobs.id, row.id))
          return null
        }
        // An earlier attempt may have applied a later lock without recording it;
        // Backblaze then rejects this date as a shortening. Accept the real lock.
        const current = await input.store.retention(row.objectKey).catch(() => null)
        if (current?.mode !== 'COMPLIANCE' || current.retainUntil < input.lockedUntil) throw error
        lockedUntil = current.retainUntil
      }
      const [extended] = await tx.update(backupBlobs).set({ lockedUntil, updatedAt: now() })
        .where(eq(backupBlobs.id, row.id)).returning()
      return extended!
    })
  }

  /** Reserve the object key before uploading so an interrupted upload is still cleaned up. */
  async function reserve(checksum: string, sizeBytes: number): Promise<BackupBlobRow> {
    const [pending] = await db.select().from(backupBlobs).where(live(checksum)).limit(1)
    if (pending) {
      if (pending.uploadedAt) throw new Error('Backup blob was uploaded concurrently')
      // Resume an interrupted upload under its key, unless cleanup removed it meanwhile.
      const [updated] = await db.update(backupBlobs).set({
        sizeBytes, lockedUntil: pending.lockedUntil > target ? pending.lockedUntil : target, updatedAt: now(),
      }).where(and(eq(backupBlobs.id, pending.id), isNull(backupBlobs.deletedAt))).returning()
      if (updated) return updated
    }
    const [row] = await db.insert(backupBlobs).values({
      id: randomUUID(),
      storageEndpoint: input.destination.endpoint,
      storageBucket: input.destination.bucket,
      storagePrefix: input.destination.prefix,
      recipientFingerprint: input.destination.recipientFingerprint,
      contentChecksum: checksum,
      sizeBytes,
      objectKey: `${input.destination.prefix}/blobs/${randomUUID()}.age`,
      lockedUntil: target,
    }).returning()
    return row!
  }

  async function upload(checksum: string, path: string): Promise<BackupBlobRow> {
    const { size } = await stat(path)
    const row = await reserve(checksum, size)
    const encrypted = await createAgeEncryptionStream(createReadStream(path), size, input.destination.recipient)
    await input.store.putEncrypted(row.objectKey, encrypted.body, encrypted.sizeBytes, input.jobId, input.destination.recipientFingerprint, row.lockedUntil)
    await encrypted.checksum
    const [uploaded] = await db.update(backupBlobs).set({ uploadedAt: now(), updatedAt: now() })
      .where(eq(backupBlobs.id, row.id)).returning()
    uploadedCount += 1; uploadedBytes += size
    return uploaded!
  }

  async function resolve(source: SnapshotBlobSource): Promise<BackupBlobRow> {
    let checksum = sha256Hex(source.checksum)
    let path: string | undefined
    try {
      if (!checksum) {
        // Without a recorded digest the content must be read to identify it.
        path = join(input.directory, `snapshot-blob-${staged++}`)
        checksum = (await stageBackupBlob(path, await input.readSource(source.objectKey), null)).checksum
      }
      const known = byContent.get(checksum)
      if (known) return await known
      const stagedPath = path
      const content = checksum
      const pending = (async () => {
        const reused = await reuse(content)
        if (reused && reused !== 'pending') return reused
        let uploadPath = stagedPath
        if (!uploadPath) {
          uploadPath = join(input.directory, `snapshot-blob-${staged++}`)
          path = uploadPath
          // Verify the source still matches the digest the snapshot will record.
          await stageBackupBlob(uploadPath, await input.readSource(source.objectKey), content)
        }
        return upload(content, uploadPath)
      })()
      byContent.set(content, pending)
      return await pending
    } finally {
      if (path) await rm(path, { force: true })
    }
  }

  let next = 0, failed = false
  async function worker(): Promise<void> {
    while (!failed && next < sources.length) {
      const index = next++
      const source = sources[index]!
      const row = await resolve(source).catch((error: unknown) => {
        // Stop the other workers from starting new blobs once one has failed.
        failed = true
        throw error
      })
      entries[index] = { objectKey: source.objectKey, checksum: row.contentChecksum, sizeBytes: row.sizeBytes, storageKey: row.objectKey }
      completed += 1
      await input.onProgress?.(completed, sources.length)
    }
  }
  const workers = Array.from({ length: Math.min(BLOB_CONCURRENCY, sources.length) }, () => worker())
  // Wait for every worker so no upload is still running when the caller
  // removes the temporary directory, then report the first failure.
  const results = await Promise.allSettled(workers)
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) throw failure.reason
  return { blobs: entries, uploadedCount, uploadedBytes }
}

/** Delete blob copies whose lock, and therefore every snapshot that used them, has expired. */
export async function deleteUnlockedOffsiteBlobs(store: B2BackupStore, destination: Pick<OffsiteBlobDestination, 'endpoint' | 'bucket'>, now = new Date()): Promise<void> {
  // Ignore the prefix, like snapshot cleanup does, so changing it never strands old blobs.
  const expired = await db.select({ id: backupBlobs.id }).from(backupBlobs).where(and(
    inBucket(destination),
    isNull(backupBlobs.deletedAt),
    lt(backupBlobs.lockedUntil, now),
  ))
  for (const { id } of expired) {
    try {
      await db.transaction(async (tx) => {
        const [row] = await tx.select().from(backupBlobs).where(and(
          eq(backupBlobs.id, id), isNull(backupBlobs.deletedAt), lt(backupBlobs.lockedUntil, now),
        )).for('update', { skipLocked: true }).limit(1)
        if (!row) return
        await store.delete(row.objectKey)
        await tx.update(backupBlobs).set({ deletedAt: now, updatedAt: now }).where(eq(backupBlobs.id, id))
      })
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error', service: 'pulpo-worker', event: 'backup.blob_retention_delete_failed', blobId: id,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }
}
