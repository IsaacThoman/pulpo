import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createInitialAdmin: vi.fn(),
  createNativeSession: vi.fn(),
  select: vi.fn(),
  billingEnabled: undefined as boolean | undefined,
  config: {} as Record<string, unknown>,
}))

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>()
  return {
    ...actual,
    getConfig: () => ({
      ...actual.getConfig(),
      ...(mocks.billingEnabled === undefined ? {} : { PULPO_BILLING_ENABLED: mocks.billingEnabled }),
      ...mocks.config,
    }),
  }
})

vi.mock('../database/client.js', () => ({ db: { select: mocks.select } }))

vi.mock('../auth/initial-admin.js', () => ({ createInitialAdmin: mocks.createInitialAdmin }))
vi.mock('../auth/service.js', () => ({
  bearerSessionToken: vi.fn(),
  createNativeSession: mocks.createNativeSession,
  createPasswordHash: vi.fn(),
  destroyNativeSession: vi.fn(),
  serializeUser: (value: unknown) => value,
  verifyPassword: vi.fn(),
}))

import { DOC_SCHEMA_VERSION } from '@pulpo/client-core/doc-schema'
import { registerMobileRoutes } from './routes.js'

describe('mobile dictation capability', () => {
  it.each([
    [undefined, false],
    [{ enabled: false, encryptedGroqApiKey: 'configured' }, false],
    [{ enabled: true, encryptedGroqApiKey: null }, false],
    [{ enabled: true, encryptedGroqApiKey: 'configured' }, true],
  ])('advertises dictation only when configured and enabled (%j)', async (settings, enabled) => {
    const values = [[{ id: 'user' }], [{ value: {} }], settings ? [{ value: settings }] : [], []]
    mocks.select.mockImplementation(() => {
      const rows = values.shift()
      const chain = { from: () => chain, where: () => chain, limit: async () => rows }
      return chain
    })
    let handler!: () => Promise<unknown>
    await registerMobileRoutes({
      get: (path: string, callback: () => Promise<unknown>) => { if (path === '/api/mobile/config') handler = callback },
      post: vi.fn(),
    } as unknown as FastifyInstance)
    expect(await handler()).toMatchObject({ capabilities: { dictation: enabled } })
  })
})

describe('mobile Files capability', () => {
  it.each([
    [{}, true],
    [{ filesEnabled: false }, false],
  ])('advertises Files and the document schema version (%j)', async (auth, enabled) => {
    const values = [[{ id: 'user' }], [{ value: auth }], [], []]
    mocks.select.mockImplementation(() => {
      const rows = values.shift()
      const chain = { from: () => chain, where: () => chain, limit: async () => rows }
      return chain
    })
    let handler!: () => Promise<unknown>
    await registerMobileRoutes({
      get: (path: string, callback: () => Promise<unknown>) => { if (path === '/api/mobile/config') handler = callback },
      post: vi.fn(),
    } as unknown as FastifyInstance)
    expect(await handler()).toMatchObject({ capabilities: { files: { enabled, docSchemaVersion: DOC_SCHEMA_VERSION } } })
  })

  it.each([
    [{}, undefined, false],
    [{}, { extractEnabled: false, encryptedKagiApiKey: 'configured' }, false],
    [{}, { extractEnabled: true }, false],
    [{}, { extractEnabled: true, encryptedKagiApiKey: 'configured' }, true],
    [{ filesEnabled: false }, { extractEnabled: true, encryptedKagiApiKey: 'configured' }, false],
  ])('advertises Import from URL only when Files is on and a page extractor is set up (%j, %j)', async (auth, webTools, urlImport) => {
    const values = [[{ id: 'user' }], [{ value: auth }], [], webTools ? [{ value: webTools }] : []]
    mocks.select.mockImplementation(() => {
      const rows = values.shift()
      const chain = { from: () => chain, where: () => chain, limit: async () => rows }
      return chain
    })
    let handler!: () => Promise<unknown>
    await registerMobileRoutes({
      get: (path: string, callback: () => Promise<unknown>) => { if (path === '/api/mobile/config') handler = callback },
      post: vi.fn(),
    } as unknown as FastifyInstance)
    expect(await handler()).toMatchObject({ capabilities: { files: { urlImport } } })
  })
})

