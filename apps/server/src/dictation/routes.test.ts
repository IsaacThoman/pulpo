import type { FastifyInstance, FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settings: { enabled: false, encryptedGroqApiKey: null as string | null },
  requireUser: vi.fn(),
  transcribeWithGroq: vi.fn(),
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
vi.mock('../config.js', () => ({ getConfig: () => ({ ENCRYPTION_KEY: 'encryption-key' }) }))
vi.mock('../lib/crypto.js', () => ({ decryptSecret: () => 'groq-secret' }))
vi.mock('./groq.js', () => ({
  GroqTranscriptionError: class GroqTranscriptionError extends Error {},
  transcribeWithGroq: mocks.transcribeWithGroq,
}))

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
    mocks.transcribeWithGroq.mockReset().mockResolvedValue('Transcribed draft')
  })

  it('authenticates before rejecting a disabled feature', async () => {
    const handler = await routeHandler()
    await expect(handler(request())).rejects.toMatchObject({ statusCode: 404, code: 'dictation_disabled' })
    expect(mocks.requireUser).toHaveBeenCalledOnce()
    expect(mocks.transcribeWithGroq).not.toHaveBeenCalled()
  })

  it('hands supported browser audio to Groq without persisting it', async () => {
    mocks.settings = { enabled: true, encryptedGroqApiKey: 'encrypted-groq-key' }
    const handler = await routeHandler()
    await expect(handler(request())).resolves.toEqual({ text: 'Transcribed draft' })
    expect(mocks.transcribeWithGroq).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'groq-secret', filename: 'dictation.webm', mimeType: 'audio/webm', audio: Buffer.from([1, 2, 3]),
    }))
  })

  it('rejects unsupported uploads before calling the provider', async () => {
    mocks.settings = { enabled: true, encryptedGroqApiKey: 'encrypted-groq-key' }
    const handler = await routeHandler()
    await expect(handler(request('text/plain'))).rejects.toMatchObject({ statusCode: 415, code: 'dictation_audio_type_unsupported' })
    expect(mocks.transcribeWithGroq).not.toHaveBeenCalled()
  })
})
