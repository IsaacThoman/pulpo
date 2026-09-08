import { createHash, randomInt } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq, ne, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { attachments, backupJobs, catalogIcons, chats, queuedMessages, speechModels, users } from '../database/schema.js'
import { getBlobStore } from '../storage/index.js'
import { deleteRedisKeysByPattern } from '../redis-keys.js'
import { redis } from '../redis.js'
import { fillMissingUsernames } from '../profile/username.js'
import { markExpiredChatsForPurge, purgePendingChats } from '../chats/trash.js'
import {
  applyFullBackupCompatibilityDefaults,
  FULL_BACKUP_EXPLICIT_COLUMNS,
  FULL_BACKUP_TABLES,
  OPTIONAL_TABLES_IN_LEGACY_BACKUPS,
  type FullBackupTable,
} from './backup-format.js'
import { writeBackupArchive, type BackupArchiveEntry } from './backup-archive.js'
import { projectFullBackup, type FullBackupDatabase } from './backup-projection.js'
import { B2BackupStore } from './b2-backup-store.js'
import { ageRecipientDetails, readStoredBackupSettings, resolveBackupSettings } from './backup-settings.js'
import { createAgeEncryptionStream } from './backup-encryption.js'
import { extractRestoreArchive, readSmallRestoreTable, restoreBatches, restoreRows, splitRestoreDatabase, type RestoreRow } from './restore-archive.js'
import { finishRestoreUpload, openRestoreUpload } from './restore-uploads.js'

const json = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item)
const checksum = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')

