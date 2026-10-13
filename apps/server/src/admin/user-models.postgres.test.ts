import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { eq, sql } from 'drizzle-orm'
import { ZodError } from 'zod'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ publish: vi.fn() }))
vi.mock('../responses/events.js', () => ({ publishStateChange: mocks.publish, publishSessionRevocation: vi.fn(), requestCancellation: vi.fn() }))
vi.mock('../jobs.js', () => ({ maintenanceQueue: { add: vi.fn() }, embeddingQueue: {}, generationQueue: {} }))
vi.mock('../redis.js', () => ({ redis: { del: vi.fn(), publish: vi.fn(), get: vi.fn(async () => null) } }))

import { AppError } from '../lib/errors.js'
import { db, queryClient } from '../database/client.js'
import { applicationSettings, auditEvents, modelPresetChoices, modelPresets, models, modelUserGrants, providerConnections, userPreferences, userProviderCredentials, users } from '../database/schema.js'
import { assertModelsAccessibleToUser } from '../catalog/model-access.js'
import { CODEX_PI_PROVIDER_ID, CODEX_PROVIDER_ID } from '../codex/constants.js'
import { registerCatalogRoutes } from '../catalog/routes.js'
import { registerSettingsRoutes } from '../settings/routes.js'
import { registerAdminRoutes } from './routes.js'
import { registerAdminSettingsRoutes } from './settings-routes.js'

// Run against a disposable, migrated database named pulpo_admin_model_test only.
const enabled = process.env.PULPO_ADMIN_MODEL_TESTS === 'true'
const adminId = randomUUID(), targetId = randomUUID(), providerId = randomUUID()
let app: FastifyInstance
let actorId: string | null
const patch = (body: unknown, id = targetId) => app.inject({ method: 'PATCH', url: `/api/admin/users/${id}`, payload: body as Record<string, unknown> })
const choices = (id = targetId) => app.inject(`/api/admin/users/${id}/models`)
async function preferences() {
  const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, targetId))
  return row
}
async function connect(userId: string) {
  await db.insert(userProviderCredentials).values({ userId, providerId: CODEX_PI_PROVIDER_ID, encryptedCredential: 'unused', status: 'connected' })
}

