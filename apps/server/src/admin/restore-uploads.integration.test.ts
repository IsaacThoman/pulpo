import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../database/client.js'
import { attachments, backupJobs, chats, chatTurnEmbeddings, episodicMemoryGenerations, models, providerConnections, responses, restoreUploads, users } from '../database/schema.js'
import { LocalBlobStore } from '../storage/local.js'
import { AppError } from '../lib/errors.js'
import { FULL_BACKUP_TABLES } from './backup-format.js'
import { createFullBackup, restoreFullBackup } from './backup.js'
import { writeBackupArchive } from './backup-archive.js'
import { registerRestoreUploadRoutes } from './restore-upload-routes.js'
import { cleanupRestoreUploads, completeRestoreUpload, discardRestoreUpload, finishRestoreUpload, openRestoreUpload, putRestoreChunk, readRestoreUpload, RESTORE_CHUNK_SIZE, startRestoreUpload } from './restore-uploads.js'

const context = vi.hoisted(() => ({
  store: undefined as LocalBlobStore | undefined,
  enqueue: vi.fn(async () => undefined), scan: vi.fn(async (): Promise<[string, string[]]> => ['0', []]),
  getJob: vi.fn(async (): Promise<{ getState(): Promise<string> } | undefined> => undefined),
}))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => context.store! }))
vi.mock('../jobs.js', () => ({ maintenanceQueue: { add: context.enqueue, getJob: context.getJob } }))
vi.mock('../redis.js', () => ({ redis: { scan: context.scan, unlink: vi.fn() } }))
vi.mock('../chats/trash.js', () => ({ markExpiredChatsForPurge: vi.fn(), purgePendingChats: vi.fn() }))
vi.mock('../auth/service.js', () => ({ requireAdmin: (request: { headers: Record<string, string> }) => {
  const id = request.headers['x-test-admin']
  if (!id) throw new AppError(403, 'forbidden', 'Administrator access required')
  return { id }
} }))

const enabled = process.env.PULPO_RESTORE_TESTS === 'true'
const checksum = (body: Uint8Array) => createHash('sha256').update(body).digest('hex')
let directory: string, userId: string
let app: FastifyInstance

async function start(body: Uint8Array, owner = userId) {
  return startRestoreUpload(owner, { id: randomUUID(), originalName: 'backup.tar.gz', sizeBytes: body.byteLength, fingerprint: checksum(body) })
}
async function upload(body: Uint8Array, owner = userId) {
  const session = await start(body, owner)
  for (let index = 0; index < Math.ceil(body.byteLength / RESTORE_CHUNK_SIZE); index++) {
    const part = body.subarray(index * RESTORE_CHUNK_SIZE, (index + 1) * RESTORE_CHUNK_SIZE)
    await putRestoreChunk(session.id, owner, index, checksum(part), part)
  }
  return session
}

