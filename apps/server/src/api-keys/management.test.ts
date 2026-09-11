import type { FastifyInstance, FastifyRequest } from 'fastify'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[][],
  conditions: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  insert: vi.fn(),
  returning: vi.fn(),
  requireUser: vi.fn(),
}))
vi.mock('../database/client.js', () => ({
  db: {
    async transaction(run: (tx: unknown) => Promise<unknown>) { return run(this) },
    select: () => ({
      from: () => {
        const rows = mocks.rows.shift() ?? []
        const result = Object.assign(Promise.resolve(rows), {
          limit: async () => rows,
          orderBy: async () => rows,
          for: async () => rows,
        })
        return Object.assign(result, { where: (condition: unknown) => { mocks.conditions(condition); return result }, innerJoin() { return this } })
      },
    }),
    delete: () => ({ where: mocks.delete }),
    insert: () => ({ values: mocks.insert }),
    update: () => ({ set: (values: unknown) => {
      mocks.update(values)
      return { where: (condition: unknown) => {
        mocks.conditions(condition)
        return { returning: mocks.returning }
      } }
    } }),
  },
}))
vi.mock('../auth/service.js', () => ({ requireUser: mocks.requireUser, serializeUser: vi.fn() }))
vi.mock('../redis.js', () => ({ createRedis: () => ({ quit: vi.fn() }) }))

import { registerApiKeyRoutes } from './routes.js'
import { CODEX_PROVIDER_ID } from '../codex/constants.js'

type Handler = (request: FastifyRequest) => Promise<unknown>
async function handler(method: string, path: string): Promise<Handler> {
  const registered = new Map<string, Handler>()
  const route = (method: string) => (path: string, fn: Handler) => registered.set(`${method} ${path}`, fn)
  await registerApiKeyRoutes({ get: route('GET'), post: route('POST'), patch: route('PATCH'), delete: route('DELETE'), addHook: vi.fn() } as unknown as FastifyInstance)
  return registered.get(`${method} ${path}`)!
}
function request(body?: unknown) {
  return { params: { id: 'key-1' }, body } as FastifyRequest
}
function condition(index: number) {
  return new PgDialect().sqlToQuery(mocks.conditions.mock.calls[index]![0])
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.rows = []
  mocks.requireUser.mockReturnValue({ id: 'owner-1' })
  mocks.returning.mockResolvedValue([{ id: 'key-1' }])
})