describe.skipIf(!enabled)('administrator default models with PostgreSQL', () => {
  beforeAll(async () => {
    const [database] = await queryClient`select current_database() as name`
    if (database?.name !== 'pulpo_admin_model_test') throw new Error('A disposable pulpo_admin_model_test database is required')
    app = Fastify()
    app.addHook('onRequest', async (request) => {
      const [actor] = actorId ? await db.select().from(users).where(eq(users.id, actorId)) : []
      Object.assign(request, { user: actor ?? null })
    })
    app.setErrorHandler((error, _request, reply) => {
      reply.code(error instanceof ZodError ? 400 : error instanceof AppError ? error.statusCode : 500)
        .send({ message: error instanceof Error ? error.message : 'Unknown error' })
    })
    await registerAdminRoutes(app)
    await registerCatalogRoutes(app)
    await registerSettingsRoutes(app)
    await registerAdminSettingsRoutes(app)
  })
  beforeEach(async () => {
    await db.execute(sql`truncate users, models, provider_connections, application_settings, audit_events cascade`)
    vi.clearAllMocks()
    actorId = adminId
    await db.insert(users).values([
      { id: adminId, name: 'Admin', username: 'admin', email: 'admin@example.test', role: 'admin' },
      { id: targetId, name: 'Target', username: 'target', email: 'target@example.test', role: 'user' },
    ])
    await db.insert(providerConnections).values([
      { id: providerId, name: 'Test', encryptedApiKey: 'unused' },
      { id: CODEX_PROVIDER_ID, name: 'Codex', encryptedApiKey: 'unused' },
    ])
    await db.insert(models).values([
      { id: 'available', name: 'Available', sortOrder: 1 },
      { id: 'second', name: 'Second', sortOrder: 2 },
      { id: 'hidden', name: 'Hidden', visible: false },
      { id: 'disabled', name: 'Disabled', enabled: false },
      { id: 'codex:test', name: 'Codex', providerConnectionId: CODEX_PROVIDER_ID, sortOrder: 3 },
    ].map((model) => ({ providerConnectionId: providerId, upstreamModelId: model.id, contextWindow: 4096, maxOutputTokens: 1024, ...model })))
    await db.insert(applicationSettings).values({ key: 'codex', value: { enabled: true } })
  })
  afterAll(async () => { await app?.close(); await queryClient.end() })

  it.each([null, targetId])('rejects a non-admin actor %s', async (id) => {
    actorId = id
    expect((await choices()).statusCode).toBe(id ? 403 : 401)
    expect((await patch({ defaultModelId: 'available' })).statusCode).toBe(id ? 403 : 401)
    expect(await preferences()).toBeUndefined()
  })

  it('uses the target’s connection and the same eligibility/order as their catalog', async () => {
    await connect(adminId)
    expect((await choices()).json().data.map((model: { id: string }) => model.id)).toEqual(['available', 'second'])
    expect((await patch({ defaultModelId: 'codex:test' })).statusCode).toBe(400)
    await db.delete(userProviderCredentials).where(eq(userProviderCredentials.userId, adminId))
    await connect(targetId)
    const eligible = (await choices()).json().data
    expect(eligible).toEqual([{ id: 'available', name: 'Available' }, { id: 'second', name: 'Second' }, { id: 'codex:test', name: 'Codex' }])
    expect((await patch({ defaultModelId: 'codex:test' })).statusCode).toBe(200)
    actorId = targetId
    const publicCatalog = await app.inject('/api/models')
    expect(publicCatalog.statusCode).toBe(200)
    expect(publicCatalog.json().data.map(({ id, name }: { id: string; name: string }) => ({ id, name }))).toEqual(eligible)
    actorId = adminId
    await db.update(applicationSettings).set({ value: { enabled: false } }).where(eq(applicationSettings.key, 'codex'))
    expect((await choices()).json().data.map((model: { id: string }) => model.id)).toEqual(['available', 'second'])
  })

  it('hides store-hidden models only from that store app’s catalog', async () => {
    const saved = await app.inject({ method: 'PATCH', url: '/api/admin/models/second', payload: { hiddenPlatforms: ['ios'] } })
    expect(saved.statusCode).toBe(200)
    expect((await app.inject('/api/admin/models')).json().data.find((model: { id: string }) => model.id === 'second').hiddenPlatforms).toEqual(['ios'])
    expect((await app.inject({ method: 'PATCH', url: '/api/admin/models/second', payload: { hiddenPlatforms: ['windows'] } })).statusCode).toBe(400)
    actorId = targetId
    const catalog = async (client?: string) => (await app.inject({ url: '/api/models', headers: client ? { 'x-pulpo-client': client } : {} }))
      .json().data.map((model: { id: string }) => model.id)
    expect(await catalog('ios/1.4.0')).toEqual(['available'])
    expect(await catalog('android/1.4.0')).toEqual(['available', 'second'])
    expect(await catalog('web')).toEqual(['available', 'second'])
    expect(await catalog()).toEqual(['available', 'second'])
  })

  it('excludes a disconnected target’s Codex models', async () => {
    await connect(targetId)
    await db.update(userProviderCredentials).set({ status: 'expired' }).where(eq(userProviderCredentials.userId, targetId))
    expect((await choices()).json().data.map((model: { id: string }) => model.id)).toEqual(['available', 'second'])
    expect((await patch({ defaultModelId: 'codex:test' })).statusCode).toBe(400)
  })

  it('preserves other preferences, audits, lists the saved model, and publishes the revision', async () => {
    const original = { defaultModelId: 'second', favoriteModelIds: ['second'], theme: 'dark', customSetting: { keep: true } }
    await db.insert(userPreferences).values({ userId: targetId, values: original })
    const response = await patch({ defaultModelId: 'available', name: 'Updated' })
    expect(response.statusCode).toBe(200)
    expect((await preferences())?.values).toEqual({ ...original, defaultModelId: 'available' })
    expect(mocks.publish).toHaveBeenCalledWith({ userId: targetId, revision: response.json().stateRevision })
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.targetId, targetId))
    expect(audit).toMatchObject({ actorUserId: adminId, action: 'user.update', metadata: { defaultModelId: 'available', name: 'Updated' } })
    const list = await app.inject('/api/admin/users')
    expect(list.statusCode).toBe(200)
    expect(list.json().data.find((row: { user: { id: string } }) => row.user.id === targetId).defaultModelId).toBe('available')
    expect(list.json().data.find((row: { user: { id: string } }) => row.user.id === adminId).defaultModelId).toBeNull()
  })

  it('creates missing preferences and lets the user clear or change the same preference', async () => {
    expect((await patch({ defaultModelId: 'available' })).statusCode).toBe(200)
    expect((await preferences())?.values).toMatchObject({ defaultModelId: 'available', favoriteModelIds: [] })
    actorId = targetId
    expect((await app.inject('/api/settings')).json().values.defaultModelId).toBe('available')
    const ownUpdate = await app.inject({ method: 'PATCH', url: '/api/settings', payload: { defaultModelId: 'second' } })
    expect(ownUpdate.statusCode).toBe(200)
    actorId = adminId
    expect((await patch({ defaultModelId: null })).statusCode).toBe(200)
    actorId = targetId
    expect((await app.inject('/api/settings')).json().values.defaultModelId).toBeNull()
  })

  it('leaves an unavailable default unchanged when omitted or resubmitted unchanged', async () => {
    await db.insert(userPreferences).values({ userId: targetId, values: { defaultModelId: 'retired', theme: 'dark' } })
    const before = await preferences()
    expect((await patch({ name: 'Other edit' })).statusCode).toBe(200)
    expect(await preferences()).toEqual(before)
    expect((await patch({ defaultModelId: 'retired' })).statusCode).toBe(200)
    expect((await preferences())?.values).toEqual(before?.values)
  })

  it.each(['missing', 'hidden', 'disabled', 'codex:test', '', '  ', 123])('rejects invalid model %s atomically', async (defaultModelId) => {
    const response = await patch({ name: 'Must not save', defaultModelId })
    expect(response.statusCode).toBe(400)
    expect(await preferences()).toBeUndefined()
    const [user] = await db.select().from(users).where(eq(users.id, targetId))
    expect(user?.name).toBe('Target')
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('rejects missing and deleting accounts', async () => {
    const absent = randomUUID()
    expect((await choices(absent)).statusCode).toBe(404)
    expect((await patch({ defaultModelId: 'available' }, absent)).statusCode).toBe(404)
    await db.update(users).set({ deletionRequestedAt: new Date() }).where(eq(users.id, targetId))
    expect((await choices()).statusCode).toBe(409)
    expect((await patch({ defaultModelId: null })).statusCode).toBe(409)
  })

  it('preserves concurrent settings changes', async () => {
    // Editing oneself lets both requests share an authenticated actor while racing.
    await db.insert(userPreferences).values({ userId: adminId, values: { favoriteModelIds: ['second'] } })
    const results = await Promise.all([
      patch({ defaultModelId: 'available' }, adminId),
      app.inject({ method: 'PATCH', url: '/api/settings', payload: { theme: 'dark', nickname: 'Keep me' } }),
    ])
    expect(results.map((result) => result.statusCode)).toEqual([200, 200])
    const [saved] = await db.select().from(userPreferences).where(eq(userPreferences.userId, adminId))
    expect(saved?.values).toMatchObject({ defaultModelId: 'available', favoriteModelIds: ['second'], theme: 'dark', nickname: 'Keep me' })
  })

  describe('restricted models', () => {
    const catalog = async () => (await app.inject('/api/models')).json().data.map((model: { id: string }) => model.id)
    const adminModel = async (id: string) => (await app.inject('/api/admin/models')).json().data.find((model: { id: string }) => model.id === id)
    const restrict = (payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: '/api/admin/models/second', payload })

    it('lists and admits a restricted model only for granted users and admins', async () => {
      expect((await restrict({ restricted: true, allowedUserIds: [] })).statusCode).toBe(200)
      expect(await catalog()).toEqual(['available', 'second'])
      expect((await choices()).json().data.map((model: { id: string }) => model.id)).toEqual(['available'])
      await expect(assertModelsAccessibleToUser(['second'], targetId)).rejects.toMatchObject({ statusCode: 403, code: 'model_access_denied' })
      await expect(assertModelsAccessibleToUser(['second'], adminId)).resolves.toBeUndefined()
      actorId = targetId
      expect(await catalog()).toEqual(['available'])

      actorId = adminId
      const granted = await restrict({ allowedUserIds: [targetId, targetId] })
      expect(granted.json()).toMatchObject({ restricted: true, allowedUserIds: [targetId] })
      expect(await adminModel('second')).toMatchObject({ restricted: true, allowedUserIds: [targetId] })
      await expect(assertModelsAccessibleToUser(['second'], targetId)).resolves.toBeUndefined()
      actorId = targetId
      expect(await catalog()).toEqual(['available', 'second'])

      actorId = adminId
      expect((await restrict({ restricted: false })).statusCode).toBe(200)
      expect(await adminModel('second')).toMatchObject({ restricted: false, allowedUserIds: [targetId] })
      expect((await restrict({ allowedUserIds: [] })).json().allowedUserIds).toEqual([])
      actorId = targetId
      expect(await catalog()).toEqual(['available', 'second'])
    })

    it('keeps existing grant metadata and rejects unknown users', async () => {
      await restrict({ restricted: true, allowedUserIds: [targetId] })
      const [before] = await db.select().from(modelUserGrants)
      await restrict({ allowedUserIds: [targetId, adminId] })
      const grants = await db.select().from(modelUserGrants)
      expect(grants).toHaveLength(2)
      expect(grants.find((grant) => grant.userId === targetId)).toEqual(before)
      expect((await restrict({ allowedUserIds: [randomUUID()] })).statusCode).toBe(400)
      expect(await db.select().from(modelUserGrants)).toHaveLength(2)
    })

    it('manages a user’s grants from the user patch and lists them', async () => {
      await restrict({ restricted: true })
      expect((await patch({ grantedModelIds: ['available'] })).statusCode).toBe(400)
      expect((await patch({ defaultModelId: 'second' })).statusCode).toBe(400)
      const response = await patch({ grantedModelIds: ['second'], defaultModelId: 'second' })
      expect(response.statusCode).toBe(200)
      expect(mocks.publish).toHaveBeenCalledWith({ userId: targetId, revision: response.json().stateRevision })
      const rows = (await app.inject('/api/admin/users')).json().data
      expect(rows.find((row: { user: { id: string } }) => row.user.id === targetId).grantedModelIds).toEqual(['second'])
      expect(rows.find((row: { user: { id: string } }) => row.user.id === adminId).grantedModelIds).toEqual([])
      expect((await patch({ grantedModelIds: [] })).statusCode).toBe(200)
      expect(await db.select().from(modelUserGrants)).toEqual([])
    })

    it('drops preset redirects to a restricted model the user cannot use', async () => {
      const presetId = randomUUID(), keepId = randomUUID(), redirectId = randomUUID()
      await db.insert(modelPresets).values({ id: presetId, modelId: 'available', publicId: 'mode', name: 'Mode', icon: 'sparkles', sortOrder: 0 })
      await db.insert(modelPresetChoices).values([
        { id: keepId, presetId, publicId: 'fast', displayName: 'Fast', icon: 'zap', actionType: 'parameters', action: { parameters: {} }, sortOrder: 0 },
        { id: redirectId, presetId, publicId: 'pro', displayName: 'Pro', icon: 'brain', actionType: 'redirect', action: { modelId: 'second' }, sortOrder: 1 },
      ])
      await db.update(modelPresets).set({ defaultChoiceId: redirectId }).where(eq(modelPresets.id, presetId))
      await restrict({ restricted: true })
      const presets = async () => (await app.inject('/api/models')).json().data.find((model: { id: string }) => model.id === 'available').presets
      expect((await presets())[0].choices.map((choice: { id: string }) => choice.id)).toEqual(['fast', 'pro'])
      actorId = targetId
      expect((await presets())[0]).toMatchObject({ defaultChoiceId: 'fast', choices: [{ id: 'fast' }] })
    })

    it('rejects a restricted model as a new-account default', async () => {
      await restrict({ restricted: true })
      const response = await app.inject({ method: 'PATCH', url: '/api/admin/settings', payload: { auth: { newAccountModelDefaults: { defaultModelId: 'second', favoriteModelIds: [] } } } })
      expect(response.json()).toMatchObject({ message: 'Configured model second is unavailable' })
    })
  })
})