describe('mobile usage limits capability', () => {
  it.each([true, false])('advertises plan usage limits only when billing is enabled (%s)', async (billingEnabled) => {
    mocks.billingEnabled = billingEnabled
    const values = [[{ id: 'user' }], [{ value: {} }], [], []]
    mocks.select.mockImplementation(() => {
      const rows = values.shift()
      const chain = { from: () => chain, where: () => chain, limit: async () => rows }
      return chain
    })
    let handler!: () => Promise<unknown>
    await registerMobileRoutes({
      get: (path: string, callback: () => Promise<unknown>) => { if (path === '/api/mobile/config') handler = callback },
      post: vi.fn(),
    } as unknown as FastifyInstance)
    try {
      expect(await handler()).toMatchObject({ capabilities: { usageLimits: billingEnabled } })
    } finally {
      mocks.billingEnabled = undefined
    }
  })
})

describe('mobile App Store billing capability', () => {
  async function capabilities() {
    const values = [[{ id: 'user' }], [{ value: {} }], [], []]
    mocks.select.mockImplementation(() => {
      const rows = values.shift()
      const chain = { from: () => chain, where: () => chain, limit: async () => rows }
      return chain
    })
    let handler!: () => Promise<{ capabilities: Record<string, unknown> }>
    await registerMobileRoutes({
      get: (path: string, callback: () => Promise<{ capabilities: Record<string, unknown> }>) => { if (path === '/api/mobile/config') handler = callback },
      post: vi.fn(),
    } as unknown as FastifyInstance)
    return (await handler()).capabilities
  }

  afterEach(() => {
    mocks.billingEnabled = undefined
    mocks.config = {}
  })

  it('lists the StoreKit environments and products the server accepts purchases of', async () => {
    mocks.billingEnabled = true
    mocks.config = {
      APP_STORE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----',
      APP_STORE_ENVIRONMENTS: ['sandbox'],
      APP_STORE_EIGHT_PRODUCT_ID: 'pulpoEight',
      APP_STORE_FAT_PRODUCT_ID: 'pulpoFat',
    }
    expect((await capabilities()).appStoreBilling).toEqual({ environments: ['sandbox'], products: { eight: 'pulpoEight', fat: 'pulpoFat' } })
  })

  it('offers no purchases without App Store configuration or billing', async () => {
    mocks.billingEnabled = true
    expect((await capabilities()).appStoreBilling).toBeNull()
    mocks.billingEnabled = false
    mocks.config = { APP_STORE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----', APP_STORE_ENVIRONMENTS: ['production'] }
    expect((await capabilities()).appStoreBilling).toBeNull()
  })
})

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>

async function nativeSetupHandler(): Promise<Handler> {
  let handler: Handler | undefined
  const app = {
    get: vi.fn(),
    post: (url: string, ...args: unknown[]) => {
      if (url === '/api/mobile/auth/setup') handler = args.at(-1) as Handler
    },
  } as unknown as FastifyInstance
  await registerMobileRoutes(app)
  return handler!
}

describe('native initial setup', () => {
  beforeEach(() => {
    mocks.createInitialAdmin.mockReset().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', role: 'admin' })
    mocks.createNativeSession.mockReset().mockResolvedValue({ token: 't'.repeat(43), expiresAt: '2030-01-01T00:00:00.000Z' })
  })

  it('creates the first administrator and a device-labelled bearer session', async () => {
    const handler = await nativeSetupHandler()
    const request = {
      body: {
        name: 'Admin', username: 'pulpo_admin', email: 'admin@example.com', password: 'password', deviceLabel: 'Pulpo for Mac',
      },
    } as unknown as FastifyRequest
    const reply = { code: vi.fn().mockReturnThis() } as unknown as FastifyReply

    const result = await handler(request, reply)

    expect(mocks.createInitialAdmin).toHaveBeenCalledWith({
      name: 'Admin', username: 'pulpo_admin', email: 'admin@example.com', password: 'password', deviceLabel: 'Pulpo for Mac',
    })
    expect(mocks.createNativeSession).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'Pulpo for Mac', request, { appType: undefined, platform: undefined })
    expect(reply.code).toHaveBeenCalledWith(201)
    expect(result).toMatchObject({ user: { role: 'admin' }, session: { token: 't'.repeat(43) } })
  })

  it('propagates duplicate-setup protection without creating a session', async () => {
    mocks.createInitialAdmin.mockRejectedValueOnce(new Error('Pulpo has already been set up'))
    const handler = await nativeSetupHandler()
    const request = { body: { name: 'Admin', username: 'pulpo_admin', email: 'admin@example.com', password: 'password', deviceLabel: 'Pulpo for Mac' } } as unknown as FastifyRequest

    await expect(handler(request, { code: vi.fn() } as unknown as FastifyReply)).rejects.toThrow('already been set up')
    expect(mocks.createNativeSession).not.toHaveBeenCalled()
  })
})
