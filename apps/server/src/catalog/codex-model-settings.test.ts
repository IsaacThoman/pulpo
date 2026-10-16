import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
}))

vi.mock('../database/client.js', () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => mocks.rows),
        orderBy: vi.fn(async () => mocks.rows),
      })),
    })),
  }))
  const update = vi.fn(() => ({
    set: vi.fn((value: Record<string, unknown>) => {
      mocks.updates.push(value)
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () => mocks.rows.length ? [{ ...mocks.rows[0], ...value }] : []),
        })),
      }
    }),
  }))
  const insert = vi.fn(() => ({ values: vi.fn(async (value: Record<string, unknown>) => { mocks.audits.push(value) }) }))
  const db = {
    select,
    update,
    insert,
    transaction: vi.fn(async (fn: (tx: { update: typeof update; insert: typeof insert }) => Promise<unknown>) => fn({ update, insert })),
  }
  return { db }
})
vi.mock('../auth/service.js', () => ({
  requireAdmin: (request: FastifyRequest) => {
    if (request.user?.role !== 'admin') throw new Error('Administrator access required')
    return request.user
  },
  requireUser: (request: FastifyRequest) => request.user,
}))
vi.mock('../config.js', () => ({ getConfig: () => ({ ENCRYPTION_KEY: 'encryption-key' }) }))
vi.mock('../lib/crypto.js', () => ({ decryptSecret: vi.fn(), encryptSecret: vi.fn() }))
vi.mock('../redis.js', () => ({ redis: {} }))

import { registerCatalogRoutes } from './routes.js'

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>

async function catalogHandlers(): Promise<Map<string, Handler>> {
  const handlers = new Map<string, Handler>()
  const route = (method: string) => (url: string, ...args: unknown[]) => handlers.set(`${method} ${url}`, args.at(-1) as Handler)
  const app = { get: route('GET'), post: route('POST'), put: route('PUT'), patch: route('PATCH'), delete: route('DELETE') } as unknown as FastifyInstance
  await registerCatalogRoutes(app)
  return handlers
}

function request(input: { role?: 'admin' | 'user'; body?: unknown; modelId?: string } = {}): FastifyRequest {
  return {
    user: {
      id: '11111111-1111-4111-8111-111111111111', email: 'admin@example.com', name: 'Admin', username: 'admin',
      avatarUrl: null, profileColor: null, role: input.role ?? 'admin', balanceMicros: 0, storageLimitBytes: 0,
      blocked: false, stateRevision: 0, createdAt: new Date().toISOString(),
    },
    params: { modelId: input.modelId ?? 'codex:gpt-test' },
    body: input.body ?? { compactionThresholdTokens: 80_000, compactionRetainedUserTokens: 12_000 },
  } as unknown as FastifyRequest
}

const model = {
  id: 'codex:gpt-test', name: 'GPT Test', upstreamModelId: 'gpt-test', contextWindow: 128_000, maxOutputTokens: 16_384, minimumOutputReservationTokens: 8_000,
  compactionEnabled: true, compactionThresholdTokens: 90_000, compactionRetainedTurns: 4, compactionRetainedUserTokens: 20_000, sortOrder: 0, createdAt: new Date(),
}

