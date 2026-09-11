import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import Fastify, { type FastifyRequest, type FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { and, eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { META_MUSE_IMAGE_PRESET, OPENAI_IMAGE_PRESET, type ImageModel } from '@pulpo/contracts'
const mocks = vi.hoisted(() => ({ blobs: new Map<string, Uint8Array>(), writeFails: false }))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({
  get: async (key: string) => { const value = mocks.blobs.get(key); if (!value) throw new Error('Missing blob'); return value },
  put: async (key: string, data: Uint8Array) => { if (mocks.writeFails) throw new Error('Blob storage unavailable'); mocks.blobs.set(key, data) },
  delete: async (key: string) => { mocks.blobs.delete(key) },
  getStream: async (key: string) => Readable.from(mocks.blobs.get(key)!),
}) }))
vi.mock('../lib/url-security.js', () => ({ assertSafeProviderUrl: vi.fn() }))
import { db, queryClient } from '../database/client.js'
import { agentRuns, auditEvents, chats, imageGenerationRequests, imageModels, models, providerConnections, responses, toolExecutions, userPreferences, users } from '../database/schema.js'
import { getConfig } from '../config.js'
import { encryptSecret } from '../lib/crypto.js'
import { AppError } from '../lib/errors.js'
import { executeImageGeneration, selectedImageModel, recoverSavedImageGenerations } from './service.js'
import { createImageGenerationTools } from './tool.js'
import { registerImageGenerationRoutes } from './routes.js'
import { registerCatalogRoutes } from '../catalog/routes.js'
import { agentSettlementAmounts } from '../agent/settlement.js'
import type { WorkspaceManager } from '../agent/controller.js'

