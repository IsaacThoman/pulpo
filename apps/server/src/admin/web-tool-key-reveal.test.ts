import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  row: undefined as { value: unknown } | undefined,
  audits: [] as Array<Record<string, unknown>>,
  requireSecretRevealAuth: vi.fn(),
}))

vi.mock('../database/client.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => mocks.row ? [mocks.row] : []) })),
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
}))
vi.mock('../auth/sensitive-action.js', () => ({ requireSecretRevealAuth: mocks.requireSecretRevealAuth }))
vi.mock('../config.js', () => ({ getConfig: () => ({ ENCRYPTION_KEY: 'encryption-key' }) }))
vi.mock('../lib/crypto.js', () => ({
  decryptSecret: (value: string) => ({
    'encrypted-kagi': 'kagi-secret',
    'encrypted-firecrawl': 'firecrawl-secret',
  })[value] ?? 'unexpected',
  encryptSecret: vi.fn(),
}))
vi.mock('../jobs.js', () => ({ maintenanceQueue: { add: vi.fn() } }))

import { registerAdminSettingsRoutes } from './settings-routes.js'

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>

async function settingsHandlers(): Promise<Map<string, Handler>> {
  const handlers = new Map<string, Handler>()
  const route = (method: string) => (url: string, ...args: unknown[]) => {
    handlers.set(`${method} ${url}`, args.at(-1) as Handler)
  }
  const app = {
    get: route('GET'), post: route('POST'), put: route('PUT'), patch: route('PATCH'), delete: route('DELETE'),
  } as unknown as FastifyInstance
  await registerAdminSettingsRoutes(app)
  return handlers
}

function request(provider: 'kagi' | 'firecrawl', body: unknown = { verificationCode: '123456' }, role: 'admin' | 'user' = 'admin'): FastifyRequest {
  return {
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'admin@example.com', name: 'Admin', username: 'admin', avatarUrl: null, profileColor: null,
      role, balanceMicros: 0, storageLimitBytes: 0, blocked: false, stateRevision: 0,
      createdAt: new Date().toISOString(),
    },
    params: { provider },
    body,
  } as unknown as FastifyRequest
}

function reply(): FastifyReply {
  return { header: vi.fn().mockReturnThis() } as unknown as FastifyReply
}

describe('admin web-tool key reveal', () => {
  beforeEach(() => {
    mocks.row = { value: { encryptedKagiApiKey: 'encrypted-kagi', encryptedFirecrawlApiKey: 'encrypted-firecrawl' } }
    mocks.audits = []
    mocks.requireSecretRevealAuth.mockReset().mockResolvedValue(undefined)
  })

  it('requires an administrator', async () => {
    const handler = (await settingsHandlers()).get('POST /api/admin/settings/web-tools/:provider/api-key/reveal')!
    await expect(handler(request('kagi', undefined, 'user'), reply())).rejects.toThrow('Administrator')
    expect(mocks.requireSecretRevealAuth).not.toHaveBeenCalled()
  })

  it('rejects a provider without a saved key before authenticating', async () => {
    mocks.row = { value: { encryptedKagiApiKey: null, encryptedFirecrawlApiKey: 'encrypted-firecrawl' } }
    const handler = (await settingsHandlers()).get('POST /api/admin/settings/web-tools/:provider/api-key/reveal')!
    await expect(handler(request('kagi'), reply())).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.requireSecretRevealAuth).not.toHaveBeenCalled()
  })

  it.each([
    ['kagi', 'kagi-secret'],
    ['firecrawl', 'firecrawl-secret'],
  ] as const)('reveals the saved %s key with no-store and a redacted audit event', async (provider, apiKey) => {
    const handler = (await settingsHandlers()).get('POST /api/admin/settings/web-tools/:provider/api-key/reveal')!
    const response = reply()
    const result = await handler(request(provider), response)
    expect(mocks.requireSecretRevealAuth).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', undefined, '123456')
    expect(result).toEqual({ apiKey })
    expect(response.header).toHaveBeenCalledWith('cache-control', 'no-store')
    expect(mocks.audits).toHaveLength(1)
    expect(mocks.audits[0]).toMatchObject({
      action: 'settings.web_tools.api_key.reveal', targetType: 'web_tool_provider', targetId: provider,
    })
    expect(JSON.stringify(mocks.audits)).not.toContain(apiKey)
  })

  it('audits denied authentication without recording credentials', async () => {
    mocks.requireSecretRevealAuth.mockRejectedValue(new Error('Invalid verification code'))
    const handler = (await settingsHandlers()).get('POST /api/admin/settings/web-tools/:provider/api-key/reveal')!
    await expect(handler(request('firecrawl', { verificationCode: '654321' }), reply())).rejects.toThrow('Invalid verification code')
    expect(mocks.audits).toHaveLength(1)
    expect(mocks.audits[0]).toMatchObject({
      action: 'settings.web_tools.api_key.reveal_denied', targetType: 'web_tool_provider', targetId: 'firecrawl',
    })
    expect(JSON.stringify(mocks.audits)).not.toContain('654321')
  })
})
