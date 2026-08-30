import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { CHAT_IMPORT_ROUTE_OPTIONS } from './routes.js'

describe('chat import request limit', () => {
  it('allows up to 100 MiB without raising the limit for other routes', async () => {
    expect(CHAT_IMPORT_ROUTE_OPTIONS.bodyLimit).toBe(100 * 1024 * 1024)

    const app = Fastify({ bodyLimit: 1_024 })
    app.post('/import', CHAT_IMPORT_ROUTE_OPTIONS, async () => ({ ok: true }))
    app.post('/other', async () => ({ ok: true }))
    const payload = { data: 'x'.repeat(2_000) }

    expect((await app.inject({ method: 'POST', url: '/import', payload })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/other', payload })).statusCode).toBe(413)
    await app.close()
  })
})
