import type { FastifyInstance, FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  returnedRows: [{ id: 'key-1' }] as { id: string }[],
  updateValues: null as Record<string, unknown> | null,
}))

vi.mock('../database/client.js', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        mocks.updateValues = values
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => mocks.returnedRows),
          })),
        }
      }),
    })),
  },
}))
vi.mock('../auth/service.js', () => ({
  requireUser: mocks.requireUser,
  serializeUser: vi.fn(),
}))
vi.mock('../redis.js', () => ({
  createRedis: () => ({ quit: vi.fn() }),
}))

import { registerApiKeyRoutes } from './routes.js'

type Handler = (request: FastifyRequest) => Promise<unknown>

async function patchHandler(): Promise<Handler> {
  let handler: Handler | undefined
  const app = {
    addHook: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    patch: (_path: string, value: Handler) => { handler = value },
    delete: vi.fn(),
  } as unknown as FastifyInstance
  await registerApiKeyRoutes(app)
  return handler!
}

function request(enabled: boolean): FastifyRequest {
  return {
    params: { id: 'key-1' },
    body: { enabled },
  } as unknown as FastifyRequest
}

describe('API key status route', () => {
  beforeEach(() => {
    mocks.requireUser.mockReset().mockReturnValue({ id: 'user-1' })
    mocks.returnedRows = [{ id: 'key-1' }]
    mocks.updateValues = null
  })

  it('disables a key reversibly', async () => {
    const handler = await patchHandler()

    await expect(handler(request(false))).resolves.toEqual({ id: 'key-1', enabled: false })
    expect(mocks.updateValues).toMatchObject({ status: 'disabled', disabledAt: expect.any(Date) })
  })

  it('re-enables a disabled key', async () => {
    const handler = await patchHandler()

    await expect(handler(request(true))).resolves.toEqual({ id: 'key-1', enabled: true })
    expect(mocks.updateValues).toEqual({ status: 'active', disabledAt: null })
  })

  it('does not expose whether another user owns the key', async () => {
    mocks.returnedRows = []
    const handler = await patchHandler()

    await expect(handler(request(true))).rejects.toMatchObject({ statusCode: 404, code: 'not_found' })
  })
})
