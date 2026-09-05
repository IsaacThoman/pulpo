import { createHash } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { B2BackupStore } from './b2-backup-store.js'

describe('Backblaze Object Lock upload requests', () => {
  let server: Server
  let store: B2BackupStore
  let uploads: Array<{ headers: IncomingHttpHeaders; body: Buffer }>

  beforeEach(async () => {
    uploads = []
    server = createServer(async (request, response) => {
      const url = new URL(request.url!, 'http://localhost')
      if (!request.headers.authorization) {
        response.writeHead(403).end()
        return
      }
      if (request.method === 'PUT') {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const body = Buffer.concat(chunks)
        uploads.push({ headers: request.headers, body })
        if (request.headers['content-md5'] !== createHash('md5').update(body).digest('base64')) {
          response.writeHead(400, { 'content-type': 'application/xml' }).end('<Error><Code>InvalidRequest</Code><Message>Object Lock requires a valid checksum</Message></Error>')
          return
        }
        response.writeHead(200).end()
      } else if (request.method === 'DELETE') {
        response.writeHead(204).end()
      } else if (request.method === 'HEAD') {
        response.writeHead(200, { 'content-length': '0' }).end()
      } else if (url.searchParams.has('object-lock')) {
        response.writeHead(200, { 'content-type': 'application/xml' }).end('<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>')
      } else if (url.searchParams.has('retention')) {
        response.writeHead(200, { 'content-type': 'application/xml' }).end('<Retention><Mode>COMPLIANCE</Mode></Retention>')
      } else if (url.searchParams.has('list-type')) {
        response.writeHead(200, { 'content-type': 'application/xml' }).end('<ListBucketResult><KeyCount>0</KeyCount></ListBucketResult>')
      } else {
        response.writeHead(200).end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    store = new B2BackupStore({
      enabled: false, endpoint: `http://127.0.0.1:${address.port}`, region: 'us-east-005',
      bucket: 'test-backups', prefix: 'pulpo', keyId: 'test-key', applicationKey: 'test-secret',
      encryptedApplicationKey: null, recipient: '', intervalHours: 6, retentionDays: 30, nextRunAt: null,
    })
  })

  afterEach(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  it('sends a valid checksum header for the empty connection probe', async () => {
    await store.testConnection()
    expect(uploads).toHaveLength(1)
    expect(uploads[0]!.body.length).toBe(0)
    expect(uploads[0]!.headers['x-amz-object-lock-mode']).toBe('COMPLIANCE')
  })

  it('uploads streamed ciphertext with a precomputed checksum and no chunked checksum trailer', async () => {
    const chunks = [Buffer.alloc(100_000, 17), Buffer.from('encrypted final chunk')]
    const ciphertext = Buffer.concat(chunks)
    await store.putEncrypted('pulpo/backup.age', Readable.from(chunks), ciphertext.length, 'job-1', 'fingerprint', new Date(Date.now() + 30_000))
    expect(uploads).toHaveLength(1)
    expect(uploads[0]!.body).toEqual(ciphertext)
    expect(uploads[0]!.headers['content-length']).toBe(String(ciphertext.length))
    expect(uploads[0]!.headers['x-amz-object-lock-mode']).toBe('COMPLIANCE')
    expect(uploads[0]!.headers['x-amz-trailer']).toBeUndefined()
    expect(uploads[0]!.headers['content-encoding']).toBeUndefined()
  })

  it('propagates ciphertext stream failures before sending an upload', async () => {
    const body = Readable.from((async function* () {
      yield Buffer.from('partial ciphertext')
      throw new Error('encryption failed')
    })())
    await expect(store.putEncrypted('pulpo/failed.age', body, 18, 'job-1', 'fingerprint', new Date())).rejects.toThrow('encryption failed')
    expect(uploads).toHaveLength(0)
  })
})
