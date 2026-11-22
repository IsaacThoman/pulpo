import type { FastifyInstance, FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settings: { enabled: false, encryptedGroqApiKey: null } as {
    enabled: boolean
    provider?: 'groq' | 'whisper'
    encryptedGroqApiKey: string | null
    billUsers?: boolean
    pricePerMinuteMicros?: number
  },
  requireUser: vi.fn(),
  transcribeWithGroq: vi.fn(),
  transcribeWithWhisper: vi.fn(),
  whisperConfig: {} as { PULPO_DICTATION_WHISPER_URL?: string; PULPO_DICTATION_WHISPER_TOKEN?: string },
  chargeMeteredUsage: vi.fn(),
}))

vi.mock('../database/client.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => [{ value: mocks.settings }]) })),
      })),
    })),
  },
}))
vi.mock('../auth/service.js', () => ({ requireUser: mocks.requireUser }))
vi.mock('../config.js', () => ({ getConfig: () => ({ ENCRYPTION_KEY: 'encryption-key', ...mocks.whisperConfig }) }))
vi.mock('../lib/crypto.js', () => ({ decryptSecret: () => 'groq-secret' }))
vi.mock('../accounting/service.js', () => ({ chargeMeteredUsage: mocks.chargeMeteredUsage }))
vi.mock('./groq.js', () => ({
  GroqTranscriptionError: class GroqTranscriptionError extends Error {},
  transcribeWithGroq: mocks.transcribeWithGroq,
}))

vi.mock('./whisper.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./whisper.js')>(),
  transcribeWithWhisper: mocks.transcribeWithWhisper,
}))

import { WhisperTranscriptionError } from './whisper.js'
import { registerDictationRoutes } from './routes.js'

type Handler = (request: FastifyRequest) => Promise<unknown>

async function routeHandler(): Promise<Handler> {
  let handler: Handler | undefined
  const app = { post: (_url: string, _options: unknown, value: Handler) => { handler = value } } as unknown as FastifyInstance
  await registerDictationRoutes(app)
  return handler!
}

function request(mimeType = 'audio/webm'): FastifyRequest {
  return {
    file: vi.fn(async () => ({
      mimetype: mimeType,
      filename: 'dictation.webm',
      file: { truncated: false },
      toBuffer: vi.fn(async () => Buffer.from([1, 2, 3])),
    })),
    log: { warn: vi.fn() },
  } as unknown as FastifyRequest
}

describe('dictation route', () => {
  beforeEach(() => {
    mocks.settings = { enabled: false, encryptedGroqApiKey: null }
    mocks.requireUser.mockReset()
    mocks.requireUser.mockReturnValue({ id: '11111111-1111-4111-8111-111111111111' })
    mocks.transcribeWithGroq.mockReset().mockResolvedValue({ text: 'Transcribed draft', durationSeconds: 12.1 })
    mocks.whisperConfig = {}
    mocks.transcribeWithWhisper.mockReset()
    mocks.chargeMeteredUsage.mockReset().mockResolvedValue(undefined)
  })

  it('bills successful transcription to the second when configured', async () => {
    mocks.settings = { enabled: true, encryptedGroqApiKey: 'encrypted-groq-key', billUsers: true, pricePerMinuteMicros: 10_000 }
    const handler = await routeHandler()
    await expect(handler(request())).resolves.toEqual({ text: 'Transcribed draft' })
    expect(mocks.chargeMeteredUsage).toHaveBeenCalledWith({
      userId: '11111111-1111-4111-8111-111111111111',
      costMicros: 2_167,
      type: 'dictation',
      metadata: expect.objectContaining({ durationSeconds: 12.1, billedSeconds: 13, pricePerMinuteMicros: 10_000 }),
    })
  })

  it('uses the configured Whisper service and bills decoded audio duration without a Groq key', async () => {
    mocks.whisperConfig = { PULPO_DICTATION_WHISPER_URL: 'https://whisper.example.ts.net', PULPO_DICTATION_WHISPER_TOKEN: 'token' }
    mocks.settings = { enabled: true, provider: 'whisper', encryptedGroqApiKey: null, billUsers: true }
    const segments = [{ start: 0.5, end: 2, text: 'Draft' }]
    mocks.transcribeWithWhisper.mockResolvedValue({ text: 'Draft', segments, durationSeconds: 3.25 })
    const handler = await routeHandler()

    await expect(handler(request())).resolves.toEqual({ text: 'Draft', segments })
    expect(mocks.transcribeWithWhisper).toHaveBeenCalledWith(expect.objectContaining({
      connection: { url: 'https://whisper.example.ts.net', token: 'token' }, audio: Buffer.from([1, 2, 3]),
    }))
    expect(mocks.chargeMeteredUsage).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ provider: 'whisper', durationSeconds: 3.25, billedSeconds: 4 }),
    }))
    expect(mocks.transcribeWithGroq).not.toHaveBeenCalled()
  })

  it('keeps Whisper failures on the selected provider and does not charge the user', async () => {
    mocks.whisperConfig = { PULPO_DICTATION_WHISPER_URL: 'https://whisper.example.ts.net', PULPO_DICTATION_WHISPER_TOKEN: 'token' }
    mocks.settings = { enabled: true, provider: 'whisper', encryptedGroqApiKey: 'saved-groq-key', billUsers: true }
    mocks.transcribeWithWhisper.mockRejectedValue(new WhisperTranscriptionError(503))
    const handler = await routeHandler()

    await expect(handler(request())).rejects.toMatchObject({ statusCode: 429, code: 'dictation_provider_rate_limited' })
    expect(mocks.transcribeWithGroq).not.toHaveBeenCalled()
    expect(mocks.chargeMeteredUsage).not.toHaveBeenCalled()
  })

  it('authenticates before rejecting a disabled feature', async () => {
    const handler = await routeHandler()
    await expect(handler(request())).rejects.toMatchObject({ statusCode: 404, code: 'dictation_disabled' })
    expect(mocks.requireUser).toHaveBeenCalledOnce()
    expect(mocks.transcribeWithGroq).not.toHaveBeenCalled()
  })

  it.each(['audio/webm', 'audio/mp4', 'audio/flac'])('hands supported %s audio to Groq without persisting it', async (mimeType) => {
    mocks.settings = { enabled: true, encryptedGroqApiKey: 'encrypted-groq-key' }
    const handler = await routeHandler()
    await expect(handler(request(mimeType))).resolves.toEqual({ text: 'Transcribed draft' })
    expect(mocks.transcribeWithGroq).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'groq-secret', filename: 'dictation.webm', mimeType, audio: Buffer.from([1, 2, 3]),
    }))
  })

  it('returns segment timestamps with the plain transcript when available', async () => {
    mocks.settings = { enabled: true, encryptedGroqApiKey: 'encrypted-groq-key' }
    const segments = [{ start: 1.5, end: 4, text: 'Transcribed draft' }]
    mocks.transcribeWithGroq.mockResolvedValueOnce({ text: 'Transcribed draft', durationSeconds: 12.1, segments })
    const handler = await routeHandler()
    await expect(handler(request())).resolves.toEqual({ text: 'Transcribed draft', segments })
  })

  it('rejects unsupported uploads before calling the provider', async () => {
    mocks.settings = { enabled: true, encryptedGroqApiKey: 'encrypted-groq-key' }
    const handler = await routeHandler()
    await expect(handler(request('text/plain'))).rejects.toMatchObject({ statusCode: 415, code: 'dictation_audio_type_unsupported' })
    expect(mocks.transcribeWithGroq).not.toHaveBeenCalled()
  })
})
