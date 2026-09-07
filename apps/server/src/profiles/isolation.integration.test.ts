import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const storageMocks = vi.hoisted(() => ({ delete: vi.fn(async (_key: string) => undefined) }))
vi.mock('../jobs.js', () => ({
  maintenanceQueue: { add: vi.fn(async () => undefined) }, generationQueue: { add: vi.fn() },
  embeddingQueue: { add: vi.fn(), getJobs: vi.fn(async () => []) },
}))
vi.mock('../redis.js', () => ({ redis: { del: vi.fn(), publish: vi.fn(), get: vi.fn(async () => null), set: vi.fn(), incr: vi.fn(async () => 1), expire: vi.fn() } }))
vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn(), requestCancellation: vi.fn(async () => undefined), publishSessionRevocation: vi.fn() }))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({ delete: storageMocks.delete, createUploadUrl: vi.fn(async () => '/upload'), getMetadata: vi.fn(async () => ({ contentLength: 4 })) }) }))
vi.mock('../agent/controller-http.js', () => ({ workspaceControllerRequest: vi.fn(async () => ({ ok: true, status: 204 })) }))

import { db, queryClient } from '../database/client.js'
import { chats, folders, users, dataProfiles, userMemoryDocuments, attachments, models, providerConnections, responses, userProviderCredentials } from '../database/schema.js'
import { serializeUser } from '../auth/service.js'
import { AppError } from '../lib/errors.js'
import { registerChatRoutes } from '../chats/routes.js'
import { registerSettingsRoutes } from '../settings/routes.js'
import { registerAttachmentRoutes } from '../attachments/routes.js'
import { registerDataProfileRoutes, registerProfileContext, resolveProfile } from './service.js'
import { acceptProfileDeletion, deleteProfileData } from './deletion.js'
import { currentProfile, profileEq, withProfile } from './context.js'
import { mutateShelf } from '../shelf/routes.js'
import { accessComposer } from '../composer/service.js'
import { getStorageUsage } from '../attachments/storage-quota.js'
import { readMemoryDocument, updateMemoryDocument } from '../memory-document/service.js'

