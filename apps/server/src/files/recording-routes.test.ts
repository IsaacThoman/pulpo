import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { AppError } from '../lib/errors.js'

const mocks = vi.hoisted(() => ({
  addRecordingClip: vi.fn(),
  updateRecordingSkips: vi.fn(),
}))
vi.mock('./request.js', async (original) => ({
  ...await original<typeof import('./request.js')>(),
  requireFilesUser: async () => ({ id: '11111111-1111-4111-8111-111111111111' }),
}))
vi.mock('./recordings.js', () => ({
  addRecordingClip: mocks.addRecordingClip,
  createRecording: vi.fn(),
  deleteRecordingClip: vi.fn(),
  getRecording: vi.fn(),
  recordingClipDownload: vi.fn(),
  retryRecordingTranscript: vi.fn(),
  updateRecordingSkips: mocks.updateRecordingSkips,
}))

const { registerRecordingRoutes } = await import('./recording-routes.js')
const recordingId = '22222222-2222-4222-8222-222222222222'

async function app() {
  const server = Fastify()
  await server.register(multipart)
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ code: error.code })
    if (error instanceof ZodError) return reply.code(400).send({ code: 'invalid' })
    return reply.code(500).send({ code: 'internal' })
  })
  await registerRecordingRoutes(server)
  return server
}

function upload(parts: Array<[string, string | Blob, string?]>) {
  const form = new FormData()
  for (const [name, value, filename] of parts) {
    if (typeof value === 'string') form.append(name, value)
    else form.append(name, value, filename)
  }
  const request = new Request('http://localhost', { method: 'POST', body: form })
  return Promise.all([request.headers.get('content-type')!, request.arrayBuffer()] as const)
}

describe('recording routes', () => {
  beforeEach(() => {
    mocks.addRecordingClip.mockReset().mockResolvedValue({ id: 'take' })
    mocks.updateRecordingSkips.mockReset().mockResolvedValue({ clips: [] })
  })

  it('takes the metadata field and then the audio of a new take', async () => {
    const server = await app()
    const [contentType, body] = await upload([
      ['metadata', JSON.stringify({ durationMs: 1_250, levels: [1, 2, 3], recordedAt: '2026-10-25T12:00:00.000-04:00' })],
      ['file', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }), 'take.webm'],
    ])
    const response = await server.inject({ method: 'POST', url: `/api/files/${recordingId}/recording/clips`, headers: { 'content-type': contentType }, payload: Buffer.from(body) })
    expect(response.statusCode).toBe(201)
    expect(mocks.addRecordingClip).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', recordingId, {
      audio: Buffer.from([1, 2, 3, 4]),
      metadata: { durationMs: 1_250, levels: [1, 2, 3], recordedAt: '2026-10-25T12:00:00.000-04:00' },
    })
  })

  it('rejects a take without its metadata, or with levels out of range', async () => {
    const server = await app()
    for (const parts of [
      [['file', new Blob([new Uint8Array([1])]), 'take.webm']],
      [['metadata', JSON.stringify({ durationMs: 1_000, levels: [101] })], ['file', new Blob([new Uint8Array([1])]), 'take.webm']],
    ] as Array<Array<[string, string | Blob, string?]>>) {
      const [contentType, body] = await upload(parts)
      const response = await server.inject({ method: 'POST', url: `/api/files/${recordingId}/recording/clips`, headers: { 'content-type': contentType }, payload: Buffer.from(body) })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ code: 'recording_metadata_invalid' })
    }
    expect(mocks.addRecordingClip).not.toHaveBeenCalled()
  })

  it('validates skips before replacing them', async () => {
    const server = await app()
    const clipId = '33333333-3333-4333-8333-333333333333'
    const bad = await server.inject({ method: 'PATCH', url: `/api/files/${recordingId}/recording`, payload: { skips: [{ clipId, startMs: 5, endMs: 5 }] } })
    expect(bad.statusCode).toBe(400)
    const good = await server.inject({ method: 'PATCH', url: `/api/files/${recordingId}/recording`, payload: { skips: [{ clipId, startMs: 0, endMs: 500 }] } })
    expect(good.statusCode).toBe(200)
    expect(mocks.updateRecordingSkips).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', recordingId, [{ clipId, startMs: 0, endMs: 500 }])
  })
})
