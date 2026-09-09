import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { SPEECH_ASSET_MAX_BYTES, speechModelSchema, speechWatermarkSchema } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { auditEvents, speechModels, speechResourceCleanup } from '../database/schema.js'
import { requireAdmin } from '../auth/service.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'
import { normalizeSpeechAsset, mixSpeechWatermark } from './audio.js'
import { createMistralVoice, listMistralVoices, mistralRequest } from './mistral.js'
import { generateSpeech } from './provider.js'
import { lockSpeechResources, queueSpeechCleanup, retrySpeechCleanup, speechConnection } from './resources.js'
import type { SpeechVoiceAssets } from './asset-types.js'

const paramsSchema = z.object({ id: z.string().min(1).max(120), voiceId: z.string().min(1).max(200).optional() })
async function modelFor(request: FastifyRequest) {
  requireAdmin(request)
  const { id } = paramsSchema.parse(request.params)
  const [row] = await db.select().from(speechModels).where(eq(speechModels.id, id)).limit(1)
  if (!row) throw notFound('Speech model')
  return row
}
function requestSignal(request: FastifyRequest, reply: FastifyReply) {
  const controller = new AbortController()
  const close = () => { if (!reply.raw.writableFinished) controller.abort() }
  reply.raw.on('close', close)
  return { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]), dispose: () => reply.raw.off('close', close) }
}
export async function readSpeechUpload(request: FastifyRequest) {
  try {
    const file = await request.file({ limits: { fileSize: SPEECH_ASSET_MAX_BYTES, files: 1, fields: 0, parts: 1 } })
    if (!file) throw new AppError(400, 'speech_asset_required', 'Choose an audio clip')
    const bytes = await file.toBuffer()
    if (file.file.truncated) throw new Error('FST_REQ_FILE_TOO_LARGE')
    return bytes
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(413, 'speech_asset_size', 'Choose one audio file up to 10 MiB')
  }
}
export async function applyVoiceWatermark(audio: Buffer, model: { config: { voices: Array<{ id: string; watermark?: { enabled: boolean; volume: number } }> }; voiceAssets?: SpeechVoiceAssets[] }, voiceId: string, format: 'mp3' | 'wav', offsetSeconds: number, signal: AbortSignal) {
  const settings = model.config.voices.find(voice => voice.id === voiceId)?.watermark
  if (!settings?.enabled) return audio
  const asset = model.voiceAssets?.find(asset => asset.voiceId === voiceId)?.watermark
  if (!asset) throw new AppError(502, 'speech_watermark_failed', 'This voice is missing its watermark. Ask an admin to replace it.')
  try { return await mixSpeechWatermark(audio, Buffer.from(await getBlobStore().get(asset.objectKey)), { format, volume: settings.volume, offsetSeconds, signal }) }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError(502, 'speech_watermark_failed', 'The voice watermark could not be loaded. Ask an admin to check its clip.') }
}
async function uploadAsset(request: FastifyRequest, reply: FastifyReply, kind: 'clone' | 'watermark', repair = false) {
  const admin = requireAdmin(request); const row = await modelFor(request)
  const { voiceId } = paramsSchema.parse(request.params)
  const voice = row.config.voices.find(voice => voice.id === voiceId)
  if (!voice || !voiceId) throw notFound('Speech voice')
  if (kind === 'clone' && row.config.adapter !== 'mistral') throw new AppError(400, 'speech_adapter_invalid', 'Cloning requires a Mistral speech model')
  const pending = requestSignal(request, reply)
  const jobId = newId(); const objectKey = `speech-assets/${jobId}.wav`
  let staged = false
  try {
    const oldReference = (row.voiceAssets ?? []).find(asset => asset.voiceId === voiceId)?.clone
    if (repair && !oldReference) throw notFound('Cloning reference')
    const bytes = repair ? Buffer.from(await getBlobStore().get(oldReference!.objectKey)) : await readSpeechUpload(request)
    const normalized = await normalizeSpeechAsset(bytes, kind, pending.signal)
    const slug = kind === 'clone' ? `pulpo-${jobId}` : null
    await db.insert(speechResourceCleanup).values({ id: jobId, objectKeys: [objectKey], providerConnectionId: kind === 'clone' ? row.providerConnectionId : null, slug, readyAt: new Date(Date.now() + 10 * 60_000) })
    staged = true
    await getBlobStore().put(objectKey, normalized.audio, { contentType: normalized.contentType, contentLength: normalized.audio.length })
    const blob = { objectKey, contentType: normalized.contentType, durationSeconds: normalized.durationSeconds, checksum: createHash('sha256').update(normalized.audio).digest('hex') }
    let upstreamVoiceId: string | undefined
    if (kind === 'clone') {
      upstreamVoiceId = await createMistralVoice(await speechConnection(row.providerConnectionId, pending.signal), voice.label, normalized.audio, slug!)
      await db.update(speechResourceCleanup).set({ upstreamVoiceId }).where(eq(speechResourceCleanup.id, jobId))
    }
    pending.signal.throwIfAborted()
    await db.transaction(async tx => {
      await lockSpeechResources(tx)
      const [current] = await tx.select().from(speechModels).where(eq(speechModels.id, row.id)).for('update')
      if (!current || current.updatedAt.getTime() !== row.updatedAt.getTime()) throw new AppError(409, 'speech_model_changed', 'The speech model changed during upload. Reload it and try again.')
      const assets = [...(current.voiceAssets ?? [])]; const previous = assets.find(asset => asset.voiceId === voiceId)
      const replaced = { ...previous, voiceId, [kind]: kind === 'clone' ? { ...blob, upstreamVoiceId: upstreamVoiceId! } : blob }
      const removed: SpeechVoiceAssets = { voiceId, ...(kind === 'clone' && previous?.clone ? { clone: previous.clone } : {}), ...(kind === 'watermark' && previous?.watermark ? { watermark: previous.watermark } : {}) }
      await queueSpeechCleanup(tx, row.providerConnectionId, [removed])
      const config = speechModelSchema.parse({ ...current.config, voices: current.config.voices.map(v => v.id === voiceId ? { ...v, ...(kind === 'clone' ? { kind: 'cloned' } : { watermark: v.watermark ?? { enabled: false, volume: 0.15 } }) } : v) })
      if (kind === 'clone') {
        const oldPreview = current.voicePreviews.find(clip => clip.voiceId === voiceId)
        if (oldPreview) await tx.insert(speechResourceCleanup).values({ id: newId(), objectKeys: [oldPreview.objectKey] })
      }
      await tx.update(speechModels).set({ config, ...(kind === 'clone' ? { voicePreviews: current.voicePreviews.filter(clip => clip.voiceId !== voiceId) } : {}), voiceAssets: [...assets.filter(asset => asset.voiceId !== voiceId), replaced], updatedAt: new Date() }).where(eq(speechModels.id, row.id))
      await tx.delete(speechResourceCleanup).where(eq(speechResourceCleanup.id, jobId))
      await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: `speech_${kind}.${repair ? 'repaired' : 'updated'}`, targetType: 'speech_model', targetId: row.id, metadata: { voiceId } })
    })
    staged = false
    await retrySpeechCleanup(request)
    return reply.code(201).send({ voiceId, available: true })
  } catch (error) {
    // Keep uncertain provider creation staged for reconciliation after its timeout.
    if (staged) await db.update(speechResourceCleanup).set({ error: 'Upload was not published. Cleanup can be retried after its staging timeout.', updatedAt: new Date() }).where(eq(speechResourceCleanup.id, jobId))
    if (error instanceof AppError) throw error
    throw new AppError(502, 'speech_asset_failed', 'Audio upload or voice creation failed. The previous asset was preserved.')
  } finally { pending.dispose() }
}
async function deleteAsset(request: FastifyRequest, reply: FastifyReply, kind: 'clone' | 'watermark') {
  const admin = requireAdmin(request); const { id, voiceId } = paramsSchema.parse(request.params)
  await db.transaction(async tx => {
    await lockSpeechResources(tx)
    const [row] = await tx.select().from(speechModels).where(eq(speechModels.id, id)).for('update')
    if (!row) throw notFound('Speech model')
    const asset = (row.voiceAssets ?? []).find(asset => asset.voiceId === voiceId)
    if (!asset?.[kind]) return
    if (kind === 'clone') throw new AppError(400, 'speech_clone_remove', 'Remove the cloned voice from the model to delete its reference and provider voice')
    await queueSpeechCleanup(tx, row.providerConnectionId, [{ voiceId: voiceId!, watermark: asset.watermark }])
    const config = { ...row.config, voices: row.config.voices.map(v => v.id === voiceId ? { ...v, watermark: { enabled: false, volume: v.watermark?.volume ?? 0.15 } } : v) }
    await tx.update(speechModels).set({ config, voiceAssets: row.voiceAssets.map(a => a.voiceId === voiceId ? { voiceId: a.voiceId, ...(a.clone ? { clone: a.clone } : {}) } : a), updatedAt: new Date() }).where(eq(speechModels.id, id))
    await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'speech_watermark.deleted', targetType: 'speech_model', targetId: id, metadata: { voiceId } })
  })
  await retrySpeechCleanup(request); return reply.code(204).send()
}
async function downloadAsset(request: FastifyRequest, reply: FastifyReply, kind: 'clone' | 'watermark') {
  const row = await modelFor(request); const { voiceId } = paramsSchema.parse(request.params)
  const asset = (row.voiceAssets ?? []).find(a => a.voiceId === voiceId)?.[kind]
  if (!asset) throw notFound('Voice audio asset')
  return reply.header('cache-control', 'no-store').header('x-content-type-options', 'nosniff').type('audio/wav').send(Buffer.from(await getBlobStore().get(asset.objectKey)))
}
export async function registerSpeechAssetRoutes(app: FastifyInstance, prefix = '/api/admin/speech-models') {
  app.get(`${prefix}/cleanup`, async request => {
    requireAdmin(request)
    return { data: (await db.select().from(speechResourceCleanup)).map(job => ({ id: job.id, readyAt: job.readyAt.toISOString(), error: job.error })) }
  })
  app.post(`${prefix}/cleanup/:cleanupId/retry`, async request => {
    requireAdmin(request); const { cleanupId } = z.object({ cleanupId: z.string().uuid() }).parse(request.params)
    await retrySpeechCleanup(request, cleanupId); return { ok: true }
  })
  app.get(`${prefix}/:id/provider-voices`, async request => {
    const row = await modelFor(request)
    if (row.config.adapter !== 'mistral') throw new AppError(400, 'speech_adapter_invalid', 'Voice discovery requires a Mistral speech model')
    return { data: await listMistralVoices(await speechConnection(row.providerConnectionId)) }
  })
  app.get(`${prefix}/:id/provider-voices/:voiceId/sample`, async (request, reply) => {
    const row = await modelFor(request); const { voiceId } = paramsSchema.parse(request.params)
    if (row.config.adapter !== 'mistral') throw new AppError(400, 'speech_adapter_invalid', 'Choose a Mistral speech model')
    const result = await mistralRequest(await speechConnection(row.providerConnectionId), `/audio/voices/${encodeURIComponent(voiceId!)}/sample`, 'GET', undefined, fetch, true)
    const audio = result as Buffer
    const normalized = await normalizeSpeechAsset(audio, 'watermark', AbortSignal.timeout(30_000))
    return reply.header('cache-control', 'no-store').type('audio/wav').send(normalized.audio)
  })
  for (const kind of ['clone', 'watermark'] as const) {
    const path = `${prefix}/:id/voices/:voiceId/${kind}`
    app.post(path, { bodyLimit: SPEECH_ASSET_MAX_BYTES + 65536 }, (request, reply) => uploadAsset(request, reply, kind))
    app.get(path, (request, reply) => downloadAsset(request, reply, kind))
    app.delete(path, (request, reply) => deleteAsset(request, reply, kind))
  }
  app.post(`${prefix}/:id/voices/:voiceId/clone/repair`, (request, reply) => uploadAsset(request, reply, 'clone', true))
  app.patch(`${prefix}/:id/voices/:voiceId/watermark`, async request => {
    const admin = requireAdmin(request); const { id, voiceId } = paramsSchema.parse(request.params); const settings = speechWatermarkSchema.parse(request.body)
    await db.transaction(async tx => {
      await lockSpeechResources(tx)
      const [row] = await tx.select().from(speechModels).where(eq(speechModels.id, id)).for('update')
      if (!row?.config.voices.some(v => v.id === voiceId)) throw notFound('Speech voice')
      if (settings.enabled && !row.voiceAssets.some(a => a.voiceId === voiceId && a.watermark)) throw new AppError(400, 'speech_watermark_required', 'Upload a watermark before enabling it')
      await tx.update(speechModels).set({ config: { ...row.config, voices: row.config.voices.map(v => v.id === voiceId ? { ...v, watermark: settings } : v) }, updatedAt: new Date() }).where(eq(speechModels.id, id))
      await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'speech_watermark.configured', targetType: 'speech_model', targetId: id, metadata: { voiceId } })
    })
    return settings
  })
  app.post(`${prefix}/:id/voices/:voiceId/test`, async (request, reply) => {
    const row = await modelFor(request); const { voiceId } = paramsSchema.parse(request.params)
    const { input, savePreview } = z.object({ input: z.string().trim().min(1).max(500).default('Hello. This is a sample of my voice.'), savePreview: z.boolean().default(false) }).parse(request.body ?? {})
    const voice = row.config.voices.find(v => v.id === voiceId)
    if (!voice) throw notFound('Speech voice')
    const pending = requestSignal(request, reply)
    try {
      const model = speechModelSchema.parse(row.config)
      const clone = row.voiceAssets.find(a => a.voiceId === voiceId)?.clone
      if (voice.kind === 'cloned' && !clone) throw notFound('Cloning reference')
      // Admin tests are provider operations, not user playback charges.
      if (Array.from(input).length > model.maxInputCharacters || (model.maxInputTokens !== null && Buffer.byteLength(input) > model.maxInputTokens)) throw new AppError(400, 'speech_input_limit', 'Test text exceeds this model’s limits')
      const result = await generateSpeech({ ...await speechConnection(row.providerConnectionId, pending.signal), model, input: { requestId: newId(), modelId: row.id, voice: voiceId!, input }, upstreamVoiceId: clone?.upstreamVoiceId })
      const mixed = await applyVoiceWatermark(result.audio, row, voiceId!, model.responseFormat, 0, pending.signal)
      if (savePreview) {
        if (result.durationSeconds > 30 || result.audio.length > 5 * 1024 * 1024) throw new AppError(400, 'speech_preview_invalid', 'Use shorter test text for a preview of at most 30 seconds and 5 MiB')
        const objectKey = `speech-previews/${newId()}.${model.responseFormat}`
        await getBlobStore().put(objectKey, result.audio, { contentType: model.responseFormat === 'wav' ? 'audio/wav' : 'audio/mpeg', contentLength: result.audio.length })
        try {
          await db.transaction(async tx => {
            await lockSpeechResources(tx)
            const [current] = await tx.select().from(speechModels).where(eq(speechModels.id, row.id)).for('update')
            if (!current || current.updatedAt.getTime() !== row.updatedAt.getTime()) throw new AppError(409, 'speech_model_changed', 'Model changed. Generate the preview again.')
            const old = current.voicePreviews.find(v => v.voiceId === voiceId)
            if (old) await tx.insert(speechResourceCleanup).values({ id: newId(), objectKeys: [old.objectKey] })
            await tx.update(speechModels).set({ voicePreviews: [...current.voicePreviews.filter(v => v.voiceId !== voiceId), { voiceId: voiceId!, objectKey, contentType: model.responseFormat === 'wav' ? 'audio/wav' : 'audio/mpeg', checksum: createHash('sha256').update(result.audio).digest('hex') }], updatedAt: new Date() }).where(eq(speechModels.id, row.id))
          })
        } catch (error) { await getBlobStore().delete(objectKey); throw error }
        await retrySpeechCleanup(request)
      }
      return reply.header('cache-control', 'no-store').type(model.responseFormat === 'wav' ? 'audio/wav' : 'audio/mpeg').send(mixed)
    } finally { pending.dispose() }
  })
}
