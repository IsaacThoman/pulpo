import Fastify, { type FastifyRequest } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn() }))
vi.mock('../database/client.js', () => ({ db: { ...mocks, transaction: async (fn: (tx: unknown) => unknown) => fn(mocks) } }))
import { registerDiagnosticRoutes } from './diagnostic-routes.js'
const apps: ReturnType<typeof Fastify>[] = []
afterEach(async () => { vi.resetAllMocks(); await Promise.all(apps.splice(0).map(app => app.close())) })
function appFor(role?: string) {
  const app = Fastify(); apps.push(app)
  if (role) app.addHook('onRequest', async request => { request.user = { id: 'admin', role } as FastifyRequest['user'] })
  registerDiagnosticRoutes(app)
  return app
}
const id = '00000000-0000-4000-8000-000000000001'
describe('diagnostic inspection', () => {
  it.each([undefined, 'user'])('requires administrator access for %s', async role => {
    const app = appFor(role)
    for (const path of ['/diagnostics', '/diagnostics/retention', `/diagnostics/${id}/payloads`, `/requests/${id}/diagnostics`]) {
      expect((await app.inject('/api/admin/usage' + path)).statusCode).toBe(role ? 403 : 401)
    }
    expect(mocks.select).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled()
  })
  it.each([
    { captureDetailedPayloads: true, payloadExpiresAt: new Date(0), retained: false },
    { captureDetailedPayloads: false, payloadExpiresAt: null, retained: false },
    { captureDetailedPayloads: true, payloadExpiresAt: null, retained: true },
  ])('gates bodies before cleanup for $captureDetailedPayloads / $payloadExpiresAt', async ({ retained, ...policy }) => {
    const row = { id, ...policy, requestPayload: { body: 'private request' }, responsePayload: { body: 'private result' } }
    const query = { from: () => query, where: () => query, for: () => query, limit: async () => [row] }
    mocks.select.mockReturnValue(query)
    const response = await appFor('admin').inject(`/api/admin/usage/diagnostics/${id}/payloads`)
    expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({ available: retained, requestPayload: retained ? row.requestPayload : null, responsePayload: retained ? row.responsePayload : null })
  })
  it.each([
    { state: { lastSuccessAt: new Date().toISOString() }, overdue: '0', oldest: null, alert: null },
    { state: { consecutiveFailures: 3 }, overdue: '0', oldest: null, alert: 'failed repeatedly' },
    { state: { lastSuccessAt: new Date(0).toISOString() }, overdue: '0', oldest: null, alert: 'five minutes' },
    { state: { lastSuccessAt: new Date().toISOString(), lastOverdueRecords: 1 }, overdue: '2', oldest: new Date(0).toISOString(), alert: 'backlog is growing' },
  ])('reports cleanup health $alert', async ({ alert, ...row }) => {
    mocks.execute.mockResolvedValue([row])
    const response = await appFor('admin').inject('/api/admin/usage/diagnostics/retention')
    expect(response.statusCode).toBe(200)
    if (alert) expect(response.json().alert).toContain(alert)
    else expect(response.json().alert).toBeNull()
  })
})
