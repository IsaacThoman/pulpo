import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../auth/service.js'
import { AppError, notFound } from '../lib/errors.js'
import {
  completeRestoreUpload, discardRestoreUpload, listRestoreUploads, MAX_RESTORE_SIZE, putRestoreChunk,
  readRestoreUpload, RESTORE_CHUNK_SIZE, startRestoreUpload,
} from './restore-uploads.js'

const idParams = z.object({ id: z.uuid() })
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)

export async function registerRestoreUploadRoutes(app: FastifyInstance) {
  app.get('/api/admin/restore/uploads', async (request) => ({ data: await listRestoreUploads(requireAdmin(request).id) }))
  app.post('/api/admin/restore/uploads', async (request) => {
    const admin = requireAdmin(request)
    const input = z.object({
      id: z.uuid(), originalName: z.string().min(1).max(255),
      sizeBytes: z.number().int().positive().max(MAX_RESTORE_SIZE), fingerprint: sha256,
    }).parse(request.body)
    await startRestoreUpload(admin.id, input)
    return readRestoreUpload(input.id, admin.id)
  })
  app.get('/api/admin/restore/uploads/:id', async (request) => {
    const admin = requireAdmin(request)
    return readRestoreUpload(idParams.parse(request.params).id, admin.id)
  })
  app.put('/api/admin/restore/uploads/:id/parts/:index', { bodyLimit: RESTORE_CHUNK_SIZE + 64 * 1024 }, async (request) => {
    const admin = requireAdmin(request)
    const { id, index } = idParams.extend({ index: z.coerce.number().int().nonnegative() }).parse(request.params)
    const checksum = sha256.parse(request.headers['x-chunk-sha256'])
    const file = await request.file({ limits: { fileSize: RESTORE_CHUNK_SIZE, files: 1, fields: 0, parts: 1 } })
    if (!file) throw notFound('Upload chunk')
    const body = await file.toBuffer()
    if (file.file.truncated) throw new AppError(413, 'chunk_too_large', 'Upload chunk is too large')
    await putRestoreChunk(id, admin.id, index, checksum, body)
    return { ok: true }
  })
  app.post('/api/admin/restore/uploads/:id/complete', async (request, reply) => {
    const admin = requireAdmin(request)
    z.object({ confirmation: z.literal('RESTORE') }).parse(request.body)
    const result = await completeRestoreUpload(idParams.parse(request.params).id, admin.id)
    reply.code(202)
    return result
  })
  app.delete('/api/admin/restore/uploads/:id', async (request, reply) => {
    const admin = requireAdmin(request)
    await discardRestoreUpload(idParams.parse(request.params).id, admin.id)
    reply.code(204)
  })
}
