import { afterEach, describe, expect, it, vi } from 'vitest'

// Boot the real app without external services, as app.rate-limit.test.ts does.
vi.mock('./catalog/defaults.js', () => ({ ensureBuiltinCatalog: vi.fn() }))
vi.mock('./bootstrap/ci-preview.js', () => ({ ensureBootstrapPreset: vi.fn() }))
vi.mock('./database/client.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })),
    })),
  },
}))
vi.mock('./redis.js', () => ({ redis: {}, createRedis: () => ({ quit: vi.fn() }) }))
vi.mock('./jobs.js', () => ({
  generationQueue: {}, codexLoginQueue: {}, maintenanceQueue: {}, embeddingQueue: {},
  payloadRetentionQueue: {}, analyticsQueue: {}, fileDocQueue: {},
}))

import { buildApp } from './app.js'

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = []
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

describe('cross-origin requests', () => {
  const preflight = (app: Awaited<ReturnType<typeof buildApp>>, origin: string, method: string) => app.inject({
    method: 'OPTIONS', url: '/api/admin/settings',
    headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': 'authorization,content-type' },
  })

  it('lets the desktop app save, rename and delete, not only read and create', async () => {
    const app = await buildApp()
    apps.push(app)
    for (const method of ['PATCH', 'PUT', 'DELETE', 'POST', 'GET']) {
      const response = await preflight(app, 'https://desktop.pulpo.invalid', method)
      expect(response.statusCode).toBe(204)
      expect(response.headers['access-control-allow-origin']).toBe('https://desktop.pulpo.invalid')
      expect(String(response.headers['access-control-allow-methods']).split(/,\s*/)).toContain(method)
    }
  })

  it('still answers no other origin', async () => {
    const app = await buildApp()
    apps.push(app)
    const response = await preflight(app, 'https://elsewhere.example', 'PATCH')
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })
})
