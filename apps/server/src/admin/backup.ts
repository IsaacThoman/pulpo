import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import tar from 'tar-stream'
import { eq, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { attachments, backupJobs, catalogIcons, users } from '../database/schema.js'
import { getBlobStore } from '../storage/index.js'
import { redis } from '../redis.js'
import { fillMissingUsernames } from '../profile/username.js'
import {
  applyFullBackupCompatibilityDefaults,
  FULL_BACKUP_EXPLICIT_COLUMNS,
  FULL_BACKUP_TABLES,
  OPTIONAL_TABLES_IN_LEGACY_BACKUPS,
  type FullBackupTable,
} from './backup-format.js'

const json = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item)
const checksum = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const checksumMatches = (value: Uint8Array, expected: string) => {
  const hash = createHash('sha256').update(value)
  return [hash.copy().digest('hex'), hash.copy().digest('base64url'), hash.digest('base64')].includes(expected)
}

async function tarBytes(entries: Array<{ name: string; body: Uint8Array }>): Promise<Uint8Array> {
  const pack = tar.pack(); const chunks: Buffer[] = []
  pack.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  const done = new Promise<void>((resolve, reject) => { pack.on('end', resolve); pack.on('error', reject) })
  for (const entry of entries) await new Promise<void>((resolve, reject) => pack.entry({ name: entry.name, size: entry.body.byteLength, mode: 0o600 }, Buffer.from(entry.body), (error) => error ? reject(error) : resolve()))
  pack.finalize(); await done
  return gzipSync(Buffer.concat(chunks))
}

async function untarBytes(value: Uint8Array): Promise<Map<string, Uint8Array>> {
  const extract = tar.extract(); const files = new Map<string, Uint8Array>()
  const done = new Promise<void>((resolve, reject) => { extract.on('finish', resolve); extract.on('error', reject) })
  extract.on('entry', (header, stream, next) => { const chunks: Buffer[] = []; stream.on('data', (chunk) => chunks.push(Buffer.from(chunk))); stream.on('end', () => { files.set(header.name, Buffer.concat(chunks)); next() }); stream.resume() })
  extract.end(gunzipSync(value)); await done; return files
}

