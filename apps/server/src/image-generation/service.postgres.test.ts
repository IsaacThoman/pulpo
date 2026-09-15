import { refreshDiagnosticPolicy, flushDiagnostics, closeDiagnostics } from '../logging/provider-diagnostics.js'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import Fastify, { type FastifyRequest, type FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { and, eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { META_MUSE_IMAGE_PRESET, OPENAI_IMAGE_PRESET, imageModelSchema, imageGenerationInputSchema, responseUsageSchema, type ImageModel } from '@pulpo/contracts'
vi.mock('../agent/controller-http.js', () => ({ workspaceControllerRequest: vi.fn() }))
vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
const mocks = vi.hoisted(() => ({ blobs: new Map<string, Uint8Array>(), writeFails: false }))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({
  get: async (key: string) => { const value = mocks.blobs.get(key); if (!value) throw new Error('Missing blob'); return value },
  put: async (key: string, data: Uint8Array) => { if (mocks.writeFails) throw new Error('Blob storage unavailable'); mocks.blobs.set(key, data) },
  delete: async (key: string) => { mocks.blobs.delete(key) },
  getStream: async (key: string) => Readable.from(mocks.blobs.get(key)!),
}) }))
vi.mock('../lib/url-security.js', () => ({ assertSafeProviderUrl: vi.fn() }))
import { db, queryClient } from '../database/client.js'
import { providerDiagnostics, usageEvents, workspaceLeases, attachments, budgetReservations, creditLedger, modelPricingVersions, agentRuns, auditEvents, chats, imageGenerationRequests, imageModels, models, providerConnections, responses, toolExecutions, userPreferences, users } from '../database/schema.js'
import { reserveBudget, extendBudgetReservationFixedCost, settleBudget, releaseBudget } from '../accounting/service.js'
import { getConfig } from '../config.js'
import { encryptSecret } from '../lib/crypto.js'
import { AppError } from '../lib/errors.js'
import { storeGeneratedAttachment } from '../attachments/generated.js'
import { executeImageGeneration, selectedImageModel, recoverSavedImageGenerations } from './service.js'
import { createWorkspaceTools } from '../agent/tools.js'
import { createImageGenerationTools } from './tool.js'
import { registerImageGenerationRoutes } from './routes.js'
import { registerCatalogRoutes } from '../catalog/routes.js'
import { workspaceControllerRequest } from '../agent/controller-http.js'
import { agentSettlementAmounts } from '../agent/settlement.js'
import { WorkspaceManager } from '../agent/controller.js'

