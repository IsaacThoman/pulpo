import type { FastifyInstance } from 'fastify'
import { requireUser } from '../auth/service.js'
import { AppError } from '../lib/errors.js'
import { enabledDictationSettings, transcribeAndBill } from './transcribe.js'

export const MAX_DICTATION_BYTES = 10 * 1024 * 1024
const SUPPORTED_AUDIO_TYPES = new Set([
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
])

export async function registerDictationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/dictation/transcriptions', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = requireUser(request)
    const settings = await enabledDictationSettings(user.id)

    let part: Awaited<ReturnType<typeof request.file>> = undefined
    try {
      part = await request.file({ limits: { files: 1, fileSize: MAX_DICTATION_BYTES } })
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(413, 'dictation_audio_too_large', 'Dictation recordings must be 10 MB or smaller')
      }
      throw cause
    }
    if (!part) throw new AppError(400, 'dictation_audio_required', 'An audio recording is required')
    const mimeType = part.mimetype.toLowerCase().split(';', 1)[0]!
    if (!SUPPORTED_AUDIO_TYPES.has(mimeType)) {
      throw new AppError(415, 'dictation_audio_type_unsupported', 'This audio format is not supported')
    }
    let audio: Buffer
    try {
      audio = await part.toBuffer()
    } catch (cause) {
      if (part.file.truncated) throw new AppError(413, 'dictation_audio_too_large', 'Dictation recordings must be 10 MB or smaller')
      throw cause
    }
    if (part.file.truncated) throw new AppError(413, 'dictation_audio_too_large', 'Dictation recordings must be 10 MB or smaller')
    if (audio.length === 0) throw new AppError(400, 'dictation_audio_empty', 'The audio recording is empty')

    const transcript = await transcribeAndBill({
      userId: user.id,
      settings,
      audio,
      filename: part.filename || 'dictation.webm',
      mimeType,
      timeoutMs: 30_000,
      log: request.log,
    })
    return { text: transcript.text }
  })
}
