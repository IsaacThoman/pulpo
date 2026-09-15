import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ManagementScope } from '@pulpo/contracts'
const mocks = vi.hoisted(() => ({ download: vi.fn(), upload: vi.fn(), remove: vi.fn(), catalog: vi.fn() }))
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
  server.all('/api/admin/image-models', mocks.catalog)
  server.all('/api/admin/image-models/*', mocks.catalog)
  server.all('/api/admin/speech-models', mocks.catalog)
  server.all('/api/admin/speech-models/*', (request: FastifyRequest, reply: FastifyReply) => request.url.endsWith('/preview') ? reply.code(404).send({ error: 'Not found' }) : mocks.catalog(request))
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
  expect((await server.inject(previewPath)).statusCode).toBe(404)
  for (const url of ['/api/management/v1/speech-models', previewPath, ...assetPaths, ...discoveryPaths]) {
    for (const method of ['POST', 'PATCH', 'DELETE'] as const) expect((await server.inject({ method, url })).statusCode).toBe(403)
  }
})
it('no longer handles saved-preview reads or mutations', async () => {
  for (const method of ['GET', 'POST', 'DELETE'] as const) expect((await server.inject({ method, url: previewPath })).statusCode).toBe(404)
})

it('advertises image models and enforces catalog scopes on their management routes', async () => {
  expect((await server.inject('/api/management/v1/info')).json().capabilities).toContain('imageModels')
  expect((await server.inject('/api/management/v1/image-models')).statusCode).toBe(200)
  const body = { id: 'image', adapter: 'meta-muse', billingUnit: 'tokens', reservationMicros: 100, tokenPrices: { input: 2000000, cachedInput: 500000, output: 10000000 } }
  expect((await server.inject({ method: 'POST', url: '/api/management/v1/image-models', payload: body })).json()).toMatchObject({ body })
  scopes = ['catalog:read']
  expect((await server.inject({ method: 'PATCH', url: '/api/management/v1/image-models/image', payload: body })).statusCode).toBe(403)
  expect((await server.inject({ method: 'DELETE', url: '/api/management/v1/image-models/image' })).statusCode).toBe(403)
  role = 'user'
  expect((await server.inject('/api/management/v1/image-models')).statusCode).toBe(403)
})
