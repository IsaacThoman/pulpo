import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  credential: { passwordHash: 'current-hash' } as { passwordHash: string } | undefined,
  createPasswordHash: vi.fn(async () => 'new-hash'),
  verifyPassword: vi.fn(async () => true),
  revokeOtherSessions: vi.fn(async () => undefined),
  updateWhere: vi.fn(async () => undefined),
}))

vi.mock('../database/client.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => mocks.credential ? [mocks.credential] : []) })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: mocks.updateWhere })),
    })),
  },
}))

vi.mock('./service.js', () => ({
  bearerSessionToken: vi.fn(),
  createPasswordHash: mocks.createPasswordHash,
  createSession: vi.fn(),
  destroySession: vi.fn(),
  requireUser: (request: FastifyRequest) => request.user,
  revokeOtherSessions: mocks.revokeOtherSessions,
  serializeUser: vi.fn(),
  verifyPassword: mocks.verifyPassword,
}))

import { registerAuthRoutes } from './routes.js'

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>

async function passwordHandler(): Promise<Handler> {
  let handler: Handler | undefined
  const app = {
    get: vi.fn(), patch: vi.fn(), delete: vi.fn(),
    post: (url: string, ...args: unknown[]) => {
      if (url === '/api/me/password') handler = args.at(-1) as Handler
    },
  } as unknown as FastifyInstance
  await registerAuthRoutes(app)
  return handler!
}

function request(): FastifyRequest {
  return {
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'user@example.com', name: 'User', username: 'user', avatarUrl: null, profileColor: null,
      role: 'user', balanceMicros: 0, storageLimitBytes: 0, blocked: false, stateRevision: 0,
      createdAt: new Date().toISOString(),
    },
    body: { currentPassword: 'current-password', newPassword: 'new-password' },
  } as unknown as FastifyRequest
}

function reply(): FastifyReply {
  return { code: vi.fn().mockReturnThis(), send: vi.fn() } as unknown as FastifyReply
}

describe('password changes', () => {
  beforeEach(() => {
    mocks.credential = { passwordHash: 'current-hash' }
    mocks.createPasswordHash.mockClear()
    mocks.verifyPassword.mockReset().mockResolvedValue(true)
    mocks.revokeOtherSessions.mockClear()
    mocks.updateWhere.mockClear()
  })

  it('revokes every session except the one changing the password', async () => {
    const handler = await passwordHandler()
    const currentRequest = request()

    await handler(currentRequest, reply())

    expect(mocks.updateWhere).toHaveBeenCalledOnce()
    expect(mocks.revokeOtherSessions).toHaveBeenCalledWith(currentRequest, currentRequest.user!.id)
  })

  it('does not revoke sessions when the current password is invalid', async () => {
    mocks.verifyPassword.mockResolvedValue(false)
    const handler = await passwordHandler()

    await expect(handler(request(), reply())).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.updateWhere).not.toHaveBeenCalled()
    expect(mocks.revokeOtherSessions).not.toHaveBeenCalled()
  })
})
