import { gunzipSync } from 'node:zlib'
import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerResponseCompression } from './compression.js'

describe('HTTP response compression', () => {
  const apps: Array<ReturnType<typeof Fastify>> = []
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())))

  it('compresses large JSON responses when the client accepts gzip', async () => {
    const app = Fastify()
    apps.push(app)
    await registerResponseCompression(app)
    app.get('/large', async () => ({ data: 'chat payload '.repeat(2_000) }))

    const response = await app.inject({ method: 'GET', url: '/large', headers: { 'accept-encoding': 'gzip' } })

    expect(response.headers['content-encoding']).toBe('gzip')
    expect(JSON.parse(gunzipSync(response.rawPayload).toString())).toMatchObject({ data: expect.any(String) })
  })
})
