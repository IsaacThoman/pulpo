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

const routeOptions = new Map<string, Record<string, unknown>>()

async function handlers(): Promise<Map<string, Handler>> {
  const registered = new Map<string, Handler>()
  // Fastify accepts `(url, handler)` or `(url, options, handler)`; the handler is always last.
  const route = (method: string) => (url: string, ...rest: unknown[]) => {
    registered.set(`${method} ${url}`, rest.at(-1) as Handler)
    if (rest.length > 1) routeOptions.set(`${method} ${url}`, rest[0] as Record<string, unknown>)
  }
  const app = { get: route('GET'), post: route('POST') } as unknown as FastifyInstance
  await registerPublicApiRoutes(app)
  return registered
}

function request(input: { body?: unknown; params?: unknown; idempotencyKey?: string; headers?: Record<string, string> } = {}): FastifyRequest {
  return {
    body: input.body,
    params: input.params ?? {},
    headers: { ...input.headers, ...(input.idempotencyKey ? { 'idempotency-key': input.idempotencyKey } : {}) },
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
      model: 'm', messages: [{ role: 'user', content: 'hi' }], n: 2,
    } }), {} as FastifyReply)).rejects.toMatchObject({ statusCode: 400, code: 'unsupported_parameter', param: 'n' })
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

  it('queues supported encrypted context without logging it as discarded', async () => {
    const handler = (await handlers()).get('POST /v1/responses')!
    await expect(handler(request({ body: {
      model: 'm', input: 'hi', include: ['reasoning.encrypted_content'], future_client_option: true,
    } }), {} as FastifyReply)).resolves.toEqual({ ok: true })

    expect(mocks.executePublicGeneration).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        parameters: expect.objectContaining({ include: ['reasoning.encrypted_content'] }),
      }),
    }))
    expect(mocks.logInfo).toHaveBeenCalledWith({
      protocol: 'responses', ignoredParameters: ['future_client_option'],
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

  it('parses Anthropic Messages requests and delegates them to the shared generation pipeline', async () => {
    const handler = (await handlers()).get('POST /v1/messages')!
    const reply = {} as FastifyReply
    await expect(handler(request({
      body: { model: 'm', max_tokens: 64, system: 'Be brief.', messages: [{ role: 'user', content: 'hi' }], top_k: 3 },
      idempotencyKey: 'anthropic-1',
    }), reply)).resolves.toEqual({ ok: true })

    expect(mocks.authenticateApiKey).toHaveBeenCalledWith(expect.anything(), 'responses')
    expect(mocks.assertApiKeyModelAllowed).toHaveBeenCalledWith('key-1', 'm')
    expect(mocks.executePublicGeneration).toHaveBeenCalledWith({
      reply,
      key: { id: 'key-1', userId: 'user-1' },
      idempotencyKey: 'anthropic-1',
      request: expect.objectContaining({
        protocol: 'anthropic_messages', model: 'm', maxOutputTokens: 64,
        rawInput: [{ role: 'user', content: 'hi' }], parameters: { instructions: 'Be brief.' },
      }),
    })
    expect(mocks.logInfo).toHaveBeenCalledWith({ protocol: 'anthropic_messages', ignoredParameters: ['top_k'] }, 'Ignored OpenAI-compatible request parameters')
  })

  it('rejects invalid Anthropic Messages requests before queueing', async () => {
    const handler = (await handlers()).get('POST /v1/messages')!
    await expect(handler(request({ body: {
      model: 'm', max_tokens: 64, messages: [{ role: 'tool', content: 'hi' }],
    } }), {} as FastifyReply)).rejects.toMatchObject({ statusCode: 400, param: 'messages.0.role' })
    expect(mocks.executePublicGeneration).not.toHaveBeenCalled()
  })

  it('drops Anthropic server tools and logs them as ignored', async () => {
    const handler = (await handlers()).get('POST /v1/messages')!
    await expect(handler(request({ body: {
      model: 'm', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }, { name: 'lookup', input_schema: { type: 'object' } }],
    } }), {} as FastifyReply)).resolves.toEqual({ ok: true })
    expect(mocks.executePublicGeneration.mock.calls[0]![0].request.parameters.tools).toEqual([
      { type: 'function', name: 'lookup', parameters: { type: 'object' } },
    ])
    expect(mocks.logInfo).toHaveBeenCalledWith({ protocol: 'anthropic_messages', ignoredParameters: ['tools.web_search_20250305'] }, 'Ignored OpenAI-compatible request parameters')
  })

  it('accepts Anthropic-sized request bodies on the Messages routes', async () => {
    routeOptions.clear()
    await handlers()
    expect(routeOptions.get('POST /v1/messages')).toEqual({ bodyLimit: 32 * 1024 * 1024 })
    expect(routeOptions.get('POST /v1/messages/count_tokens')).toEqual({ bodyLimit: 32 * 1024 * 1024 })
    expect(routeOptions.has('POST /v1/responses')).toBe(false)
  })

  it('estimates Anthropic input tokens without requiring max_tokens', async () => {
    mocks.selectRows = [{ id: 'm' }]
    const handler = (await handlers()).get('POST /v1/messages/count_tokens')!
    const result = await handler(request({ body: { model: 'm', messages: [{ role: 'user', content: 'hello there' }] } }), {} as FastifyReply) as { input_tokens: number }
    expect(result.input_tokens).toBeGreaterThan(0)
    expect(mocks.assertApiKeyModelAllowed).toHaveBeenCalledWith('key-1', 'm')
    expect(mocks.executePublicGeneration).not.toHaveBeenCalled()

    mocks.selectRows = []
    await expect(handler(request({ body: { model: 'm', messages: [{ role: 'user', content: 'x' }] } }), {} as FastifyReply))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('lists models in the Anthropic shape when the anthropic-version header is present', async () => {
    const first = { id: 'claude-a', name: 'Claude A', enabled: true, visible: true, createdAt: new Date('2026-01-01T00:00:00.000Z') }
    const second = { id: 'claude-b', name: 'Claude B', enabled: true, visible: true, createdAt: new Date('2026-02-01T00:00:00.000Z') }
    mocks.selectRows = [first, second]
    const routes = await handlers()
    const result = await routes.get('GET /v1/models')!(request({ headers: { 'anthropic-version': '2023-06-01' } }), {} as FastifyReply)
    expect(result).toEqual({
      data: [
        { id: 'claude-a', type: 'model', display_name: 'Claude A', created_at: '2026-01-01T00:00:00.000Z' },
        { id: 'claude-b', type: 'model', display_name: 'Claude B', created_at: '2026-02-01T00:00:00.000Z' },
      ],
      has_more: false, first_id: 'claude-a', last_id: 'claude-b',
    })
    const openai = await routes.get('GET /v1/models')!(request(), {} as FastifyReply) as { object: string; data: Array<{ object: string }> }
    expect(openai.object).toBe('list')
    expect(openai.data[0]!.object).toBe('model')

    mocks.selectRows = [first]
    await expect(routes.get('GET /v1/models/:model')!(request({ params: { model: 'claude-a' }, headers: { 'anthropic-version': '2023-06-01' } }), {} as FastifyReply))
      .resolves.toEqual({ id: 'claude-a', type: 'model', display_name: 'Claude A', created_at: '2026-01-01T00:00:00.000Z' })
  })
})