const enabled = process.env.PULPO_IMAGE_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_image_test') throw new Error('Use the disposable pulpo_image_test database')
const providerId = randomUUID(), userId = randomUUID(), chatId = randomUUID(), chatModelId = `chat-${randomUUID()}`
const config: ImageModel = { ...META_MUSE_IMAGE_PRESET, id: 'muse-test', providerConnectionId: providerId, enabled: true, billUsers: true, imagePriceMicros: 10_000 }
const exportFile = vi.fn(), stageGeneratedAttachment = vi.fn()
const manager = { exportFile, stageGeneratedAttachment } as unknown as WorkspaceManager
let server: FastifyInstance, role: 'admin' | 'user' | null = 'admin', image: Buffer, fetcher: ReturnType<typeof vi.fn<typeof fetch>>
async function turn() {
  const responseId = randomUUID(), runId = randomUUID(), operationId = `image-${randomUUID()}`
  await db.insert(responses).values({ id: responseId, userId, chatId, modelId: chatModelId, input: [], agentMode: true })
  await db.insert(agentRuns).values({ id: runId, responseId })
  await db.insert(toolExecutions).values({ id: randomUUID(), agentRunId: runId, operationId, toolName: 'generate_image' })
  return { responseId, runId, operationId, userId, chatId, manager, args: { prompt: 'Paint a fox' }, reserveCost: vi.fn(async (_amount: number) => undefined) }
}
async function preference(enabled = true, modelId: string | null = config.id) {
  await db.update(userPreferences).set({ values: { imageGeneration: { enabled, modelId } } }).where(eq(userPreferences.userId, userId))
}
describe.skipIf(!enabled)('image generation persistence and authorization', () => {
  beforeAll(async () => {
    image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#fb7' } }).png().toBuffer()
    await db.insert(users).values({ id: userId, email: `${userId}@example.test`, username: userId, name: 'Image QA', storageLimitBytes: 100_000_000 })
    await db.insert(providerConnections).values({ id: providerId, name: 'Image QA', baseUrl: 'https://api.meta.ai/v1', encryptedApiKey: encryptSecret('fixture-secret', getConfig().ENCRYPTION_KEY) })
    await db.insert(models).values({ id: chatModelId, providerConnectionId: providerId, upstreamModelId: 'chat', name: 'Chat', contextWindow: 32000, maxOutputTokens: 1000 })
    await db.insert(chats).values({ id: chatId, userId, modelId: chatModelId })
    await db.insert(userPreferences).values({ userId, values: {} })
    server = Fastify()
    server.addHook('preHandler', async request => { request.user = role ? { id: userId, role, blocked: false } as FastifyRequest['user'] : null })
    server.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send({ error: { message: error instanceof Error ? error.message : 'Failed' } }))
    await registerImageGenerationRoutes(server)
    await registerCatalogRoutes(server)
  })
  beforeEach(async () => {
    role = 'admin'; mocks.writeFails = false; exportFile.mockReset(); stageGeneratedAttachment.mockReset().mockResolvedValue(undefined)
    await db.delete(imageModels).where(eq(imageModels.id, config.id))
    await db.insert(imageModels).values({ id: config.id, providerConnectionId: providerId, config })
    await db.update(providerConnections).set({ enabled: true, baseUrl: 'https://api.meta.ai/v1' }).where(eq(providerConnections.id, providerId))
    await db.update(users).set({ storageLimitBytes: 100_000_000 }).where(eq(users.id, userId))
    await preference()
    fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: 'response-id', status: 'completed', output: [{ type: 'image_generation_call', id: 'image-item', status: 'completed', result: image.toString('base64') }], usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 } }))
    vi.stubGlobal('fetch', fetcher)
  })
  afterAll(async () => {
    vi.unstubAllGlobals(); await server?.close()
    await db.delete(chats).where(eq(chats.id, chatId))
    await db.delete(models).where(eq(models.id, chatModelId))
    await db.delete(imageModels).where(eq(imageModels.providerConnectionId, providerId))
    await db.delete(providerConnections).where(eq(providerConnections.id, providerId))
    await db.delete(auditEvents).where(eq(auditEvents.actorUserId, userId))
    await db.delete(users).where(eq(users.id, userId)); await queryClient.end()
  })
  it('hides the tool and denies direct calls when disabled, unselected, or unavailable', async () => {
    const input = await turn()
    for (const settings of [[false, config.id], [true, null], [true, 'missing']] as const) {
      await preference(settings[0], settings[1])
      const selected = await selectedImageModel(userId)
      expect(selected).toBeNull()
      expect(createImageGenerationTools({ model: selected?.model ?? null, execute: vi.fn(), onStarted: vi.fn(), onAttachment: vi.fn() })).toEqual([])
      await expect(executeImageGeneration(input)).rejects.toThrow('Enable image generation')
    }
    await preference(); await db.update(providerConnections).set({ enabled: false }).where(eq(providerConnections.id, providerId))
    await expect(executeImageGeneration(input)).rejects.toThrow('Enable image generation')
    expect(fetcher).not.toHaveBeenCalled(); expect(input.reserveCost).not.toHaveBeenCalled()
  })
  it('persists one result and one charge on replay; edits reuse a stateless image item', async () => {
    const input = await turn()
    const result = await executeImageGeneration(input)
    expect(result.attachment.mimeType).toBe('image/png'); expect(result.billedCostMicros).toBe(10_000)
    expect(input.reserveCost).toHaveBeenCalledExactlyOnceWith(10_000)
    const replay = await executeImageGeneration(input)
    expect(replay.attachment.id).toBe(result.attachment.id); expect(fetcher).toHaveBeenCalledOnce(); expect(input.reserveCost).toHaveBeenCalledOnce()
    expect(stageGeneratedAttachment).toHaveBeenCalledWith(result.attachment.id, undefined)
    const [claim] = await db.select().from(imageGenerationRequests).where(eq(imageGenerationRequests.responseId, input.responseId))
    expect(claim).toMatchObject({ status: 'completed', billedCostMicros: 10_000, result: { imageItem: { id: 'image-item' }, usage: { inputTokens: 5, outputTokens: 10 } } })
    expect(JSON.stringify(claim)).not.toContain(image.toString('base64')); expect(JSON.stringify(claim)).not.toContain('fixture-secret')
    const [charge] = await db.select().from(toolExecutions).where(eq(toolExecutions.operationId, input.operationId))
    expect(agentSettlementAmounts({ totalTokens: 0, generationCostMicros: 0, toolCostMicros: charge!.billedCostMicros, sidecarCostMicros: 0, workspaceCostMicros: 0 })).toMatchObject({ shouldSettle: true, costMicrosOverride: 10_000 })
    const edit = await turn()
    await executeImageGeneration({ ...edit, args: { prompt: 'Make it blue', referenceImages: [{ attachmentId: result.attachment.id }] } })
    const request = JSON.parse(String(fetcher.mock.calls[1]![1]!.body))
    expect(request).toMatchObject({ store: false, input: [{ id: 'image-item', type: 'image_generation_call', result: image.toString('base64') }, { role: 'user' }] })
    expect(exportFile).not.toHaveBeenCalled()
  })
  it('creates an OpenAI catalog entry, saves and bills once, and edits a saved attachment', async () => {
    await db.update(providerConnections).set({ baseUrl: 'https://api.openai.com/v1' }).where(eq(providerConnections.id, providerId))
    await db.delete(imageModels).where(eq(imageModels.id, config.id))
    const openai = { ...config, ...OPENAI_IMAGE_PRESET, enabled: true, billUsers: true, imagePriceMicros: 20_000 }
    const created = await server.inject({ method: 'POST', url: '/api/admin/image-models', payload: openai })
    expect(created.statusCode).toBe(201)
    expect((await server.inject('/api/image-models')).json().data).toEqual([expect.objectContaining({ id: config.id, adapter: 'openai-images' })])
    expect((await selectedImageModel(userId))?.model.adapter).toBe('openai-images')
    fetcher.mockImplementation(async () => Response.json({ data: [{ b64_json: image.toString('base64') }], usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 } }))
    const input = await turn()
    const result = await executeImageGeneration(input)
    expect(result.billedCostMicros).toBe(20_000)
    expect(input.reserveCost).toHaveBeenCalledExactlyOnceWith(20_000)
    expect((await executeImageGeneration(input)).attachment.id).toBe(result.attachment.id)
    expect(fetcher).toHaveBeenCalledOnce()
    const [charge] = await db.select().from(toolExecutions).where(eq(toolExecutions.operationId, input.operationId))
    expect(charge).toMatchObject({ billedCostMicros: 20_000, providerAttempts: [{ provider: 'openai-images', usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 } }] })
    await executeImageGeneration({ ...await turn(), args: { prompt: 'Make it blue', referenceImages: [{ attachmentId: result.attachment.id }] } })
    expect(fetcher.mock.calls[1]![0]).toBe('https://api.openai.com/v1/images/edits')
    const form = fetcher.mock.calls[1]![1]!.body as FormData
    expect(Buffer.from(await (form.get('image[]') as Blob).arrayBuffer())).toEqual(image)
    expect(exportFile).not.toHaveBeenCalled()
  })
  it('never replays a failed or uncertain request, and rejects concurrent duplicates', async () => {
    const input = await turn(); let release!: () => void
    fetcher.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve }); throw new Error('uncertain') })
    const first = executeImageGeneration(input).catch(error => error)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    await expect(executeImageGeneration(input)).rejects.toThrow('already submitted')
    release(); await first
    await expect(executeImageGeneration(input)).rejects.toThrow('already submitted')
    expect(fetcher).toHaveBeenCalledOnce()
    const [charge] = await db.select().from(toolExecutions).where(eq(toolExecutions.operationId, input.operationId))
    expect(charge!.billedCostMicros).toBe(0)
  })
  it('recovers a saved attachment after interruption without another provider call', async () => {
    const input = await turn(), result = await executeImageGeneration(input)
    await db.update(imageGenerationRequests).set({ status: 'claimed', attachmentId: null, billedCostMicros: 0 }).where(eq(imageGenerationRequests.responseId, input.responseId))
    await db.update(toolExecutions).set({ status: 'running', billedCostMicros: 0 }).where(eq(toolExecutions.operationId, input.operationId))
    await preference(false)
    await recoverSavedImageGenerations(input.responseId, input.runId)
    await recoverSavedImageGenerations(input.responseId, input.runId)
    await preference()
    expect((await executeImageGeneration(input)).attachment.id).toBe(result.attachment.id)
    expect(fetcher).toHaveBeenCalledOnce()
    const [charge] = await db.select().from(toolExecutions).where(eq(toolExecutions.operationId, input.operationId))
    expect(charge!.billedCostMicros).toBe(10_000)
  })
  it('rejects another chat’s reference without loading it or charging', async () => {
    const original = await executeImageGeneration(await turn()); fetcher.mockClear()
    const input = await turn()
    await expect(executeImageGeneration({ ...input, chatId: randomUUID(), args: { prompt: 'Edit', referenceImages: [{ attachmentId: original.attachment.id }] } })).rejects.toThrow('not available in this chat')
    expect(fetcher).not.toHaveBeenCalled(); expect(input.reserveCost).not.toHaveBeenCalled()
  })
  it('resolves workspace files, rejects invalid images, and honors cancellation', async () => {
    const input = await turn()
    await expect(executeImageGeneration({ ...input, args: { prompt: 'Edit', referenceImages: [{ path: '/etc/reference.png' }] } })).rejects.toThrow('inside /workspace')
    expect(exportFile).not.toHaveBeenCalled()
    exportFile.mockRejectedValueOnce(new Error('internal controller error'))
    await expect(executeImageGeneration({ ...input, args: { prompt: 'Edit', referenceImages: [{ path: '/workspace/missing.png' }] } })).rejects.toThrow('check the path')
    exportFile.mockResolvedValue({ data: image, sizeBytes: image.length })
    await executeImageGeneration({ ...input, args: { prompt: 'Edit', referenceImages: [{ path: '/workspace/reference.png' }] } })
    expect(exportFile).toHaveBeenCalledWith('/workspace/reference.png', undefined)
    fetcher.mockClear(); exportFile.mockResolvedValue({ data: Buffer.from('bad'), sizeBytes: 3 })
    await expect(executeImageGeneration({ ...await turn(), args: { prompt: 'Edit', referenceImages: [{ path: '/workspace/bad.png' }] } })).rejects.toThrow('Unsupported')
    await expect(executeImageGeneration({ ...await turn(), signal: AbortSignal.abort() })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('does not bill storage failures and does not call the provider without balance or storage', async () => {
    const noBalance = await turn(); noBalance.reserveCost.mockRejectedValueOnce(new Error('Insufficient balance'))
    await expect(executeImageGeneration(noBalance)).rejects.toThrow('Insufficient balance'); expect(fetcher).not.toHaveBeenCalled()
    mocks.writeFails = true; const failed = await turn()
    await expect(executeImageGeneration(failed)).rejects.toThrow('storage unavailable')
    const [charge] = await db.select().from(toolExecutions).where(eq(toolExecutions.operationId, failed.operationId))
    expect(charge!.billedCostMicros).toBe(0)
    mocks.writeFails = false; fetcher.mockClear()
    await db.update(users).set({ storageLimitBytes: 0 }).where(eq(users.id, userId))
    await expect(executeImageGeneration(await turn())).rejects.toThrow('attachment storage')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rechecks opt-in after reservation and allows free generation without a charge', async () => {
    const input = await turn(); input.reserveCost.mockImplementationOnce(async () => { await preference(false) })
    await expect(executeImageGeneration(input)).rejects.toThrow('Enable image generation'); expect(fetcher).not.toHaveBeenCalled()
    await preference(); await db.update(imageModels).set({ config: { ...config, billUsers: false } }).where(eq(imageModels.id, config.id))
    const free = await executeImageGeneration(await turn()); expect(free.billedCostMicros).toBe(0)
  })
  it('serves a sanitized catalog and protects CRUD with admin authorization', async () => {
    const publicResponse = await server.inject('/api/image-models')
    expect(publicResponse.statusCode).toBe(200)
    expect(publicResponse.body).not.toMatch(/providerConnectionId|upstreamModelId|fixture-secret|api.meta.ai/)
    role = null
    expect((await server.inject('/api/image-models')).statusCode).toBe(401)
    role = 'user'
    for (const [method, url] of [['GET', '/api/admin/image-models'], ['POST', '/api/admin/image-models'], ['PATCH', `/api/admin/image-models/${config.id}`], ['DELETE', `/api/admin/image-models/${config.id}`]] as const) {
      expect((await server.inject({ method, url, ...(['POST', 'PATCH'].includes(method) ? { payload: config } : {}) })).statusCode).toBe(403)
    }
    role = 'admin'
    expect((await server.inject({ method: 'POST', url: '/api/admin/image-models', payload: config })).statusCode).toBe(409)
    expect((await server.inject({ method: 'PATCH', url: `/api/admin/image-models/${config.id}`, payload: { ...config, enabled: false } })).statusCode).toBe(200)
    expect((await server.inject('/api/image-models')).json().data).toEqual([])
    expect((await server.inject({ method: 'PATCH', url: `/api/admin/image-models/${config.id}`, payload: { ...config, id: 'new-id' } })).statusCode).toBe(400)
  })
  it('protects an image-only provider from deletion', async () => {
    const other = randomUUID()
    await db.insert(providerConnections).values({ id: other, name: 'Image only', baseUrl: 'https://api.meta.ai/v1', encryptedApiKey: 'fixture' })
    await db.insert(imageModels).values({ id: 'image-only', providerConnectionId: other, config: { ...config, id: 'image-only', providerConnectionId: other } })
    expect((await server.inject({ method: 'DELETE', url: `/api/admin/providers/${other}` })).statusCode).toBe(409)
    await expect(db.delete(providerConnections).where(eq(providerConnections.id, other))).rejects.toThrow()
    await db.delete(imageModels).where(eq(imageModels.id, 'image-only'))
    await db.delete(providerConnections).where(eq(providerConnections.id, other))
  })
  it('retains billing when a response is cancelled and cascades request cleanup with the response', async () => {
    const input = await turn(); await executeImageGeneration(input)
    await db.update(responses).set({ status: 'cancelled' }).where(eq(responses.id, input.responseId))
    const [sum] = await db.select({ total: sql<number>`sum(${toolExecutions.billedCostMicros})` }).from(toolExecutions).where(eq(toolExecutions.agentRunId, input.runId))
    expect(Number(sum!.total)).toBe(10_000)
    await db.delete(responses).where(eq(responses.id, input.responseId))
    expect(await db.select().from(imageGenerationRequests).where(and(eq(imageGenerationRequests.responseId, input.responseId), eq(imageGenerationRequests.operationId, input.operationId)))).toEqual([])
  })
})
