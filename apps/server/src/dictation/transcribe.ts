import { eq } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { chargeMeteredUsage } from '../accounting/service.js'
import { assertDailySpendAvailable } from '../billing/usage-tiers.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { applicationSettings } from '../database/schema.js'
import { decryptSecret } from '../lib/crypto.js'
import { AppError } from '../lib/errors.js'
import { diagnosticFetch } from '../logging/diagnostic-fetch.js'
import { parseDictationSettings } from '../settings/application-settings.js'
import { dictationUsageMicros } from './billing.js'
import { GroqTranscriptionError, transcribeWithGroq, type GroqTranscript } from './groq.js'

const TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo'

export type DictationSettingsValue = ReturnType<typeof parseDictationSettings>

/**
 * The dictation settings, once dictation is enabled with a Groq key. Recorded dictation and
 * transcripts of audio files share them: the same key, price and daily spend check.
 */
export async function enabledDictationSettings(userId: string): Promise<DictationSettingsValue & { encryptedGroqApiKey: string }> {
  const [row] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, 'dictation')).limit(1)
  const settings = parseDictationSettings(row?.value)
  if (!settings.enabled || !settings.encryptedGroqApiKey) {
    throw new AppError(404, 'dictation_disabled', 'Dictation is not enabled')
  }
  if (settings.billUsers) await assertDailySpendAvailable(userId)
  return { ...settings, encryptedGroqApiKey: settings.encryptedGroqApiKey }
}

/** Transcribes audio with Groq, maps provider failures, and bills the result when configured. */
export async function transcribeAndBill(input: {
  userId: string
  settings: DictationSettingsValue & { encryptedGroqApiKey: string }
  audio: Uint8Array
  filename: string
  mimeType: string
  timeoutMs: number
  log: FastifyBaseLogger
  /** Usage metadata; recorded dictation has none. */
  source?: { kind: 'attachment' | 'file'; id: string }
}): Promise<GroqTranscript> {
  let transcript: GroqTranscript
  try {
    transcript = await transcribeWithGroq({
      apiKey: decryptSecret(input.settings.encryptedGroqApiKey, getConfig().ENCRYPTION_KEY),
      audio: input.audio,
      filename: input.filename,
      mimeType: input.mimeType,
      signal: AbortSignal.timeout(input.timeoutMs),
      fetchImpl: diagnosticFetch({ purpose: 'dictation', userId: input.userId, providerId: 'groq', upstreamModelId: TRANSCRIPTION_MODEL }),
    })
  } catch (cause) {
    input.log.warn({ err: cause }, 'Groq transcription failed')
    if (cause instanceof GroqTranscriptionError && cause.status === 429) {
      throw new AppError(429, 'dictation_provider_rate_limited', 'Dictation is temporarily busy. Try again shortly.')
    }
    throw new AppError(502, 'dictation_provider_error', 'The recording could not be transcribed', 'server_error')
  }
  if (!transcript.text) throw new AppError(422, 'dictation_no_speech', 'No speech was detected in the recording')
  if (input.settings.billUsers) {
    const usage = dictationUsageMicros(transcript.durationSeconds, input.settings.pricePerMinuteMicros)
    await chargeMeteredUsage({
      userId: input.userId,
      costMicros: usage.costMicros,
      type: 'dictation',
      metadata: {
        provider: 'groq', model: TRANSCRIPTION_MODEL,
        durationSeconds: transcript.durationSeconds, billedSeconds: usage.billedSeconds,
        pricePerMinuteMicros: input.settings.pricePerMinuteMicros,
        ...(input.source ? { source: input.source.kind, sourceId: input.source.id } : {}),
      },
    })
  }
  return transcript
}