describe.skipIf(!enabled)('restore uploads with PostgreSQL and filesystem storage', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_restore_test')) throw new Error('Use the disposable pulpo_restore_test database')
    await db.execute(sql.raw(`truncate ${FULL_BACKUP_TABLES.join(', ')}, restore_uploads cascade`))
    directory = await mkdtemp(join(tmpdir(), 'pulpo-upload-integration-'))
    context.store = new LocalBlobStore(directory)
    context.enqueue.mockReset(); context.enqueue.mockResolvedValue(undefined)
    context.getJob.mockReset(); context.getJob.mockResolvedValue(undefined)
    context.scan.mockReset(); context.scan.mockResolvedValue(['0', []])
    userId = randomUUID()
    await db.insert(users).values({ id: userId, name: 'Original', email: `${userId}@example.test`, username: 'original', role: 'admin' })
    app = Fastify()
    await app.register(multipart)
    app.setErrorHandler<FastifyError>((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error.statusCode ?? 400).send({ error: { message: error.message } }))
    await registerRestoreUploadRoutes(app)
  })
  afterEach(async () => { await app?.close(); if (directory) await rm(directory, { recursive: true, force: true }) })
  afterAll(async () => { await queryClient.end() })

  it('accepts concurrent out-of-order chunks and idempotent retries, then streams exact bytes', async () => {
    const body = randomBytes(RESTORE_CHUNK_SIZE + 37), session = await start(body)
    const a = body.subarray(0, RESTORE_CHUNK_SIZE), b = body.subarray(RESTORE_CHUNK_SIZE)
    await Promise.all([putRestoreChunk(session.id, userId, 1, checksum(b), b), putRestoreChunk(session.id, userId, 0, checksum(a), a)])
    await putRestoreChunk(session.id, userId, 0, checksum(a), a)
    expect(Object.keys((await readRestoreUpload(session.id, userId)).parts)).toHaveLength(2)
    await Promise.all([completeRestoreUpload(session.id, userId), completeRestoreUpload(session.id, userId)])
    const bytes = []
    for await (const part of await openRestoreUpload(session.id)) bytes.push(part)
    expect(checksum(Buffer.concat(bytes))).toBe(checksum(body))
    expect(await db.select().from(backupJobs).where(eq(backupJobs.id, session.id))).toHaveLength(1)
    expect(context.enqueue.mock.calls.every((call) => (call as unknown as unknown[])[0] === 'restore')).toBe(true)
  })
  it('rejects wrong owners, wrong sizes, invalid indices, checksums, and conflicting retries', async () => {
    const body = Buffer.from('archive'), session = await start(body)
    await expect(readRestoreUpload(session.id, randomUUID())).rejects.toMatchObject({ statusCode: 404 })
    await expect(putRestoreChunk(session.id, randomUUID(), 0, checksum(body), body)).rejects.toMatchObject({ statusCode: 404 })
    await expect(putRestoreChunk(session.id, userId, 1, checksum(body), body)).rejects.toMatchObject({ code: 'invalid_chunk' })
    await expect(putRestoreChunk(session.id, userId, 0, checksum(body), Buffer.from('a'))).rejects.toMatchObject({ code: 'chunk_checksum_failed' })
    await expect(putRestoreChunk(session.id, userId, 0, checksum(Buffer.from('a')), Buffer.from('a'))).rejects.toMatchObject({ code: 'chunk_size_mismatch' })
    await expect(completeRestoreUpload(session.id, userId)).rejects.toMatchObject({ code: 'upload_incomplete' })
    await putRestoreChunk(session.id, userId, 0, checksum(body), body)
    const changed = Buffer.from('changed')
    await expect(putRestoreChunk(session.id, userId, 0, checksum(changed), changed)).rejects.toMatchObject({ code: 'chunk_conflict' })
    await completeRestoreUpload(session.id, userId)
    await expect(discardRestoreUpload(session.id, userId)).rejects.toMatchObject({ code: 'restore_in_progress' })
  })
  it('requires admin authorization and explicit restore confirmation over HTTP', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/admin/restore/uploads', payload: {} })).statusCode).toBe(403)
    const session = await upload(Buffer.from('archive'))
    expect((await app.inject({ method: 'POST', url: `/api/admin/restore/uploads/${session.id}/complete`, headers: { 'x-test-admin': userId }, payload: {} })).statusCode).toBe(400)
    expect(context.enqueue).not.toHaveBeenCalled()
    const oversized = new FormData(); oversized.append('file', new Blob([Buffer.alloc(RESTORE_CHUNK_SIZE + 1)]))
    const request = new Request('http://test', { method: 'PUT', body: oversized })
    const result = await app.inject({ method: 'PUT', url: `/api/admin/restore/uploads/${session.id}/parts/0`,
      headers: { 'x-test-admin': userId, 'content-type': request.headers.get('content-type')!, 'x-chunk-sha256': 'a'.repeat(64) },
      payload: Buffer.from(await request.arrayBuffer()),
    })
    expect(result.statusCode).toBe(413)
  })
  it('recovers enqueue failure and retains queued uploads during cleanup', async () => {
    const session = await upload(Buffer.from('archive'))
    context.enqueue.mockRejectedValueOnce(new Error('redis disconnected'))
    await expect(completeRestoreUpload(session.id, userId)).rejects.toThrow('redis disconnected')
    await db.update(restoreUploads).set({ expiresAt: new Date(0) }).where(eq(restoreUploads.id, session.id))
    await cleanupRestoreUploads()
    expect(context.enqueue).toHaveBeenCalledTimes(2)
    expect((await readRestoreUpload(session.id, userId)).status).toBe('queued')
  })
  it('marks a stalled worker failure so it does not block future restores forever', async () => {
    const session = await upload(Buffer.from('archive'))
    await completeRestoreUpload(session.id, userId)
    await db.update(backupJobs).set({ status: 'in_progress' }).where(eq(backupJobs.id, session.id))
    context.getJob.mockResolvedValue({ getState: async () => 'failed' })
    await cleanupRestoreUploads()
    expect((await readRestoreUpload(session.id, userId)).job).toMatchObject({ status: 'failed', error: expect.stringContaining('interrupted') })
    expect((await readRestoreUpload(session.id, userId)).status).toBe('finished')
  })
  it('cleans expired chunks including unacknowledged object writes, without deleting renewed sessions', async () => {
    const body = Buffer.from('archive'), session = await start(body)
    await context.store!.put(`restore-chunks/${session.id}/0`, body, { contentType: 'application/octet-stream' })
    await discardRestoreUpload(session.id, undefined, true)
    expect(await context.store!.get(`restore-chunks/${session.id}/0`)).toEqual(body)
    await db.update(restoreUploads).set({ expiresAt: new Date(0) }).where(eq(restoreUploads.id, session.id))
    await expect(readRestoreUpload(session.id, userId)).rejects.toMatchObject({ statusCode: 410 })
    await cleanupRestoreUploads()
    await expect(context.store!.get(`restore-chunks/${session.id}/0`)).rejects.toThrow()
    expect(await db.select().from(restoreUploads)).toHaveLength(0)
  })
  it('rejects encrypted archives and stored corruption before modifying the instance', async () => {
    const age = Buffer.from('age-encryption.org/v1\nsecret'), encrypted = await start(age)
    await expect(putRestoreChunk(encrypted.id, userId, 0, checksum(age), age)).rejects.toMatchObject({ code: 'backup_must_be_decrypted' })
    const session = await upload(Buffer.from('not a backup'))
    await completeRestoreUpload(session.id, userId)
    await expect(restoreFullBackup(session.id)).rejects.toThrow()
    expect((await db.select().from(users))[0]?.name).toBe('Original')
    expect((await readRestoreUpload(session.id, userId)).job?.status).toBe('failed')
  })
  it('detects corruption of acknowledged chunks when the worker reads them', async () => {
    const session = await upload(Buffer.from('archive'))
    await completeRestoreUpload(session.id, userId)
    await context.store!.put(`restore-chunks/${session.id}/0`, Buffer.from('changed'), { contentType: 'application/octet-stream' })
    const consume = async () => { for await (const _chunk of await openRestoreUpload(session.id)) { /* Drain to verify final chunk checksum. */ } }
    await expect(consume()).rejects.toThrow('failed integrity verification')
  })
  it('rolls back the database and removes staged blobs if a later table fails to import', async () => {
    const database: Record<string, unknown[]> = {}
    for (const table of FULL_BACKUP_TABLES) database[table] = [...await db.execute(sql.raw(`select * from ${table}`))]
    const avatar = Buffer.from('new avatar')
    Object.assign(database.users![0]!, { name: 'Restored', avatar_object_key: 'new-avatar' })
    database.tool_executions = [{ id: randomUUID(), user_id: randomUUID() }]
    const manifest = { format: 'pulpo-instance-backup', version: 1, blobs: [{ entry: 'blobs/YQ', objectKey: 'new-avatar', checksum: checksum(avatar) }] }
    const path = join(directory, 'broken.tar.gz')
    await writeBackupArchive(path, (async function* () {
      yield { name: 'database.json', body: Buffer.from(JSON.stringify(database)) }
      yield { name: 'manifest.json', body: Buffer.from(JSON.stringify(manifest)) }
      yield { name: 'blobs/YQ', body: avatar }
    })())
    const session = await upload(await context.store!.get('broken.tar.gz'))
    await completeRestoreUpload(session.id, userId)
    await expect(restoreFullBackup(session.id)).rejects.toThrow()
    expect((await db.select().from(users))[0]).toMatchObject({ id: userId, name: 'Original', avatarObjectKey: null })
    await expect(context.store!.get(`restored/${session.id}/${checksum(Buffer.from('new-avatar'))}`)).rejects.toThrow()
    expect((await readRestoreUpload(session.id, userId)).job?.status).toBe('failed')
  })
  it('round-trips a real backup through chunks and streams, reassigning the job to the restored admin', async () => {
    const avatar = randomBytes(RESTORE_CHUNK_SIZE + 500)
    await context.store!.put('avatar/original', avatar, { contentType: 'image/png' })
    await db.update(users).set({ avatarObjectKey: 'avatar/original' }).where(eq(users.id, userId))
    await db.insert(attachments).values({ id: randomUUID(), userId, originalName: 'pending', mimeType: 'text/plain', sizeBytes: 1, objectKey: 'missing-pending', status: 'pending' })
    const backupId = randomUUID()
    await db.insert(backupJobs).values({ id: backupId, userId, operation: 'backup' })
    await createFullBackup(backupId)
    const [backup] = await db.select().from(backupJobs).where(eq(backupJobs.id, backupId))
    const archive = await context.store!.get(backup!.objectKey!)
    const temporaryAdmin = randomUUID()
    await db.insert(users).values({ id: temporaryAdmin, name: 'Temporary', email: 'temporary@example.test', username: 'temporary', role: 'admin' })
    await db.update(users).set({ name: 'Changed' }).where(eq(users.id, userId))
    const session = await upload(archive, temporaryAdmin)
    await completeRestoreUpload(session.id, temporaryAdmin)
    await restoreFullBackup(session.id)
    const [restored] = await db.select().from(users)
    expect(restored).toMatchObject({ id: userId, name: 'Original' })
    expect(checksum(await context.store!.get(restored!.avatarObjectKey!))).toBe(checksum(avatar))
    const [job] = await db.select().from(backupJobs).where(eq(backupJobs.id, session.id))
    expect(job).toMatchObject({ userId, status: 'completed', progress: 100 })
    await db.update(users).set({ name: 'After restore' }).where(eq(users.id, userId))
    await restoreFullBackup(session.id)
    expect((await db.select().from(users))[0]?.name).toBe('After restore')
    expect(await db.select().from(restoreUploads)).toHaveLength(1)
    await finishRestoreUpload(session.id)
    await discardRestoreUpload(session.id)
  }, 30_000)
  it('preserves restored blobs if cache invalidation fails after commit', async () => {
    await context.store!.put('avatar', Buffer.from('avatar'), { contentType: 'image/png' })
    await db.update(users).set({ avatarObjectKey: 'avatar' }).where(eq(users.id, userId))
    const backupId = randomUUID()
    await db.insert(backupJobs).values({ id: backupId, userId, operation: 'backup' })
    await createFullBackup(backupId)
    const [backup] = await db.select().from(backupJobs).where(eq(backupJobs.id, backupId))
    const session = await upload(await context.store!.get(backup!.objectKey!))
    await completeRestoreUpload(session.id, userId)
    context.scan.mockRejectedValueOnce(new Error('redis offline'))
    await expect(restoreFullBackup(session.id)).rejects.toThrow('redis offline')
    const [restored] = await db.select().from(users)
    expect(Buffer.from(await context.store!.get(restored!.avatarObjectKey!)).toString()).toBe('avatar')
    expect((await readRestoreUpload(session.id, userId)).job?.status).toBe('completed')
  })
  it('restores long object keys and repeated backups without growing filenames', async () => {
    const otherUser = randomUUID()
    await db.insert(users).values({ id: otherUser, name: 'Other', email: 'other@example.test', username: 'other' })
    const avatars = new Map([[userId, Buffer.from('first avatar')], [otherUser, Buffer.from('second avatar')]])
    for (const [id, body] of avatars) {
      const key = `restored/${randomUUID()}/${'a'.repeat(200)}${id}`
      await context.store!.put(key, body, { contentType: 'image/png' })
      await db.update(users).set({ avatarObjectKey: key }).where(eq(users.id, id))
    }
    for (let round = 0; round < 3; round++) {
      const backupId = randomUUID()
      await db.insert(backupJobs).values({ id: backupId, userId, operation: 'backup' })
      await createFullBackup(backupId)
      const [backup] = await db.select().from(backupJobs).where(eq(backupJobs.id, backupId))
      const session = await upload(await context.store!.get(backup!.objectKey!))
      await completeRestoreUpload(session.id, userId)
      await restoreFullBackup(session.id)
      const restored = await db.select().from(users)
      expect(new Set(restored.map((user) => user.avatarObjectKey)).size).toBe(2)
      for (const user of restored) {
        expect(user.avatarObjectKey).toMatch(new RegExp(`^restored/${session.id}/[a-f0-9]{64}$`))
        expect(await context.store!.get(user.avatarObjectKey!)).toEqual(avatars.get(user.id))
      }
      expect((await readRestoreUpload(session.id, userId)).job?.status).toBe('completed')
    }
  }, 30_000)
  it.each([true, false])('restores search indexes from a legacy=%s backup', async (legacy) => {
    const providerId = randomUUID(), chatId = randomUUID(), responseId = randomUUID(), generationId = randomUUID()
    await db.insert(providerConnections).values({ id: providerId, name: 'Test', encryptedApiKey: 'test' })
    await db.insert(models).values({ id: 'test-model', providerConnectionId: providerId, upstreamModelId: 'test', name: 'Test', contextWindow: 1024, maxOutputTokens: 100 })
    await db.insert(chats).values({ id: chatId, userId, modelId: 'test-model' })
    await db.insert(responses).values({ id: responseId, userId, chatId, modelId: 'test-model', input: [], status: 'completed' })
    await db.insert(episodicMemoryGenerations).values({ id: generationId, profile: 'embeddinggemma', model: 'test', dimension: 768, indexVersion: legacy ? 1 : 2 })
    for (const chunkIndex of legacy ? [0] : [0, 1]) {
      await db.insert(chatTurnEmbeddings).values({ id: randomUUID(), generationId, userId, chatId, responseId, chunkIndex, contentHash: `hash-${chunkIndex}`, chunkText: `search chunk ${chunkIndex}` })
    }
    const backupId = randomUUID()
    await db.insert(backupJobs).values({ id: backupId, userId, operation: 'backup' })
    await createFullBackup(backupId)
    const [backup] = await db.select().from(backupJobs).where(eq(backupJobs.id, backupId))
    let archive = await context.store!.get(backup!.objectKey!)
    if (legacy) {
      const database: Record<string, Record<string, unknown>[]> = {}
      for (const table of FULL_BACKUP_TABLES) database[table] = [...await db.execute(sql.raw(`select * from ${table}`))]
      for (const row of database.episodic_memory_generations!) delete row.index_version
      for (const row of database.chat_turn_embeddings!) { delete row.chunk_index; delete row.search_vector }
      await writeBackupArchive(join(directory, 'legacy-search.tar.gz'), (async function* () {
        yield { name: 'database.json', body: Buffer.from(JSON.stringify(database)) }
        yield { name: 'manifest.json', body: Buffer.from(JSON.stringify({ format: 'pulpo-instance-backup', version: 1, blobs: [] })) }
      })())
      archive = await context.store!.get('legacy-search.tar.gz')
    }
    const session = await upload(archive)
    await completeRestoreUpload(session.id, userId)
    await restoreFullBackup(session.id)
    expect((await db.select().from(episodicMemoryGenerations))[0]?.indexVersion).toBe(legacy ? 1 : 2)
    const chunks = await db.select().from(chatTurnEmbeddings).orderBy(chatTurnEmbeddings.chunkIndex)
    expect(chunks.map((row) => row.chunkIndex)).toEqual(legacy ? [0] : [0, 1])
    expect(chunks.every((row) => String(row.searchVector).includes('search'))).toBe(true)
  })
})
