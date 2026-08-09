import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import tar from 'tar-stream'
import { eq, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { attachments, backupJobs } from '../database/schema.js'
import { getBlobStore } from '../storage/index.js'
import { redis } from '../redis.js'

const TABLES = [
  'labs', 'provider_connections', 'users', 'password_credentials', 'user_preferences', 'audit_events',
  'models', 'model_pricing_versions', 'model_presets', 'model_preset_choices', 'folders', 'chats', 'responses',
  'response_items', 'response_content_parts', 'chat_shares', 'attachments', 'memories', 'api_keys',
  'management_tokens', 'api_key_model_permissions', 'credit_ledger', 'usage_events', 'daily_usage_rollups', 'application_settings',
  'banners', 'request_logs', 'generation_attempts', 'ocr_attempts', 'ocr_cache_entries', 'chat_import_sources',
  'workspace_leases', 'agent_runs', 'tool_executions',
] as const

const json = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item)
const checksum = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')

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
    for (const [index, table] of TABLES.entries()) {
      database[table] = [...await db.execute(sql.raw(`select * from ${table}`))] as unknown[]
      await db.update(backupJobs).set({ progress: Math.round(((index + 1) / TABLES.length) * 55), updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
    }
    const blobRows = await db.select({ objectKey: attachments.objectKey, checksum: attachments.checksum }).from(attachments).where(eq(attachments.status, 'ready'))
    const entries: Array<{ name: string; body: Uint8Array }> = []
    const blobs: Array<{ entry: string; objectKey: string; checksum: string }> = []
    for (const [index, blob] of blobRows.entries()) {
      const body = await getBlobStore().get(blob.objectKey)
      const entry = `blobs/${Buffer.from(blob.objectKey).toString('base64url')}`
      entries.push({ name: entry, body }); blobs.push({ entry, objectKey: blob.objectKey, checksum: blob.checksum ?? checksum(body) })
      await db.update(backupJobs).set({ progress: 55 + Math.round(((index + 1) / Math.max(blobRows.length, 1)) * 35), updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
    }
    const manifest = { format: 'pulpo-instance-backup', version: 1, createdAt: new Date().toISOString(), tables: TABLES, blobs }
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
    if (!(database.users ?? []).some((user) => user.role === 'admin')) throw new Error('Backup must contain at least one administrator')
    // Backups created before management tokens were introduced remain valid;
    // they restore with no automation credentials.
    database.management_tokens ??= []
    for (const table of TABLES) if (!Array.isArray(database[table])) throw new Error(`Backup is missing ${table}`)
    for (const [index, blob] of manifest.blobs.entries()) {
      const body = files.get(blob.entry); if (!body || checksum(body) !== blob.checksum) throw new Error(`Attachment checksum failed: ${blob.objectKey}`)
      const staged = `restored/${jobId}/${Buffer.from(blob.objectKey).toString('base64url')}`
      await getBlobStore().put(staged, body, { contentType: 'application/octet-stream', contentLength: body.byteLength }); stagedKeys.push(staged)
      for (const attachment of database.attachments ?? []) if (attachment.object_key === blob.objectKey) attachment.object_key = staged
      await db.update(backupJobs).set({ progress: 5 + Math.round(((index + 1) / Math.max(manifest.blobs.length, 1)) * 35), updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
    }
    const oldBlobs = await db.select({ key: attachments.objectKey }).from(attachments)
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`truncate table ${[...TABLES].reverse().join(', ')} restart identity cascade`))
      for (const [index, table] of TABLES.entries()) {
        const rows = database[table]!
        if (rows.length) await tx.execute(sql`insert into ${sql.raw(table)} select * from json_populate_recordset(null::${sql.raw(table)}, ${json(rows)}::json)`)
        await db.update(backupJobs).set({ progress: 40 + Math.round(((index + 1) / TABLES.length) * 55), updatedAt: new Date() }).where(eq(backupJobs.id, jobId))
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
