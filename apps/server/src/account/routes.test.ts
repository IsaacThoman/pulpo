import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../lib/errors.js'
const mocks = vi.hoisted(() => ({ sensitiveAuth: vi.fn(), accept: vi.fn() }))
vi.mock('../auth/service.js', () => ({ authenticateSessionToken: async () => ({ id: 'owner' }), requestSessionToken: () => 'session' }))
vi.mock('../auth/sensitive-action.js', () => ({ requireSensitiveAuth: mocks.sensitiveAuth }))
vi.mock('./deletion.js', () => ({ acceptAccountDeletion: mocks.accept }))
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
})