export async function createFullBackup(jobId: string, finalAttempt = true): Promise<void> {
  const [job] = await db.select().from(backupJobs).where(eq(backupJobs.id, jobId)).limit(1)
  if (!job) return
  await db.update(backupJobs).set({ status: 'in_progress', progress: 1, updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
  const offsite = job.destination === 'backblaze_b2'
  const objectKey = offsite ? job.objectKey : `backups/${job.userId}/${job.id}.tar.gz`
  let temporaryDirectory: string | undefined
  let uploaded = false
  let offsiteStore: B2BackupStore | undefined
  let offsiteRecipient: string | undefined
  let offsiteRecipientFingerprint: string | undefined
  try {
    if (!objectKey) throw new Error('Backup object key is missing')
    if (offsite) {
      const settings = resolveBackupSettings(await readStoredBackupSettings())
      if (job.storageEndpoint !== settings.endpoint || job.storageBucket !== settings.bucket) {
        throw new Error('Backblaze destination changed while this backup was queued')
      }
      const recipient = ageRecipientDetails(settings.recipient)
      if (job.recipientFingerprint !== recipient.fingerprint) {
        throw new Error('Age recipient changed while this backup was queued')
      }
      if (!job.lockedUntil) throw new Error('Backup retention date is missing')
      offsiteStore = new B2BackupStore(settings)
      offsiteRecipient = settings.recipient
      offsiteRecipientFingerprint = recipient.fingerprint
      const existing = await offsiteStore.head(objectKey)
      if (existing) {
        if (existing.jobId !== job.id || existing.recipientFingerprint !== recipient.fingerprint) {
          throw new Error('Backblaze object key is already occupied by another backup')
        }
        await db.update(backupJobs).set({
          status: 'completed', progress: 100, archiveSizeBytes: existing.sizeBytes,
          completedAt: new Date(), error: null, updatedAt: new Date(),
        }).where(eq(backupJobs.id, jobId))
        return
      }
    }
    try {
      await markExpiredChatsForPurge(new Date())
      await purgePendingChats()
    } catch (error) {
      console.warn(JSON.stringify({
        level: 'warn', service: 'pulpo-worker', event: 'backup.preflight_chat_cleanup_failed', jobId,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'pulpo-backup-'))
    const archivePath = join(temporaryDirectory, `${job.id}.tar.gz`)
    const { database: rawDatabase, avatarBlobRows, iconRows, speechBlobRows, temporaryQueuedAttachmentRows } = await db.transaction(async (tx) => {
      const database: Record<string, unknown[]> = {}
      for (const [index, table] of FULL_BACKUP_TABLES.entries()) {
        const columns = FULL_BACKUP_EXPLICIT_COLUMNS[table]
        database[table] = [...await tx.execute(sql.raw(`select ${columns?.join(', ') ?? '*'} from ${table}`))] as unknown[]
        await db.update(backupJobs).set({ progress: Math.round(((index + 1) / FULL_BACKUP_TABLES.length) * 55), updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
      }
      return {
        database,
        avatarBlobRows: await tx.select({ objectKey: users.avatarObjectKey }).from(users).where(sql`${users.avatarObjectKey} is not null`),
        iconRows: await tx.select().from(catalogIcons),
        speechBlobRows: (await tx.select({ previews: speechModels.voicePreviews }).from(speechModels)).flatMap(row => row.previews),
        temporaryQueuedAttachmentRows: await tx.select({ attachmentIds: queuedMessages.attachmentIds })
          .from(queuedMessages).innerJoin(chats, eq(chats.id, queuedMessages.chatId)).where(eq(chats.temporary, true)),
      }
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
    const { database, attachmentBlobs } = projectFullBackup(rawDatabase as FullBackupDatabase, {
      temporaryQueuedAttachmentIds: temporaryQueuedAttachmentRows.flatMap((row) => row.attachmentIds),
    })
    const blobRows = [
      ...attachmentBlobs,
      ...speechBlobRows.map(row => ({ objectKey: row.objectKey!, checksum: row.checksum })),
      ...avatarBlobRows.map((avatar) => ({ objectKey: avatar.objectKey!, checksum: null })),
      ...iconRows.flatMap((icon) => [
        { objectKey: icon.originalObjectKey, checksum: icon.originalChecksum },
        { objectKey: icon.monochromeLightObjectKey, checksum: icon.monochromeLightChecksum },
        { objectKey: icon.monochromeDarkObjectKey, checksum: icon.monochromeDarkChecksum },
      ]),
    ]
    async function* archiveEntries(): AsyncGenerator<BackupArchiveEntry> {
      const blobs: Array<{ entry: string; objectKey: string; checksum: string }> = []
      const includedKeys = new Set<string>()
      yield { name: 'database.json', body: Buffer.from(json(database)) }
      for (const [index, blob] of blobRows.entries()) {
        if (includedKeys.has(blob.objectKey)) continue
        includedKeys.add(blob.objectKey)
        const body = await getBlobStore().get(blob.objectKey)
        const entry = `blobs/${Buffer.from(blob.objectKey).toString('base64url')}`
        blobs.push({ entry, objectKey: blob.objectKey, checksum: blob.checksum ?? checksum(body) })
        yield { name: entry, body }
        await db.update(backupJobs).set({ progress: 55 + Math.round(((index + 1) / Math.max(blobRows.length, 1)) * 35), updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
      }
      const manifest = { format: 'pulpo-instance-backup', version: 1, createdAt: new Date().toISOString(), tables: FULL_BACKUP_TABLES, blobs }
      yield { name: 'manifest.json', body: Buffer.from(json(manifest)) }
    }
    const { sizeBytes: archiveSizeBytes, checksum: archiveChecksum } = await writeBackupArchive(archivePath, archiveEntries())
    if (offsite) {
      if (!offsiteStore || !offsiteRecipient || !offsiteRecipientFingerprint || !job.lockedUntil) throw new Error('Offsite backup configuration is unavailable')
      const inputSize = (await stat(archivePath)).size
      const encrypted = await createAgeEncryptionStream(createReadStream(archivePath), inputSize, offsiteRecipient)
      await db.update(backupJobs).set({ progress: 92, updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
      await offsiteStore.putEncrypted(objectKey, encrypted.body, encrypted.sizeBytes, job.id, offsiteRecipientFingerprint, job.lockedUntil)
      uploaded = true
      await db.update(backupJobs).set({
        status: 'completed', progress: 100, archiveSizeBytes: encrypted.sizeBytes,
        archiveChecksum: await encrypted.checksum, completedAt: new Date(), error: null, updatedAt: new Date(),
      }).where(eq(backupJobs.id, jobId))
    } else {
      await getBlobStore().putStream(objectKey, createReadStream(archivePath), {
        contentType: 'application/gzip', contentLength: archiveSizeBytes, contentDisposition: 'attachment',
      })
      uploaded = true
      await db.update(backupJobs).set({
        status: 'completed', progress: 100, objectKey, archiveSizeBytes, archiveChecksum,
        expiresAt: new Date(Date.now() + 7 * 86_400_000), completedAt: new Date(), error: null, updatedAt: new Date(),
      }).where(eq(backupJobs.id, jobId))
    }
  } catch (error) {
    if (uploaded && !offsite && objectKey) await getBlobStore().delete(objectKey).catch(() => undefined)
    await db.update(backupJobs).set({
      status: finalAttempt ? 'failed' : 'queued',
      error: error instanceof Error ? error.message : 'Backup failed',
      updatedAt: new Date(),
    }).where(eq(backupJobs.id, jobId))
    throw error
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function restoreFullBackup(jobId: string): Promise<void> {
  const [job] = await db.select().from(backupJobs).where(eq(backupJobs.id, jobId)).limit(1)
  if (!job || job.status === 'completed') return
  await db.update(backupJobs).set({ status: 'in_progress', progress: 1, updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
  const stagedKeys: string[] = []
  let directory: string | undefined
  let committed = false
  let importStarted = false
  try {
    directory = await mkdtemp(join(tmpdir(), 'pulpo-restore-'))
    const source = job.objectKey ? await getBlobStore().getStream(job.objectKey) : await openRestoreUpload(jobId)
    const { files, manifest, databasePath } = await extractRestoreArchive(source, directory, {
      size: job.archiveSizeBytes, checksum: job.archiveChecksum,
    })
    const tables = await splitRestoreDatabase(databasePath, directory)
    const optional = new Set<string>([
      'management_tokens', 'catalog_icons', 'user_totp_credentials', 'two_factor_recovery_codes',
      'friendships', 'user_blocks', ...OPTIONAL_TABLES_IN_LEGACY_BACKUPS,
    ])
    for (const table of FULL_BACKUP_TABLES) if (!tables.has(table) && !optional.has(table)) throw new Error(`Backup is missing ${table}`)
    const usernames = new Set<string>()
    let restoredAdminId: string | undefined
    for await (const user of restoreRows(tables.get('users'))) {
      if (user.role === 'admin' && typeof user.id === 'string') restoredAdminId ??= user.id
      if (typeof user.username === 'string' && user.username.trim()) usernames.add(user.username.trim().toLowerCase())
    }
    if (!restoredAdminId) throw new Error('Backup must contain at least one administrator')
    const settings = await readSmallRestoreTable(tables.get('application_settings'))
    // Keep reference IDs/decisions only; detailed payloads stay on disk. This
    // preserves legacy logging defaults across separately streamed tables.
    const ocrPayloadLogs = new Set<string>()
    for await (const row of restoreRows(tables.get('ocr_attempts'))) {
      if (typeof row.request_log_id === 'string' && (row.request_payload != null || row.response_payload != null)) ocrPayloadLogs.add(row.request_log_id)
    }
    const logCapture = new Map<string, boolean>()
    const blobKeys = new Map<string, string>()
    for (const [index, blob] of manifest.blobs.entries()) {
      const file = files.get(blob.entry)!
      // Bound the filename even when the source key came from a previous
      // restore. Encoding the entire key grows it on every backup/restore cycle.
      const staged = `restored/${jobId}/${createHash('sha256').update(blob.objectKey).digest('hex')}`
      // Record before writing so even an interrupted/partially successful put
      // is included in rollback cleanup.
      stagedKeys.push(staged)
      await getBlobStore().putStream(staged, createReadStream(file.path), { contentType: 'application/octet-stream', contentLength: file.size })
      blobKeys.set(blob.objectKey, staged)
      await db.update(backupJobs).set({ progress: 5 + Math.round(((index + 1) / Math.max(manifest.blobs.length, 1)) * 35), updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
    }
    async function* compatibleRows(table: FullBackupTable): AsyncGenerator<RestoreRow> {
      for await (const row of restoreRows(tables.get(table))) {
        const data: Record<string, RestoreRow[]> = { [table]: [row], application_settings: settings }
        if (table === 'users' && !(typeof row.username === 'string' && row.username.trim())) {
          fillMissingUsernames([row], () => {
            let number: number
            do number = randomInt(1, 2_147_483_647)
            while (usernames.has(`pulpo${number}`))
            return number
          })
          usernames.add(String(row.username))
        }
        if (table === 'request_logs') {
          data.ocr_attempts = ocrPayloadLogs.has(String(row.id)) ? [{ request_log_id: row.id, request_payload: true }] : []
        }
        applyFullBackupCompatibilityDefaults(data)
        if (table === 'request_logs') logCapture.set(String(row.id), row.capture_detailed_payloads === true)
        if (table === 'ocr_attempts' && logCapture.get(String(row.request_log_id)) === false) {
          row.request_payload = null; row.response_payload = null
        }
        const blobFields = table === 'users' ? ['avatar_object_key'] : table === 'attachments' ? ['object_key']
          : table === 'speech_models' ? ['preview_object_key'] : table === 'catalog_icons' ? ['original_object_key', 'monochrome_light_object_key', 'monochrome_dark_object_key'] : []
        for (const field of blobFields) {
          if (row[field] == null) continue
          const replacement = blobKeys.get(String(row[field]))
          if (!replacement && table === 'attachments' && row.status !== 'ready') continue
          if (!replacement) throw new Error(`Backup is missing a blob referenced by ${table}`)
          row[field] = replacement
        }
        if (table === 'speech_models') {
          for (const clip of row.voice_previews as Array<{ objectKey: string }>) {
            const replacement = blobKeys.get(clip.objectKey)
            if (!replacement) throw new Error('Backup is missing a speech voice preview blob')
            clip.objectKey = replacement
          }
        }
        yield row
      }
    }
    const oldAttachmentBlobs = await db.select({ key: attachments.objectKey }).from(attachments)
    const oldAvatarBlobs = await db.select({ key: users.avatarObjectKey }).from(users).where(sql`${users.avatarObjectKey} is not null`)
    const oldIconRows = await db.select().from(catalogIcons)
    const oldSpeechBlobs = (await db.select({ previews: speechModels.voicePreviews }).from(speechModels)).flatMap(row => row.previews.map(clip => ({ key: clip.objectKey })))
    const oldBlobs = [
      ...oldAttachmentBlobs,
      ...oldSpeechBlobs.map(row => ({ key: row.key! })),
      ...oldAvatarBlobs.map((avatar) => ({ key: avatar.key! })),
      ...oldIconRows.flatMap((icon) => [
        { key: icon.originalObjectKey }, { key: icon.monochromeLightObjectKey }, { key: icon.monochromeDarkObjectKey },
      ]),
    ]
    importStarted = true
    await db.transaction(async (tx) => {
      await tx.delete(backupJobs).where(ne(backupJobs.id, jobId))
      await tx.execute(sql.raw(`truncate table ${[...FULL_BACKUP_TABLES].reverse().join(', ')} restart identity cascade`))
      for (const [index, table] of FULL_BACKUP_TABLES.entries()) {
        for await (const batch of restoreBatches(compatibleRows(table))) await insertBackupRows(tx, table, batch)
        if (table === 'users') {
          await tx.insert(backupJobs).values({ ...job, userId: restoredAdminId!, status: 'in_progress', progress: 40, error: null, updatedAt: new Date() })
        }
        await tx.update(backupJobs).set({ progress: 40 + Math.round(((index + 1) / FULL_BACKUP_TABLES.length) * 55), updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
      }
      // Persist the completion marker with the imported data. A worker crash
      // after COMMIT must not cause BullMQ to import the same backup again.
      await tx.update(backupJobs).set({ status: 'completed', progress: 100, completedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86_400_000), updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
    })
    committed = true
    // BullMQ shares Redis; preserve the active queue job when invalidating caches.
    await deleteRedisKeysByPattern(redis, 'pulpo:*')
    const restoredKeys = new Set(stagedKeys)
    for (const blob of oldBlobs) if (!restoredKeys.has(blob.key)) await getBlobStore().delete(blob.key).catch(() => undefined)
    await db.update(backupJobs).set({ status: 'completed', progress: 100, expiresAt: new Date(Date.now() + 7 * 86_400_000), updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
  } catch (error) {
    // Once committed, the new database owns these blobs. A cache/cleanup error
    // must never remove the successfully restored attachments.
    let safeToRemoveStaged = !importStarted
    if (importStarted && !committed) {
      try {
        const [persisted] = await db.select({ status: backupJobs.status }).from(backupJobs).where(eq(backupJobs.id, jobId))
        committed = persisted?.status === 'completed'
        safeToRemoveStaged = Boolean(persisted && !committed)
      } catch { /* An unknown COMMIT outcome must retain potentially live blobs. */ }
    }
    if (!committed && safeToRemoveStaged) for (const key of stagedKeys) await getBlobStore().delete(key).catch(() => undefined)
    await db.update(backupJobs).set({
      status: committed ? 'completed' : 'failed', progress: committed ? 100 : undefined,
      error: committed ? 'Data restored, but post-restore cleanup failed' : error instanceof Error ? error.message : 'Restore failed',
      expiresAt: new Date(Date.now() + 7 * 86_400_000), updatedAt: new Date(),
    }).where(committed ? eq(backupJobs.id, jobId) : and(eq(backupJobs.id, jobId), ne(backupJobs.status, 'completed')))
    throw error
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    if (!job.objectKey) await finishRestoreUpload(jobId).catch(() => undefined)
  }
}

async function insertBackupRows(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  table: FullBackupTable,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const columns = FULL_BACKUP_EXPLICIT_COLUMNS[table]
  if (!columns) {
    await tx.execute(sql`insert into ${sql.raw(table)} select * from json_populate_recordset(null::${sql.raw(table)}, ${json(rows)}::json)`)
    return
  }
  const columnList = columns.join(', ')
  await tx.execute(sql`insert into ${sql.raw(table)} (${sql.raw(columnList)})
    select ${sql.raw(columnList)} from json_populate_recordset(null::${sql.raw(table)}, ${json(rows)}::json)`)
}
