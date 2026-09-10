import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selects: [] as unknown[][], inserted: [] as unknown[],
  createResponse: vi.fn(), publish: vi.fn(), deleteChat: vi.fn(),
}))
vi.mock('../database/client.js', () => ({ db: {
  select: () => { const query = { from: () => query, where: () => query, limit: async () => mocks.selects.shift() ?? [] }; return query },
  insert: () => { const query = { values: () => query, onConflictDoNothing: () => query, returning: async () => mocks.inserted }; return query },
  update: () => { const query = { set: () => query, where: () => query, returning: async () => [{ revision: 1 }] }; return query },
  delete: () => ({ where: mocks.deleteChat }),
} }))
vi.mock('../auth/service.js', () => ({ requireUser: () => ({ id: 'owner' }), billingUserForRequest: () => ({ id: 'owner' }) }))
vi.mock('../responses/service.js', () => ({ createResponse: mocks.createResponse, toSnapshot: (response: { id: string }) => ({ responseId: response.id }) }))
vi.mock('../responses/events.js', () => ({ publishChatStarted: mocks.publish, publishStateChange: vi.fn(), requestCancellation: vi.fn() }))
import { registerChatRoutes } from './routes.js'

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
const chatId = '00000000-0000-4000-8000-000000000001'
const responseId = '00000000-0000-4000-8000-000000000002'
const chat = { id: chatId, userId: 'owner', modelId: 'model', temporary: false, expiresAt: null }
let handler: Handler
let request: FastifyRequest
let reply: FastifyReply
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.inserted = [chat]
  mocks.selects = [[{ id: 'model' }], [chat]]
  mocks.createResponse.mockResolvedValue({ id: responseId })
  mocks.publish.mockResolvedValue(undefined)
  await registerChatRoutes({
    get: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
    post: (path: string, candidate: Handler) => { if (path === '/api/chats/start') handler = candidate },
  } as unknown as FastifyInstance)
  request = {
    body: { chat: { clientId: chatId, modelId: 'model' }, response: { clientId: responseId, modelId: 'model', input: 'Hello' } },
    headers: {}, log: { warn: vi.fn() },
  } as unknown as FastifyRequest
  reply = { code: vi.fn() } as unknown as FastifyReply
})

describe('accepted new chat notifications', () => {
  it('publishes the owner and accepted chat/response identities only after acceptance', async () => {
    let accept!: (value: unknown) => void
    mocks.createResponse.mockReturnValue(new Promise((resolve) => { accept = resolve }))
    const pending = handler(request, reply)
    await vi.waitFor(() => expect(mocks.createResponse).toHaveBeenCalledOnce())
    expect(mocks.publish).not.toHaveBeenCalled()
    accept({ id: responseId })
    await expect(pending).resolves.toEqual({ chat, response: { responseId } })
    expect(mocks.publish.mock.calls).toEqual([['owner', { chatId, responseId }]])
    expect(reply.code).toHaveBeenCalledWith(202)
  })
  it('does not emit for an idempotent retry of an existing chat', async () => {
    mocks.inserted = []
    mocks.selects = [[{ id: 'model' }], [chat], [chat]]
    await handler(request, reply)
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('does not emit for temporary starts', async () => {
    mocks.inserted = [{ ...chat, temporary: true }]
    ;(request.body as { chat: { temporary?: boolean } }).chat.temporary = true
    await handler(request, reply)
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('does not emit for rejected responses or invalid models', async () => {
    mocks.createResponse.mockRejectedValue(new Error('Rejected'))
    await expect(handler(request, reply)).rejects.toThrow('Rejected')
    expect(mocks.deleteChat).toHaveBeenCalledOnce()
    expect(mocks.publish).not.toHaveBeenCalled()
    mocks.selects = [[]]
    await expect(handler(request, reply)).rejects.toMatchObject({ code: 'model_not_found' })
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('does not roll back an accepted chat if the live notification fails', async () => {
    mocks.publish.mockRejectedValue(new Error('Redis unavailable'))
    await expect(handler(request, reply)).resolves.toEqual({ chat, response: { responseId } })
    expect(mocks.deleteChat).not.toHaveBeenCalled()
    expect(request.log.warn).toHaveBeenCalledOnce()
  })
})
