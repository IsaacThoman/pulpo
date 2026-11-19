import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

const fake = await vi.hoisted(async () => (await import('./test-redis.js')).createFakeRedis())
const blobs = vi.hoisted(() => new Map<string, Buffer>())
vi.mock('../redis.js', () => ({ redis: fake.redis, createRedis: fake.createRedis }))
vi.mock('../storage/index.js', () => ({
  getBlobStore: () => ({
    async put(key: string, body: Uint8Array) { blobs.set(key, Buffer.from(body)) },
    async putStream(key: string, body: Readable) {
      const chunks: Buffer[] = []
      for await (const chunk of body) chunks.push(Buffer.from(chunk))
      blobs.set(key, Buffer.concat(chunks))
    },
    async get(key: string) { const blob = blobs.get(key); if (!blob) throw new Error('missing'); return new Uint8Array(blob) },
    async getStream(key: string) { const blob = blobs.get(key); if (!blob) throw new Error('missing'); return Readable.from([blob]) },
    async delete(key: string) { blobs.delete(key) },
  }),
}))

const { AppError } = await import('../lib/errors.js')
const { redactComputerTransferToken, registerComputerRoutes } = await import('./routes.js')
const { createComputerDownload, createComputerUpload, ComputerRequestError } = await import('./tunnel.js')
const { COMPUTER_TRANSFER_TTL_MS, sweepComputerTransfers } = await import('./transfers.js')
const { COMPUTER_TRANSFERS_KEY } = await import('../redis-keys.js')

const session = { userId: 'user-1', sessionId: '6f0c2a7e-1d6b-4c43-9a51-0d3c5b7f2a10' }

async function buildApp() {
  const app = Fastify()
  // The real app parses octet-stream bodies globally (attachments); the transfer routes must not depend on it.
  app.addContentTypeParser('application/octet-stream', (_request, body, done) => done(null, body))
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code } })
    return reply.code(500).send({ error: { code: 'internal_error' } })
  })
  await registerComputerRoutes(app)
  return app
}

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = []
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })
const app = async () => { const built = await buildApp(); apps.push(built); return built }
const withToken = (url: string, token: string) => url.replace(/token=[^&]+/, `token=${token}`)

describe('computer uploads', () => {
  it('accepts one body within the limit and serves it back to the server', async () => {
    const server = await app()
    const upload = await createComputerUpload(session, { maxBytes: 10 })
    expect(upload.transfer.url).toMatch(/^\/api\/computer\/transfers\/[0-9a-f-]{36}\?token=[\w-]{43}$/)
    await expect(upload.bytes(10)).rejects.toBeInstanceOf(ComputerRequestError)

    const sent = await server.inject({ method: 'PUT', url: upload.transfer.url, payload: Buffer.from('hello') })
    expect(sent.statusCode).toBe(204)
    expect(Buffer.from(await upload.bytes(10)).toString()).toBe('hello')
    await expect(upload.bytes(4)).rejects.toMatchObject({ code: 'too_large' })
    const opened = await upload.open()
    expect(opened.sizeBytes).toBe(5)
    const chunks: Buffer[] = []
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString()).toBe('hello')

    // Single use.
    expect((await server.inject({ method: 'PUT', url: upload.transfer.url, payload: Buffer.from('again') })).statusCode).toBe(409)
    await upload.dispose()
  })

  it('works without a content type and with any content type', async () => {
    const server = await app()
    const plain = await createComputerUpload(session, { maxBytes: 10 })
    expect((await server.inject({ method: 'PUT', url: plain.transfer.url, payload: Buffer.from('abc') })).statusCode).toBe(204)
    const json = await createComputerUpload(session, { maxBytes: 10 })
    expect((await server.inject({ method: 'PUT', url: json.transfer.url, payload: '{"a":1}', headers: { 'content-type': 'application/json' } })).statusCode).toBe(204)
    expect(Buffer.from(await json.bytes(10)).toString()).toBe('{"a":1}')
    const empty = await createComputerUpload(session, { maxBytes: 10 })
    expect((await server.inject({ method: 'PUT', url: empty.transfer.url, headers: { 'content-length': '0' } })).statusCode).toBe(204)
    expect((await empty.bytes(10)).byteLength).toBe(0)
  })

  it('answers a wrong token, a wrong direction and an unknown id alike', async () => {
    const server = await app()
    const upload = await createComputerUpload(session, { maxBytes: 10 })
    const wrongToken = await server.inject({ method: 'PUT', url: withToken(upload.transfer.url, 'x'.repeat(43)), payload: Buffer.from('a') })
    const wrongDirection = await server.inject({ method: 'GET', url: upload.transfer.url })
    const unknown = await server.inject({ method: 'PUT', url: `/api/computer/transfers/${crypto.randomUUID()}?token=abc`, payload: Buffer.from('a') })
    const malformed = await server.inject({ method: 'PUT', url: '/api/computer/transfers/nope', payload: Buffer.from('a') })
    for (const response of [wrongToken, wrongDirection, unknown, malformed]) {
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: { code: 'transfer_not_found' } })
    }
    // None of those used it up.
    expect((await server.inject({ method: 'PUT', url: upload.transfer.url, payload: Buffer.from('a') })).statusCode).toBe(204)
  })

  it('refuses a body over the limit or without a length, and allows a retry after a failed one', async () => {
    const server = await app()
    const upload = await createComputerUpload(session, { maxBytes: 4 })
    expect((await server.inject({ method: 'PUT', url: upload.transfer.url, payload: Buffer.from('too long') })).statusCode).toBe(413)
    const chunked = await server.inject({
      method: 'PUT', url: upload.transfer.url, payload: Readable.from([Buffer.from('ab')]), headers: { 'transfer-encoding': 'chunked' },
    })
    expect(chunked.statusCode).toBe(411)
    expect((await server.inject({ method: 'PUT', url: upload.transfer.url, payload: Buffer.from('abcd') })).statusCode).toBe(204)
  })

  it('dispose deletes the bytes and retires the URL, more than once', async () => {
    const server = await app()
    const upload = await createComputerUpload(session, { maxBytes: 10 })
    await server.inject({ method: 'PUT', url: upload.transfer.url, payload: Buffer.from('hello') })
    expect(blobs.size).toBeGreaterThan(0)
    await upload.dispose()
    await upload.dispose()
    expect([...blobs.keys()].some((key) => upload.transfer.url.includes(key.split('/')[1]!))).toBe(false)
    expect((await server.inject({ method: 'PUT', url: upload.transfer.url, payload: Buffer.from('a') })).statusCode).toBe(404)
    await expect(upload.bytes(10)).rejects.toMatchObject({ code: 'failed' })
  })
})

