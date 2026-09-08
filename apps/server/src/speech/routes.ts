import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { speechModelSchema, speechRequestSchema, type SpeechModel, type PublicSpeechModel } from '@pulpo/contracts'
import { speechBytes } from '@pulpo/client-core'
import { requireAdmin, requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { auditEvents, providerConnections, speechModels, speechRequests } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { assertSafeProviderUrl } from '../lib/url-security.js'
import { decryptSecret } from '../lib/crypto.js'
import { getConfig } from '../config.js'
import { newId } from '../lib/ids.js'
import { chargeMeteredUsage } from '../accounting/service.js'
import { generateSpeech, speechCost } from './provider.js'
import { cleanupSpeechPreview, registerSpeechPreviewRoutes } from './preview.js'

export function publicSpeechModel(model: SpeechModel, previewAvailable = false): PublicSpeechModel {
  const { providerConnectionId: _provider, upstreamModelId: _upstream, ...value } = model
  return { ...value, previewAvailable }
}
export function validateSpeechInput(model: SpeechModel, input: ReturnType<typeof speechRequestSchema.parse>) {
  if (!model.voices.some(voice => voice.id === input.voice)) throw new AppError(400, 'speech_voice_invalid', 'Choose an available speech voice')
  if ((!model.supportsInstructions && input.instructions !== undefined) || (!model.supportsSpeed && input.speed !== undefined)) throw new AppError(400, 'speech_control_unsupported', 'This speech model does not support the selected controls')
  if (input.speed !== undefined && (input.speed < model.speedMin || input.speed > model.speedMax)) throw new AppError(400, 'speech_speed_invalid', 'Speech speed is outside the supported range')
  if (!input.input.trim() || Array.from(input.input).length > model.maxInputCharacters || (model.maxInputTokens !== null && speechBytes(input.input) + speechBytes(input.instructions ?? '') > model.maxInputTokens)) throw new AppError(400, 'speech_input_limit', 'Speech input exceeds this model’s limits')
}
export async function registerSpeechRoutes(app: FastifyInstance) {
  await registerSpeechPreviewRoutes(app)
  app.get('/api/admin/speech-models', async request => {
    requireAdmin(request)
    return { data: (await db.select().from(speechModels)).map(row => ({ ...row.config, previewAvailable: Boolean(row.previewObjectKey) })).sort((a,b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)) }
  })
  app.get('/api/speech-models', async request => {
    requireUser(request)
    const rows = await db.select({ config: speechModels.config, enabled: providerConnections.enabled, previewObjectKey: speechModels.previewObjectKey }).from(speechModels).innerJoin(providerConnections, eq(providerConnections.id, speechModels.providerConnectionId))
    return { data: rows.filter(row => row.enabled && row.config.enabled).map(row => publicSpeechModel(row.config, Boolean(row.previewObjectKey))).sort((a,b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)) }
  })
  const save = async (request: Parameters<typeof requireAdmin>[0], create: boolean) => {
    const admin = requireAdmin(request)
    const model = speechModelSchema.parse(request.body)
    if (!create && (request.params as { id: string }).id !== model.id) throw new AppError(400, 'speech_id_immutable', 'Model IDs cannot be changed')
    const [provider] = await db.select().from(providerConnections).where(eq(providerConnections.id, model.providerConnectionId)).limit(1)
    if (!provider || !provider.encryptedApiKey) throw new AppError(400, 'speech_provider_invalid', 'Choose a provider with an API key')
    await assertSafeProviderUrl(provider.baseUrl)
    await db.transaction(async tx => {
      if (create) {
        const rows = await tx.insert(speechModels).values({ id: model.id, providerConnectionId: model.providerConnectionId, config: model }).onConflictDoNothing().returning()
        if (!rows.length) throw new AppError(409, 'speech_model_exists', 'This speech model ID already exists')
      } else {
        const rows = await tx.update(speechModels).set({ config: model, providerConnectionId: model.providerConnectionId, updatedAt: new Date() }).where(eq(speechModels.id, model.id)).returning()
        if (!rows.length) throw new AppError(404, 'speech_model_missing', 'Speech model not found')
      }
      await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: create ? 'speech_model.created' : 'speech_model.updated', targetType: 'speech_model', targetId: model.id })
    })
    return model
  }
  app.post('/api/admin/speech-models', async (request, reply) => reply.code(201).send(await save(request, true)))
  app.patch('/api/admin/speech-models/:id', request => save(request, false))
  app.delete('/api/admin/speech-models/:id', async (request, reply) => {
    const admin = requireAdmin(request); const { id } = request.params as { id: string }
    const deleted = await db.transaction(async tx => {
      const [model] = await tx.delete(speechModels).where(eq(speechModels.id, id)).returning()
      await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'speech_model.deleted', targetType: 'speech_model', targetId: id })
      return model
    })
    await cleanupSpeechPreview(deleted?.previewObjectKey, request)
    return reply.code(204).send()
  })
  app.post('/api/speech', { bodyLimit: 96 * 1024, config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = requireUser(request)
    const input = speechRequestSchema.parse(request.body)
    const [row] = await db.select({ config: speechModels.config, provider: providerConnections }).from(speechModels).innerJoin(providerConnections, eq(providerConnections.id, speechModels.providerConnectionId)).where(eq(speechModels.id, input.modelId)).limit(1)
    if (!row || !row.config.enabled || !row.provider.enabled) throw new AppError(404, 'speech_model_unavailable', 'Choose an available speech model in Settings')
    const { config: model, provider } = row
    validateSpeechInput(model, input)
    await assertSafeProviderUrl(provider.baseUrl)
    const claims = await db.insert(speechRequests).values({ userId: user.id, requestId: input.requestId }).onConflictDoNothing().returning()
    if (!claims.length) throw new AppError(409, 'speech_duplicate_request', 'This speech request was already submitted')
    const controller = new AbortController()
    const close = () => { if (!reply.raw.writableFinished) controller.abort() }
    reply.raw.on('close', close)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.min(provider.requestTimeoutMs, 120_000))])
    try {
      const result = await generateSpeech({ baseUrl: provider.baseUrl, apiKey: decryptSecret(provider.encryptedApiKey, getConfig().ENCRYPTION_KEY), organizationId: provider.organizationId, projectId: provider.projectId, model, input, signal })
      signal.throwIfAborted()
      const costMicros = speechCost(model, input.input, result.durationSeconds, result.usage)
      if (costMicros) await chargeMeteredUsage({ userId: user.id, costMicros, type: 'speech', metadata: {
        requestId: input.requestId, modelId: model.id, modelName: model.name, upstreamModelId: model.upstreamModelId, providerId: provider.id,
        billingUnit: model.billingUnit, characters: Array.from(input.input).length, durationSeconds: result.durationSeconds,
        inputTokens: result.usage?.input_tokens, outputTokens: result.usage?.output_tokens,
        inputPriceMicros: model.inputPriceMicros, outputPriceMicros: model.outputPriceMicros,
        characterPriceMicros: model.characterPriceMicros, minutePriceMicros: model.minutePriceMicros,
      } })
      return reply.header('cache-control', 'no-store').type(model.responseFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav').send(result.audio)
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(signal.aborted ? 408 : 502, 'speech_failed', signal.aborted ? 'Speech generation was cancelled or timed out' : 'Speech generation failed')
    } finally { reply.raw.off('close', close) }
  })
}
