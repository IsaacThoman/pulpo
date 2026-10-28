import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { Decrypter, generateIdentity, identityToRecipient } from 'age-encryption'
import tar from 'tar-stream'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backupSnapshotManifestSchema, type BackupSnapshotManifest } from '@pulpo/contracts'
import { db, queryClient } from '../database/client.js'
import * as schema from '../database/schema.js'
import { LocalBlobStore } from '../storage/local.js'
import { encryptSecret } from '../lib/crypto.js'
import { getConfig } from '../config.js'
import { FULL_BACKUP_TABLES } from './backup-format.js'
import { createFullBackup, restoreFullBackup } from './backup.js'
import { completeRestoreUpload, putRestoreChunk, startRestoreUpload } from './restore-uploads.js'
import { createOffsiteBackup, deleteUnlockedOffsiteBackups, runOffsiteBackupSchedule } from './backup-scheduler.js'

const context = vi.hoisted(() => ({
  store: undefined as LocalBlobStore | undefined,
  enqueue: vi.fn(async () => undefined),
  /** A Backblaze bucket with Compliance Object Lock, mirrored to disk like a downloaded bucket. */
  remote: new Map<string, { bytes: Buffer; jobId: string; recipientFingerprint: string; lockedUntil: Date }>(),
  mirror: '',
  calls: { put: [] as string[], extend: [] as string[], delete: [] as string[] },
  failPut: undefined as ((key: string) => boolean) | undefined,
  failDelete: undefined as ((key: string) => boolean) | undefined,
  /** Safety failures: deleting a locked object. */
  violations: [] as string[],
  /** Requests Backblaze rejects because they would shorten a lock. */
  shortened: [] as string[],
}))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => context.store! }))
vi.mock('../jobs.js', () => ({ maintenanceQueue: { add: context.enqueue, getJob: vi.fn(async () => undefined) } }))
vi.mock('./b2-backup-store.js', async () => {
  const { mkdir: makeDirectory, rm: remove, writeFile: write } = await import('node:fs/promises')
  const { dirname: parent, join: joinPath } = await import('node:path')
  return { B2BackupStore: class {
    async head(key: string) {
      const entry = context.remote.get(key)
      return entry ? { sizeBytes: entry.bytes.length, jobId: entry.jobId, recipientFingerprint: entry.recipientFingerprint } : null
    }
    async putEncrypted(key: string, body: AsyncIterable<Uint8Array>, size: number, jobId: string, recipientFingerprint: string, lockedUntil: Date) {
      const chunks = []; for await (const chunk of body) chunks.push(chunk)
      const bytes = Buffer.concat(chunks)
      if (size !== bytes.length) throw new Error('Ciphertext size mismatch')
      if (context.failPut?.(key)) throw new Error('Simulated upload failure')
      // A new version never shortens an existing version's lock.
      const previous = context.remote.get(key)
      context.remote.set(key, { bytes, jobId, recipientFingerprint, lockedUntil: previous && previous.lockedUntil > lockedUntil ? previous.lockedUntil : lockedUntil })
      context.calls.put.push(key)
      await makeDirectory(parent(joinPath(context.mirror, key)), { recursive: true })
      await write(joinPath(context.mirror, key), bytes)
    }
    async extendRetention(key: string, lockedUntil: Date) {
      const entry = context.remote.get(key)
      if (!entry) throw Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } })
      if (lockedUntil < entry.lockedUntil) {
        context.shortened.push(key)
        throw Object.assign(new Error('Compliance retention cannot be shortened'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })
      }
      entry.lockedUntil = lockedUntil
      context.calls.extend.push(key)
    }
    async retention(key: string) {
      const entry = context.remote.get(key)
      return entry ? { mode: 'COMPLIANCE', retainUntil: entry.lockedUntil } : null
    }
    async abortStaleUploads() { return 0 }
    async delete(key: string) {
      if (context.failDelete?.(key)) throw new Error('Simulated delete failure')
      const entry = context.remote.get(key)
      if (entry && entry.lockedUntil > new Date()) {
        context.violations.push(`deleted locked ${key}`)
        throw new Error('Object retention has not expired')
      }
      context.remote.delete(key)
      context.calls.delete.push(key)
      await remove(joinPath(context.mirror, key), { force: true })
    }
  } }
})
vi.mock('../redis.js', () => ({ redis: {} }))
vi.mock('../redis-keys.js', () => ({ deleteRedisKeysByPattern: vi.fn() }))
vi.mock('../chats/trash.js', () => ({ markExpiredChatsForPurge: vi.fn(), purgePendingChats: vi.fn() }))

