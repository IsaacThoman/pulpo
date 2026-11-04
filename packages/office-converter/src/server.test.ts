import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createConverterServer, type Convert, type ConverterServer } from './server.js'
import { ConversionError, type ConversionJob } from './soffice.js'

const TOKEN = 'a'.repeat(40)
const DOC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3])

let current: ConverterServer | undefined

async function start(convert: Convert, overrides: Partial<{ maxInputBytes: number; concurrency: number; maxQueued: number; token: string | null }> = {}) {
  current = createConverterServer({ token: TOKEN, maxInputBytes: 1024, concurrency: 1, maxQueued: 1, timeoutMs: 5_000, ...overrides }, convert)
  current.setReady(true)
  await new Promise<void>((resolve) => current!.server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(current.server.address() as AddressInfo).port}`
}

afterEach(async () => {
  await new Promise((resolve) => current?.server.close(resolve) ?? resolve(undefined))
  current = undefined
})

const post = (base: string, query: string, body: Uint8Array, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
  fetch(`${base}/v1/convert?${query}`, { method: 'POST', body: Buffer.from(body), headers })

describe('converter HTTP API', () => {
  it('converts the posted bytes', async () => {
    const jobs: ConversionJob[] = []
    const base = await start(async (job) => { jobs.push(job); return new Uint8Array([9, 8, 7]) })
    const response = await post(base, 'from=DOC&to=docx', DOC)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([9, 8, 7])
    expect(jobs[0]).toMatchObject({ from: 'doc', to: 'docx' })
    expect([...jobs[0]!.input]).toEqual([...DOC])
  })

  it('reports health without a token, and is unhealthy until LibreOffice is ready', async () => {
    const base = await start(async () => new Uint8Array())
    expect((await fetch(`${base}/healthz`)).status).toBe(200)
    current!.setReady(false)
    const starting = await fetch(`${base}/healthz`)
    expect(starting.status).toBe(503)
    expect((await post(base, 'from=doc&to=docx', DOC)).status).toBe(503)
  })

  it('requires the token for everything else', async () => {
    const base = await start(async () => new Uint8Array([1]))
    for (const headers of [{} as Record<string, string>, { authorization: 'Bearer wrong' }, { authorization: `Bearer ${TOKEN}x` }, { authorization: TOKEN }]) {
      const response = await post(base, 'from=doc&to=docx', DOC, headers)
      expect(response.status).toBe(401)
      expect((await response.json()).error.code).toBe('unauthorized')
    }
    expect((await fetch(`${base}/v1/formats`)).status).toBe(401)
    const formats = await fetch(`${base}/v1/formats`, { headers: { authorization: `Bearer ${TOKEN}` } })
    expect((await formats.json()).conversions).toContainEqual({ from: 'key', to: 'pptx' })
  })

  it('refuses unsupported conversions, empty files, and unknown routes', async () => {
    const base = await start(async () => new Uint8Array([1]))
    for (const query of ['from=doc&to=xlsx', 'from=exe&to=pdf', 'from=docx&to=docx', 'to=pdf', 'from=doc&to=odt']) {
      const response = await post(base, query, DOC)
      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('unsupported_conversion')
    }
    expect((await post(base, 'from=doc&to=docx', new Uint8Array())).status).toBe(415)
    expect((await fetch(`${base}/v1/elsewhere`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(404)
    expect((await fetch(`${base}/v1/convert?from=doc&to=docx`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(405)
  })

  it('refuses a body above the size limit, declared or streamed, without converting it', async () => {
    let called = false
    const base = await start(async () => { called = true; return new Uint8Array([1]) }, { maxInputBytes: 16 })
    const declared = await post(base, 'from=doc&to=docx', new Uint8Array(64))
    expect(declared.status).toBe(413)
    expect((await declared.json()).error.code).toBe('input_too_large')
    // A chunked upload has no declared length; it is cut off once it passes the limit.
    const streamed = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const url = new URL(`${base}/v1/convert?from=doc&to=docx`)
      const outgoing = httpRequest(url, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'transfer-encoding': 'chunked' } }, (response) => {
        let body = ''
        response.on('data', (chunk: Buffer) => { body += chunk.toString() })
        response.on('end', () => resolve({ status: response.statusCode!, body }))
      })
      outgoing.on('error', reject)
      outgoing.write(new Uint8Array(10))
      outgoing.write(new Uint8Array(10))
      setTimeout(() => outgoing.end(), 50)
    })
    expect(streamed.status).toBe(413)
    expect(called).toBe(false)
  })

  it('maps conversion failures to their own status codes', async () => {
    const failures: Array<[ConversionError, number]> = [
      [new ConversionError('encrypted', 'locked'), 422],
      [new ConversionError('conversion_failed', 'damaged'), 422],
      [new ConversionError('unexpected_content', 'not a doc'), 415],
      [new ConversionError('timeout', 'slow'), 504],
      [new ConversionError('output_too_large', 'big'), 413],
    ]
    for (const [error, status] of failures) {
      const base = await start(async () => { throw error })
      const response = await post(base, 'from=doc&to=pdf', DOC)
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error: { code: error.code, message: error.message } })
      await new Promise((resolve) => current!.server.close(resolve))
    }
    const base = await start(async () => { throw new Error('secret internal detail') })
    const response = await post(base, 'from=doc&to=pdf', DOC)
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('secret internal detail')
  })

  it('answers busy when every slot and queue place is taken', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const base = await start(async () => { await gate; return new Uint8Array([1]) }, { concurrency: 1, maxQueued: 1 })
    const running = post(base, 'from=doc&to=docx', DOC)
    const queued = post(base, 'from=doc&to=docx', DOC)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(current!.limiter.stats).toEqual({ running: 1, queued: 1 })
    const refused = await post(base, 'from=doc&to=docx', DOC)
    expect(refused.status).toBe(503)
    expect(refused.headers.get('retry-after')).toBe('5')
    expect((await refused.json()).error.code).toBe('busy')
    release()
    expect((await running).status).toBe(200)
    expect((await queued).status).toBe(200)
  })

  it('cancels the job when the client disconnects', async () => {
    let signal: AbortSignal | undefined
    const base = await start((job) => {
      signal = job.signal
      return new Promise((_resolve, reject) => job.signal!.addEventListener('abort', () => reject(new ConversionError('aborted', 'cancelled'))))
    })
    const pending = post(base, 'from=doc&to=docx', DOC).then(() => undefined, () => undefined)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(signal?.aborted).toBe(false)
    // Closing every connection is what a client going away looks like to the server.
    current!.server.closeAllConnections()
    await pending
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(signal?.aborted).toBe(true)
    expect(current!.limiter.stats).toEqual({ running: 0, queued: 0 })
  })

  it('allows requests without a token when none is configured', async () => {
    const base = await start(async () => new Uint8Array([5]), { token: null })
    expect((await post(base, 'from=xls&to=pdf', DOC, {})).status).toBe(200)
  })
})
