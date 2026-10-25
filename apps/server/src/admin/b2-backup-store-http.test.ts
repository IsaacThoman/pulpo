import { createHash } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { B2BackupStore } from './b2-backup-store.js'

describe('Backblaze Object Lock upload requests', () => {
  let server: Server
  let store: B2BackupStore
  let uploads: Array<{ url: URL; headers: IncomingHttpHeaders; body: Buffer }>
  let multipartRequests: Array<{ url: URL; method: string; headers: IncomingHttpHeaders; body: string }>
  let failNextPart: boolean
  let retentionMode: string
  let deletedVersions: string[]

  beforeEach(async () => {
    retentionMode = 'COMPLIANCE'
    deletedVersions = []
    uploads = []
    multipartRequests = []
    failNextPart = false
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
        if (url.searchParams.has('partNumber') && failNextPart) {
          failNextPart = false
          response.writeHead(400, { 'content-type': 'application/xml' }).end('<Error><Code>InvalidRequest</Code><Message>Temporary part failure</Message></Error>')
          return
        }
        uploads.push({ url, headers: request.headers, body })
        if (request.headers['content-md5'] !== createHash('md5').update(body).digest('base64')) {
          response.writeHead(400, { 'content-type': 'application/xml' }).end('<Error><Code>InvalidRequest</Code><Message>Object Lock requires a valid checksum</Message></Error>')
          return
        }
        response.writeHead(200, { etag: `"etag-${url.searchParams.get('partNumber') ?? 'object'}"` }).end()
      } else if (request.method === 'POST' || (request.method === 'DELETE' && url.searchParams.has('uploadId'))) {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        multipartRequests.push({ url, method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString() })
        if (request.method === 'DELETE') response.writeHead(204).end()
        else if (url.searchParams.has('uploads')) {
          response.writeHead(200, { 'content-type': 'application/xml' }).end('<InitiateMultipartUploadResult><Bucket>test-backups</Bucket><Key>pulpo/large.age</Key><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>')
        } else response.writeHead(200, { 'content-type': 'application/xml' }).end('<CompleteMultipartUploadResult><Key>pulpo/large.age</Key><ETag>"final"</ETag></CompleteMultipartUploadResult>')
      } else if (request.method === 'DELETE') {
        if (url.searchParams.has('versionId')) deletedVersions.push(url.pathname.split('/').slice(2).join('/'))
        response.writeHead(204).end()
      } else if (request.method === 'HEAD') {
        response.writeHead(200, { 'content-length': '0' }).end()
      } else if (url.searchParams.has('object-lock')) {
        response.writeHead(200, { 'content-type': 'application/xml' }).end('<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>')
      } else if (url.searchParams.has('retention')) {
        response.writeHead(200, { 'content-type': 'application/xml' }).end(`<Retention><Mode>${retentionMode}</Mode><RetainUntilDate>2099-01-01T00:00:00.000Z</RetainUntilDate></Retention>`)
      } else if (url.searchParams.has('list-type')) {
        response.writeHead(200, { 'content-type': 'application/xml' }).end('<ListBucketResult><KeyCount>0</KeyCount></ListBucketResult>')
      } else if (url.searchParams.has('versions')) {
        response.writeHead(200, { 'content-type': 'application/xml' }).end(`<ListVersionsResult><IsTruncated>false</IsTruncated><Version><Key>${url.searchParams.get('prefix')}</Key><VersionId>probe-version</VersionId></Version></ListVersionsResult>`)
      } else {
        response.writeHead(200).end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    store = new B2BackupStore({
      enabled: false, endpoint: `http://127.0.0.1:${address.port}`, region: 'us-east-005',
      bucket: 'test-backups', prefix: 'pulpo', keyId: 'test-key', applicationKey: 'test-secret',
      encryptedApplicationKey: null, recipient: '', intervalHours: 6, retentionDays: 30, fullArchiveIntervalDays: 7 as const, nextRunAt: null,
    }, { partSizeBytes: 1_024, retryDelayMs: 0 })
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
    const chunks = [Buffer.alloc(1_000, 17), Buffer.from('encrypted final chunk')]
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

  it('uploads ciphertext larger than one part as a locked multipart upload with per-part checksums', async () => {
    const chunks = [Buffer.alloc(1_500, 3), Buffer.alloc(1_000, 4)]
    const ciphertext = Buffer.concat(chunks)
    await store.putEncrypted('pulpo/large.age', Readable.from(chunks), ciphertext.length, 'job-1', 'fingerprint', new Date(Date.now() + 30_000))
    const [create, complete] = multipartRequests
    expect(create!.url.searchParams.has('uploads')).toBe(true)
    expect(create!.headers['x-amz-object-lock-mode']).toBe('COMPLIANCE')
    expect(create!.headers['x-amz-meta-pulpo-job-id']).toBe('job-1')
    expect(uploads.map(upload => [upload.url.searchParams.get('partNumber'), upload.body.length])).toEqual([['1', 1_024], ['2', 1_024], ['3', 452]])
    expect(Buffer.concat(uploads.map(upload => upload.body))).toEqual(ciphertext)
    expect(uploads.every(upload => upload.url.searchParams.get('uploadId') === 'upload-1' && !upload.headers['x-amz-trailer'])).toBe(true)
    expect(complete!.url.searchParams.get('uploadId')).toBe('upload-1')
    expect(complete!.body).toContain('<PartNumber>3</PartNumber>')
    expect(complete!.body).toContain('&quot;etag-3&quot;')
  })

  it('deletes a multipart backup that Backblaze stored without Compliance retention', async () => {
    retentionMode = 'GOVERNANCE'
    await expect(store.putEncrypted('pulpo/large.age', Readable.from([Buffer.alloc(2_000, 7)]), 2_000, 'job-1', 'fingerprint', new Date(Date.now() + 30_000)))
      .rejects.toThrow('did not apply Compliance retention')
    expect(deletedVersions).toEqual(['pulpo/large.age'])
  })

  it('extends Compliance retention with a Content-MD5 instead of a flexible checksum', async () => {
    const requests: Array<{ url: URL; headers: IncomingHttpHeaders; body: string }> = []
    server.removeAllListeners('request')
    server.on('request', async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      requests.push({ url: new URL(request.url!, 'http://localhost'), headers: request.headers, body: Buffer.concat(chunks).toString() })
      response.writeHead(200).end()
    })
    await store.extendRetention('pulpo/blobs/blob.age', new Date('2030-01-02T03:04:05.000Z'))
    const [request] = requests
    expect(request!.url.pathname).toBe('/test-backups/pulpo/blobs/blob.age')
    expect(request!.url.searchParams.has('retention')).toBe(true)
    expect(request!.body).toContain('<Mode>COMPLIANCE</Mode><RetainUntilDate>2030-01-02T03:04:05Z</RetainUntilDate>')
    expect(request!.headers['content-md5']).toBe(createHash('md5').update(request!.body).digest('base64'))
    expect(Object.keys(request!.headers).filter(name => name.includes('checksum'))).toEqual([])
    expect(request!.headers.authorization).toContain('content-md5')
  })

  it('retries a failed part with a fresh read of the spooled ciphertext', async () => {
    failNextPart = true
    const ciphertext = Buffer.alloc(2_000, 5)
    await store.putEncrypted('pulpo/large.age', Readable.from([ciphertext]), ciphertext.length, 'job-1', 'fingerprint', new Date(Date.now() + 30_000))
    expect(Buffer.concat(uploads.map(upload => upload.body))).toEqual(ciphertext)
    expect(multipartRequests.map(request => request.method)).toEqual(['POST', 'POST'])
  })

  it('aborts the multipart upload when a part keeps failing', async () => {
    server.removeAllListeners('request')
    server.on('request', async (request, response) => {
      const url = new URL(request.url!, 'http://localhost')
      for await (const chunk of request) void chunk
      if (request.method === 'PUT') {
        response.writeHead(400, { 'content-type': 'application/xml' }).end('<Error><Code>InvalidRequest</Code><Message>Part rejected</Message></Error>')
      } else {
        multipartRequests.push({ url, method: request.method!, headers: request.headers, body: '' })
        if (request.method === 'DELETE') response.writeHead(204).end()
        else response.writeHead(200, { 'content-type': 'application/xml' }).end('<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>')
      }
    })
    await expect(store.putEncrypted('pulpo/large.age', Readable.from([Buffer.alloc(2_000, 6)]), 2_000, 'job-1', 'fingerprint', new Date())).rejects.toThrow('Part rejected')
    expect(multipartRequests.map(request => [request.method, request.url.searchParams.get('uploadId')])).toEqual([['POST', null], ['DELETE', 'upload-1']])
  })
})