const enabled = process.env.PULPO_BACKUP_SNAPSHOT_TESTS === 'true'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_backup_snapshot') throw new Error('Use the disposable pulpo_backup_snapshot database')
const DAY = 86_400_000
const T0 = new Date('2026-11-01T00:00:00.000Z')
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes)
let directory: string, userId: string, identity: string

interface AssembleModule {
  assembleSnapshot(options: {
    snapshotPath: string; identityPath: string; outputPath: string; blobs: { kind: 'directory'; path: string }
  }): Promise<{ blobs: number; storedObjects: number }>
}
// The operator CLI owns assembly. Import its source so this suite exercises
// the same code that rebuilds archives on the trusted machine.
const assembleModulePath = new URL('../../../cli/src/backup-assemble.ts', import.meta.url).href

async function configure(overrides: Record<string, unknown> = {}) {
  await db.insert(schema.applicationSettings).values({ key: 'backups', value: {
    enabled: false, endpoint: 'https://s3.us-west-004.backblazeb2.com', bucket: 'fixture', prefix: 'audit', keyId: 'fixture',
    encryptedApplicationKey: encryptSecret('fixture', getConfig().ENCRYPTION_KEY), recipient: await identityToRecipient(identity),
    intervalHours: 24, retentionDays: 30, fullArchiveIntervalDays: 0, nextRunAt: null, ...overrides,
  } }).onConflictDoUpdate({ target: schema.applicationSettings.key, set: { value: sql`excluded.value` } })
}

async function addFile(name: string, body: Buffer, checksum: string | null) {
  const objectKey = `users/${userId}/files/${randomUUID()}`
  await context.store!.put(objectKey, body, { contentType: 'application/octet-stream' })
  await db.insert(schema.fileNodes).values({ id: randomUUID(), ownerUserId: userId, kind: 'blob', name, objectKey, sizeBytes: body.length, checksum })
  return objectKey
}

async function snapshot() {
  const { id } = await createOffsiteBackup('manual', userId)
  await createFullBackup(id)
  const [job] = await db.select().from(schema.backupJobs).where(eq(schema.backupJobs.id, id))
  expect(job).toMatchObject({ status: 'completed', format: 'snapshot' })
  expect(job!.objectKey).toMatch(/\.snapshot\.tar\.gz\.age$/)
  return job!
}

async function readSnapshot(objectKey: string): Promise<{ manifest: BackupSnapshotManifest; entries: string[] }> {
  const decrypter = new Decrypter(); decrypter.addIdentity(identity)
  const plaintext = await decrypter.decrypt(context.remote.get(objectKey)!.bytes)
  const extract = tar.extract()
  const done = pipeline(Readable.from([plaintext]), createGunzip(), extract)
  const files = new Map<string, Buffer>()
  for await (const entry of extract) {
    const chunks: Buffer[] = []; for await (const chunk of entry) chunks.push(chunk as Buffer)
    files.set(entry.header.name, Buffer.concat(chunks))
  }
  await done
  return { manifest: backupSnapshotManifestSchema.parse(JSON.parse(files.get('manifest.json')!.toString('utf8'))), entries: [...files.keys()] }
}

