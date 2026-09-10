import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ManagementScope } from '@pulpo/contracts'
const mocks = vi.hoisted(() => ({ download: vi.fn(), upload: vi.fn(), remove: vi.fn(), catalog: vi.fn() }))
vi.mock('../speech/preview.js', () => ({
  MAX_PREVIEW_BYTES: 5 * 1024 * 1024,
  downloadSpeechPreview: mocks.download, uploadSpeechPreview: mocks.upload, deleteSpeechPreview: mocks.remove,
}))
import { registerManagementRoutes } from './routes.js'

let role: 'admin' | 'user' | null
let scopes: ManagementScope[]
let server: ReturnType<typeof Fastify>
const previewPath = '/api/management/v1/speech-models/test/voices/custom%2Fvoice/preview'
const assetPaths = ['clone', 'watermark', 'clone/repair', 'test'].map(suffix => `/api/management/v1/speech-models/test/voices/custom%2Fvoice/${suffix}`)
const discoveryPaths = ['/api/management/v1/speech-models/test/provider-voices', '/api/management/v1/speech-models/test/provider-voices/custom/sample', '/api/management/v1/speech-models/cleanup', '/api/management/v1/speech-models/cleanup/00000000-0000-4000-8000-000000000001/retry']
beforeEach(async () => {
  vi.clearAllMocks(); role = 'admin'; scopes = ['catalog:read', 'catalog:write']
  server = Fastify()
  await server.register(multipart)
  server.addHook('preHandler', async (request: FastifyRequest) => {
    // Authentication runs in preHandler. A guard in onRequest would incorrectly reject tokens.
    request.user = role ? { id: 'admin', role, blocked: false } as FastifyRequest['user'] : null
    request.managementTokenId = role ? 'token' : null
    request.managementScopes = scopes
  })
  mocks.catalog.mockImplementation((request: FastifyRequest) => ({ method: request.method, body: request.body ?? null }))
  mocks.download.mockImplementation((_request: FastifyRequest, reply: FastifyReply) => reply.type('audio/wav').send(Buffer.from('audio')))
  mocks.upload.mockImplementation(async (request: FastifyRequest, reply: FastifyReply) => {
    const file = await request.file()
    return reply.code(201).send({ voice: (request.params as { voiceId: string }).voiceId, bytes: (await file!.toBuffer()).toString() })
  })
  mocks.remove.mockImplementation((_request: FastifyRequest, reply: FastifyReply) => reply.code(204).send())
  server.all('/api/admin/image-models', mocks.catalog)
  server.all('/api/admin/image-models/*', mocks.catalog)
  server.all('/api/admin/speech-models', mocks.catalog)
  server.all('/api/admin/speech-models/*', mocks.catalog)
  await registerManagementRoutes(server)
})
afterEach(async () => { await server.close() })
it('advertises speech management and forwards authorized catalog operations', async () => {
  expect((await server.inject('/api/management/v1/info')).json().capabilities).toContain('speechModels')
  const body = { id: 'test', voices: [{ id: 'custom', label: 'Custom' }], billingUnit: 'duration', minutePriceMicros: 123 }
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
    const response = await server.inject({ method, url: '/api/management/v1/speech-models', ...(['POST', 'PATCH'].includes(method) ? { payload: body } : {}) })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ method, body: ['POST', 'PATCH'].includes(method) ? body : null })
  }
})
it('requires authentication, current admin role, and the matching catalog scope', async () => {
  for (const identity of [{ role: null, scopes: [] }, { role: 'user', scopes: ['catalog:read', 'catalog:write'] }, { role: 'admin', scopes: ['account:read'] }] as const) {
    role = identity.role; scopes = [...identity.scopes]
    for (const url of ['/api/management/v1/speech-models', previewPath, ...assetPaths, ...discoveryPaths]) {
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
        const response = await server.inject({ method, url })
        expect(response.statusCode, `${identity.role} ${method} ${url}`).toBe(role ? 403 : 401)
      }
    }
  }
  expect(mocks.catalog).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled()
})
it('allows reads with read-only scope but blocks catalog and preview writes', async () => {
  scopes = ['catalog:read']
  expect((await server.inject('/api/management/v1/speech-models')).statusCode).toBe(200)
  const response = await server.inject(previewPath)
  expect(response.headers['content-type']).toBe('audio/wav')
  expect(response.rawPayload).toEqual(Buffer.from('audio'))
  for (const url of ['/api/management/v1/speech-models', previewPath, ...assetPaths, ...discoveryPaths]) {
    for (const method of ['POST', 'PATCH', 'DELETE'] as const) expect((await server.inject({ method, url })).statusCode).toBe(403)
  }
})
it('preserves multipart bytes and decoded voice IDs instead of JSON-proxying uploads', async () => {
  scopes = ['catalog:write']
  const response = await server.inject({ method: 'POST', url: previewPath, headers: { 'content-type': 'multipart/form-data; boundary=clip' }, payload: '--clip\r\nContent-Disposition: form-data; name="file"; filename="test.wav"\r\nContent-Type: audio/wav\r\n\r\nwave bytes\r\n--clip--\r\n' })
  expect(response.statusCode).toBe(201)
  expect(response.json()).toEqual({ voice: 'custom/voice', bytes: 'wave bytes' })
  expect(mocks.catalog).not.toHaveBeenCalled()
  expect((await server.inject({ method: 'DELETE', url: previewPath })).statusCode).toBe(204)
  expect(mocks.remove).toHaveBeenCalledOnce()
  expect((await server.inject(previewPath)).statusCode).toBe(403)
})

it('advertises image models and enforces catalog scopes on their management routes', async () => {
  expect((await server.inject('/api/management/v1/info')).json().capabilities).toContain('imageModels')
  expect((await server.inject('/api/management/v1/image-models')).statusCode).toBe(200)
  const body = { id: 'image', adapter: 'meta-muse' }
  expect((await server.inject({ method: 'POST', url: '/api/management/v1/image-models', payload: body })).json()).toMatchObject({ body })
  scopes = ['catalog:read']
  expect((await server.inject({ method: 'PATCH', url: '/api/management/v1/image-models/image', payload: body })).statusCode).toBe(403)
  expect((await server.inject({ method: 'DELETE', url: '/api/management/v1/image-models/image' })).statusCode).toBe(403)
  role = 'user'
  expect((await server.inject('/api/management/v1/image-models')).statusCode).toBe(403)
})
