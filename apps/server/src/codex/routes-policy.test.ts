import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

const state = vi.hoisted(() => ({
  settings: [] as Array<{ key: string; value: unknown }>,
  writes: [] as Array<{ table: string; value: Record<string, unknown> }>,
  queued: vi.fn(),
  cancelled: vi.fn(),
  credentialDeleted: vi.fn(),
  catalogWhere: undefined as unknown,
}))
vi.mock('../database/client.js', () => {
  const db = {
    select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => {
      const name = getTableName(table)
      let settingKey: string | undefined
      const rows = () => name === 'application_settings' ? state.settings.filter((row) => !settingKey || row.key === settingKey)
        : name === 'user_provider_credentials' ? [{ status: 'connected' }] : []
      const query = {
        where: (condition: Parameters<PgDialect['sqlToQuery']>[0]) => {
          if (name === 'application_settings') {
            const params = new PgDialect().sqlToQuery(condition).params
            if (params.length === 1) settingKey = String(params[0])
          }
          if (name === 'models') state.catalogWhere = condition
          return query
        },
        innerJoin: () => query, leftJoin: () => query,
        limit: async () => rows(), orderBy: async () => rows(),
        then: <T>(resolve: (value: unknown[]) => T) => Promise.resolve(rows()).then(resolve),
      }
      return query
    } }),
    execute: vi.fn(),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
    insert: (table: Parameters<typeof getTableName>[0]) => ({ values: (value: Record<string, unknown>) => {
      const write = () => {
        const name = getTableName(table)
        state.writes.push({ table: name, value })
        if (name === 'application_settings') state.settings = [{ key: String(value.key), value: value.value }]
      }
      return { onConflictDoUpdate: async () => write(), then: (resolve: () => void) => { write(); resolve() } }
    } }),
    update: (table: Parameters<typeof getTableName>[0]) => ({ set: (value: Record<string, unknown>) => ({
      where: () => {
        state.writes.push({ table: getTableName(table), value })
        return { returning: async () => [{ id: '00000000-0000-7000-8000-000000000001' }], then: (resolve: () => void) => resolve() }
      },
    }) }),
  }
  return { db }
})
vi.mock('../jobs.js', () => ({ codexLoginQueue: { add: state.queued }, maintenanceQueue: { add: vi.fn() }, generationQueue: {} }))
vi.mock('../redis.js', () => ({ redis: {} }))
vi.mock('../responses/events.js', () => ({ requestCancellation: state.cancelled, publishStateChange: vi.fn() }))
vi.mock('./credential-store.js', () => ({ UserCredentialStore: class { delete = state.credentialDeleted } }))

import { registerAdminSettingsRoutes } from '../admin/settings-routes.js'
import { registerAuthRoutes } from '../auth/routes.js'
import { registerCodexRoutes } from './routes.js'
import { registerCatalogRoutes } from '../catalog/routes.js'
import { CODEX_PROVIDER_ID } from './constants.js'

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
const handlers = new Map<string, Handler>()
const route = (method: string) => (url: string, ...args: unknown[]) => handlers.set(`${method} ${url}`, args.at(-1) as Handler)
const app = { get: route('GET'), post: route('POST'), patch: route('PATCH'), delete: route('DELETE'), put: route('PUT') } as unknown as FastifyInstance
await registerAdminSettingsRoutes(app)
await registerAuthRoutes(app)
await registerCodexRoutes(app)
await registerCatalogRoutes(app)
const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() } as unknown as FastifyReply
const request = (body?: unknown, role = 'admin') => ({
  user: { id: '00000000-0000-7000-8000-000000000001', role }, body,
  params: { attemptId: '00000000-0000-7000-8000-000000000001' },
}) as unknown as FastifyRequest
const call = (route: string, body?: unknown, role?: string) => handlers.get(route)!(request(body, role), reply)

describe('Codex instance settings endpoints', () => {
  beforeEach(() => { state.settings = []; state.writes = []; state.catalogWhere = undefined; vi.clearAllMocks() })

  it('exposes default-off and saved policy in public settings', async () => {
    expect(await call('GET /api/auth/settings')).toMatchObject({ codexEnabled: false })
    state.settings = [{ key: 'codex', value: { enabled: true } }]
    expect(await call('GET /api/auth/settings')).toMatchObject({ codexEnabled: true })
  })

  it('requires admin access and validates values before writing', async () => {
    await expect(call('PATCH /api/admin/settings', { codex: { enabled: true } }, 'user')).rejects.toMatchObject({ statusCode: 403 })
    await expect(call('PATCH /api/admin/settings', { codex: { enabled: 'true' } })).rejects.toThrow()
    expect(state.writes).toEqual([])
  })

  it('persists the toggle, audits it, and cancels pending logins without deleting credentials', async () => {
    await call('PATCH /api/admin/settings', { codex: { enabled: false } })
    expect(await call('GET /api/admin/settings')).toEqual({ values: { codex: { enabled: false } } })
    expect(state.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'codex_login_attempts', value: expect.objectContaining({ status: 'cancelled' }) }),
      expect.objectContaining({ table: 'audit_events', value: expect.objectContaining({ action: 'settings.update', metadata: { keys: ['codex'] } }) }),
    ]))
    expect(state.credentialDeleted).not.toHaveBeenCalled()
    expect(state.cancelled).not.toHaveBeenCalled()
    await call('PATCH /api/admin/settings', { codex: { enabled: true } })
    expect(await call('GET /api/auth/settings')).toMatchObject({ codexEnabled: true })
  })

  it.each(['admin', 'user'])('blocks disabled sign-in for %s accounts and allows it after enablement', async (role) => {
    await expect(call('POST /api/account/providers/codex/login', undefined, role)).rejects.toMatchObject({ statusCode: 403, code: 'codex_disabled' })
    expect(state.queued).not.toHaveBeenCalled()
    state.settings = [{ key: 'codex', value: { enabled: true } }]
    await call('POST /api/account/providers/codex/login', undefined, role)
    expect(state.queued).toHaveBeenCalledOnce()
  })

  it('allows disconnecting while disabled', async () => {
    await call('DELETE /api/account/providers/codex')
    expect(state.credentialDeleted).toHaveBeenCalledOnce()
  })

  it('allows login cancellation while disabled', async () => {
    await call('DELETE /api/account/providers/codex/login/:attemptId')
    expect(state.writes).toContainEqual(expect.objectContaining({ table: 'codex_login_attempts', value: expect.objectContaining({ status: 'cancelled' }) }))
  })

  it('excludes Codex from the catalog even with a connected credential, then restores it when enabled', async () => {
    expect(await call('GET /api/models')).toMatchObject({ codexEnabled: false })
    const disabled = new PgDialect().sqlToQuery(state.catalogWhere as Parameters<PgDialect['sqlToQuery']>[0])
    expect(disabled.sql).toContain('<>')
    expect(disabled.params).toContain(CODEX_PROVIDER_ID)
    state.settings = [{ key: 'codex', value: { enabled: true } }]
    expect(await call('GET /api/models')).toMatchObject({ codexEnabled: true })
    const enabled = new PgDialect().sqlToQuery(state.catalogWhere as Parameters<PgDialect['sqlToQuery']>[0])
    expect(enabled.params).not.toContain(CODEX_PROVIDER_ID)
  })
})