describe('admin Codex model settings', () => {
  beforeEach(() => {
    mocks.rows = [{ ...model }]
    mocks.updates = []
    mocks.audits = []
  })

  it('lists only the restricted settings DTO for administrators', async () => {
    const handler = (await catalogHandlers()).get('GET /api/admin/codex-model-settings')!
    const result = await handler(request(), {} as FastifyReply)
    expect(result).toEqual({ data: [{
      id: 'codex:gpt-test', name: 'GPT Test', upstreamModelId: 'gpt-test', contextWindow: 128_000,
      maxOutputTokens: 16_384, minimumOutputReservationTokens: 8_000, compactionThresholdTokens: 90_000, compactionRetainedUserTokens: 20_000,
      maximumCompactionThresholdTokens: 115_200,
    }] })
    await expect(handler(request({ role: 'user' }), {} as FastifyReply)).rejects.toThrow('Administrator')
  })

  it('reports a threshold saved above the current maximum as the maximum, so the dialog can save', async () => {
    // Allowed under the old window - 4,096 rule, above the 90% maximum of 115,200.
    mocks.rows = [{ ...model, compactionThresholdTokens: 120_000 }]
    const handlers = await catalogHandlers()
    const listed = await handlers.get('GET /api/admin/codex-model-settings')!(request(), {} as FastifyReply) as { data: Array<Record<string, unknown>> }
    expect(listed.data[0]).toMatchObject({ compactionThresholdTokens: 115_200, maximumCompactionThresholdTokens: 115_200 })
    // Saving an unrelated setting with the reported threshold is accepted.
    const patch = handlers.get('PATCH /api/admin/codex-model-settings/:modelId')!
    const saved = await patch(request({ body: { compactionThresholdTokens: 115_200, compactionRetainedUserTokens: 40_000 } }), {} as FastifyReply)
    expect(mocks.updates[0]).toMatchObject({ compactionThresholdTokens: 115_200, compactionRetainedUserTokens: 40_000 })
    expect(saved).toMatchObject({ compactionThresholdTokens: 115_200 })
  })

  it('rejects unknown fields and unsafe thresholds', async () => {
    const handler = (await catalogHandlers()).get('PATCH /api/admin/codex-model-settings/:modelId')!
    await expect(handler(request({ body: { compactionEnabled: false } }), {} as FastifyReply)).rejects.toThrow()
    await expect(handler(request({ body: { compactionRetainedTurns: 4 } }), {} as FastifyReply)).rejects.toThrow()
    await expect(handler(request({ body: { compactionThresholdTokens: 115_201 } }), {} as FastifyReply))
      .rejects.toMatchObject({ statusCode: 400, code: 'validation_error' })
    for (const value of [-1, 1.5, 100_001, null]) {
      await expect(handler(request({ body: { compactionRetainedUserTokens: value } }), {} as FastifyReply)).rejects.toThrow()
    }
    expect(mocks.updates).toHaveLength(0)
  })

  it('updates the minimum allocation independently and validates its bounds', async () => {
    const handler = (await catalogHandlers()).get('PATCH /api/admin/codex-model-settings/:modelId')!
    expect(await handler(request({ body: { minimumOutputReservationTokens: 1_500 } }), {} as FastifyReply))
      .toMatchObject({ minimumOutputReservationTokens: 1_500 })
    for (const value of [0, -1, 1.5, null, '1000', 2_147_483_648]) {
      await expect(handler(request({ body: { minimumOutputReservationTokens: value } }), {} as FastifyReply)).rejects.toThrow()
    }
  })

  it('returns 404 when the requested model is not managed by Codex', async () => {
    mocks.rows = []
    const handler = (await catalogHandlers()).get('PATCH /api/admin/codex-model-settings/:modelId')!
    await expect(handler(request(), {} as FastifyReply)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('updates only compaction policy and records an audit event', async () => {
    const handler = (await catalogHandlers()).get('PATCH /api/admin/codex-model-settings/:modelId')!
    const result = await handler(request(), {} as FastifyReply)
    expect(mocks.updates[0]).toMatchObject({
      compactionEnabled: true, compactionThresholdTokens: 80_000, compactionRetainedUserTokens: 12_000,
    })
    expect(mocks.updates[0]).not.toHaveProperty('compactionRetainedTurns')
    expect(mocks.audits).toContainEqual(expect.objectContaining({
      action: 'codex_model.settings.update', targetType: 'model', targetId: 'codex:gpt-test',
    }))
    expect(result).toMatchObject({ compactionThresholdTokens: 80_000, compactionRetainedUserTokens: 12_000 })
  })
})
