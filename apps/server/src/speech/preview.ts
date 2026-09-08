import { createHash } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { parseBuffer } from 'music-metadata'
import { db } from '../database/client.js'
import { auditEvents, providerConnections, speechModels } from '../database/schema.js'
import { requireAdmin, requireUser } from '../auth/service.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'

export const MAX_PREVIEW_BYTES = 5 * 1024 * 1024
export async function validateSpeechPreview(bytes: Buffer) {
  if (bytes.length > MAX_PREVIEW_BYTES) throw new AppError(413, 'speech_preview_too_large', 'Preview clips may be at most 5 MiB')
  try {
    const { format } = await parseBuffer(bytes, undefined, { duration: true })
    if (!['MPEG', 'WAVE'].includes(format.container ?? '') || !format.duration || !Number.isFinite(format.duration) || format.duration <= 0 || format.duration > 30) throw new Error('Invalid preview')
    return format.container === 'WAVE' ? 'audio/wav' : 'audio/mpeg'
  } catch {
    throw new AppError(400, 'speech_preview_invalid', 'Choose a valid MP3 or WAV clip up to 30 seconds long')
  }
}
export async function cleanupSpeechPreview(key: string | null | undefined, request: FastifyRequest) {
  if (key) await getBlobStore().delete(key).catch(() => request.log.warn('Speech preview cleanup failed'))
}
export async function registerSpeechPreviewRoutes(app: FastifyInstance) {
  app.get('/api/speech-models/:id/preview', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const [row] = await db.select({ model: speechModels, enabled: providerConnections.enabled }).from(speechModels)
      .innerJoin(providerConnections, eq(providerConnections.id, speechModels.providerConnectionId)).where(eq(speechModels.id, id)).limit(1)
    if (!row?.model.previewObjectKey || (user.role !== 'admin' && (!row.enabled || !row.model.config.enabled))) throw notFound('Speech preview')
    const contentType = row.model.previewContentType
    if (contentType !== 'audio/mpeg' && contentType !== 'audio/wav') throw notFound('Speech preview')
    return reply.header('cache-control', 'no-store').header('x-content-type-options', 'nosniff').type(contentType)
      .send(Buffer.from(await getBlobStore().get(row.model.previewObjectKey)))
  })
  app.post('/api/admin/speech-models/:id/preview', { bodyLimit: MAX_PREVIEW_BYTES + 65536 }, async (request, reply) => {
    const admin = requireAdmin(request)
    const { id } = request.params as { id: string }
    const [model] = await db.select().from(speechModels).where(eq(speechModels.id, id)).limit(1)
    if (!model) throw notFound('Speech model')
    let bytes: Buffer
    try {
      const file = await request.file({ limits: { fileSize: MAX_PREVIEW_BYTES, files: 1, fields: 0, parts: 1 } })
      if (!file) throw new AppError(400, 'speech_preview_required', 'Choose a preview clip')
      bytes = await file.toBuffer()
      if (file.file.truncated) throw new AppError(413, 'speech_preview_too_large', 'Preview clips may be at most 5 MiB')
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') throw new AppError(413, 'speech_preview_too_large', 'Preview clips may be at most 5 MiB')
      throw error
    }
    const contentType = await validateSpeechPreview(bytes)
    const key = `speech-previews/${newId()}.${contentType === 'audio/wav' ? 'wav' : 'mp3'}`
    let oldKey: string | null = null
    try {
      await getBlobStore().put(key, bytes, { contentType, contentLength: bytes.length })
      oldKey = await db.transaction(async tx => {
        const [current] = await tx.select().from(speechModels).where(eq(speechModels.id, id)).for('update')
        if (!current) throw notFound('Speech model')
        await tx.update(speechModels).set({ previewObjectKey: key, previewContentType: contentType, previewChecksum: createHash('sha256').update(bytes).digest('hex'), updatedAt: new Date() }).where(eq(speechModels.id, id))
        await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'speech_preview.updated', targetType: 'speech_model', targetId: id })
        return current.previewObjectKey
      })
    } catch (error) { await cleanupSpeechPreview(key, request); throw error }
    await cleanupSpeechPreview(oldKey, request)
    return reply.code(201).send({ previewAvailable: true })
  })
  app.delete('/api/admin/speech-models/:id/preview', async (request, reply) => {
    const admin = requireAdmin(request)
    const { id } = request.params as { id: string }
    const oldKey = await db.transaction(async tx => {
      const [current] = await tx.select().from(speechModels).where(eq(speechModels.id, id)).for('update')
      if (!current) throw notFound('Speech model')
      await tx.update(speechModels).set({ previewObjectKey: null, previewContentType: null, previewChecksum: null, updatedAt: new Date() }).where(eq(speechModels.id, id))
      await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'speech_preview.deleted', targetType: 'speech_model', targetId: id })
      return current.previewObjectKey
    })
    await cleanupSpeechPreview(oldKey, request)
    return reply.code(204).send()
  })
}
