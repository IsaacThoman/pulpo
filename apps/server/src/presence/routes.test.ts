import type { FastifyInstance, FastifyRequest } from 'fastify'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  rows: [{ count: 0 }] as Array<{ count: number | string }>,
  selection: null as Record<string, unknown> | null,
  predicate: null as unknown,
}))

vi.mock('../auth/service.js', () => ({ requireUser: mocks.requireUser }))
vi.mock('../database/client.js', () => ({
  db: {
    select: vi.fn((selection: Record<string, unknown>) => {
      mocks.selection = selection
      return {
        from: vi.fn(() => ({
          where: vi.fn((predicate: unknown) => {
            mocks.predicate = predicate
            return Promise.resolve(mocks.rows)
          }),
        })),
      }
    }),
  },
}))

import { registerPresenceRoutes } from './routes.js'

type Handler = (request: FastifyRequest) => Promise<unknown>

async function onlineCountHandler(): Promise<Handler> {
  let handler: Handler | undefined
  const app = {
    get: (path: string, value: Handler) => {
      if (path === '/api/auth/online-count') handler = value
    },
  } as unknown as FastifyInstance
  await registerPresenceRoutes(app)
  return handler!
}

describe('online user count', () => {
  beforeEach(() => {
    mocks.requireUser.mockReset().mockReturnValue({ id: 'viewer' })
    mocks.rows = [{ count: 0 }]
    mocks.selection = null
    mocks.predicate = null
  })

  it('requires an authenticated approved user', async () => {
    const error = Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    mocks.requireUser.mockImplementationOnce(() => { throw error })
    const handler = await onlineCountHandler()

    await expect(handler({} as FastifyRequest)).rejects.toBe(error)
    expect(mocks.selection).toBeNull()
  })

  it('returns a numeric count of distinct recently active users', async () => {
    mocks.rows = [{ count: '4' }]
    const handler = await onlineCountHandler()

    await expect(handler({} as FastifyRequest)).resolves.toEqual({ count: 4 })

    const dialect = new PgDialect()
    const countQuery = dialect.sqlToQuery(mocks.selection!.count as Parameters<typeof dialect.sqlToQuery>[0]).sql
    const predicateQuery = dialect.sqlToQuery(mocks.predicate as Parameters<typeof dialect.sqlToQuery>[0]).sql
    expect(countQuery).toContain('count(distinct "sessions"."user_id")::int')
    expect(predicateQuery).toContain('"sessions"."last_seen_at" >= now() - interval \'30 minutes\'')
  })

  it('falls back to zero when the aggregate returns no row', async () => {
    mocks.rows = []
    const handler = await onlineCountHandler()

    await expect(handler({} as FastifyRequest)).resolves.toEqual({ count: 0 })
  })
})
