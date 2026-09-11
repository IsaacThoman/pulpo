import Fastify, { type FastifyRequest } from 'fastify'
import { drizzle } from 'drizzle-orm/postgres-js'
import { afterEach, expect, it, vi } from 'vitest'
import { requestLogs } from '../database/schema.js'

const mocks = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock('../database/client.js', () => ({ db: { select: mocks.select } }))
import { registerAdminUsageRoutes } from './usage-routes.js'

afterEach(() => vi.resetAllMocks())

it('does not fetch captured bodies for each model turn in the usage list', async () => {
  const query = {
    from: () => query, innerJoin: () => query, leftJoin: () => query,
    where: () => query, orderBy: () => query, limit: async () => [],
  }
  mocks.select.mockReturnValue(query)
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    request.user = { id: 'admin', role: 'admin' } as FastifyRequest['user']
  })
  try {
    await registerAdminUsageRoutes(app)
    const response = await app.inject('/api/admin/usage/requests?limit=100')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ data: [], nextCursor: null })

    // Check the SQL projection, not just the response: dropping bodies after
    // fetching still parses gigabytes of repeated payloads in the DB driver.
    const selection = mocks.select.mock.calls[0]![0]
    const sql = drizzle.mock().select({ log: selection.log }).from(requestLogs).toSQL().sql
    expect(sql).not.toContain('request_payload')
    expect(sql).not.toContain('response_payload')
    expect(selection.log).toEqual({
      id: requestLogs.id, responseId: requestLogs.responseId,
      stickyFallbackUsed: requestLogs.stickyFallbackUsed, ocrStatus: requestLogs.ocrStatus,
    })
  } finally {
    await app.close()
  }
})
