import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../lib/errors.js'
const mocks = vi.hoisted(() => ({ sensitiveAuth: vi.fn(), accept: vi.fn(), hasTwoFactor: vi.fn(), appStoreRenews: vi.fn(async () => false) }))
vi.mock('../auth/service.js', () => ({ authenticateSessionToken: async () => ({ id: 'owner' }), requestSessionToken: () => 'session' }))
vi.mock('../auth/two-factor.js', () => ({ hasTwoFactor: mocks.hasTwoFactor }))
vi.mock('../auth/sensitive-action.js', () => ({ requireSensitiveAuth: mocks.sensitiveAuth }))
vi.mock('./deletion.js', () => ({ acceptAccountDeletion: mocks.accept }))
vi.mock('../billing/app-store-sync.js', () => ({ appStoreSubscriptionRenews: mocks.appStoreRenews }))
vi.mock('../config.js', async (original) => {
  const config = await original<typeof import('../config.js')>()
  return { ...config, getConfig: () => ({ ...config.getConfig(), PULPO_BILLING_ENABLED: true }) }
})
import { registerAccountDeletionRoutes } from './routes.js'

describe('account deletion authorization', () => {
  it.each(['apiKeyId', 'managementTokenId', 'adminChatAccess'])('rejects %s access', async (field) => {
    const app = Fastify()
    await app.register(cookie)
    app.addHook('onRequest', async (request) => {
      Object.assign(request, { user: { id: 'user' }, [field]: 'not-a-session' })
    })
    app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 500).send())
    await registerAccountDeletionRoutes(app)
    expect((await app.inject({ method: 'DELETE', url: '/api/me', payload: { currentPassword: 'password' } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/me/deletion' })).statusCode).toBe(401)
    await app.close()
  })
  it('does not accept deletion when the second factor is missing', async () => {
    mocks.accept.mockClear()
    mocks.sensitiveAuth.mockRejectedValueOnce(new AppError(400, 'two_factor_code_required', 'Enter your authenticator or recovery code.'))
    const app = Fastify()
    await app.register(cookie)
    app.addHook('onRequest', async (request) => { Object.assign(request, { user: { id: 'owner' } }) })
    app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 500).send())
    await registerAccountDeletionRoutes(app)
    expect((await app.inject({ method: 'DELETE', url: '/api/me', payload: { currentPassword: 'password' } })).statusCode).toBe(400)
    expect(mocks.accept).not.toHaveBeenCalled()
    await app.close()
  })
  it.each([false, true])('reports actual second-factor requirements for pending sessions: %s', async (enabled) => {
    mocks.hasTwoFactor.mockResolvedValueOnce(enabled)
    const app = Fastify()
    app.addHook('onRequest', async (request) => { Object.assign(request, { user: { id: 'owner', role: 'pending' } }) })
    await registerAccountDeletionRoutes(app)
    const response = await app.inject({ method: 'GET', url: '/api/me/deletion' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ twoFactorEnabled: enabled, appStoreSubscriptionRenews: false })
    expect(mocks.hasTwoFactor).toHaveBeenLastCalledWith('owner')
    await app.close()
  })

  it('warns when deletion would leave an App Store subscription renewing', async () => {
    mocks.hasTwoFactor.mockResolvedValueOnce(false)
    mocks.appStoreRenews.mockResolvedValueOnce(true)
    const app = Fastify()
    app.addHook('onRequest', async (request) => { Object.assign(request, { user: { id: 'owner' } }) })
    await registerAccountDeletionRoutes(app)
    const response = await app.inject({ method: 'GET', url: '/api/me/deletion' })
    expect(response.json()).toEqual({ twoFactorEnabled: false, appStoreSubscriptionRenews: true })
    expect(mocks.appStoreRenews).toHaveBeenLastCalledWith('owner')
    await app.close()
  })
})
