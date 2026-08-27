import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectRows: [] as Array<Record<string, unknown>>,
  authenticateApiKey: vi.fn(),
  assertApiKeyModelAllowed: vi.fn(),
  apiKeyModelAllowed: vi.fn(),
  filterApiKeyAllowedModels: vi.fn(),
  executePublicGeneration: vi.fn(),
  logInfo: vi.fn(),
}))

vi.mock('../database/client.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn(() => {
          const result = Promise.resolve(mocks.selectRows)
          return Object.assign(result, { limit: vi.fn(async () => mocks.selectRows) })
        }),
      })),
    })),
  },
}))
vi.mock('../api-keys/routes.js', () => ({
  authenticateApiKey: mocks.authenticateApiKey,
  assertApiKeyModelAllowed: mocks.assertApiKeyModelAllowed,
  apiKeyModelAllowed: mocks.apiKeyModelAllowed,
  filterApiKeyAllowedModels: mocks.filterApiKeyAllowedModels,
}))
vi.mock('./generation.js', () => ({ executePublicGeneration: mocks.executePublicGeneration }))
vi.mock('../responses/events.js', () => ({ requestCancellation: vi.fn() }))

import { registerPublicApiRoutes } from './routes.js'

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>

async function handlers(): Promise<Map<string, Handler>> {
  const registered = new Map<string, Handler>()
  const route = (method: string) => (url: string, handler: Handler) => registered.set(`${method} ${url}`, handler)
  const app = { get: route('GET'), post: route('POST') } as unknown as FastifyInstance
  await registerPublicApiRoutes(app)
  return registered
}

function request(input: { body?: unknown; params?: unknown; idempotencyKey?: string } = {}): FastifyRequest {
  return {
    body: input.body,
    params: input.params ?? {},
    headers: input.idempotencyKey ? { 'idempotency-key': input.idempotencyKey } : {},
    log: { info: mocks.logInfo },
  } as unknown as FastifyRequest
}

describe('public OpenAI-compatible routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectRows = []
    mocks.authenticateApiKey.mockResolvedValue({ id: 'key-1', userId: 'user-1' })
    mocks.assertApiKeyModelAllowed.mockResolvedValue(undefined)
    mocks.apiKeyModelAllowed.mockResolvedValue(true)
    mocks.filterApiKeyAllowedModels.mockImplementation(async (_keyId: string, rows: unknown[]) => rows)
    mocks.executePublicGeneration.mockResolvedValue({ ok: true })
  })

  it('uses the existing responses scope for all three inference protocols', async () => {
    const routes = await handlers()
    const reply = {} as FastifyReply
    await routes.get('POST /v1/responses')!(request({ body: { model: 'm', input: 'hi' } }), reply)
    await routes.get('POST /v1/chat/completions')!(request({
      body: { model: 'm', messages: [{ role: 'user', content: 'hi' }] }, idempotencyKey: 'retry-1',
    }), reply)
    await routes.get('POST /v1/completions')!(request({ body: { model: 'm', prompt: 'hi' } }), reply)

    expect(mocks.authenticateApiKey.mock.calls.map((call) => call[1])).toEqual(['responses', 'responses', 'responses'])
    expect(mocks.assertApiKeyModelAllowed).toHaveBeenCalledTimes(3)
    expect(mocks.executePublicGeneration.mock.calls.map((call) => call[0].request.protocol))
      .toEqual(['responses', 'chat_completions', 'completions'])
    expect(mocks.executePublicGeneration.mock.calls[1]![0]).toMatchObject({ idempotencyKey: 'retry-1' })
  })

  it('rejects unsupported parameters before queueing', async () => {
    const handler = (await handlers()).get('POST /v1/chat/completions')!
    await expect(handler(request({ body: {
      model: 'm', messages: [{ role: 'user', content: 'hi' }], stop: 'END',
    } }), {} as FastifyReply)).rejects.toMatchObject({ statusCode: 400, code: 'unsupported_parameter', param: 'stop' })
    expect(mocks.assertApiKeyModelAllowed).not.toHaveBeenCalled()
    expect(mocks.executePublicGeneration).not.toHaveBeenCalled()
  })

  it('queues requests with harmless or unknown parameters and logs what was ignored', async () => {
    const handler = (await handlers()).get('POST /v1/responses')!
    await expect(handler(request({ body: {
      model: 'm', input: 'hi', store: false, include: [], future_client_option: true,
    } }), {} as FastifyReply)).resolves.toEqual({ ok: true })

    expect(mocks.executePublicGeneration).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ publiclyStored: false }),
    }))
    expect(mocks.logInfo).toHaveBeenCalledWith({
      protocol: 'responses', ignoredParameters: ['future_client_option', 'include'],
    }, 'Ignored OpenAI-compatible request parameters')
  })

  it('does not expose Responses created with store=false through retrieval', async () => {
    mocks.selectRows = [{ response: { publiclyStored: false } }]
    const handler = (await handlers()).get('GET /v1/responses/:id')!
    await expect(handler(request({ params: { id: 'response-1' } }), {} as FastifyReply))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('filters model listings through the key permission set', async () => {
    const visible = { id: 'visible', enabled: true, visible: true, createdAt: new Date('2026-01-01') }
    const denied = { id: 'denied', enabled: true, visible: true, createdAt: new Date('2026-01-01') }
    mocks.selectRows = [visible, denied]
    mocks.filterApiKeyAllowedModels.mockResolvedValue([visible])

    const result = await (await handlers()).get('GET /v1/models')!(request(), {} as FastifyReply) as { data: Array<{ id: string }> }
    expect(mocks.authenticateApiKey).toHaveBeenCalledWith(expect.anything(), 'models')
    expect(mocks.filterApiKeyAllowedModels).toHaveBeenCalledWith('key-1', [visible, denied])
    expect(result.data.map((model) => model.id)).toEqual(['visible'])
  })

  it('returns 404 for missing or key-inaccessible model details', async () => {
    const handler = (await handlers()).get('GET /v1/models/:model')!
    await expect(handler(request({ params: { model: 'missing' } }), {} as FastifyReply))
      .rejects.toMatchObject({ statusCode: 404 })

    mocks.selectRows = [{ id: 'private', enabled: true, visible: true, createdAt: new Date('2026-01-01') }]
    mocks.apiKeyModelAllowed.mockResolvedValue(false)
    await expect(handler(request({ params: { model: 'private' } }), {} as FastifyReply))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})
