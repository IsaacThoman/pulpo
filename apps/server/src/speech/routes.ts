import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { SPEECH_DURATION_HEADER, SPEECH_REQUEST_BODY_LIMIT, speechModelSchema, speechRequestSchema, type SpeechModel, type PublicSpeechModel } from '@pulpo/contracts'
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
import { applyVoiceWatermark, registerSpeechAssetRoutes } from './assets.js'
import { lockSpeechResources, queueSpeechCleanup, retrySpeechCleanup } from './resources.js'
import { readSpeechDefaults, registerSpeechDefaultsRoutes } from './defaults.js'
import type { SpeechVoiceAssets } from './asset-types.js'

export function publicSpeechModel(model: SpeechModel, previews: Array<{ voiceId: string }> = []): PublicSpeechModel {
  const { providerConnectionId: _provider, upstreamModelId: _upstream, ...value } = model
  return { ...value, adapter: value.adapter ?? 'openai', voices: value.voices.map(voice => ({ id: voice.id, label: voice.label, ...(voice.kind ? { kind: voice.kind } : {}), previewAvailable: previews.some(clip => clip.voiceId === voice.id) })) }
}
export function validateVoiceAssets(model: SpeechModel, assets: SpeechVoiceAssets[]) {
  for (const voice of model.voices) {
    const asset = assets.find(a => a.voiceId === voice.id)
    if (Boolean(asset?.clone) !== (voice.kind === 'cloned')) throw new AppError(400, 'speech_clone_invalid', 'Create or replace cloned voices using an audio upload')
    if (voice.watermark?.enabled && !asset?.watermark) throw new AppError(400, 'speech_watermark_required', 'Upload a watermark before enabling it')
  }
}
export function validateSpeechInput(model: SpeechModel, input: ReturnType<typeof speechRequestSchema.parse>) {
  if (!model.voices.some(voice => voice.id === input.voice)) throw new AppError(400, 'speech_voice_invalid', 'Choose an available speech voice')
  if ((!model.supportsInstructions && input.instructions !== undefined) || (!model.supportsSpeed && input.speed !== undefined)) throw new AppError(400, 'speech_control_unsupported', 'This speech model does not support the selected controls')
  if (input.speed !== undefined && (input.speed < model.speedMin || input.speed > model.speedMax)) throw new AppError(400, 'speech_speed_invalid', 'Speech speed is outside the supported range')
  if (!input.input.trim() || Array.from(input.input).length > model.maxInputCharacters || (model.maxInputTokens !== null && speechBytes(input.input) + speechBytes(input.instructions ?? '') > model.maxInputTokens)) throw new AppError(400, 'speech_input_limit', 'Speech input exceeds this model’s limits')
}
export async function registerSpeechRoutes(app: FastifyInstance) {
  registerSpeechDefaultsRoutes(app)
  await registerSpeechPreviewRoutes(app)
  await registerSpeechAssetRoutes(app)
  app.get('/api/admin/speech-models', async request => {
    requireAdmin(request)
    return { data: (await db.select().from(speechModels)).map(row => ({ ...row.config, adapter: row.config.adapter ?? 'openai', voices: row.config.voices.map(voice => ({ ...voice, referenceAvailable: Boolean(row.voiceAssets?.find(a => a.voiceId === voice.id)?.clone), watermarkAvailable: Boolean(row.voiceAssets?.find(a => a.voiceId === voice.id)?.watermark), previewAvailable: row.voicePreviews.some(clip => clip.voiceId === voice.id) })) })).sort((a,b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)) }
  })
  app.get('/api/speech-models', async request => {
    requireUser(request)
    const rows = await db.select({ config: speechModels.config, enabled: providerConnections.enabled, voicePreviews: speechModels.voicePreviews }).from(speechModels).innerJoin(providerConnections, eq(providerConnections.id, speechModels.providerConnectionId))
    const data = rows.filter(row => row.enabled && row.config.enabled).map(row => publicSpeechModel(row.config, row.voicePreviews)).sort((a,b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    const defaults = await readSpeechDefaults()
    return { data, defaultModelId: data.some(model => model.id === defaults.modelId) ? defaults.modelId : null }
  })
  const save = async (request: Parameters<typeof requireAdmin>[0], create: boolean) => {
    const admin = requireAdmin(request)
    const model = speechModelSchema.parse(request.body)
    if (!create && (request.params as { id: string }).id !== model.id) throw new AppError(400, 'speech_id_immutable', 'Model IDs cannot be changed')
    const [provider] = await db.select().from(providerConnections).where(eq(providerConnections.id, model.providerConnectionId)).limit(1)
    if (!provider || !provider.encryptedApiKey) throw new AppError(400, 'speech_provider_invalid', 'Choose a provider with an API key')
    await assertSafeProviderUrl(provider.baseUrl)
    const removedKeys: string[] = []
    await db.transaction(async tx => {
      await lockSpeechResources(tx)
      if (create) {
        validateVoiceAssets(model, [])
        const rows = await tx.insert(speechModels).values({ id: model.id, providerConnectionId: model.providerConnectionId, config: model }).onConflictDoNothing().returning()
        if (!rows.length) throw new AppError(409, 'speech_model_exists', 'This speech model ID already exists')
      } else {
        const [current] = await tx.select().from(speechModels).where(eq(speechModels.id, model.id)).for('update')
        if (!current) throw new AppError(404, 'speech_model_missing', 'Speech model not found')
        if (current.providerConnectionId !== model.providerConnectionId || (current.config.adapter ?? 'openai') !== model.adapter) {
          if (current.voiceAssets?.some(a => a.clone)) throw new AppError(400, 'speech_provider_bound', 'Remove cloned voices before changing the provider or adapter')
        }
        // Older admin clients may omit newer optional voice settings.
        model.voices = model.voices.map(voice => {
          const previous = current.config.voices.find(v => v.id === voice.id)
          return { ...voice, ...(voice.kind === undefined && previous?.kind ? { kind: previous.kind } : {}), ...(voice.watermark === undefined && previous?.watermark ? { watermark: previous.watermark } : {}) }
        })
        const retainedAssets = (current.voiceAssets ?? []).filter(a => model.voices.some(v => v.id === a.voiceId))
        validateVoiceAssets(model, retainedAssets)
        await queueSpeechCleanup(tx, current.providerConnectionId, (current.voiceAssets ?? []).filter(a => !retainedAssets.includes(a)))
        const retained = current.voicePreviews.filter(clip => model.voices.some(voice => voice.id === clip.voiceId))
        removedKeys.push(...current.voicePreviews.filter(clip => !retained.includes(clip)).map(clip => clip.objectKey))
        const rows = await tx.update(speechModels).set({ config: model, voiceAssets: retainedAssets, voicePreviews: retained, providerConnectionId: model.providerConnectionId, updatedAt: new Date() }).where(eq(speechModels.id, model.id)).returning()
        if (!rows.length) throw new AppError(404, 'speech_model_missing', 'Speech model not found')
      }
      await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: create ? 'speech_model.created' : 'speech_model.updated', targetType: 'speech_model', targetId: model.id })
    })
    for (const key of removedKeys) await cleanupSpeechPreview(key, request)
    await retrySpeechCleanup(request)
    return model
  }
  app.post('/api/admin/speech-models', async (request, reply) => reply.code(201).send(await save(request, true)))
  app.patch('/api/admin/speech-models/:id', request => save(request, false))
  app.delete('/api/admin/speech-models/:id', async (request, reply) => {
    const admin = requireAdmin(request); const { id } = request.params as { id: string }
    const deleted = await db.transaction(async tx => {
      await lockSpeechResources(tx)
      const [model] = await tx.delete(speechModels).where(eq(speechModels.id, id)).returning()
      if (model) await queueSpeechCleanup(tx, model.providerConnectionId, model.voiceAssets ?? [])
      await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'speech_model.deleted', targetType: 'speech_model', targetId: id })
      return model
    })
    for (const clip of deleted?.voicePreviews ?? []) await cleanupSpeechPreview(clip.objectKey, request)
    await retrySpeechCleanup(request)
    return reply.code(204).send()
  })
  app.post('/api/speech', { bodyLimit: SPEECH_REQUEST_BODY_LIMIT, config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = requireUser(request)
    const input = speechRequestSchema.parse(request.body)
    const [row] = await db.select({ config: speechModels.config, voiceAssets: speechModels.voiceAssets, provider: providerConnections }).from(speechModels).innerJoin(providerConnections, eq(providerConnections.id, speechModels.providerConnectionId)).where(eq(speechModels.id, input.modelId)).limit(1)
    if (!row || !row.config.enabled || !row.provider.enabled) throw new AppError(404, 'speech_model_unavailable', 'Choose an available speech model in Settings')
    const { provider } = row
    const model = speechModelSchema.parse(row.config)
    validateSpeechInput(model, input)
    validateVoiceAssets({ ...model, voices: model.voices.filter(voice => voice.id === input.voice) }, row.voiceAssets ?? [])
    const clone = row.voiceAssets?.find(a => a.voiceId === input.voice)?.clone
    await assertSafeProviderUrl(provider.baseUrl)
    const claims = await db.insert(speechRequests).values({ userId: user.id, requestId: input.requestId }).onConflictDoNothing().returning()
    if (!claims.length) throw new AppError(409, 'speech_duplicate_request', 'This speech request was already submitted')
    const controller = new AbortController()
    const close = () => { if (!reply.raw.writableFinished) controller.abort() }
    reply.raw.on('close', close)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.min(provider.requestTimeoutMs, 120_000))])
    try {
      const result = await generateSpeech({ baseUrl: provider.baseUrl, apiKey: decryptSecret(provider.encryptedApiKey, getConfig().ENCRYPTION_KEY), organizationId: provider.organizationId, projectId: provider.projectId, model, input, signal, upstreamVoiceId: clone?.upstreamVoiceId })
      signal.throwIfAborted()
      const audio = await applyVoiceWatermark(result.audio, row, input.voice, model.responseFormat, input.playbackOffsetSeconds ?? 0, signal)
      signal.throwIfAborted()
      const costMicros = speechCost(model, input.input, result.durationSeconds, result.usage)
      if (costMicros) await chargeMeteredUsage({ userId: user.id, costMicros, type: 'speech', metadata: {
        requestId: input.requestId, modelId: model.id, modelName: model.name, upstreamModelId: model.upstreamModelId, providerId: provider.id,
        billingUnit: model.billingUnit, characters: Array.from(input.input).length, durationSeconds: result.durationSeconds,
        inputTokens: result.usage?.input_tokens, outputTokens: result.usage?.output_tokens,
        inputPriceMicros: model.inputPriceMicros, outputPriceMicros: model.outputPriceMicros,
        characterPriceMicros: model.characterPriceMicros, minutePriceMicros: model.minutePriceMicros,
      } })
      return reply.header('cache-control', 'no-store').header(SPEECH_DURATION_HEADER, String(result.durationSeconds)).type(model.responseFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav').send(audio)
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(signal.aborted ? 408 : 502, 'speech_failed', signal.aborted ? 'Speech generation was cancelled or timed out' : 'Speech generation failed')
    } finally { reply.raw.off('close', close) }
  })
}