/** Every snapshot that has not been deleted must still find all of its blobs. */
async function expectRetainedSnapshotsComplete() {
  const jobs = await db.select().from(schema.backupJobs).where(and(
    eq(schema.backupJobs.format, 'snapshot'), eq(schema.backupJobs.status, 'completed'), isNull(schema.backupJobs.deletedAt),
  ))
  for (const job of jobs) {
    const { manifest } = await readSnapshot(job.objectKey!)
    for (const blob of manifest.blobs) expect(context.remote.has(blob.storageKey), `${job.id} needs ${blob.storageKey}`).toBe(true)
  }
  expect(context.violations).toEqual([])
  expect(context.shortened).toEqual([])
}

async function assemble(objectKey: string) {
  const { assembleSnapshot } = await import(/* @vite-ignore */ assembleModulePath) as AssembleModule
  const identityPath = join(directory, `identity-${randomUUID()}.txt`)
  await writeFile(identityPath, `# created: fixture\n# public key: ignored\n${identity}\n`, { mode: 0o600 })
  const outputPath = join(directory, `assembled-${randomUUID()}.tar.gz`)
  const result = await assembleSnapshot({
    snapshotPath: join(context.mirror, objectKey), identityPath, outputPath, blobs: { kind: 'directory', path: context.mirror },
  })
  return { bytes: await readFile(outputPath), result }
}

async function restore(bytes: Uint8Array) {
  const id = randomUUID(), fingerprint = digest(bytes).digest('hex')
  await startRestoreUpload(userId, { id, originalName: 'backup.tar.gz', sizeBytes: bytes.byteLength, fingerprint })
  await putRestoreChunk(id, userId, 0, fingerprint, bytes)
  await completeRestoreUpload(id, userId)
  await restoreFullBackup(id)
  return id
}

const liveBlobs = () => db.select().from(schema.backupBlobs).where(isNull(schema.backupBlobs.deletedAt))

