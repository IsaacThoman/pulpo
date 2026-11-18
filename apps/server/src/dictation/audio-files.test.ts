import type { FastifyInstance, FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ATTACHMENT_ID = '22222222-2222-4222-8222-222222222222'
const FILE_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '11111111-1111-4111-8111-111111111111'

const mocks = vi.hoisted(() => ({
  settings: { enabled: true, encryptedGroqApiKey: 'encrypted' } as Record<string, unknown>,
  attachment: null as Record<string, unknown> | null,
  node: null as Record<string, unknown> | null,
  transcribeWithGroq: vi.fn(),
  chargeMeteredUsage: vi.fn(),
  blobGet: vi.fn(),
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
vi.mock('../auth/service.js', () => ({ requireUser: () => ({ id: USER_ID }) }))
vi.mock('../files/request.js', () => ({ requireFilesUser: async () => ({ id: USER_ID }) }))
vi.mock('../files/access.js', () => ({ resolveFileAccess: async () => mocks.node ? { node: mocks.node, role: 'owner' } : null }))
vi.mock('../attachments/routes.js', () => ({ findReadyAttachment: async () => mocks.attachment }))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({ get: mocks.blobGet }) }))
vi.mock('../config.js', () => ({ getConfig: () => ({ ENCRYPTION_KEY: 'encryption-key' }) }))
vi.mock('../lib/crypto.js', () => ({ decryptSecret: () => 'groq-secret' }))
vi.mock('../accounting/service.js', () => ({ chargeMeteredUsage: mocks.chargeMeteredUsage }))
vi.mock('../billing/usage-tiers.js', () => ({ assertDailySpendAvailable: vi.fn() }))
vi.mock('./groq.js', () => ({
  GroqTranscriptionError: class GroqTranscriptionError extends Error {},
  transcribeWithGroq: mocks.transcribeWithGroq,
}))

import { registerAudioTranscriptionRoutes } from './audio-files.js'

type Handler = (request: FastifyRequest) => Promise<unknown>

async function handlers(): Promise<Record<string, Handler>> {
  const routes: Record<string, Handler> = {}
  const app = { post: (url: string, _options: unknown, handler: Handler) => { routes[url] = handler } } as unknown as FastifyInstance
  await registerAudioTranscriptionRoutes(app)
  return routes
}

function request(id: string, extra: Record<string, unknown> = {}): FastifyRequest {
  return { params: { id }, log: { warn: vi.fn() }, adminChatAccess: null, ...extra } as unknown as FastifyRequest
}

const transcript = {
  text: 'Hello there',
  durationSeconds: 61.2,
  segments: [{ start: 0, end: 2, text: 'Hello' }, { start: 2, end: 61.2, text: 'there' }],
}

describe('audio file transcription routes', () => {
  beforeEach(() => {
    mocks.settings = { enabled: true, encryptedGroqApiKey: 'encrypted' }
    mocks.attachment = { id: ATTACHMENT_ID, originalName: 'Interview.mp3', mimeType: 'audio/mpeg', sizeBytes: 3, objectKey: 'attachments/key' }
    mocks.node = { id: FILE_ID, kind: 'blob', status: 'ready', name: 'memo.m4a', mimeType: 'application/octet-stream', sizeBytes: 3, objectKey: 'files/key' }
    mocks.transcribeWithGroq.mockReset().mockResolvedValue(transcript)
    mocks.chargeMeteredUsage.mockReset().mockResolvedValue(undefined)
    mocks.blobGet.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]))
  })

  it('transcribes a stored attachment with timed segments, without sending its name', async () => {
    const routes = await handlers()
    await expect(routes['/api/attachments/:id/transcription']!(request(ATTACHMENT_ID))).resolves.toEqual(transcript)
    expect(mocks.blobGet).toHaveBeenCalledWith('attachments/key')
    expect(mocks.transcribeWithGroq).toHaveBeenCalledWith(expect.objectContaining({ filename: 'audio.mp3', mimeType: 'audio/mpeg' }))
  })

  it('types a generically stored file from its extension and bills with its source', async () => {
    mocks.settings = { enabled: true, encryptedGroqApiKey: 'encrypted', billUsers: true, pricePerMinuteMicros: 10_000 }
    const routes = await handlers()
    await routes['/api/files/:id/transcription']!(request(FILE_ID))
    expect(mocks.transcribeWithGroq).toHaveBeenCalledWith(expect.objectContaining({ filename: 'audio.m4a', mimeType: 'audio/mp4' }))
    expect(mocks.chargeMeteredUsage).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID,
      type: 'dictation',
      metadata: expect.objectContaining({ billedSeconds: 62, source: 'file', sourceId: FILE_ID }),
    }))
  })

  it('rejects a disabled feature before looking at the audio', async () => {
    mocks.settings = { enabled: false, encryptedGroqApiKey: null }
    const routes = await handlers()
    await expect(routes['/api/attachments/:id/transcription']!(request(ATTACHMENT_ID))).rejects.toMatchObject({ statusCode: 404, code: 'dictation_disabled' })
    expect(mocks.blobGet).not.toHaveBeenCalled()
  })

  it('rejects unsupported, oversized and missing audio', async () => {
    const routes = await handlers()
    mocks.attachment = { ...mocks.attachment, originalName: 'clip.aac', mimeType: 'audio/aac' }
    await expect(routes['/api/attachments/:id/transcription']!(request(ATTACHMENT_ID))).rejects.toMatchObject({ statusCode: 415 })
    mocks.node = { ...mocks.node, sizeBytes: 26 * 1024 * 1024 }
    await expect(routes['/api/files/:id/transcription']!(request(FILE_ID))).rejects.toMatchObject({ statusCode: 413 })
    mocks.node = null
    await expect(routes['/api/files/:id/transcription']!(request(FILE_ID))).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.transcribeWithGroq).not.toHaveBeenCalled()
  })

  it('does not let an admin reading a chat spend for its owner', async () => {
    const routes = await handlers()
    await expect(routes['/api/attachments/:id/transcription']!(request(ATTACHMENT_ID, { adminChatAccess: { actorUser: { id: 'admin' } } })))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})
