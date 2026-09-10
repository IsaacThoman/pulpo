import Fastify, { type FastifyRequest } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock('../database/client.js', () => ({ db: { select: mocks.select } }))
import { registerAdminUsageRoutes } from './usage-routes.js'

const apps: ReturnType<typeof Fastify>[] = []
afterEach(async () => { vi.resetAllMocks(); await Promise.all(apps.splice(0).map((app) => app.close())) })
function queryResult(rows: unknown[]) {
  const query = { from: () => query, where: () => query, limit: async () => rows, orderBy: async () => rows }
  return query
}

describe('request detail OCR retention', () => {
  it.each([
    { captureDetailedPayloads: true, payloadExpiresAt: new Date(0), retained: false },
    { captureDetailedPayloads: false, payloadExpiresAt: null, retained: false },
    { captureDetailedPayloads: true, payloadExpiresAt: null, retained: true },
    { captureDetailedPayloads: true, payloadExpiresAt: new Date('2099-01-01'), retained: true },
  ])('enforces $captureDetailedPayloads / $payloadExpiresAt independently of cleanup', async ({ retained, ...policy }) => {
    const app = Fastify()
    apps.push(app)
    app.addHook('onRequest', async (request) => { request.user = { id: 'admin', role: 'admin' } as FastifyRequest['user'] })
    mocks.select
      .mockReturnValueOnce(queryResult([{ id: 'call', requestLogId: 'log' }]))
      .mockReturnValueOnce(queryResult([{ id: 'log', responseId: 'response', ...policy, requestPayload: { secret: true } }]))
      .mockReturnValueOnce(queryResult([{ id: 'ocr', requestPayload: { image: true }, responsePayload: { text: true }, status: 'completed' }]))
      .mockReturnValueOnce(queryResult([]))
    await registerAdminUsageRoutes(app)
    const response = await app.inject('/api/admin/usage/requests/call')
    expect(response.statusCode).toBe(200)
    expect(response.json().request.requestPayload).toBeUndefined()
    expect(response.json().ocrAttempts).toEqual([{ id: 'ocr', status: 'completed', requestPayload: retained ? { image: true } : null, responsePayload: retained ? { text: true } : null }])
  })
})
