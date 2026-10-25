import { afterEach, describe, expect, it, vi } from 'vitest'

// Boot the real routes, limiter, and error handler without external services.
vi.mock('./catalog/defaults.js', () => ({ ensureBuiltinCatalog: vi.fn() }))
vi.mock('./bootstrap/ci-preview.js', () => ({ ensureBootstrapPreset: vi.fn() }))
vi.mock('./redis.js', () => ({ redis: {}, createRedis: () => ({ quit: vi.fn() }) }))
vi.mock('./jobs.js', () => ({
  generationQueue: {}, codexLoginQueue: {}, maintenanceQueue: {}, embeddingQueue: {},
  payloadRetentionQueue: {}, analyticsQueue: {}, fileDocQueue: {}, fileRecordingQueue: {},
}))

import { buildApp } from './app.js'
import { getConfig } from './config.js'

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = []
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

describe('HTTP rate limits', () => {
  it('returns a structured 429 and retry headers when the global IP bucket is exhausted', async () => {
    const app = await buildApp()
    apps.push(app)
    for (let index = 0; index < 300; index++) {
      expect((await app.inject('/health')).statusCode).toBe(200)
    }

    const response = await app.inject('/health')
    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({ error: { code: 'rate_limit_exceeded', type: 'rate_limit_error', param: null } })
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0)
    expect(response.headers['x-ratelimit-remaining']).toBe('0')
    expect((await app.inject({ url: '/health', remoteAddress: '127.0.0.2' })).statusCode).toBe(200)
  })

  it('inherits the error builder for route limits and exposes Retry-After to allowed origins', async () => {
    const app = await buildApp()
    apps.push(app)
    app.get('/limited', { config: { rateLimit: { max: 1, timeWindow: '1 minute' } } }, async () => ({ ok: true }))
    const request = { url: '/limited', headers: { origin: new URL(getConfig().PUBLIC_URL).origin } }
    expect((await app.inject(request)).statusCode).toBe(200)

    const response = await app.inject(request)
    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({ error: { code: 'rate_limit_exceeded' } })
    expect(response.headers['access-control-expose-headers']).toContain('retry-after')
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('preserves the Anthropic error envelope when the global bucket is exhausted', async () => {
    const app = await buildApp()
    apps.push(app)
    for (let index = 0; index < 300; index++) await app.inject('/health')

    const response = await app.inject({ method: 'POST', url: '/v1/messages', payload: {} })
    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({ type: 'error', error: { type: 'rate_limit_error' } })
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0)
  })
})

describe('malformed JSON bodies', () => {
  it('are rejected with 400 in the envelope the endpoint uses', async () => {
    const app = await buildApp()
    apps.push(app)
    const body = { payload: '{"model":', headers: { 'content-type': 'application/json' } }
    const anthropic = await app.inject({ method: 'POST', url: '/v1/messages', ...body })
    expect(anthropic.statusCode).toBe(400)
    expect(anthropic.json()).toEqual({ type: 'error', error: { type: 'invalid_request_error', message: 'Request body is not valid JSON' } })
    const openai = await app.inject({ method: 'POST', url: '/v1/chat/completions', ...body })
    expect(openai.statusCode).toBe(400)
    expect(openai.json()).toMatchObject({ error: { type: 'invalid_request_error', code: 'invalid_json' } })
  })
})
