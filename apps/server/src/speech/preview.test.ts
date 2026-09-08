import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '../lib/errors.js'
const mocks = vi.hoisted(() => ({ role: 'admin', enabled: true, providerEnabled: true, key: 'old.wav' as string | null,
  contentType: 'audio/wav' as string | null, put: vi.fn(), get: vi.fn(), remove: vi.fn(), transaction: vi.fn(), updates: vi.fn() }))
vi.mock('../auth/service.js', () => ({
  requireUser: () => { if (!mocks.role) throw new AppError(401, 'unauthorized', 'Sign in'); return { id: 'admin', role: mocks.role } },
  requireAdmin: () => { if (mocks.role !== 'admin') throw new AppError(403, 'forbidden', 'Admin only'); return { id: 'admin' } },
}))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({ put: mocks.put, get: mocks.get, delete: mocks.remove }) }))
vi.mock('../database/client.js', () => {
  const rows = () => { const model = { previewObjectKey: mocks.key, previewContentType: mocks.contentType, config: { enabled: mocks.enabled } }; return [{ ...model, model, enabled: mocks.providerEnabled }] }
  const select = () => { const chain: Record<string, unknown> = {}; for (const method of ['from', 'where', 'innerJoin']) chain[method] = () => chain; chain.limit = async () => rows(); chain.for = async () => rows(); return chain }
  const db = { select, update: () => ({ set: (value: { previewObjectKey: string | null; previewContentType: string | null }) => ({ where: async () => { mocks.updates(value); mocks.key = value.previewObjectKey; mocks.contentType = value.previewContentType } }) }),
    insert: () => ({ values: async () => undefined }), transaction: (fn: (tx: unknown) => Promise<unknown>) => mocks.transaction(fn, db) }
  return { db }
})
import { MAX_PREVIEW_BYTES, registerSpeechPreviewRoutes, validateSpeechPreview } from './preview.js'
function wav(seconds = 1) {
  const bytes = Buffer.alloc(44 + 48000 * seconds)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40)
  return bytes
}
const upload = (bytes = wav()) => ({ method: 'POST' as const, url: '/api/admin/speech-models/test/preview', headers: { 'content-type': 'multipart/form-data; boundary=preview' }, payload: Buffer.concat([Buffer.from('--preview\r\nContent-Disposition: form-data; name="file"; filename="sample.wav"\r\nContent-Type: audio/wav\r\n\r\n'), bytes, Buffer.from('\r\n--preview--\r\n')]) })
async function app() { const server = Fastify(); await server.register(multipart); await registerSpeechPreviewRoutes(server); return server }
beforeEach(() => {
  vi.clearAllMocks(); mocks.role = 'admin'; mocks.enabled = true; mocks.providerEnabled = true; mocks.key = 'old.wav'; mocks.contentType = 'audio/wav'
  mocks.get.mockResolvedValue(wav()); mocks.remove.mockResolvedValue(undefined); mocks.transaction.mockImplementation((fn, db) => fn(db))
})
it('validates audio content, duration and upload size', async () => {
  expect(await validateSpeechPreview(wav())).toBe('audio/wav')
  await expect(validateSpeechPreview(Buffer.from('<script>not audio</script>'))).rejects.toMatchObject({ statusCode: 400 })
  await expect(validateSpeechPreview(wav(31))).rejects.toMatchObject({ statusCode: 400 })
  const server = await app()
  expect((await server.inject(upload(Buffer.alloc(MAX_PREVIEW_BYTES + 1)))).statusCode).toBe(413)
  expect(mocks.put).not.toHaveBeenCalled(); await server.close()
})
it('requires authentication to listen and admin access to upload or remove', async () => {
  const server = await app(); mocks.role = ''
  expect((await server.inject('/api/speech-models/test/preview')).statusCode).toBe(401)
  mocks.role = 'user'
  expect((await server.inject(upload())).statusCode).toBe(403)
  expect((await server.inject({ method: 'DELETE', url: '/api/admin/speech-models/test/preview' })).statusCode).toBe(403)
  expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled(); await server.close()
})
it('replaces and removes clips, cleans old blobs, and serves authenticated audio without caching', async () => {
  const server = await app()
  const uploaded = await server.inject(upload())
  expect(uploaded.statusCode, uploaded.body).toBe(201)
  expect(mocks.put).toHaveBeenCalledWith(expect.stringMatching(/^speech-previews\/.*\.wav$/), wav(), { contentType: 'audio/wav', contentLength: wav().length })
  expect(mocks.remove).toHaveBeenCalledWith('old.wav')
  expect(mocks.updates).toHaveBeenCalledWith(expect.objectContaining({ previewChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) }))
  mocks.role = 'user'
  const response = await server.inject('/api/speech-models/test/preview')
  expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store'); expect(response.rawPayload).toEqual(wav())
  mocks.role = 'admin'
  expect((await server.inject({ method: 'DELETE', url: '/api/admin/speech-models/test/preview' })).statusCode).toBe(204)
  expect((await server.inject('/api/speech-models/test/preview')).statusCode).toBe(404)
  await server.close()
})
it('hides disabled models/providers from users and cleans uploads after failed database writes', async () => {
  const server = await app(); mocks.role = 'user'; mocks.enabled = false
  expect((await server.inject('/api/speech-models/test/preview')).statusCode).toBe(404)
  mocks.enabled = true; mocks.providerEnabled = false
  expect((await server.inject('/api/speech-models/test/preview')).statusCode).toBe(404)
  mocks.role = 'admin'
  expect((await server.inject('/api/speech-models/test/preview')).statusCode).toBe(200)
  mocks.transaction.mockRejectedValueOnce(new Error('Database offline'))
  expect((await server.inject(upload())).statusCode).toBe(500)
  expect(mocks.remove).toHaveBeenCalledWith(expect.stringMatching(/^speech-previews\//)); expect(mocks.remove).not.toHaveBeenCalledWith('old.wav')
  await server.close()
})
