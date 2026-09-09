import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { ZodError } from 'zod'
import { VOXTRAL_SPEECH_PRESET, speechModelSchema } from '@pulpo/contracts'
import { db, queryClient } from '../database/client.js'
import { auditEvents, providerConnections, speechModels, speechRequests, speechResourceCleanup, users } from '../database/schema.js'
import { encryptSecret } from '../lib/crypto.js'
import { getConfig } from '../config.js'
import { AppError } from '../lib/errors.js'
import { speechTestWav } from './audio-fixtures.js'
const mocks = vi.hoisted(() => ({ role: 'admin', userId: '', blobs: new Map<string, Uint8Array>(), charge: vi.fn() }))
vi.mock('../auth/service.js', () => ({
  requireUser: () => { if (!mocks.role) throw new AppError(401, 'unauthorized', 'Sign in'); return { id: mocks.userId, role: mocks.role } },
  requireAdmin: () => { if (mocks.role !== 'admin') throw new AppError(403, 'forbidden', 'Admin only'); return { id: mocks.userId, role: mocks.role } },
}))
vi.mock('../lib/url-security.js', () => ({ assertSafeProviderUrl: vi.fn() }))
vi.mock('../accounting/service.js', () => ({ chargeMeteredUsage: mocks.charge }))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({
  put: async (key: string, bytes: Uint8Array) => { mocks.blobs.set(key, bytes) },
  get: async (key: string) => { const blob = mocks.blobs.get(key); if (!blob) throw new Error('Missing blob'); return blob },
  delete: async (key: string) => { mocks.blobs.delete(key) },
}) }))
import { registerSpeechRoutes } from './routes.js'
const enabled = process.env.PULPO_SPEECH_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_speech_test') throw new Error('Use the disposable pulpo_speech_test database')
const providerId = randomUUID(); const modelId = `voxtral-${randomUUID()}`
const saved = () => db.select().from(speechModels).where(eq(speechModels.id, modelId)).then(rows => rows[0]!)
let server: FastifyInstance
let serial = 0, failCreate = false, changeDuringCreate = false, failDelete = false
const remote = new Map<string, { id: string; name: string; slug: string; user_id: string }>()
const path = (suffix: string) => `/api/admin/speech-models/${modelId}${suffix}`
const upload = (suffix: string, bytes = speechTestWav(3)) => ({ method: 'POST' as const, url: path(suffix), headers: { 'content-type': 'multipart/form-data; boundary=audio' }, payload: Buffer.concat([Buffer.from('--audio\r\nContent-Disposition: form-data; name="file"; filename="source.wav"\r\nContent-Type: audio/wav\r\n\r\n'), bytes, Buffer.from('\r\n--audio--\r\n')]) })
const model = () => speechModelSchema.parse({ ...VOXTRAL_SPEECH_PRESET, id: modelId, providerConnectionId: providerId, responseFormat: 'wav', voices: [{ id: 'voice', label: 'My voice' }], defaultVoice: 'voice' })
describe.skipIf(!enabled)('speech voice assets in PostgreSQL', () => {
  beforeAll(async () => {
    mocks.userId = randomUUID()
    await db.insert(users).values({ id: mocks.userId, email: `${mocks.userId}@example.test`, username: mocks.userId, name: 'Voice QA' })
    await db.insert(providerConnections).values({ id: providerId, name: 'Voice QA provider', baseUrl: 'https://mistral.example/v1', encryptedApiKey: encryptSecret('fixture', getConfig().ENCRYPTION_KEY) })
    server = Fastify(); await server.register(multipart); await registerSpeechRoutes(server)
    server.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: { message: error instanceof Error ? error.message : 'Unknown error', code: error instanceof AppError ? error.code : 'invalid_request' } }))
  })
  beforeEach(async () => {
    mocks.role = 'admin'; mocks.charge.mockReset(); failCreate = false; changeDuringCreate = false; failDelete = false; remote.clear(); mocks.blobs.clear()
    await db.delete(speechResourceCleanup)
    await db.delete(speechModels).where(eq(speechModels.providerConnectionId, providerId))
    await db.insert(speechModels).values({ id: modelId, providerConnectionId: providerId, config: model() })
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/audio/speech')) return Response.json({ audio_data: speechTestWav(1).toString('base64') })
      if (url.includes('/audio/voices?')) return Response.json({ items: [...remote.values()], total: remote.size })
      if (options?.method === 'DELETE') {
        if (failDelete) return new Response('secret', { status: 500 })
        remote.delete(decodeURIComponent(url.split('/').at(-1)!)); return Response.json({})
      }
      if (options?.method === 'POST' && url.endsWith('/audio/voices')) {
        if (failCreate) return new Response('provider secret', { status: 500 })
        const input = JSON.parse(String(options.body)); const voice = { id: `remote-${++serial}`, name: input.name, slug: input.slug, user_id: 'user' }; remote.set(voice.id, voice)
        if (changeDuringCreate) await db.update(speechModels).set({ updatedAt: new Date(Date.now() + 1000) }).where(eq(speechModels.id, modelId))
        return Response.json(voice)
      }
      return new Response('Missing fixture endpoint', { status: 404 })
    }))
  })
  afterAll(async () => {
    vi.unstubAllGlobals(); await server?.close()
    await db.delete(speechResourceCleanup)
    await db.delete(speechModels).where(eq(speechModels.providerConnectionId, providerId))
    await db.delete(providerConnections).where(eq(providerConnections.id, providerId))
    await db.delete(speechRequests).where(eq(speechRequests.userId, mocks.userId))
    await db.delete(auditEvents).where(eq(auditEvents.actorUserId, mocks.userId))
    await db.delete(users).where(eq(users.id, mocks.userId)); await queryClient.end()
  })
  it('creates and repairs a private clone while preserving the local voice ID', async () => {
    const response = await server.inject(upload('/voices/voice/clone'))
    expect(response.statusCode, response.body).toBe(201)
    const first = await saved(); const clone = first.voiceAssets[0]!.clone!
    expect(first.config.voices[0]?.kind).toBe('cloned'); expect(mocks.blobs.has(clone.objectKey)).toBe(true)
    expect((await server.inject({ method: 'POST', url: path('/voices/voice/clone/repair') })).statusCode).toBe(201)
    const next = await saved()
    expect(next.config.voices[0]?.id).toBe('voice'); expect(next.voiceAssets[0]?.clone?.upstreamVoiceId).not.toBe(clone.upstreamVoiceId)
    expect(remote.has(clone.upstreamVoiceId)).toBe(false); expect(mocks.blobs.has(clone.objectKey)).toBe(false)
    await db.update(speechModels).set({ config: { ...next.config, enabled: true } }).where(eq(speechModels.id, modelId))
    const catalog = await server.inject('/api/speech-models')
    expect(catalog.body).not.toMatch(/objectKey|referenceAvailable|upstreamVoiceId|remote-|speech-assets/)
    mocks.role = 'user'
    expect((await server.inject(path('/voices/voice/clone'))).statusCode).toBe(403)
    expect((await server.inject(upload('/voices/voice/watermark'))).statusCode).toBe(403)
  })
  it('mixes watermarks into generated speech and previews before charging, and fails closed', async () => {
    expect((await server.inject(upload('/voices/voice/watermark', speechTestWav(0.5, 173, 0.5)))).statusCode).toBe(201)
    expect((await server.inject({ method: 'PATCH', url: path('/voices/voice/watermark'), payload: { enabled: true, volume: 0.3 } })).statusCode).toBe(200)
    const current = await saved(); const config = { ...current.config, enabled: true, billUsers: true, billingUnit: 'duration' as const, minutePriceMicros: 60_000 }
    await db.update(speechModels).set({ config }).where(eq(speechModels.id, modelId))
    const speech = { method: 'POST' as const, url: '/api/speech', payload: { requestId: randomUUID(), modelId, voice: 'voice', input: 'Hello', playbackOffsetSeconds: 0.2 } }
    const response = await server.inject(speech)
    expect(response.statusCode, response.body).toBe(200); expect(response.headers['x-speech-duration-seconds']).toBe('1')
    expect(response.rawPayload).not.toEqual(speechTestWav(1)); expect(mocks.charge).toHaveBeenCalledWith(expect.objectContaining({ costMicros: 1000 }))
    expect((await server.inject({ method: 'POST', url: path('/voices/voice/test'), payload: { input: 'Hello', savePreview: true } })).statusCode).toBe(200)
    const preview = await server.inject(`/api/speech-models/${modelId}/voices/voice/preview`)
    expect(preview.statusCode).toBe(200); expect(preview.rawPayload).not.toEqual(speechTestWav(1))
    mocks.blobs.delete(current.voiceAssets[0]!.watermark!.objectKey); mocks.charge.mockClear()
    const failure = await server.inject({ ...speech, payload: { ...speech.payload, requestId: randomUUID() } })
    expect(failure.statusCode).toBe(502); expect(mocks.charge).not.toHaveBeenCalled()
  })
  it('preserves previous assets on upstream failures and concurrent edits, with durable cleanup', async () => {
    expect((await server.inject(upload('/voices/voice/clone'))).statusCode).toBe(201)
    const old = (await saved()).voiceAssets
    failCreate = true
    expect((await server.inject(upload('/voices/voice/clone'))).statusCode).toBe(502)
    expect((await saved()).voiceAssets).toEqual(old)
    failCreate = false; changeDuringCreate = true
    expect((await server.inject(upload('/voices/voice/clone'))).statusCode).toBe(409)
    expect((await saved()).voiceAssets).toEqual(old)
    const jobs = await db.select().from(speechResourceCleanup)
    expect(jobs.length).toBeGreaterThan(0)
    await db.update(speechResourceCleanup).set({ readyAt: new Date(0) })
    for (const job of jobs) expect((await server.inject({ method: 'POST', url: `/api/admin/speech-models/cleanup/${job.id}/retry` })).statusCode).toBe(200)
    expect(remote.size).toBe(1); expect(mocks.blobs.has(old[0]!.clone!.objectKey)).toBe(true)
  })
  it('never deletes a managed provider voice still imported by another model', async () => {
    expect((await server.inject(upload('/voices/voice/clone'))).statusCode).toBe(201)
    const old = (await saved()).voiceAssets[0]!.clone!
    const otherId = `${modelId}-other`
    await db.insert(speechModels).values({ id: otherId, providerConnectionId: providerId, config: { ...model(), id: otherId, voices: [{ id: old.upstreamVoiceId, label: 'Imported' }], defaultVoice: old.upstreamVoiceId } })
    expect((await server.inject({ method: 'POST', url: path('/voices/voice/clone/repair') })).statusCode).toBe(201)
    const [job] = await db.select().from(speechResourceCleanup)
    expect(job?.error).toContain('still used'); expect(remote.has(old.upstreamVoiceId)).toBe(true)
    await db.delete(speechModels).where(eq(speechModels.id, otherId))
    expect((await server.inject({ method: 'POST', url: `/api/admin/speech-models/cleanup/${job!.id}/retry` })).statusCode).toBe(200)
    expect(remote.has(old.upstreamVoiceId)).toBe(false)
  })
  it('retains cleanup failures after model deletion and supports empty disabled drafts', async () => {
    expect((await server.inject(upload('/voices/voice/clone'))).statusCode).toBe(201)
    failDelete = true
    expect((await server.inject({ method: 'DELETE', url: path('') })).statusCode).toBe(204)
    const [job] = await db.select().from(speechResourceCleanup)
    expect(job?.error).toBeTruthy()
    failDelete = false
    expect((await server.inject({ method: 'POST', url: `/api/admin/speech-models/cleanup/${job!.id}/retry` })).statusCode).toBe(200)
    expect(remote.size).toBe(0); expect(mocks.blobs.size).toBe(0)
    const draft = { ...model(), voices: [], defaultVoice: '' }
    expect((await server.inject({ method: 'POST', url: '/api/admin/speech-models', payload: draft })).statusCode).toBe(201)
    expect((await server.inject({ method: 'PATCH', url: path(''), payload: { ...draft, enabled: true } })).statusCode).toBe(400)
  })
})
