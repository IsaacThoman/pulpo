import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AudioTranscript } from '@pulpo/contracts'
import { MAX_AUDIO_TRANSCRIPTION_BYTES, transcriptionAudioFormat } from '@pulpo/client-core/files'
import { requireUser } from '../auth/service.js'
import { findReadyAttachment } from '../attachments/routes.js'
import { db } from '../database/client.js'
import { resolveFileAccess } from '../files/access.js'
import { requireFilesUser } from '../files/request.js'
import { AppError, notFound } from '../lib/errors.js'
import { getBlobStore } from '../storage/index.js'
import { enabledDictationSettings, transcribeAndBill } from './transcribe.js'

const TRANSCRIPTION_TIMEOUT_MS = 120_000
const idParams = z.object({ id: z.uuid() })

async function transcribeStoredAudio(request: FastifyRequest, userId: string, source: {
  kind: 'attachment' | 'file'
  id: string
  name: string
  mimeType: string | null
  sizeBytes: number
  objectKey: string
}): Promise<AudioTranscript> {
  const settings = await enabledDictationSettings(userId)
  const format = transcriptionAudioFormat(source.name, source.mimeType)
  if (!format) throw new AppError(415, 'transcription_audio_type_unsupported', 'This audio format cannot be transcribed')
  if (source.sizeBytes > MAX_AUDIO_TRANSCRIPTION_BYTES) {
    throw new AppError(413, 'transcription_audio_too_large', 'Audio must be 25 MB or smaller to transcribe')
  }
  if (source.sizeBytes === 0) throw new AppError(400, 'transcription_audio_empty', 'The audio file is empty')
  const audio = await getBlobStore().get(source.objectKey)
  const transcript = await transcribeAndBill({
    userId,
    settings,
    audio,
    ...format,
    timeoutMs: TRANSCRIPTION_TIMEOUT_MS,
    log: request.log,
    source: { kind: source.kind, id: source.id },
  })
  return { text: transcript.text, durationSeconds: transcript.durationSeconds, segments: transcript.segments }
}

/** Transcripts of audio already stored as a chat attachment or in Files, for following along while it plays. */
export async function registerAudioTranscriptionRoutes(app: FastifyInstance): Promise<void> {
  const rateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } }

  app.post('/api/attachments/:id/transcription', { config: rateLimit }, async (request) => {
    // Transcribing is billed, and an admin reading someone's chat must not spend for them.
    if (request.adminChatAccess) throw new AppError(403, 'forbidden', 'Attachments cannot be transcribed during admin chat access', 'permission_error')
    const user = requireUser(request)
    const { id } = idParams.parse(request.params)
    const attachment = await findReadyAttachment(user.id, id)
    if (!attachment) throw notFound('Attachment')
    return transcribeStoredAudio(request, user.id, {
      kind: 'attachment',
      id: attachment.id,
      name: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      objectKey: attachment.objectKey,
    })
  })

  app.post('/api/files/:id/transcription', { config: rateLimit }, async (request) => {
    const user = await requireFilesUser(request)
    const { id } = idParams.parse(request.params)
    const node = (await resolveFileAccess(db, user.id, id))?.node
    if (!node || node.kind !== 'blob' || node.status !== 'ready' || !node.objectKey) throw notFound('File')
    return transcribeStoredAudio(request, user.id, {
      kind: 'file',
      id: node.id,
      name: node.name,
      mimeType: node.mimeType,
      sizeBytes: node.sizeBytes,
      objectKey: node.objectKey,
    })
  })
}