export async function createFullBackup(jobId: string): Promise<void> {
  const [job] = await db.select().from(backupJobs).where(eq(backupJobs.id, jobId)).limit(1)
  if (!job) return
  await db.update(backupJobs).set({ status: 'in_progress', progress: 1, updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
  try {
    const database: Record<string, unknown[]> = {}
    for (const [index, table] of FULL_BACKUP_TABLES.entries()) {
      const columns = FULL_BACKUP_EXPLICIT_COLUMNS[table]
      database[table] = [...await db.execute(sql.raw(`select ${columns?.join(', ') ?? '*'} from ${table}`))] as unknown[]
      await db.update(backupJobs).set({ progress: Math.round(((index + 1) / FULL_BACKUP_TABLES.length) * 55), updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
    }
    const attachmentBlobRows = await db.select({ objectKey: attachments.objectKey, checksum: attachments.checksum }).from(attachments).where(eq(attachments.status, 'ready'))
    const avatarBlobRows = await db.select({ objectKey: users.avatarObjectKey }).from(users).where(sql`${users.avatarObjectKey} is not null`)
    const iconRows = await db.select().from(catalogIcons)
    const blobRows = [
      ...attachmentBlobRows,
      ...avatarBlobRows.map((avatar) => ({ objectKey: avatar.objectKey!, checksum: null })),
      ...iconRows.flatMap((icon) => [
        { objectKey: icon.originalObjectKey, checksum: icon.originalChecksum },
        { objectKey: icon.monochromeLightObjectKey, checksum: icon.monochromeLightChecksum },
        { objectKey: icon.monochromeDarkObjectKey, checksum: icon.monochromeDarkChecksum },
      ]),
    ]
    const entries: Array<{ name: string; body: Uint8Array }> = []
    const blobs: Array<{ entry: string; objectKey: string; checksum: string }> = []
    for (const [index, blob] of blobRows.entries()) {
      const body = await getBlobStore().get(blob.objectKey)
      const entry = `blobs/${Buffer.from(blob.objectKey).toString('base64url')}`
      entries.push({ name: entry, body }); blobs.push({ entry, objectKey: blob.objectKey, checksum: blob.checksum ?? checksum(body) })
      await db.update(backupJobs).set({ progress: 55 + Math.round(((index + 1) / Math.max(blobRows.length, 1)) * 35), updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
    }
    const manifest = { format: 'pulpo-instance-backup', version: 1, createdAt: new Date().toISOString(), tables: FULL_BACKUP_TABLES, blobs }
    entries.unshift({ name: 'manifest.json', body: Buffer.from(json(manifest)) }, { name: 'database.json', body: Buffer.from(json(database)) })
    const archive = await tarBytes(entries)
    const objectKey = `backups/${job.userId}/${job.id}.tar.gz`
    await getBlobStore().put(objectKey, archive, { contentType: 'application/gzip', contentLength: archive.byteLength, contentDisposition: 'attachment' })
    await db.update(backupJobs).set({ status: 'completed', progress: 100, objectKey, expiresAt: new Date(Date.now() + 7 * 86_400_000), updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
  } catch (error) {
    await db.update(backupJobs).set({ status: 'failed', error: error instanceof Error ? error.message : 'Backup failed', updatedAt: new Date() }).where(eq(backupJobs.id, jobId)); throw error
  }
}

export async function restoreFullBackup(jobId: string): Promise<void> {
  const [job] = await db.select().from(backupJobs).where(eq(backupJobs.id, jobId)).limit(1)
  if (!job?.objectKey) return
  await db.update(backupJobs).set({ status: 'in_progress', progress: 1, updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
  const stagedKeys: string[] = []
  try {
    const files = await untarBytes(await getBlobStore().get(job.objectKey))
    const manifest = JSON.parse(Buffer.from(files.get('manifest.json') ?? []).toString()) as { format: string; version: number; blobs: Array<{ entry: string; objectKey: string; checksum: string }> }
    const database = JSON.parse(Buffer.from(files.get('database.json') ?? []).toString()) as Record<string, Array<Record<string, unknown>>>
    if (manifest.format !== 'pulpo-instance-backup' || manifest.version !== 1) throw new Error('Unsupported backup manifest')
    const restoredAdmin = (database.users ?? []).find((user) => user.role === 'admin')
    if (!restoredAdmin) throw new Error('Backup must contain at least one administrator')
    const restoredAdminId = String(restoredAdmin.id ?? '')
    if (!restoredAdminId) throw new Error('Backup administrator is missing an id')
    // Backups created before management tokens were introduced remain valid;
    // they restore with no automation credentials.
    database.management_tokens ??= []
    database.catalog_icons ??= []
    // Older backups predate optional per-user two-factor authentication.
    database.user_totp_credentials ??= []
    database.two_factor_recovery_codes ??= []
    database.friendships ??= []
    database.user_blocks ??= []
    for (const table of OPTIONAL_TABLES_IN_LEGACY_BACKUPS) database[table] ??= []
    fillMissingUsernames(database.users ?? [])
    applyFullBackupCompatibilityDefaults(database)
    for (const table of FULL_BACKUP_TABLES) if (!Array.isArray(database[table])) throw new Error(`Backup is missing ${table}`)
    for (const [index, blob] of manifest.blobs.entries()) {
      const body = files.get(blob.entry); if (!body || !checksumMatches(body, blob.checksum)) throw new Error(`Blob checksum failed: ${blob.objectKey}`)
      const staged = `restored/${jobId}/${Buffer.from(blob.objectKey).toString('base64url')}`
      await getBlobStore().put(staged, body, { contentType: 'application/octet-stream', contentLength: body.byteLength }); stagedKeys.push(staged)
      for (const attachment of database.attachments ?? []) if (attachment.object_key === blob.objectKey) attachment.object_key = staged
      for (const user of database.users ?? []) if (user.avatar_object_key === blob.objectKey) user.avatar_object_key = staged
      for (const icon of database.catalog_icons ?? []) {
        for (const field of ['original_object_key', 'monochrome_light_object_key', 'monochrome_dark_object_key']) {
          if (icon[field] === blob.objectKey) icon[field] = staged
        }
      }
      await db.update(backupJobs).set({ progress: 5 + Math.round(((index + 1) / Math.max(manifest.blobs.length, 1)) * 35), updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
    }
    const oldAttachmentBlobs = await db.select({ key: attachments.objectKey }).from(attachments)
    const oldAvatarBlobs = await db.select({ key: users.avatarObjectKey }).from(users).where(sql`${users.avatarObjectKey} is not null`)
    const oldIconRows = await db.select().from(catalogIcons)
    const oldBlobs = [
      ...oldAttachmentBlobs,
      ...oldAvatarBlobs.map((avatar) => ({ key: avatar.key! })),
      ...oldIconRows.flatMap((icon) => [
        { key: icon.originalObjectKey },
        { key: icon.monochromeLightObjectKey },
        { key: icon.monochromeDarkObjectKey },
      ]),
    ]
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`truncate table ${[...FULL_BACKUP_TABLES].reverse().join(', ')} restart identity cascade`))
      for (const [index, table] of FULL_BACKUP_TABLES.entries()) {
        const rows = database[table]!
        if (rows.length) await insertBackupRows(tx, table, rows)
        if (table === 'users') {
          // Truncating users cascades to backup_jobs. Recreate the active job
          // under an administrator from the restored dataset so progress
          // updates do not block on the transaction's backup_jobs lock and the
          // completed restore remains visible after the temporary admin is gone.
          await tx.insert(backupJobs).values({
            ...job,
            userId: restoredAdminId,
            status: 'in_progress',
            progress: 40,
            error: null,
            updatedAt: new Date(),
          })
        }
        await tx.update(backupJobs).set({ progress: 40 + Math.round(((index + 1) / FULL_BACKUP_TABLES.length) * 55), updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
      }
    })
    await redis.flushdb()
    for (const blob of oldBlobs) await getBlobStore().delete(blob.key).catch(() => undefined)
    await db.update(backupJobs).set({ status: 'completed', progress: 100, updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
  } catch (error) {
    for (const key of stagedKeys) await getBlobStore().delete(key).catch(() => undefined)
    await db.update(backupJobs).set({ status: 'failed', error: error instanceof Error ? error.message : 'Restore failed', updatedAt: new Date() }).where(eq(backupJobs.id, jobId)); throw error
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
