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
    body: input.body ?? { compactionThresholdTokens: 80_000, compactionRetainedTurns: 6 },
  } as unknown as FastifyRequest
}

const model = {
  id: 'codex:gpt-test', name: 'GPT Test', upstreamModelId: 'gpt-test', contextWindow: 128_000, maxOutputTokens: 16_384,
  compactionEnabled: true, compactionThresholdTokens: 90_000, compactionRetainedTurns: 4, sortOrder: 0, createdAt: new Date(),
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
      maxOutputTokens: 16_384, compactionThresholdTokens: 90_000, compactionRetainedTurns: 4,
      maximumCompactionThresholdTokens: 123_904,
    }] })
    await expect(handler(request({ role: 'user' }), {} as FastifyReply)).rejects.toThrow('Administrator')
  })

  it('rejects unknown fields and unsafe thresholds', async () => {
    const handler = (await catalogHandlers()).get('PATCH /api/admin/codex-model-settings/:modelId')!
    await expect(handler(request({ body: { compactionEnabled: false } }), {} as FastifyReply)).rejects.toThrow()
    await expect(handler(request({ body: { compactionThresholdTokens: 123_905 } }), {} as FastifyReply))
      .rejects.toMatchObject({ statusCode: 400, code: 'validation_error' })
    expect(mocks.updates).toHaveLength(0)
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
      compactionEnabled: true, compactionThresholdTokens: 80_000, compactionRetainedTurns: 6,
    })
    expect(mocks.audits).toContainEqual(expect.objectContaining({
      action: 'codex_model.compaction.update', targetType: 'model', targetId: 'codex:gpt-test',
    }))
    expect(result).toMatchObject({ compactionThresholdTokens: 80_000, compactionRetainedTurns: 6 })
  })
})
