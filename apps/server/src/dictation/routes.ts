import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { requireUser } from '../auth/service.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { applicationSettings } from '../database/schema.js'
import { decryptSecret } from '../lib/crypto.js'
import { AppError } from '../lib/errors.js'
import { parseDictationSettings } from '../settings/application-settings.js'
import { GroqTranscriptionError, transcribeWithGroq } from './groq.js'

export const MAX_DICTATION_BYTES = 10 * 1024 * 1024
const SUPPORTED_AUDIO_TYPES = new Set([
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
])

export async function registerDictationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/dictation/transcriptions', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request) => {
    requireUser(request)
    const [row] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
      .where(eq(applicationSettings.key, 'dictation')).limit(1)
    const settings = parseDictationSettings(row?.value)
    if (!settings.enabled || !settings.encryptedGroqApiKey) {
      throw new AppError(404, 'dictation_disabled', 'Dictation is not enabled')
    }

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

    try {
      const text = await transcribeWithGroq({
        apiKey: decryptSecret(settings.encryptedGroqApiKey, getConfig().ENCRYPTION_KEY),
        audio,
        filename: part.filename || 'dictation.webm',
        mimeType,
        signal: AbortSignal.timeout(30_000),
      })
      return { text }
    } catch (cause) {
      request.log.warn({ err: cause }, 'Groq dictation transcription failed')
      if (cause instanceof GroqTranscriptionError && cause.status === 429) {
        throw new AppError(429, 'dictation_provider_rate_limited', 'Dictation is temporarily busy. Try again shortly.')
      }
      throw new AppError(502, 'dictation_provider_error', 'The recording could not be transcribed', 'server_error')
    }
  })
}