const enabled = process.env.PULPO_PROFILES_TESTS === '1'
if (enabled && !/^\/pulpo_profiles_(?:isolation_)?test$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error('Use the disposable pulpo_profiles_test database')
const app = Fastify()
let userId: string, workId: string, otherId: string

describe.skipIf(!enabled)('private profile isolation with PostgreSQL', () => {
  beforeAll(async () => {
    registerProfileContext(app)
    app.decorateRequest('user', null)
    app.decorateRequest('adminChatAccess', null)
    app.addHook('onRequest', async (request) => {
      const [user] = await db.select().from(users).where(eq(users.id, String(request.headers['test-user'] ?? userId)))
      request.user = serializeUser(user!)
    })
    app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 500).send({ error: { code: error instanceof AppError ? error.code : 'internal', message: error instanceof Error ? error.message : String(error) } }))
    await registerDataProfileRoutes(app)
    await registerSettingsRoutes(app)
    await registerChatRoutes(app)
    await registerAttachmentRoutes(app)
    await app.ready()
  })
  beforeEach(async () => {
    await db.execute(sql`truncate users, models, provider_connections, application_settings cascade`)
    userId = randomUUID(); otherId = randomUUID(); workId = randomUUID()
    for (const id of [userId, otherId]) await db.insert(users).values({ id, email: `${id}@example.test`, name: 'Test', username: id, role: 'user' })
    await db.insert(dataProfiles).values({ id: workId, userId, name: 'Work' })
    const providerId = randomUUID()
    await db.insert(providerConnections).values({ id: providerId, name: 'Test', encryptedApiKey: 'unused' })
    await db.insert(models).values({ id: 'profile-test-model', name: 'Test', providerConnectionId: providerId, upstreamModelId: 'test', contextWindow: 4096, maxOutputTokens: 1024 })
  })
  afterAll(async () => { await app.close(); await queryClient.end() })
  const request = (url: string, profileId?: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET', payload?: object) => app.inject({ url, method, payload, headers: profileId ? { 'x-pulpo-profile-id': profileId } : {} })
  async function addChat(profileId: string, title: string) {
    const result = await request('/api/chats', profileId, 'POST', { title, modelId: 'profile-test-model', autoExpire: false })
    expect(result.statusCode, result.body).toBe(201)
    return result.json().id as string
  }

  it('creates Personal automatically and gives new profiles fresh settings', async () => {
    expect(await resolveProfile(userId)).toEqual({ userId, profileId: userId })
    await request('/api/settings', userId, 'PATCH', { customInstructions: 'Personal secret' })
    const created = await request('/api/profiles', undefined, 'POST', { name: 'Study', color: '#0d9488' })
    expect(created.statusCode, created.body).toBe(201)
    const settings = await request('/api/settings', created.json().createdProfileId)
    expect(settings.json().values.customInstructions ?? '').toBe('')
    expect((await request('/api/settings')).json().values.customInstructions).toBe('Personal secret')
  })

  it('isolates lists, search, direct IDs, folder references, exports, and bulk trash', async () => {
    const personal = await addChat(userId, 'Personal-only secret')
    const work = await addChat(workId, 'Work-only secret')
    expect((await request('/api/chats', workId)).json().data.map((chat: { id: string }) => chat.id)).toEqual([work])
    expect((await request(`/api/chats/${personal}`, workId)).statusCode).toBe(404)
    expect((await request('/api/chats/search?q=Personal-only', workId)).body).not.toContain('Personal-only secret')
    expect((await request('/api/chats/export', workId)).body).not.toContain('Personal-only secret')
    const folderId = randomUUID()
    await db.insert(folders).values({ id: folderId, userId, profileId: userId, name: 'Personal' })
    expect((await request(`/api/chats/${work}`, workId, 'PATCH', { folderId })).statusCode).toBeGreaterThanOrEqual(400)
    await request('/api/chats', workId, 'DELETE')
    expect((await db.select().from(chats).where(eq(chats.id, personal)))[0]!.deletedAt).toBeNull()
    expect((await db.select().from(chats).where(eq(chats.id, work)))[0]!.deletedAt).not.toBeNull()
  })

  it('rejects foreign, malformed, and deleted profiles', async () => {
    expect((await request('/api/chats', otherId)).statusCode).toBe(404)
    expect((await request('/api/chats', 'invalid')).statusCode).toBe(400)
    await acceptProfileDeletion(userId, workId, 'Work')
    expect((await request('/api/settings', workId)).statusCode).toBe(404)
  })

  it('keeps settings, memory revisions, and new-chat composer scopes independent concurrently', async () => {
    const scopes = [userId, workId].map((profileId) => ({ userId, profileId }))
    await Promise.all(scopes.map((scope) => withProfile(scope, async () => {
      await updateMemoryDocument({ userId, content: scope.profileId, expectedRevision: 0, editor: 'user', summary: 'Seed' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(currentProfile()).toEqual(scope)
      expect((await readMemoryDocument(userId)).content).toBe(scope.profileId)
      expect((await accessComposer(userId, 'new')).ok).toBe(true)
    })))
    expect(await db.select().from(userMemoryDocuments)).toHaveLength(2)
    expect((await db.execute(sql`select * from composer_drafts`))).toHaveLength(2)
  })

  it('rejects cross-profile shelf IDs and composer attachment references', async () => {
    const draftId = randomUUID(), fileId = randomUUID()
    await db.insert(attachments).values({ id: fileId, userId, profileId: userId, originalName: 'personal.txt', mimeType: 'text/plain', sizeBytes: 4, objectKey: fileId, status: 'ready' })
    await withProfile({ userId, profileId: userId }, () => mutateShelf(userId, { operationId: randomUUID(), action: { type: 'save', draft: { id: draftId, content: 'Personal shelf', attachmentIds: [fileId] } } }))
    await expect(withProfile({ userId, profileId: workId }, () => mutateShelf(userId, { operationId: randomUUID(), action: { type: 'delete', id: draftId } }))).rejects.toThrow()
    const result = await withProfile({ userId, profileId: workId }, () => accessComposer(userId, 'new', { draftId: 'new', baseRevision: 0, mutationId: randomUUID(), patch: { attachments: [{ id: fileId, name: 'personal.txt', mimeType: 'text/plain', size: 4 }] } }))
    expect(result.ok).toBe(false)
    expect(await db.execute(sql`select * from shelved_draft_attachments where draft_id = ${draftId}::uuid`)).toHaveLength(1)
  })

  it('isolates attachment access but sums account storage across profiles', async () => {
    const id = randomUUID()
    await db.insert(attachments).values({ id, userId, profileId: userId, originalName: 'private.txt', mimeType: 'text/plain', sizeBytes: 4, objectKey: id, status: 'ready' })
    expect((await request(`/api/attachments/${id}/download`, workId)).statusCode).toBe(404)
    expect((await withProfile({ userId, profileId: workId }, () => getStorageUsage(userId))).usedBytes).toBe(4)
    await expect(db.insert(attachments).values({ id: randomUUID(), userId: otherId, profileId: workId, originalName: 'bad', mimeType: 'text/plain', sizeBytes: 1, objectKey: 'bad' })).rejects.toThrow()
  })

  it('binds child worker inserts to their parent and rejects cross-profile parents', async () => {
    const chatId = await addChat(workId, 'Work task')
    const id = randomUUID()
    await db.insert(responses).values({ id, chatId, userId, modelId: 'profile-test-model', input: [] })
    expect((await db.select().from(responses).where(eq(responses.id, id)))[0]!.profileId).toBe(workId)
    expect(await withProfile({ userId, profileId: userId }, () => db.select().from(responses).where(profileEq(responses.id, id)))).toEqual([])
    await expect(withProfile({ userId, profileId: userId }, () => db.insert(responses).values({ id: randomUUID(), chatId, userId, modelId: 'profile-test-model', input: [] }))).rejects.toThrow()
  })

  it('blocks retiring data immediately and retries cleanup after running work and storage failure', async () => {
    const personal = await addChat(userId, 'Keep personal')
    const work = await addChat(workId, 'Remove work')
    const responseId = randomUUID(), fileId = randomUUID()
    await db.insert(responses).values({ id: responseId, chatId: work, userId, profileId: workId, modelId: 'profile-test-model', input: [], status: 'in_progress' })
    await db.insert(attachments).values({ id: fileId, userId, profileId: workId, chatId: work, originalName: 'work.txt', mimeType: 'text/plain', sizeBytes: 4, objectKey: fileId, status: 'ready' })
    await withProfile({ userId, profileId: workId }, () => updateMemoryDocument({ userId, content: 'Work memory', expectedRevision: 0, editor: 'user', summary: 'Seed' }))
    await acceptProfileDeletion(userId, workId, 'Work')
    expect((await request(`/api/chats/${work}`, workId)).statusCode).toBe(404)
    await expect(deleteProfileData(workId)).rejects.toThrow('Waiting for running responses')
    await db.update(responses).set({ status: 'cancelled' }).where(eq(responses.id, responseId))
    await db.update(dataProfiles).set({ deletionRequestedAt: new Date(Date.now() - 17 * 60_000) }).where(eq(dataProfiles.id, workId))
    storageMocks.delete.mockRejectedValueOnce(new Error('Storage unavailable'))
    await expect(deleteProfileData(workId)).rejects.toThrow('Storage unavailable')
    expect((await db.select().from(dataProfiles).where(eq(dataProfiles.id, workId)))[0]!.deletionError).toBe('Storage unavailable')
    await deleteProfileData(workId)
    expect(await db.select().from(dataProfiles).where(eq(dataProfiles.id, workId))).toHaveLength(0)
    expect(await db.select().from(chats).where(eq(chats.id, personal))).toHaveLength(1)
    expect(await db.select().from(attachments).where(eq(attachments.id, fileId))).toHaveLength(0)
  })

  it('serializes concurrent deletions, reassigns the default, and preserves shared data', async () => {
    await db.insert(userProviderCredentials).values({ userId, providerId: 'test', encryptedCredential: 'shared' })
    const results = await Promise.allSettled([acceptProfileDeletion(userId, userId, 'Personal'), acceptProfileDeletion(userId, workId, 'Work')])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const remaining = (await request('/api/profiles')).json()
    expect(remaining.profiles).toHaveLength(1)
    expect((await resolveProfile(userId)).profileId).toBe(remaining.defaultProfileId)
    const deletedId = remaining.defaultProfileId === userId ? workId : userId
    await db.update(dataProfiles).set({ deletionRequestedAt: new Date(Date.now() - 17 * 60_000) }).where(eq(dataProfiles.id, deletedId))
    await deleteProfileData(deletedId)
    expect(await db.select().from(users).where(eq(users.id, userId))).toHaveLength(1)
    expect(await db.select().from(userProviderCredentials).where(eq(userProviderCredentials.userId, userId))).toHaveLength(1)
    await db.delete(users).where(eq(users.id, userId))
    expect(await db.select().from(dataProfiles).where(eq(dataProfiles.userId, userId))).toHaveLength(0)
  })
})
