import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  createRecordingSchema,
  RECORDING_CLIP_MAX_BYTES,
  recordingClipMetadataSchema,
  updateRecordingSkipsSchema,
} from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'
import { parseFileInput, requireFilesUser } from './request.js'
import {
  addRecordingClip,
  createRecording,
  deleteRecordingClip,
  getRecording,
  recordingClipDownload,
  retryRecordingTranscript,
  updateRecordingSkips,
} from './recordings.js'

const idParams = z.object({ id: z.uuid() })
const clipParams = z.object({ id: z.uuid(), clipId: z.uuid() })
const tooLarge = () => new AppError(413, 'recording_audio_too_large', 'A take must be 25 MB or smaller')

export async function registerRecordingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/files/recordings', async (request, reply) => {
    const user = await requireFilesUser(request)
    const input = parseFileInput(createRecordingSchema, request.body)
    reply.code(201)
    return createRecording(user.id, input)
  })

  app.get('/api/files/:id/recording', async (request) => {
    const user = await requireFilesUser(request)
    return getRecording(user.id, idParams.parse(request.params).id)
  })

  // Replaces every skipped part of the recording.
  app.patch('/api/files/:id/recording', async (request) => {
    const user = await requireFilesUser(request)
    const { skips } = updateRecordingSkipsSchema.parse(request.body)
    return updateRecordingSkips(user.id, idParams.parse(request.params).id, skips)
  })

  // A new take, appended at the end: multipart with a `metadata` JSON field, then the audio file.
  app.post('/api/files/:id/recording/clips', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = await requireFilesUser(request)
    const { id } = idParams.parse(request.params)
    let part: Awaited<ReturnType<typeof request.file>> = undefined
    try {
      part = await request.file({ limits: { files: 1, fileSize: RECORDING_CLIP_MAX_BYTES, fields: 4, fieldSize: 512 * 1024 } })
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge()
      throw cause
    }
    if (!part) throw new AppError(400, 'recording_audio_required', 'An audio recording is required')
    const field = part.fields.metadata
    const raw = field && !Array.isArray(field) && field.type === 'field' ? field.value : undefined
    let metadata: z.infer<typeof recordingClipMetadataSchema>
    try {
      metadata = recordingClipMetadataSchema.parse(JSON.parse(typeof raw === 'string' ? raw : 'null'))
    } catch {
      part.file.resume()
      throw new AppError(400, 'recording_metadata_invalid', 'The take is missing its length or waveform', 'invalid_request_error', 'metadata')
    }
    const audio = await part.toBuffer().catch((cause: unknown) => {
      if (part.file.truncated) throw tooLarge()
      throw cause
    })
    if (part.file.truncated) throw tooLarge()
    if (!audio.length) throw new AppError(400, 'recording_audio_empty', 'The take is empty')
    reply.code(201)
    return addRecordingClip(user.id, id, { audio, metadata })
  })

  app.delete('/api/files/:id/recording/clips/:clipId', async (request) => {
    const user = await requireFilesUser(request)
    const { id, clipId } = clipParams.parse(request.params)
    return deleteRecordingClip(user.id, id, clipId)
  })

  app.post('/api/files/:id/recording/clips/:clipId/transcribe', async (request) => {
    const user = await requireFilesUser(request)
    const { id, clipId } = clipParams.parse(request.params)
    return retryRecordingTranscript(user.id, id, clipId)
  })

  app.get('/api/files/:id/recording/clips/:clipId/download', async (request) => {
    const user = await requireFilesUser(request)
    const { id, clipId } = clipParams.parse(request.params)
    return recordingClipDownload(user.id, id, clipId)
  })
}
