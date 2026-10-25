import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { eq, sql } from 'drizzle-orm'
import { generateIdentity, identityToRecipient } from 'age-encryption'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../database/client.js'
import * as schema from '../database/schema.js'
import { LocalBlobStore } from '../storage/local.js'
import { encryptSecret } from '../lib/crypto.js'
import { getConfig } from '../config.js'
import { FULL_BACKUP_TABLES } from './backup-format.js'
import { createFullBackup, restoreFullBackup } from './backup.js'
import { B2BackupStore } from './b2-backup-store.js'
import { resolveBackupSettings } from './backup-settings.js'
import { completeRestoreUpload, putRestoreChunk, startRestoreUpload } from './restore-uploads.js'
import { createOffsiteBackup } from './backup-scheduler.js'

/**
 * End to end against real S3 Object Lock (SeaweedFS in CI, or a B2 test
 * bucket): snapshots upload real objects, the built `pulpo` CLI downloads and
 * decrypts them over SigV4, and the assembled archive restores the instance.
 * Objects stay locked for the one-day minimum retention.
 */
const s3 = {
  endpoint: process.env.PULPO_BACKUP_S3_TEST_ENDPOINT,
  region: process.env.PULPO_BACKUP_S3_TEST_REGION ?? 'us-east-1',
  bucket: process.env.PULPO_BACKUP_S3_TEST_BUCKET ?? 'pulpo-backup-test',
  keyId: process.env.PULPO_BACKUP_S3_TEST_KEY_ID ?? '',
  key: process.env.PULPO_BACKUP_S3_TEST_KEY ?? '',
}
const context = vi.hoisted(() => ({ store: undefined as LocalBlobStore | undefined }))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => context.store! }))
vi.mock('../jobs.js', () => ({ maintenanceQueue: { add: vi.fn(async () => undefined), getJob: vi.fn(async () => undefined) } }))
vi.mock('../redis.js', () => ({ redis: {} }))
vi.mock('../redis-keys.js', () => ({ deleteRedisKeysByPattern: vi.fn() }))
vi.mock('../chats/trash.js', () => ({ markExpiredChatsForPurge: vi.fn(), purgePendingChats: vi.fn() }))
// Production accepts only Backblaze endpoints; point the resolved settings at the test server.
vi.mock('./backup-settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./backup-settings.js')>()
  return {
    ...actual,
    resolveBackupSettings: (settings: Parameters<typeof actual.resolveBackupSettings>[0]) => ({
      ...actual.resolveBackupSettings(settings),
      endpoint: process.env.PULPO_BACKUP_S3_TEST_ENDPOINT!,
      region: process.env.PULPO_BACKUP_S3_TEST_REGION ?? 'us-east-1',
    }),
  }
})

const enabled = process.env.PULPO_BACKUP_SNAPSHOT_TESTS === 'true' && Boolean(s3.endpoint)
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_backup_snapshot') throw new Error('Use the disposable pulpo_backup_snapshot database')
const cli = fileURLToPath(new URL('../../../cli/dist/index.js', import.meta.url))
const run = promisify(execFile)
let directory: string, userId: string, identity: string, prefix: string

async function addFile(name: string, body: Buffer, checksum: string | null) {
  const objectKey = `users/${userId}/files/${randomUUID()}`
  await context.store!.put(objectKey, body, { contentType: 'application/octet-stream' })
  await db.insert(schema.fileNodes).values({ id: randomUUID(), ownerUserId: userId, kind: 'blob', name, objectKey, sizeBytes: body.length, checksum })
}

async function snapshot() {
  const { id } = await createOffsiteBackup('manual', userId)
  await createFullBackup(id)
  const [job] = await db.select().from(schema.backupJobs).where(eq(schema.backupJobs.id, id))
  expect(job).toMatchObject({ status: 'completed', format: 'snapshot' })
  return job!
}

