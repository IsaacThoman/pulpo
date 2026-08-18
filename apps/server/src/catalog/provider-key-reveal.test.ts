import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  requireSensitiveAuth: vi.fn(),
}))

vi.mock('../database/client.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const result = {
            limit: vi.fn(async () => mocks.rows),
            then: (resolve: (value: Array<Record<string, unknown>>) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(mocks.rows).then(resolve, reject),
          }
          return result
        }),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(async (value: Record<string, unknown>) => { mocks.audits.push(value) }) })),
  },
}))
vi.mock('../auth/service.js', () => ({
  requireAdmin: (request: FastifyRequest) => {
    if (request.user?.role !== 'admin') throw new Error('Administrator access required')
    return request.user
  },
  requireUser: (request: FastifyRequest) => request.user,
}))
vi.mock('../auth/sensitive-action.js', () => ({ requireSensitiveAuth: mocks.requireSensitiveAuth }))
vi.mock('../config.js', () => ({ getConfig: () => ({ ENCRYPTION_KEY: 'encryption-key' }) }))
vi.mock('../lib/crypto.js', () => ({
  decryptSecret: (value: string) => value === 'encrypted-provider-key' ? 'sk-provider-secret' : 'unexpected',
  encryptSecret: vi.fn(),
}))

import { registerCatalogRoutes } from './routes.js'

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>

async function catalogHandlers(): Promise<Map<string, Handler>> {
  const handlers = new Map<string, Handler>()
  const route = (method: string) => (url: string, ...args: unknown[]) => {
    handlers.set(`${method} ${url}`, args.at(-1) as Handler)
  }
  const app = {
    get: route('GET'), post: route('POST'), put: route('PUT'), patch: route('PATCH'), delete: route('DELETE'),
  } as unknown as FastifyInstance
  await registerCatalogRoutes(app)
  return handlers
}

function request(input: { role?: 'admin' | 'user'; id?: string; body?: unknown } = {}): FastifyRequest {
  return {
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'admin@example.com', name: 'Admin', username: 'admin', avatarUrl: null, profileColor: null,
      role: input.role ?? 'admin', balanceMicros: 0, storageLimitBytes: 0, blocked: false, stateRevision: 0,
      createdAt: new Date().toISOString(),
    },
    params: { id: input.id ?? '22222222-2222-4222-8222-222222222222' },
    body: input.body ?? { currentPassword: 'password' },
  } as unknown as FastifyRequest
}

function reply(): FastifyReply {
  return { header: vi.fn().mockReturnThis() } as unknown as FastifyReply
}

describe('admin provider key reveal', () => {
  beforeEach(() => {
    mocks.rows = [{
      id: '22222222-2222-4222-8222-222222222222', name: 'Provider', encryptedApiKey: 'encrypted-provider-key',
    }]
    mocks.audits = []
    mocks.requireSensitiveAuth.mockReset().mockResolvedValue(undefined)
  })

  it('keeps encrypted and plaintext keys out of provider list responses', async () => {
    const handler = (await catalogHandlers()).get('GET /api/admin/providers')!
    const result = await handler(request(), reply()) as { data: Array<Record<string, unknown>> }
    expect(result.data[0]).not.toHaveProperty('encryptedApiKey')
    expect(JSON.stringify(result)).not.toContain('sk-provider-secret')
  })

  it('requires an administrator and an existing provider', async () => {
    const handler = (await catalogHandlers()).get('POST /api/admin/providers/:id/api-key/reveal')!
    await expect(handler(request({ role: 'user' }), reply())).rejects.toThrow('Administrator')
    mocks.rows = []
    await expect(handler(request(), reply())).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.requireSensitiveAuth).not.toHaveBeenCalled()
  })

  it('audits denied authentication without recording sensitive input', async () => {
    const handler = (await catalogHandlers()).get('POST /api/admin/providers/:id/api-key/reveal')!
    mocks.requireSensitiveAuth.mockRejectedValue(new Error('Current password is incorrect'))
    await expect(handler(request({ body: { currentPassword: 'sensitive-password', verificationCode: '123456' } }), reply()))
      .rejects.toThrow('Current password')
    expect(mocks.audits).toHaveLength(1)
    expect(mocks.audits[0]).toMatchObject({ action: 'provider.api_key.reveal_denied', targetType: 'provider' })
    expect(JSON.stringify(mocks.audits)).not.toContain('sensitive-password')
    expect(JSON.stringify(mocks.audits)).not.toContain('123456')
  })

  it('returns the decrypted key with no-store and audits the reveal', async () => {
    const handler = (await catalogHandlers()).get('POST /api/admin/providers/:id/api-key/reveal')!
    const response = reply()
    const result = await handler(request({ body: { currentPassword: 'password', verificationCode: '123456' } }), response)
    expect(mocks.requireSensitiveAuth).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'password', '123456')
    expect(result).toEqual({ apiKey: 'sk-provider-secret' })
    expect(response.header).toHaveBeenCalledWith('cache-control', 'no-store')
    expect(mocks.audits).toHaveLength(1)
    expect(mocks.audits[0]).toMatchObject({ action: 'provider.api_key.reveal', targetType: 'provider' })
    expect(JSON.stringify(mocks.audits)).not.toContain('sk-provider-secret')
  })
})
