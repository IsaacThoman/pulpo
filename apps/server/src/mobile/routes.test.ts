import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createInitialAdmin: vi.fn(),
  createNativeSession: vi.fn(),
  select: vi.fn(),
}))

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

import { registerMobileRoutes } from './routes.js'

describe('mobile dictation capability', () => {
  it.each([
    [undefined, false],
    [{ enabled: false, encryptedGroqApiKey: 'configured' }, false],
    [{ enabled: true, encryptedGroqApiKey: null }, false],
    [{ enabled: true, encryptedGroqApiKey: 'configured' }, true],
  ])('advertises dictation only when configured and enabled (%j)', async (settings, enabled) => {
    const values = [[{ id: 'user' }], [{ value: {} }], settings ? [{ value: settings }] : []]
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
        name: 'Admin', username: 'admin', email: 'admin@example.com', password: 'password', deviceLabel: 'Pulpo for Mac',
      },
    } as unknown as FastifyRequest
    const reply = { code: vi.fn().mockReturnThis() } as unknown as FastifyReply

    const result = await handler(request, reply)

    expect(mocks.createInitialAdmin).toHaveBeenCalledWith({
      name: 'Admin', username: 'admin', email: 'admin@example.com', password: 'password', deviceLabel: 'Pulpo for Mac',
    })
    expect(mocks.createNativeSession).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'Pulpo for Mac', request, { appType: undefined, platform: undefined })
    expect(reply.code).toHaveBeenCalledWith(201)
    expect(result).toMatchObject({ user: { role: 'admin' }, session: { token: 't'.repeat(43) } })
  })

  it('propagates duplicate-setup protection without creating a session', async () => {
    mocks.createInitialAdmin.mockRejectedValueOnce(new Error('Pulpo has already been set up'))
    const handler = await nativeSetupHandler()
    const request = { body: { name: 'Admin', username: 'admin', email: 'admin@example.com', password: 'password', deviceLabel: 'Pulpo for Mac' } } as unknown as FastifyRequest

    await expect(handler(request, { code: vi.fn() } as unknown as FastifyReply)).rejects.toThrow('already been set up')
    expect(mocks.createNativeSession).not.toHaveBeenCalled()
  })
})