describe.skipIf(!enabled)('incremental snapshots end to end against S3 Object Lock', () => {
  beforeEach(async () => {
    await db.execute(sql`set client_min_messages = warning`)
    await db.execute(sql.raw(`truncate ${FULL_BACKUP_TABLES.join(', ')}, restore_uploads, backup_jobs, backup_blobs restart identity cascade`))
    directory = await mkdtemp(join(tmpdir(), 'pulpo-snapshot-s3-'))
    context.store = new LocalBlobStore(join(directory, 'primary'))
    identity = await generateIdentity()
    prefix = `${process.env.PULPO_BACKUP_S3_TEST_PREFIX ?? 'pulpo-test'}/${randomUUID()}`
    userId = randomUUID()
    await db.insert(schema.users).values({ id: userId, name: 'S3 auditor', email: 's3@example.test', username: 's3audit', role: 'admin' })
    await db.insert(schema.applicationSettings).values({ key: 'backups', value: {
      enabled: false, endpoint: 'https://s3.us-west-004.backblazeb2.com', bucket: s3.bucket, prefix, keyId: s3.keyId,
      encryptedApplicationKey: encryptSecret(s3.key, getConfig().ENCRYPTION_KEY), recipient: await identityToRecipient(identity),
      intervalHours: 24, retentionDays: 1, fullArchiveIntervalDays: 0, nextRunAt: null,
    } })
  })
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })
  afterAll(async () => { await queryClient.end() })

  it('restores an instance from a snapshot assembled by the pulpo CLI over S3', async () => {
    if (!existsSync(cli)) throw new Error('Build the CLI first: npm run build -w @isaacthoman/pulpo')
    const shared = Buffer.from('shared over S3'), unique = Buffer.from('unique over S3')
    await addFile('one.txt', shared, createHash('sha256').update(shared).digest('base64url'))
    await addFile('two.txt', shared, null)
    await addFile('three.txt', unique, createHash('sha256').update(unique).digest('hex'))

    await snapshot()
    const second = await snapshot()
    const client = new S3Client({
      endpoint: s3.endpoint, region: s3.region, forcePathStyle: true, credentials: { accessKeyId: s3.keyId, secretAccessKey: s3.key },
    })
    const listed = await client.send(new ListObjectsV2Command({ Bucket: s3.bucket, Prefix: `${prefix}/blobs/` }))
    expect(listed.KeyCount).toBe(2)

    // Download the snapshot as an administrator would from Pulpo or Backblaze.
    const settings = resolveBackupSettings((await db.select().from(schema.applicationSettings))[0]!.value as never)
    const snapshotPath = join(directory, 'snapshot.tar.gz.age')
    await pipeline((await new B2BackupStore(settings).getStream(second.objectKey!)).body, createWriteStream(snapshotPath))
    const identityPath = join(directory, 'identity.txt')
    await writeFile(identityPath, `${identity}\n`, { mode: 0o600 })
    const outputPath = join(directory, 'restorable.tar.gz')
    const { stdout } = await run(process.execPath, [
      cli, '--json', 'backup', 'assemble', snapshotPath, '--identity', identityPath, '--output', outputPath,
      '--endpoint', s3.endpoint!, '--bucket', s3.bucket, '--region', s3.region,
    ], { env: { ...process.env, B2_APPLICATION_KEY_ID: s3.keyId, B2_APPLICATION_KEY: s3.key } })
    expect(JSON.parse(stdout)).toMatchObject({ blobs: 3, storedObjects: 2 })

    const bytes = await readFile(outputPath), fingerprint = createHash('sha256').update(bytes).digest('hex')
    const restoreId = randomUUID()
    await startRestoreUpload(userId, { id: restoreId, originalName: 'restorable.tar.gz', sizeBytes: bytes.byteLength, fingerprint })
    await putRestoreChunk(restoreId, userId, 0, fingerprint, bytes)
    await completeRestoreUpload(restoreId, userId)
    await restoreFullBackup(restoreId)
    const restored = new Map((await db.select().from(schema.fileNodes)).map(file => [file.name, file.objectKey!]))
    expect(Buffer.from(await context.store!.get(restored.get('one.txt')!))).toEqual(shared)
    expect(Buffer.from(await context.store!.get(restored.get('two.txt')!))).toEqual(shared)
    expect(Buffer.from(await context.store!.get(restored.get('three.txt')!))).toEqual(unique)
  }, 120_000)
})
