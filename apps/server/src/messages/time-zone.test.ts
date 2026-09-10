import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ selects: [] as unknown[][], createResponse: vi.fn() }))
vi.mock('../database/client.js', () => ({ db: {
  update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
  select: () => {
    const query = {
      from: () => query, innerJoin: () => query, where: () => query,
      limit: async () => mocks.selects.shift() ?? [],
    }
    return query
  },
} }))
vi.mock('../auth/service.js', () => ({
  requireUser: () => ({ id: 'user' }), billingUserForRequest: () => ({ id: 'user' }),
}))
vi.mock('../responses/service.js', () => ({ createResponse: mocks.createResponse, toSnapshot: (value: unknown) => value }))
vi.mock('../episodic-memory/queue.js', () => ({ scheduleChatIndex: vi.fn() }))

import { registerMessageRoutes } from './routes.js'
import { registerChatRoutes } from '../chats/routes.js'

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
const handlers = new Map<string, Handler>()
const app = {
  get: vi.fn(), put: vi.fn(), delete: vi.fn(),
  post: (path: string, handler: Handler) => handlers.set(`POST ${path}`, handler),
  patch: (path: string, handler: Handler) => handlers.set(`PATCH ${path}`, handler),
} as unknown as FastifyInstance
await registerMessageRoutes(app)
await registerChatRoutes(app)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.selects = []
  mocks.createResponse.mockResolvedValue({ id: 'new-response' })
})

const original = {
  id: 'response', chatId: 'chat', modelId: 'model', input: [{ role: 'user', content: 'hello' }],
  presetSelections: {}, parameters: {}, executionMode: 'stream', agentMode: false,
  parentResponseId: null, timeZone: 'Asia/Tokyo',
}

describe('generation routes carry timezone', () => {
  it.each(['send', 'edit', 'regenerate'] as const)('uses the request timezone for %s', async (kind) => {
    const path = kind === 'send' ? 'POST /api/chats/:id/responses'
      : kind === 'edit' ? 'PATCH /api/messages/:id' : 'POST /api/messages/:id/regenerate'
    if (kind !== 'send') mocks.selects = [[{ response: original }]]
    await handlers.get(path)!({
      params: { id: kind === 'edit' ? 'response:input' : kind === 'send' ? 'chat' : 'response' },
      body: { timeZone: 'America/New_York', modelId: 'model', input: 'hello', content: 'edited' },
      headers: {},
    } as unknown as FastifyRequest, { code: vi.fn() } as unknown as FastifyReply)
    expect(mocks.createResponse).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ timeZone: 'America/New_York' }),
    }))
  })

  it('rejects an invalid timezone on regeneration before starting work', async () => {
    mocks.selects = [[{ response: original }]]
    await expect(handlers.get('POST /api/messages/:id/regenerate')!({
      params: { id: 'response' }, body: { timeZone: 'Mars/Olympus_Mons' }, headers: {},
    } as unknown as FastifyRequest, { code: vi.fn() } as unknown as FastifyReply)).rejects.toThrow('Invalid time zone')
    expect(mocks.createResponse).not.toHaveBeenCalled()
  })
})