describe('API key updates', () => {
  it('updates scopes and limits together with a deduplicated replacement permission set', async () => {
    const input = { name: 'Work', scopes: ['responses'], allowedModels: ['model-2', 'model-2'], monthlyBudgetMicros: 12_340_000, lifetimeBudgetMicros: null }
    expect(await (await handler('PATCH', '/api/api-keys/:id'))(request(input))).toEqual({ id: 'key-1', ...input })
    expect(mocks.update).toHaveBeenCalledWith({ name: 'Work', scopes: ['responses'], monthlyBudgetMicros: 12_340_000, lifetimeBudgetMicros: null })
    expect(condition(0).params).toEqual(['key-1', 'owner-1'])
    expect(mocks.delete).toHaveBeenCalledTimes(1)
    expect(new PgDialect().sqlToQuery(mocks.delete.mock.calls[0]![0]).params).toEqual(['key-1'])
    expect(mocks.insert).toHaveBeenCalledWith([{ apiKeyId: 'key-1', modelId: 'model-2' }])
  })

  it('locks an owned key for model-only edits and clears permissions to restore all-model access', async () => {
    mocks.rows = [[{ id: 'key-1' }]]
    await (await handler('PATCH', '/api/api-keys/:id'))(request({ allowedModels: [] }))
    expect(condition(0).params).toEqual(['key-1', 'owner-1'])
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.delete).toHaveBeenCalledTimes(1)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('keeps model restrictions unchanged when only a spending limit is supplied', async () => {
    await (await handler('PATCH', '/api/api-keys/:id'))(request({ monthlyBudgetMicros: null }))
    expect(mocks.update).toHaveBeenCalledWith({ monthlyBudgetMicros: null })
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('rejects invalid settings and Codex assignments before any writes', async () => {
    const patch = await handler('PATCH', '/api/api-keys/:id')
    for (const input of [{ scopes: [] }, { scopes: ['admin'] }, { monthlyBudgetMicros: 0 }, { lifetimeBudgetMicros: -1 }]) {
      await expect(patch(request(input))).rejects.toThrow()
    }
    await expect(patch(request({ allowedModels: ['codex:test'] }))).rejects.toMatchObject({ statusCode: 400, code: 'codex_ui_only' })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('never changes permissions for unowned keys or after a failed key update', async () => {
    const patch = await handler('PATCH', '/api/api-keys/:id')
    mocks.rows = [[]]
    await expect(patch(request({ allowedModels: [] }))).rejects.toMatchObject({ statusCode: 404 })
    mocks.returning.mockRejectedValueOnce(new Error('Write failed'))
    await expect(patch(request({ name: 'Work', allowedModels: ['model-2'] }))).rejects.toThrow('Write failed')
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('renames only the owned key without changing status, secret or permissions', async () => {
    const result = await (await handler('PATCH', '/api/api-keys/:id'))(request({ name: '  Work scripts  ' }))
    expect(result).toEqual({ id: 'key-1', name: 'Work scripts' })
    expect(mocks.update).toHaveBeenCalledWith({ name: 'Work scripts' })
    expect(condition(0).params).toEqual(['key-1', 'owner-1'])
    expect(condition(0).sql).toContain('"api_keys"."user_id"')
  })

  it.each([true, false])('preserves the existing enabled update for %s', async (enabled) => {
    await (await handler('PATCH', '/api/api-keys/:id'))(request({ enabled }))
    expect(mocks.update).toHaveBeenCalledWith({ status: enabled ? 'active' : 'disabled', disabledAt: enabled ? null : expect.any(Date) })
  })

  it('rejects empty updates before writing and returns 404 for missing or unowned keys', async () => {
    const patch = await handler('PATCH', '/api/api-keys/:id')
    await expect(patch(request({ name: ' ' }))).rejects.toThrow()
    expect(mocks.update).not.toHaveBeenCalled()
    mocks.returning.mockResolvedValue([])
    await expect(patch(request({ name: 'Work' }))).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('API key model access listings', () => {
  it('returns names and API IDs from the public catalog for unrestricted keys', async () => {
    const models = [{ id: 'model-api-id', name: 'Friendly model' }]
    mocks.rows = [[{ id: 'key-1' }], models, []]
    expect(await (await handler('GET', '/api/api-keys/:id/models'))(request())).toEqual({ data: models })
    expect(condition(0).params).toEqual(['key-1', 'owner-1'])
    expect(condition(1).params).toEqual([true, true, CODEX_PROVIDER_ID])
    expect(condition(1).sql).toContain('"models"."enabled"')
    expect(condition(1).sql).toContain('"models"."visible"')
    expect(condition(1).sql).toContain('"models"."provider_connection_id" <>')
  })

  it('includes permitted models and reachable fallback and preset models, but excludes unrelated models', async () => {
    const rows = ['root', 'fallback', 'preset', 'denied'].map((id) => ({ id, name: `Friendly ${id}` }))
    mocks.rows = [
      [{ id: 'key-1' }], rows, [{ modelId: 'root' }],
      rows.map(({ id }) => ({ id, enabled: true, visible: true, fallbackModelId: id === 'root' ? 'fallback' : null })),
      [{ modelId: 'root', action: { modelId: 'preset' } }],
    ]
    expect(await (await handler('GET', '/api/api-keys/:id/models'))(request())).toEqual({ data: rows.slice(0, 3) })
  })

  it('returns an empty list when a restricted key has no available models', async () => {
    mocks.rows = [[{ id: 'key-1' }], [{ id: 'denied', name: 'Other model' }], [{ modelId: 'removed' }], [], []]
    expect(await (await handler('GET', '/api/api-keys/:id/models'))(request())).toEqual({ data: [] })
  })

  it('does not read model permissions for missing or unowned keys', async () => {
    mocks.rows = [[]]
    await expect((await handler('GET', '/api/api-keys/:id/models'))(request())).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.conditions).toHaveBeenCalledTimes(1)
  })
})