describe.skipIf(!enabled)('incremental offsite snapshots with PostgreSQL', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    await db.execute(sql`set client_min_messages = warning`)
    await db.execute(sql.raw(`truncate ${FULL_BACKUP_TABLES.join(', ')}, restore_uploads, backup_jobs, backup_blobs restart identity cascade`))
    directory = await mkdtemp(join(tmpdir(), 'pulpo-snapshot-audit-'))
    context.mirror = join(directory, 'bucket')
    await mkdir(context.mirror)
    context.store = new LocalBlobStore(join(directory, 'primary'))
    context.enqueue.mockReset(); context.enqueue.mockResolvedValue(undefined)
    context.remote.clear(); context.violations = []; context.shortened = []; context.failPut = undefined; context.failDelete = undefined
    context.calls = { put: [], extend: [], delete: [] }
    identity = await generateIdentity()
    userId = randomUUID()
    await db.insert(schema.users).values({ id: userId, name: 'Snapshot auditor', email: 'snapshot@example.test', username: 'snapshot', role: 'admin' })
    await configure()
  })
  afterEach(async () => {
    vi.useRealTimers()
    if (directory) await rm(directory, { recursive: true, force: true })
  })
  afterAll(async () => { await queryClient.end() })

  it('uploads each distinct blob once, shares it across snapshots, and assembles a restorable archive', async () => {
    const shared = Buffer.from('identical attachment bytes'), legacy = Buffer.from('legacy file without a digest')
    const encoded = Buffer.from('file with a base64 digest'), avatar = Buffer.from('avatar image')
    const sharedA = await addFile('shared-a.txt', shared, digest(shared).digest('base64url'))
    const sharedB = await addFile('shared-b.txt', shared, digest(shared).digest('hex'))
    await addFile('legacy.bin', legacy, null)
    await addFile('encoded.bin', encoded, digest(encoded).digest('base64'))
    const avatarKey = `users/${userId}/avatar`
    await context.store!.put(avatarKey, avatar, { contentType: 'image/png' })
    await db.update(schema.users).set({ avatarObjectKey: avatarKey }).where(eq(schema.users.id, userId))

    const first = await snapshot()
    const blobs = await liveBlobs()
    expect(blobs).toHaveLength(4)
    expect(blobs.every(blob => blob.uploadedAt && blob.lockedUntil >= first.lockedUntil!)).toBe(true)
    expect(context.remote.size).toBe(5)
    const { manifest, entries } = await readSnapshot(first.objectKey!)
    expect(entries.sort()).toEqual(['database.json', 'manifest.json'])
    expect(manifest.blobs).toHaveLength(5)
    expect(manifest.blobs.find(blob => blob.objectKey === sharedA)!.storageKey).toBe(manifest.blobs.find(blob => blob.objectKey === sharedB)!.storageKey)
    for (const blob of manifest.blobs) {
      expect(blob.storageKey).toMatch(/^audit\/blobs\/[0-9a-f-]{36}\.age$/)
      expect(context.remote.get(blob.storageKey)!.bytes.toString('utf8', 0, 22)).toBe('age-encryption.org/v1\n')
    }

    vi.setSystemTime(new Date(T0.getTime() + 3_600_000))
    context.calls.put = []
    const second = await snapshot()
    expect(context.calls.put).toEqual([second.objectKey])
    expect(context.calls.extend).toEqual([])

    // Ten days later this snapshot outlives the first lock, so every reused blob is extended.
    vi.setSystemTime(new Date(T0.getTime() + 10 * DAY))
    const added = Buffer.from('added after the first snapshot')
    await addFile('added.txt', added, digest(added).digest('base64url'))
    context.calls.put = []
    const third = await snapshot()
    expect(context.calls.put).toHaveLength(2)
    expect(context.calls.put.at(-1)).toBe(third.objectKey)
    expect(context.calls.extend).toHaveLength(4)
    expect((await liveBlobs()).every(blob => blob.lockedUntil >= third.lockedUntil!)).toBe(true)
    await expectRetainedSnapshotsComplete()

    const { bytes, result } = await assemble(third.objectKey!)
    expect(result).toMatchObject({ blobs: 6, storedObjects: 5 })
    await restore(bytes)
    const restored = await db.select().from(schema.fileNodes)
    const expected = new Map([['shared-a.txt', shared], ['shared-b.txt', shared], ['legacy.bin', legacy], ['encoded.bin', encoded], ['added.txt', added]])
    expect(restored).toHaveLength(expected.size)
    for (const file of restored) expect(Buffer.from(await context.store!.get(file.objectKey!))).toEqual(expected.get(file.name))
    const [user] = await db.select().from(schema.users)
    expect(Buffer.from(await context.store!.get(user!.avatarObjectKey!))).toEqual(avatar)
  })

  it('deletes a blob only after every snapshot that references it has expired', async () => {
    const kept = Buffer.from('kept'), removed = Buffer.from('removed later')
    await addFile('kept.txt', kept, digest(kept).digest('hex'))
    const removedKey = await addFile('removed.txt', removed, digest(removed).digest('hex'))
    const first = await snapshot()
    const removedStorage = (await readSnapshot(first.objectKey!)).manifest.blobs.find(blob => blob.objectKey === removedKey)!.storageKey

    vi.setSystemTime(new Date(T0.getTime() + 20 * DAY))
    await db.delete(schema.fileNodes).where(eq(schema.fileNodes.objectKey, removedKey))
    const second = await snapshot()
    const keptStorage = (await readSnapshot(second.objectKey!)).manifest.blobs[0]!.storageKey

    for (const day of [25, 31, 36, 38, 45, 51, 56, 58]) {
      vi.setSystemTime(new Date(T0.getTime() + day * DAY))
      await deleteUnlockedOffsiteBackups(new Date())
      await expectRetainedSnapshotsComplete()
      if (day === 31) expect(context.remote.has(first.objectKey!)).toBe(false)
      if (day === 36) expect(context.remote.has(removedStorage)).toBe(true)
      if (day === 38) expect(context.remote.has(removedStorage)).toBe(false)
      if (day === 51) expect(context.remote.has(second.objectKey!)).toBe(false)
      if (day === 56) expect(context.remote.has(keptStorage)).toBe(true)
    }
    expect(context.remote.size).toBe(0)
    expect(await liveBlobs()).toEqual([])
  })

  it('replaces a vanished copy and resumes an interrupted upload under the same key', async () => {
    const body = Buffer.from('copy that disappears')
    await addFile('vanishing.txt', body, digest(body).digest('hex'))
    const first = await snapshot()
    const [original] = await liveBlobs()
    // After every lock expired, cleanup removed the object but crashed before recording it.
    vi.setSystemTime(new Date(T0.getTime() + 40 * DAY))
    await deleteUnlockedOffsiteBackups(new Date(T0.getTime() + 31 * DAY))
    expect(context.remote.has(first.objectKey!)).toBe(false)
    context.remote.delete(original!.objectKey)
    const second = await snapshot()
    const [replacement] = await liveBlobs()
    expect(replacement!.id).not.toBe(original!.id)
    expect((await db.select().from(schema.backupBlobs).where(eq(schema.backupBlobs.id, original!.id)))[0]!.deletedAt).not.toBeNull()
    expect((await readSnapshot(second.objectKey!)).manifest.blobs[0]!.storageKey).toBe(replacement!.objectKey)

    const late = Buffer.from('uploaded on the second attempt')
    await addFile('late.txt', late, digest(late).digest('base64url'))
    context.failPut = key => key.includes('/blobs/')
    const { id } = await createOffsiteBackup('manual', userId)
    await expect(createFullBackup(id, false)).rejects.toThrow('Simulated upload failure')
    expect((await db.select().from(schema.backupJobs).where(eq(schema.backupJobs.id, id)))[0]!.status).toBe('queued')
    const pending = (await liveBlobs()).find(blob => !blob.uploadedAt)!
    expect(pending).toBeDefined()
    context.failPut = undefined
    await createFullBackup(id)
    const resumed = (await db.select().from(schema.backupBlobs).where(eq(schema.backupBlobs.id, pending.id)))[0]!
    expect(resumed).toMatchObject({ objectKey: pending.objectKey, deletedAt: null })
    expect(resumed.uploadedAt).not.toBeNull()
    await expectRetainedSnapshotsComplete()
  })

  it('schedules a self-contained archive on the configured interval and snapshots in between', async () => {
    await addFile('scheduled.txt', Buffer.from('scheduled'), null)
    await configure({ enabled: true, fullArchiveIntervalDays: 7, nextRunAt: T0.toISOString() })
    const formats: string[] = []
    for (const day of [0, 1, 2, 8, 9]) {
      vi.setSystemTime(new Date(T0.getTime() + day * DAY + 60_000))
      await runOffsiteBackupSchedule(new Date())
      const [job] = await db.select().from(schema.backupJobs).where(eq(schema.backupJobs.status, 'queued'))
      expect(job!.objectKey!.endsWith(job!.format === 'snapshot' ? '.snapshot.tar.gz.age' : `${job!.id}.tar.gz.age`)).toBe(true)
      formats.push(job!.format)
      // A failed archive still counts, so it cannot starve snapshots.
      if (day === 0) await db.update(schema.backupJobs).set({ status: 'failed' }).where(eq(schema.backupJobs.id, job!.id))
      else await createFullBackup(job!.id)
    }
    expect(formats).toEqual(['archive', 'snapshot', 'snapshot', 'archive', 'snapshot'])
    const archive = (await db.select().from(schema.backupJobs).where(and(eq(schema.backupJobs.format, 'archive'), eq(schema.backupJobs.status, 'completed'))))[0]!
    const decrypter = new Decrypter(); decrypter.addIdentity(identity)
    await restore(await decrypter.decrypt(context.remote.get(archive.objectKey!)!.bytes))
    expect(await db.select().from(schema.fileNodes)).toHaveLength(1)
  })

  it('explains that a decrypted snapshot must be assembled before restore', async () => {
    await addFile('only.txt', Buffer.from('only'), null)
    const job = await snapshot()
    const decrypter = new Decrypter(); decrypter.addIdentity(identity)
    await expect(restore(await decrypter.decrypt(context.remote.get(job.objectKey!)!.bytes))).rejects.toThrow('pulpo backup assemble')
  })

  it('keeps tracking snapshots after an in-place restore so they expire with their blobs', async () => {
    const body = Buffer.from('survives restore')
    await addFile('kept.txt', body, digest(body).digest('hex'))
    const first = await snapshot()
    const { bytes } = await assemble(first.objectKey!)
    await restore(bytes)
    const tracked = await db.select().from(schema.backupJobs).where(eq(schema.backupJobs.id, first.id))
    expect(tracked).toMatchObject([{ status: 'completed', format: 'snapshot', userId, deletedAt: null }])

    for (const day of [20, 31, 38]) {
      vi.setSystemTime(new Date(T0.getTime() + day * DAY))
      await deleteUnlockedOffsiteBackups(new Date())
      await expectRetainedSnapshotsComplete()
    }
    expect(context.remote.size).toBe(0)
  })

  it('cleans up blobs stored under an earlier prefix', async () => {
    const body = Buffer.from('old prefix')
    await addFile('old.txt', body, digest(body).digest('hex'))
    await snapshot()
    await configure({ prefix: 'moved' })
    vi.setSystemTime(new Date(T0.getTime() + 38 * DAY))
    await deleteUnlockedOffsiteBackups(new Date())
    expect(context.remote.size).toBe(0)
    expect(await liveBlobs()).toEqual([])
  })

  it('accepts a later lock that an interrupted attempt applied but never recorded', async () => {
    const body = Buffer.from('extended twice')
    await addFile('twice.txt', body, digest(body).digest('hex'))
    await snapshot()
    const [blob] = await liveBlobs()
    // Backblaze holds a later lock than the database knows about.
    const actual = new Date(T0.getTime() + 90 * DAY)
    context.remote.get(blob!.objectKey)!.lockedUntil = actual
    vi.setSystemTime(new Date(T0.getTime() + 10 * DAY))
    const later = await snapshot()
    expect(context.shortened).toEqual([blob!.objectKey])
    const [recorded] = await liveBlobs()
    expect(recorded).toMatchObject({ id: blob!.id, lockedUntil: actual })
    expect(recorded!.lockedUntil >= later.lockedUntil!).toBe(true)
    context.shortened = []
    await expectRetainedSnapshotsComplete()
  })

  it('locks to whole seconds so stored dates match Object Lock exactly', async () => {
    vi.setSystemTime(new Date(T0.getTime() + 321))
    const body = Buffer.from('precise')
    await addFile('precise.txt', body, digest(body).digest('hex'))
    const job = await snapshot()
    const [blob] = await liveBlobs()
    expect(job.lockedUntil!.getTime() % 1_000).toBe(0)
    expect(blob!.lockedUntil.getTime() % 1_000).toBe(0)
  })

  it('keeps scheduling after restoring a backup whose schedule slot already ran', async () => {
    await addFile('scheduled.txt', Buffer.from('scheduled'), null)
    await configure({ enabled: true, nextRunAt: T0.toISOString() })
    const runScheduled = async (day: number, minute = 1) => {
      vi.setSystemTime(new Date(T0.getTime() + day * DAY + minute * 60_000))
      await runOffsiteBackupSchedule(new Date())
      const [job] = await db.select().from(schema.backupJobs).where(eq(schema.backupJobs.status, 'queued'))
      if (job) await createFullBackup(job.id)
      return job
    }
    const first = await runScheduled(0)
    const { bytes } = await assemble(first!.objectKey!)
    await runScheduled(1)
    // The restored settings point at the day-0 slot this instance already ran.
    await restore(bytes)
    expect(await runScheduled(1, 2)).toBeUndefined()
    // The next tick runs the overdue backup under a fresh slot instead of waiting a day.
    expect(await runScheduled(1, 3)).toMatchObject({ trigger: 'scheduled', status: 'queued' })
    expect(await runScheduled(2, 4)).toMatchObject({ trigger: 'scheduled' })
    expect(await db.select().from(schema.backupJobs).where(eq(schema.backupJobs.trigger, 'scheduled'))).toHaveLength(4)
    expect((await db.select().from(schema.backupJobs).where(eq(schema.backupJobs.trigger, 'scheduled'))).every(job => job.status === 'completed')).toBe(true)
  })

  it('restores in place with years of offsite history', async () => {
    await addFile('history.txt', Buffer.from('history'), null)
    const job = await snapshot()
    const { bytes } = await assemble(job.objectKey!)
    await db.execute(sql`insert into backup_jobs (id, user_id, operation, destination, format, trigger, status, object_key, storage_endpoint, storage_bucket, locked_until, deleted_at)
      select gen_random_uuid(), ${userId}, 'backup', 'backblaze_b2', 'snapshot', 'manual', 'completed', 'audit/old-' || n, ${job.storageEndpoint}, ${job.storageBucket}, ${T0.toISOString()}::timestamptz, ${T0.toISOString()}::timestamptz
      from generate_series(1, 3000) as n`)
    await restore(bytes)
    expect(await db.select({ id: schema.backupJobs.id }).from(schema.backupJobs).where(eq(schema.backupJobs.destination, 'backblaze_b2'))).toHaveLength(3001)
  })

  it('deletes an object that a failed final attempt left behind, keeping the failure as reported', async () => {
    const body = Buffer.from('uploaded then failed')
    await addFile('failed.txt', body, digest(body).digest('hex'))
    const job = await snapshot()
    const failedAt = new Date(T0.getTime() + 1_000)
    await db.update(schema.backupJobs).set({ status: 'failed', error: 'Lost the completion response', updatedAt: failedAt }).where(eq(schema.backupJobs.id, job.id))
    vi.setSystemTime(new Date(T0.getTime() + 38 * DAY))
    await deleteUnlockedOffsiteBackups(new Date())
    expect(context.remote.size).toBe(0)
    const [cleaned] = await db.select().from(schema.backupJobs).where(eq(schema.backupJobs.id, job.id))
    expect(cleaned).toMatchObject({ status: 'failed', error: 'Lost the completion response', updatedAt: failedAt })
    expect(cleaned!.deletedAt).not.toBeNull()
  })

  it('keeps blobs while an expired snapshot that uses them could not be deleted', async () => {
    const body = Buffer.from('held by a stuck snapshot')
    await addFile('held.txt', body, digest(body).digest('hex'))
    const job = await snapshot()
    vi.setSystemTime(new Date(T0.getTime() + 38 * DAY))
    context.failDelete = key => key === job.objectKey
    await deleteUnlockedOffsiteBackups(new Date())
    expect(context.remote.size).toBe(2)
    context.failDelete = undefined
    await deleteUnlockedOffsiteBackups(new Date())
    expect(context.remote.size).toBe(0)
  })

  it('refuses to upload a backup delayed past its retention window', async () => {
    await addFile('late.txt', Buffer.from('late'), null)
    const { id } = await createOffsiteBackup('manual', userId)
    vi.setSystemTime(new Date(T0.getTime() + 31 * DAY))
    await expect(createFullBackup(id)).rejects.toThrow('delayed past its retention window')
    expect(context.remote.size).toBe(0)
    expect((await db.select().from(schema.backupJobs).where(eq(schema.backupJobs.id, id)))[0]!.status).toBe('failed')
  })
})
