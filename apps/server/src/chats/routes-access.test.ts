import type { FastifyInstance, FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
}))

vi.mock('../database/client.js', () => ({
  db: {
    select: vi.fn(() => {
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(async () => mocks.selectResults.shift() ?? []),
      }
      return builder
    }),
  },
}))
vi.mock('../auth/service.js', () => ({
  requireUser: (request: FastifyRequest) => request.user,
  billingUserForRequest: (request: FastifyRequest) => request.user,
}))

import { registerChatRoutes } from './routes.js'

type Handler = (request: FastifyRequest) => Promise<unknown>

async function chatHandler(method: 'get' | 'patch'): Promise<Handler> {
  let handler: Handler | undefined
  const capture = (verb: string) => (path: string, value: Handler) => {
    if (verb === method && path === '/api/chats/:id') handler = value
  }
  const app = {
    get: capture('get'),
    post: vi.fn(),
    put: vi.fn(),
    patch: capture('patch'),
    delete: vi.fn(),
  } as unknown as FastifyInstance
  await registerChatRoutes(app)
  return handler!
}

const chatDetailHandler = () => chatHandler('get')

function request(role: 'admin' | 'user'): FastifyRequest {
  return {
    params: { id: '9db9ea5a-3af7-4b66-9f2a-c179278a0998' },
    query: { format: 'compact', scope: 'active' },
    user: { id: 'user-1', role },
    adminChatAccess: null,
  } as unknown as FastifyRequest
}

describe('chat detail access response', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectResults = []
  })

  it('directs an admin to the access gate only when the chat belongs to another account', async () => {
    mocks.selectResults = [[], [], [{ id: 'foreign-chat' }]]

    await expect((await chatDetailHandler())(request('admin')))
      .rejects.toMatchObject({ statusCode: 403, code: 'chat_not_in_account' })
  })

  it('keeps missing chats indistinguishable for non-admins and reports a normal 404', async () => {
    mocks.selectResults = [[], []]

    await expect((await chatDetailHandler())(request('user')))
      .rejects.toMatchObject({ statusCode: 404, code: 'not_found' })
  })

  it('reports a normal 404 when no foreign chat exists', async () => {
    mocks.selectResults = [[], [], []]

    await expect((await chatDetailHandler())(request('admin')))
      .rejects.toMatchObject({ statusCode: 404, code: 'not_found' })
  })
})

describe('chat update during admin chat access', () => {
  it('rejects file scope changes so the grant cannot reach the owner\'s Files', async () => {
    const rootId = '5f0f3c1e-7f43-4e8e-9d1b-6a0c8a3c2b11'
    const adminRequest = {
      ...request('user'),
      body: { fileScopeIds: [rootId] },
      adminChatAccess: { chatId: '9db9ea5a-3af7-4b66-9f2a-c179278a0998', actorUser: { id: 'admin-1' } },
    } as unknown as FastifyRequest

    await expect((await chatHandler('patch'))(adminRequest))
      .rejects.toMatchObject({ statusCode: 403, code: 'forbidden' })
  })
})
