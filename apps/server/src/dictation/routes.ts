import { audioTranscriptionMimeType, MAX_AUDIO_TRANSCRIPTION_BYTES } from '@pulpo/contracts'
import { diagnosticFetch } from '../logging/diagnostic-fetch.js'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { requireUser } from '../auth/service.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { applicationSettings } from '../database/schema.js'
import { decryptSecret } from '../lib/crypto.js'
import { AppError } from '../lib/errors.js'
import { dictationProviderConfigured, parseDictationSettings } from '../settings/application-settings.js'
import { GroqTranscriptionError, transcribeWithGroq } from './groq.js'
import { getWhisperConnection, transcribeWithWhisper, WhisperTranscriptionError } from './whisper.js'
import type { DictationTranscript } from './transcript.js'
import { chargeMeteredUsage } from '../accounting/service.js'
import { dictationUsageMicros } from './billing.js'
import { assertDailySpendAvailable } from '../billing/usage-tiers.js'

export async function registerDictationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/dictation/transcriptions', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = requireUser(request)
    const [row] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
      .where(eq(applicationSettings.key, 'dictation')).limit(1)
    const settings = parseDictationSettings(row?.value)
    const config = getConfig()
    const whisper = getWhisperConnection(config)
    const { provider } = settings
    if (!settings.enabled || !dictationProviderConfigured(settings, Boolean(whisper))) {
      throw new AppError(404, 'dictation_disabled', 'Dictation is not enabled')
    }
    if (settings.billUsers) await assertDailySpendAvailable(user.id)

    let part: Awaited<ReturnType<typeof request.file>> = undefined
    try {
      part = await request.file({ limits: { files: 1, fileSize: MAX_AUDIO_TRANSCRIPTION_BYTES } })
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(413, 'dictation_audio_too_large', 'Dictation recordings must be 10 MB or smaller')
      }
      throw cause
    }
    if (!part) throw new AppError(400, 'dictation_audio_required', 'An audio recording is required')
    const mimeType = audioTranscriptionMimeType(part.mimetype)
    if (!mimeType) {
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

    let transcript: DictationTranscript
    try {
      const signal = AbortSignal.timeout(30_000)
      if (provider === 'whisper' && whisper) {
        transcript = await transcribeWithWhisper({ connection: whisper, audio, signal })
      } else if (provider === 'groq' && settings.encryptedGroqApiKey) {
        transcript = await transcribeWithGroq({
          apiKey: decryptSecret(settings.encryptedGroqApiKey, config.ENCRYPTION_KEY),
          audio,
          filename: part.filename || 'dictation.webm',
          mimeType,
          signal,
          fetchImpl: diagnosticFetch({ purpose: 'dictation', userId: user.id, providerId: 'groq', upstreamModelId: 'whisper-large-v3-turbo' }),
        })
      } else {
        throw new Error('Dictation provider configuration is missing')
      }
    } catch (cause) {
      request.log.warn({ err: cause, provider }, 'Dictation transcription failed')
      if ((cause instanceof GroqTranscriptionError && cause.status === 429)
        || (cause instanceof WhisperTranscriptionError && (cause.status === 429 || cause.status === 503))) {
        throw new AppError(429, 'dictation_provider_rate_limited', 'Dictation is temporarily busy. Try again shortly.')
      }
      throw new AppError(502, 'dictation_provider_error', 'The recording could not be transcribed', 'server_error')
    }
    if (!transcript.text) throw new AppError(422, 'dictation_no_speech', 'No speech was detected in the recording')
    if (settings.billUsers) {
      const usage = dictationUsageMicros(transcript.durationSeconds, settings.pricePerMinuteMicros)
      await chargeMeteredUsage({
        userId: user.id,
        costMicros: usage.costMicros,
        type: 'dictation',
        metadata: {
          provider, model: 'whisper-large-v3-turbo',
          durationSeconds: transcript.durationSeconds, billedSeconds: usage.billedSeconds,
          pricePerMinuteMicros: settings.pricePerMinuteMicros,
        },
      })
    }
    return { text: transcript.text, ...(transcript.segments && { segments: transcript.segments }) }
  })
}