describe('computer downloads', () => {
  it('serves the bytes once with their length', async () => {
    const server = await app()
    const download = await createComputerDownload(session, Readable.from([Buffer.from('hel'), Buffer.from('lo')]), 5)
    expect((await server.inject({ method: 'PUT', url: download.transfer.url, payload: Buffer.from('x') })).statusCode).toBe(404)
    const fetched = await server.inject({ method: 'GET', url: download.transfer.url })
    expect(fetched.statusCode).toBe(200)
    expect(fetched.headers['content-length']).toBe('5')
    expect(fetched.body).toBe('hello')
    expect((await server.inject({ method: 'GET', url: download.transfer.url })).statusCode).toBe(409)
    await download.dispose()
    expect((await server.inject({ method: 'GET', url: download.transfer.url })).statusCode).toBe(404)
  })

  it('refuses a body whose size is not the declared one and leaves nothing behind', async () => {
    const before = blobs.size
    await expect(createComputerDownload(session, new Uint8Array(3), 4)).rejects.toThrow()
    await expect(createComputerDownload(session, Readable.from([Buffer.from('abc')]), 4)).rejects.toThrow()
    expect(blobs.size).toBe(before)
  })
})

describe('transfer sweep', () => {
  it('deletes the bytes of transfers that outlived their expiry', async () => {
    for (const member of await fake.redis.zrangebyscore(COMPUTER_TRANSFERS_KEY, '-inf', '+inf')) await fake.redis.zrem(COMPUTER_TRANSFERS_KEY, member)
    blobs.clear()
    const fresh = await createComputerDownload(session, new Uint8Array([1]), 1)
    expect(blobs.size).toBe(1)
    expect(await sweepComputerTransfers(Date.now())).toBe(0)
    expect(await sweepComputerTransfers(Date.now() + COMPUTER_TRANSFER_TTL_MS + 1)).toBe(1)
    expect(blobs.size).toBe(0)
    expect(await fake.redis.zcount(COMPUTER_TRANSFERS_KEY, '-inf', '+inf')).toBe(0)
    await fresh.dispose()
  })
})

describe('transfer URLs in logs', () => {
  it('lose their token', () => {
    expect(redactComputerTransferToken('/api/computer/transfers/abc?token=secret')).toBe('/api/computer/transfers/abc?token=[redacted]')
    expect(redactComputerTransferToken('/api/chats?token=kept')).toBe('/api/chats?token=kept')
  })
})