const enabled = process.env.PULPO_IMAGE_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_image_test') throw new Error('Use the disposable pulpo_image_test database')
const providerId = randomUUID(), userId = randomUUID(), chatId = randomUUID(), chatModelId = `chat-${randomUUID()}`
const config: ImageModel = { ...META_MUSE_IMAGE_PRESET, id: 'muse-test', providerConnectionId: providerId, enabled: true, billUsers: true, imagePriceMicros: 10_000 }
const workspaceFiles = new Map<string, Uint8Array>()
const exportFile = vi.fn(), ensureLease = vi.fn(), saveGeneratedFile = vi.fn(), readGeneratedFile = vi.fn()
const manager = { exportFile, ensureLease, saveGeneratedFile, readGeneratedFile, continuedWithoutAgent: false } as unknown as WorkspaceManager
let server: FastifyInstance, role: 'admin' | 'user' | null = 'admin', image: Buffer, fetcher: ReturnType<typeof vi.fn<typeof fetch>>
async function turn() {
  const responseId = randomUUID(), runId = randomUUID(), operationId = `image-${randomUUID()}`
  await db.insert(responses).values({ id: responseId, userId, chatId, modelId: chatModelId, input: [], agentMode: true })
  await db.insert(agentRuns).values({ id: runId, responseId })
  await db.insert(toolExecutions).values({ id: randomUUID(), agentRunId: runId, operationId, toolName: 'generate_image' })
  return { responseId, runId, operationId, userId, chatId, manager, args: { prompt: 'Paint a fox' }, reserveCost: vi.fn(async (_amount: number): Promise<void> => undefined) }
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
    await db.update(budgetReservations).set({ status: 'released' }).where(eq(budgetReservations.userId, userId))
    await refreshDiagnosticPolicy()
    role = 'admin'; mocks.writeFails = false; workspaceFiles.clear()
    const readWorkspace = async (path: string) => {
      const data = workspaceFiles.get(path)
      if (!data) throw new Error('Workspace file unavailable')
      return { data, sizeBytes: data.byteLength }
    }
    exportFile.mockReset().mockImplementation(readWorkspace)
    readGeneratedFile.mockReset().mockImplementation(readWorkspace)
    ensureLease.mockReset().mockResolvedValue('image-test-lease')
    saveGeneratedFile.mockReset().mockImplementation(async (path: string, data: Uint8Array) => { workspaceFiles.set(path, data) })
    await db.delete(imageModels).where(eq(imageModels.id, config.id))
    await db.insert(imageModels).values({ id: config.id, providerConnectionId: providerId, config })
    await db.update(providerConnections).set({ enabled: true, baseUrl: 'https://api.meta.ai/v1' }).where(eq(providerConnections.id, providerId))
    await db.update(users).set({ storageLimitBytes: 100_000_000 }).where(eq(users.id, userId))
    await preference()
    fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: 'response-id', status: 'completed', output: [{ type: 'image_generation_call', id: 'image-item', status: 'completed', result: image.toString('base64') }], usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 } }))
    vi.stubGlobal('fetch', fetcher)
  })
  afterAll(async () => {
    await closeDiagnostics()
    vi.unstubAllGlobals(); await server?.close()
    await db.delete(chats).where(eq(chats.id, chatId))
    await db.delete(usageEvents).where(eq(usageEvents.userId, userId))
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
      expect(createImageGenerationTools({ model: selected?.model ?? null, execute: vi.fn(), onStarted: vi.fn() })).toEqual([])
      await expect(executeImageGeneration(input)).rejects.toThrow('Enable image generation')
    }
    await preference(); await db.update(providerConnections).set({ enabled: false }).where(eq(providerConnections.id, providerId))
    await expect(executeImageGeneration(input)).rejects.toThrow('Enable image generation')
    expect(fetcher).not.toHaveBeenCalled(); expect(input.reserveCost).not.toHaveBeenCalled()
  })
  it('retains provider error details without creating a charge or keeping detailed bodies', async () => {
    const input = await turn()
    fetcher.mockResolvedValue(Response.json({ error: { code: 'invalid_image', message: 'Unsupported reference format' } }, { status: 400, headers: { 'x-request-id': 'req-image-failed' } }))
    await expect(executeImageGeneration(input)).rejects.toThrow()
    await flushDiagnostics()
    const [diagnostic] = await db.select().from(providerDiagnostics).where(eq(providerDiagnostics.operationId, input.operationId))
    expect(diagnostic).toMatchObject({ status: 'failed', providerId, modelId: config.id, requestPayload: null, responsePayload: null, metadata: { httpStatus: 400, errorCode: 'invalid_image', providerRequestId: 'req-image-failed' } })
    const [tool] = await db.select().from(toolExecutions).where(eq(toolExecutions.operationId, input.operationId))
    expect(tool!.billedCostMicros).toBe(0)
    expect(tool!.providerAttempts).toEqual([expect.objectContaining({ providerId, modelId: config.id, outcome: 'failed' })])
  })

  it('saves only a workspace file, bills once on replay, and edits its bytes', async () => {
    const input = await turn()
    const result = await executeImageGeneration(input)
    expect(result.file.mimeType).toBe('image/png'); expect(result.billedCostMicros).toBe(10_000)
    expect(input.reserveCost).toHaveBeenCalledExactlyOnceWith(10_000)
    const replay = await executeImageGeneration(input)
    expect(replay.path).toBe(result.path); expect(fetcher).toHaveBeenCalledOnce(); expect(input.reserveCost).toHaveBeenCalledOnce()
    expect(saveGeneratedFile).toHaveBeenCalledExactlyOnceWith(result.path, image, 'image/png', 'image-test-lease', undefined)
    expect(workspaceFiles.get(result.path)).toEqual(image)
    expect(await db.select().from(attachments).where(eq(attachments.sourceResponseId, input.responseId))).toEqual([])
    const [claim] = await db.select().from(imageGenerationRequests).where(eq(imageGenerationRequests.responseId, input.responseId))
    expect(claim).toMatchObject({ status: 'completed', billedCostMicros: 10_000, result: { imageItem: { id: 'image-item' }, usage: { inputTokens: 5, outputTokens: 10 } } })
    expect(JSON.stringify(claim)).not.toContain(image.toString('base64')); expect(JSON.stringify(claim)).not.toContain('fixture-secret')
    const [charge] = await db.select().from(toolExecutions).where(eq(toolExecutions.operationId, input.operationId))
    expect(agentSettlementAmounts({ totalTokens: 0, generationCostMicros: 0, toolCostMicros: charge!.billedCostMicros, sidecarCostMicros: 0, workspaceCostMicros: 0 })).toMatchObject({ shouldSettle: true, costMicrosOverride: 10_000 })
    const edit = await turn()
    await executeImageGeneration({ ...edit, args: { prompt: 'Make it blue', referenceImages: [{ path: result.path }] } })
    const request = JSON.parse(String(fetcher.mock.calls[1]![1]!.body))
    expect(request).toMatchObject({ store: false, input: [{ role: 'user', content: expect.arrayContaining([expect.objectContaining({ type: 'input_image' })]) }] })
    expect(exportFile).toHaveBeenCalledWith(result.path, undefined)
  })
  it('creates an OpenAI catalog entry, saves and bills once, and edits the workspace file', async () => {
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
    expect((await executeImageGeneration(input)).path).toBe(result.path)
    expect(fetcher).toHaveBeenCalledOnce()
    const [charge] = await db.select().from(toolExecutions).where(eq(toolExecutions.operationId, input.operationId))
    expect(charge).toMatchObject({ billedCostMicros: 20_000, providerAttempts: [{ provider: 'openai-images', usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 } }] })
    await executeImageGeneration({ ...await turn(), args: { prompt: 'Make it blue', referenceImages: [{ path: result.path }] } })
    expect(fetcher.mock.calls[1]![0]).toBe('https://api.openai.com/v1/images/edits')
    const form = fetcher.mock.calls[1]![1]!.body as FormData
    expect(Buffer.from(await (form.get('image[]') as Blob).arrayBuffer())).toEqual(image)
    expect(exportFile).toHaveBeenCalledWith(result.path, undefined)
  })
  it.each(['attachment', 'workspace', 'shorthand'] as const)('normalizes an MPO from a %s before editing without replacing the source', async source => {
    const data = await readFile(new URL('./fixtures/oriented-mpo.jpg', import.meta.url))
    const id = randomUUID(), objectKey = `reference-${id}`
    const model = { ...config, ...OPENAI_IMAGE_PRESET, enabled: true }
    await db.update(imageModels).set({ config: model }).where(eq(imageModels.id, config.id))
    await db.update(providerConnections).set({ baseUrl: 'https://api.openai.com/v1' }).where(eq(providerConnections.id, providerId))
    if (source === 'attachment') {
      mocks.blobs.set(objectKey, data)
      await db.insert(attachments).values({ id, userId, chatId, objectKey, originalName: 'oriented-mpo.jpg', mimeType: 'image/jpeg', sizeBytes: data.length, status: 'ready' })
    } else exportFile.mockResolvedValue({ data })
    fetcher.mockImplementation(async () => Response.json({ data: [{ b64_json: image.toString('base64') }] }))
    const args = imageGenerationInputSchema.parse({ prompt: 'Make it blue', referenceImages: [source === 'attachment' ? { attachmentId: id } : source === 'shorthand' ? '/workspace/oriented-mpo.jpg' : { path: '/workspace/oriented-mpo.jpg' }] })
    await executeImageGeneration({ ...await turn(), args })
    expect(fetcher).toHaveBeenCalledOnce()
    const file = (fetcher.mock.calls[0]![1]!.body as FormData).get('image[]') as File
    const bytes = Buffer.from(await file.arrayBuffer())
    expect(file.type).toBe('image/jpeg')
    expect(bytes.includes(Buffer.from('MPF\0'))).toBe(false)
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 32, height: 64 })
    if (source === 'attachment') { expect(mocks.blobs.get(objectKey)).toEqual(data); expect(exportFile).not.toHaveBeenCalled() }
    else expect(exportFile).toHaveBeenCalledWith('/workspace/oriented-mpo.jpg', undefined)
  })
  it('persists Meta cached usage and bills combined output including reasoning', async () => {
    const token = imageModelSchema.parse({ ...config, billingUnit: 'tokens', reservationMicros: 20000,
      tokenPrices: { input: 2000000, cachedInput: 500000, output: 10000000 } })
    await db.update(imageModels).set({ config: token }).where(eq(imageModels.id, config.id))
    fetcher.mockImplementation(async () => Response.json({ status: 'completed', output: [{ type: 'image_generation_call', id: 'image-item', status: 'completed', result: image.toString('base64') }],
      usage: { input_tokens: 9996, input_tokens_details: { cached_tokens: 7936 }, output_tokens: 908, output_tokens_details: { reasoning_tokens: 161 }, total_tokens: 10904 } }))
    const input = await turn()
    const result = await executeImageGeneration(input)
    expect(result.billedCostMicros).toBe(17168)
    expect(result.metadata.usage).toMatchObject({ inputDetails: { cachedTokens: 7936 }, outputDetails: { reasoningTokens: 161 } })
    expect(input.reserveCost).toHaveBeenCalledExactlyOnceWith(20000)
    expect((await executeImageGeneration(input)).billedCostMicros).toBe(17168)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  async function tokenModel(reservationMicros = 100) {
    const token = imageModelSchema.parse({ ...config, ...OPENAI_IMAGE_PRESET, enabled: true, billUsers: true, billingUnit: 'tokens', reservationMicros })
    await db.update(imageModels).set({ config: token }).where(eq(imageModels.id, config.id))
    await db.update(providerConnections).set({ baseUrl: 'https://api.openai.com/v1' }).where(eq(providerConnections.id, providerId))
    fetcher.mockImplementation(async () => Response.json({ data: [{ b64_json: image.toString('base64') }], usage: { input_tokens: 30, input_tokens_details: { text_tokens: 10, image_tokens: 20 }, output_tokens: 10, total_tokens: 40 } }))
    return token // 10*5 + 20*8 + 10*30 = 510 microdollars.
  }
  async function fundedTurn(balanceMicros = 1000) {
    await db.update(users).set({ balanceMicros }).where(eq(users.id, userId))
    const input = await turn()
    const [pricing] = await db.insert(modelPricingVersions).values({ id: randomUUID(), modelId: chatModelId, inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0 }).returning()
    // Free text pricing leaves the entire balance available for image charges.
    expect(await reserveBudget({ responseId: input.responseId, userId, requestInput: [], maxOutputTokens: 1000, pricing: pricing! }))
      .toEqual({ amountMicros: 0, maxOutputTokens: 1000 })
    input.reserveCost.mockImplementation(async micros => { await extendBudgetReservationFixedCost(input.responseId, micros) })
    return input
  }
  const settle = (responseId: string, cost: number) => settleBudget({ responseId, usage: responseUsageSchema.parse({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }), latencyMs: 0, costMicrosOverride: cost })

  it.each([100, 800])('reserves %i, settles actual tokens once and releases unused funding', async hold => {
    await tokenModel(hold)
    const input = await fundedTurn()
    const result = await executeImageGeneration(input)
    expect(result.billedCostMicros).toBe(510)
    expect(input.reserveCost.mock.calls.map(call => call[0])).toEqual(hold < 510 ? [hold, 510 - hold] : [hold])
    expect((await executeImageGeneration(input)).path).toBe(result.path)
    await settle(input.responseId, result.billedCostMicros)
    await settle(input.responseId, result.billedCostMicros)
    expect((await db.select().from(users).where(eq(users.id, userId)))[0]?.balanceMicros).toBe(490)
    const [reservation] = await db.select().from(budgetReservations).where(eq(budgetReservations.responseId, input.responseId))
    expect(reservation).toMatchObject({ status: 'settled', settledAmountMicros: 510 })
    expect(await db.select().from(creditLedger).where(eq(creditLedger.responseId, input.responseId))).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('rejects an unaffordable token hold before calling the provider', async () => {
    await tokenModel(100)
    const input = await fundedTurn(50)
    await expect(executeImageGeneration(input)).rejects.toMatchObject({ code: 'insufficient_balance' })
    expect(fetcher).not.toHaveBeenCalled()
    expect(await db.select().from(attachments).where(eq(attachments.sourceResponseId, input.responseId))).toEqual([])
    await releaseBudget(input.responseId)
  })
  it('does not save or bill an image when the actual cost cannot be reserved', async () => {
    await tokenModel()
    const input = await fundedTurn(200)
    await expect(executeImageGeneration(input)).rejects.toMatchObject({ code: 'insufficient_balance' })
    expect(await db.select().from(attachments).where(eq(attachments.sourceResponseId, input.responseId))).toEqual([])
    expect((await db.select().from(toolExecutions).where(eq(toolExecutions.operationId, input.operationId)))[0]?.billedCostMicros).toBe(0)
    await recoverSavedImageGenerations(input.responseId, input.runId, manager)
    await expect(executeImageGeneration(input)).rejects.toThrow('already submitted')
    await releaseBudget(input.responseId)
    expect((await db.select().from(users).where(eq(users.id, userId)))[0]?.balanceMicros).toBe(200)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('fails token billing without usage rather than charging the flat fallback', async () => {
    await tokenModel()
    fetcher.mockImplementation(async () => Response.json({ data: [{ b64_json: image.toString('base64') }] }))
    const input = await turn()
    await expect(executeImageGeneration(input)).rejects.toMatchObject({ code: 'image_usage_invalid' })
    expect(await db.select().from(attachments).where(eq(attachments.sourceResponseId, input.responseId))).toEqual([])
    expect(input.reserveCost).toHaveBeenCalledExactlyOnceWith(100)
  })
  it('recovers token charges using the snapshot after pricing changes and cancellation', async () => {
    const original = await tokenModel(800)
    const input = await fundedTurn()
    fetcher.mockImplementationOnce(async () => {
      await db.update(imageModels).set({ config: { ...original, tokenPrices: { ...original.tokenPrices, imageOutput: 900000000 } } }).where(eq(imageModels.id, config.id))
      return Response.json({ data: [{ b64_json: image.toString('base64') }], usage: { input_tokens: 30, input_tokens_details: { text_tokens: 10, image_tokens: 20 }, output_tokens: 10, total_tokens: 40 } })
    })
    const result = await executeImageGeneration(input)
    expect(result.billedCostMicros).toBe(510)
    await db.update(imageGenerationRequests).set({ status: 'claimed', attachmentId: null, billedCostMicros: 0 }).where(eq(imageGenerationRequests.responseId, input.responseId))
    await db.update(toolExecutions).set({ status: 'running', billedCostMicros: 0 }).where(eq(toolExecutions.operationId, input.operationId))
    await db.update(responses).set({ status: 'cancelled' }).where(eq(responses.id, input.responseId))
    await preference(false)
    await recoverSavedImageGenerations(input.responseId, input.runId, manager)
    await recoverSavedImageGenerations(input.responseId, input.runId, manager)
    expect((await db.select().from(toolExecutions).where(eq(toolExecutions.operationId, input.operationId)))[0]?.billedCostMicros).toBe(510)
    await settle(input.responseId, 510)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('round trips token rates and normalizes restored legacy catalog entries', async () => {
    const token = await tokenModel()
    const patched = await server.inject({ method: 'PATCH', url: `/api/admin/image-models/${config.id}`, payload: token })
    expect(patched.statusCode).toBe(200)
    expect(patched.json()).toEqual(token)
    expect((await server.inject('/api/admin/image-models')).json().data).toEqual([token])
    expect((await server.inject('/api/image-models')).json().data[0]).toMatchObject({ tokenPrices: token.tokenPrices, billingUnit: 'tokens' })
    const { billingUnit: _unit, tokenPrices: _rates, reservationMicros: _hold, ...legacy } = config
    await db.update(imageModels).set({ config: legacy as ImageModel }).where(eq(imageModels.id, config.id))
    expect((await server.inject('/api/admin/image-models')).json().data[0]).toMatchObject({ billingUnit: 'images', imagePriceMicros: 10000 })
    expect((await server.inject('/api/image-models')).json().data[0]).toMatchObject({ billingUnit: 'images' })
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
  it('recovers a saved workspace image after interruption without another provider call', async () => {
    const input = await turn(), result = await executeImageGeneration(input)
    await db.update(imageGenerationRequests).set({ status: 'claimed', attachmentId: null, billedCostMicros: 0 }).where(eq(imageGenerationRequests.responseId, input.responseId))
    await db.update(toolExecutions).set({ status: 'running', billedCostMicros: 0 }).where(eq(toolExecutions.operationId, input.operationId))
    const { billingUnit: _unit, tokenPrices: _prices, reservationMicros: _hold, ...legacy } = config
    await db.update(imageGenerationRequests).set({ model: legacy as ImageModel }).where(eq(imageGenerationRequests.responseId, input.responseId))
    await preference(false)
    await recoverSavedImageGenerations(input.responseId, input.runId, manager)
    await recoverSavedImageGenerations(input.responseId, input.runId, manager)
    await preference()
    expect((await executeImageGeneration(input)).path).toBe(result.path)
    expect(fetcher).toHaveBeenCalledOnce()
    const [charge] = await db.select().from(toolExecutions).where(eq(toolExecutions.operationId, input.operationId))
    expect(charge!.billedCostMicros).toBe(10_000)
  })
  it('rejects another chat’s reference without loading it or charging', async () => {
    const originalTurn = await turn()
    const original = await storeGeneratedAttachment({ ...originalTurn, toolCallId: 'attached-reference', path: '/workspace/other-chat-reference.png', data: image })
    fetcher.mockClear()
    const input = await turn()
    await expect(executeImageGeneration({ ...input, chatId: randomUUID(), args: { prompt: 'Edit', referenceImages: [{ attachmentId: original.id }] } })).rejects.toThrow('not available in this chat')
    expect(fetcher).not.toHaveBeenCalled(); expect(input.reserveCost).not.toHaveBeenCalled()
  })
  it('resolves workspace files, rejects invalid images, and honors cancellation', async () => {
    const input = await turn()
    await expect(executeImageGeneration({ ...input, args: { prompt: 'Edit', referenceImages: [{ path: '/etc/reference.png' }] } })).rejects.toThrow('inside /workspace')
    expect(exportFile).not.toHaveBeenCalled()
    exportFile.mockRejectedValueOnce(new Error('internal controller error'))
    await expect(executeImageGeneration({ ...input, args: imageGenerationInputSchema.parse({ prompt: 'Edit', referenceImages: ['/workspace/missing.png'] }) })).rejects.toThrow('check the path')
    expect(fetcher).not.toHaveBeenCalled(); expect(input.reserveCost).not.toHaveBeenCalled()
    exportFile.mockResolvedValue({ data: image, sizeBytes: image.length })
    await executeImageGeneration({ ...input, args: { prompt: 'Edit', referenceImages: [{ path: '/workspace/reference.png' }] } })
    expect(exportFile).toHaveBeenCalledWith('/workspace/reference.png', undefined)
    fetcher.mockClear(); exportFile.mockResolvedValue({ data: Buffer.from('bad'), sizeBytes: 3 })
    await expect(executeImageGeneration({ ...await turn(), args: { prompt: 'Edit', referenceImages: [{ path: '/workspace/bad.png' }] } })).rejects.toThrow('Unsupported')
    await expect(executeImageGeneration({ ...await turn(), signal: AbortSignal.abort() })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('does not call the provider without balance or an available workspace, or bill failed writes', async () => {
    const noBalance = await turn(); noBalance.reserveCost.mockRejectedValueOnce(new Error('Insufficient balance'))
    await expect(executeImageGeneration(noBalance)).rejects.toThrow('Insufficient balance'); expect(fetcher).not.toHaveBeenCalled()
    ensureLease.mockRejectedValueOnce(new Error('Workspace unavailable'))
    await expect(executeImageGeneration(await turn())).rejects.toThrow('Workspace unavailable')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(executeImageGeneration({ ...await turn(), manager: { ...manager, continuedWithoutAgent: true } as WorkspaceManager })).rejects.toThrow('Workspace unavailable')
    expect(fetcher).not.toHaveBeenCalled()
    saveGeneratedFile.mockRejectedValueOnce(new Error('Workspace storage unavailable'))
    const failed = await turn()
    await expect(executeImageGeneration(failed)).rejects.toThrow('storage unavailable')
    await recoverSavedImageGenerations(failed.responseId, failed.runId, manager)
    const [charge] = await db.select().from(toolExecutions).where(eq(toolExecutions.operationId, failed.operationId))
    expect(charge!.billedCostMicros).toBe(0)
    expect(workspaceFiles.size).toBe(0)
    await expect(executeImageGeneration(failed)).rejects.toThrow('missing or changed')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('saves with a full attachment quota; only explicit attachment storage publishes the image', async () => {
    await db.update(users).set({ storageLimitBytes: 0 }).where(eq(users.id, userId))
    const input = await turn(), result = await executeImageGeneration(input)
    expect(result.billedCostMicros).toBe(10_000)
    expect(await db.select().from(attachments).where(eq(attachments.sourceResponseId, input.responseId))).toEqual([])
    const attachTool = createWorkspaceTools(manager, 1000, undefined, async (toolCallId, path, requestedName, signal) => {
      const file = await manager.exportFile(path, signal)
      return storeGeneratedAttachment({ ...input, toolCallId, path, requestedName, data: file.data })
    }).find(tool => tool.name === 'attach_file')!
    const attach = () => attachTool.execute('explicit-attach', { path: result.path })
    await expect(attach()).rejects.toThrow('storage allowance')
    await db.update(users).set({ storageLimitBytes: 100_000_000 }).where(eq(users.id, userId))
    const attached = await attach()
    expect(await attach()).toEqual(attached)
    expect(await db.select().from(attachments).where(eq(attachments.sourceResponseId, input.responseId))).toEqual([expect.objectContaining({ sourceToolCallId: 'explicit-attach', workspacePath: result.path, status: 'ready' })])
    expect((await executeImageGeneration(input)).billedCostMicros).toBe(10_000)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('recovers a lost write acknowledgement, including cancellation after the bytes were saved', async () => {
    const controller = new AbortController()
    saveGeneratedFile.mockImplementationOnce(async (path: string, data: Uint8Array) => {
      workspaceFiles.set(path, data)
      controller.abort()
      throw new Error('Write acknowledgement lost')
    })
    const input = await turn()
    const result = await executeImageGeneration({ ...input, signal: controller.signal })
    expect(result.billedCostMicros).toBe(10_000)
    expect(readGeneratedFile).toHaveBeenCalledWith(result.path, 'image-test-lease')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each(['missing', 'modified'])('never regenerates or recovers a %s workspace file', async state => {
    const input = await turn(), result = await executeImageGeneration(input)
    await db.update(imageGenerationRequests).set({ status: 'claimed', billedCostMicros: 0 }).where(eq(imageGenerationRequests.responseId, input.responseId))
    await db.update(toolExecutions).set({ status: 'running', billedCostMicros: 0 }).where(eq(toolExecutions.operationId, input.operationId))
    if (state === 'missing') workspaceFiles.delete(result.path)
    else workspaceFiles.set(result.path, Buffer.from('modified'))
    ensureLease.mockClear()
    await recoverSavedImageGenerations(input.responseId, input.runId, manager)
    await expect(executeImageGeneration(input)).rejects.toMatchObject({ code: 'image_workspace_unavailable' })
    expect((await db.select().from(toolExecutions).where(eq(toolExecutions.operationId, input.operationId)))[0]?.billedCostMicros).toBe(0)
    expect(ensureLease).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('still recovers legacy attachment saves and reuses their image item without another generation', async () => {
    const input = await turn()
    const attachment = await storeGeneratedAttachment({ ...input, toolCallId: input.operationId, path: '/workspace/legacy.png', data: image })
    await db.insert(imageGenerationRequests).values({ responseId: input.responseId, operationId: input.operationId, model: config, result: { text: '', imageItem: { id: 'legacy-image-item', type: 'image_generation_call', status: 'completed' } } })
    await recoverSavedImageGenerations(input.responseId, input.runId, manager)
    const result = await executeImageGeneration(input)
    expect(workspaceFiles.get(result.path)).toEqual(image)
    expect(result.billedCostMicros).toBe(10_000)
    expect(fetcher).not.toHaveBeenCalled()
    await executeImageGeneration({ ...await turn(), args: { prompt: 'Make it blue', referenceImages: [{ attachmentId: attachment.id }] } })
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject({ store: false, input: [{ id: 'legacy-image-item', type: 'image_generation_call', result: image.toString('base64') }, { role: 'user' }] })
  })
  it('writes through the real manager and recovers only from the original authorized lease', async () => {
    const isolatedChatId = randomUUID(), leaseId = randomUUID(), controllerId = 'original-image-lease'
    const controllerRequest = vi.mocked(workspaceControllerRequest)
    const settings = getConfig()
    const originalUrl = settings.WORKSPACE_CONTROLLER_URL, originalToken = settings.WORKSPACE_CONTROLLER_TOKEN
    settings.WORKSPACE_CONTROLLER_URL = 'http://controller.test'
    settings.WORKSPACE_CONTROLLER_TOKEN = 'fixture-controller-token'
    await db.insert(chats).values({ id: isolatedChatId, userId, modelId: chatModelId })
    const responseId = randomUUID()
    await db.insert(responses).values({ id: responseId, chatId: isolatedChatId, userId, modelId: chatModelId, input: [], agentMode: true })
    await db.insert(workspaceLeases).values({ id: leaseId, responseId, chatId: isolatedChatId, userId, controllerLeaseId: controllerId, status: 'ready', imageDigest: 'test-image' })
    try {
      const workspace = new WorkspaceManager(responseId, isolatedChatId, userId)
      await expect(workspace.ensureLease()).resolves.toBe(controllerId)
      controllerRequest.mockResolvedValueOnce(Response.json({ saved: true }))
      const path = '/workspace/generated-image.png'
      await workspace.saveGeneratedFile(path, image, 'image/png', controllerId)
      expect(controllerRequest).toHaveBeenLastCalledWith(`/v1/leases/${controllerId}/v1/files?path=${encodeURIComponent(path)}`, expect.objectContaining({ method: 'PUT', body: image }))
      expect((await db.select().from(workspaceLeases).where(eq(workspaceLeases.id, leaseId)))[0]?.lastUsedAt).toBeInstanceOf(Date)
      controllerRequest.mockReset().mockImplementation(async () => new Response(new Uint8Array(image)))
      const reader = new WorkspaceManager(responseId, isolatedChatId, userId)
      expect(await reader.readGeneratedFile(path, controllerId)).toMatchObject({ data: new Uint8Array(image), sizeBytes: image.length })
      const calls = controllerRequest.mock.calls.length
      await expect(reader.saveGeneratedFile(path, image, 'image/png', controllerId)).rejects.toThrow('original image workspace')
      await expect(new WorkspaceManager(randomUUID(), chatId, userId).readGeneratedFile(path, controllerId)).rejects.toThrow('original image workspace')
      await expect(new WorkspaceManager(randomUUID(), isolatedChatId, randomUUID()).readGeneratedFile(path, controllerId)).rejects.toThrow('original image workspace')
      await expect(new WorkspaceManager(randomUUID(), isolatedChatId, userId).readGeneratedFile(path, controllerId)).rejects.toThrow('original image workspace')
      await expect(reader.readGeneratedFile(path, 'replacement-lease')).rejects.toThrow('original image workspace')
      await expect(reader.readGeneratedFile('/etc/image.png', controllerId)).rejects.toThrow('inside /workspace')
      expect(controllerRequest).toHaveBeenCalledTimes(calls)
      controllerRequest.mockResolvedValueOnce(new Response('Expired', { status: 404 }))
      await expect(reader.readGeneratedFile(path, controllerId)).rejects.toThrow()
      expect(controllerRequest).toHaveBeenCalledTimes(calls + 1)
      await db.update(workspaceLeases).set({ status: 'expired' }).where(eq(workspaceLeases.id, leaseId))
      await expect(reader.readGeneratedFile(path, controllerId)).rejects.toThrow('original image workspace')
      expect(controllerRequest).toHaveBeenCalledTimes(calls + 1)
      expect(await db.select().from(workspaceLeases).where(eq(workspaceLeases.chatId, isolatedChatId))).toHaveLength(1)
    } finally {
      settings.WORKSPACE_CONTROLLER_URL = originalUrl; settings.WORKSPACE_CONTROLLER_TOKEN = originalToken
      controllerRequest.mockReset()
      await db.delete(chats).where(eq(chats.id, isolatedChatId))
    }
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
