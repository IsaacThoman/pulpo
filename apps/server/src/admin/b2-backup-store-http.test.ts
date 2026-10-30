import { createHash } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { B2BackupStore } from './b2-backup-store.js'

interface Upload { key: string; partNumber: number | null; headers: IncomingHttpHeaders; body: Buffer }

describe('Backblaze Object Lock upload requests', () => {
  let server: Server
  let store: B2BackupStore
  let uploads: Array<Upload>
  let requests: Array<{ method: string; key: string; query: string }>
  let created: IncomingHttpHeaders[]
  let completed: string[]
  let failPartOnce: Set<number>
  let retention: { mode: string; retainUntil: Date | null } | null
  let pendingUploads: Array<{ key: string; uploadId: string; initiated: Date }>
  const PART_BYTES = 64 * 1024

  beforeEach(async () => {
    uploads = []
    requests = []
    created = []
    completed = []
    failPartOnce = new Set()
    retention = null
    pendingUploads = []
    server = createServer(async (request, response) => {
      const url = new URL(request.url!, 'http://localhost')
      const key = decodeURIComponent(url.pathname.replace(/^\/test-backups\/?/, ''))
      requests.push({ method: request.method!, key, query: url.search })
      if (!request.headers.authorization) {
        response.writeHead(403).end()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      const xml = (status: number, payload: string) => response.writeHead(status, { 'content-type': 'application/xml' }).end(payload)
      if (request.method === 'PUT' && !url.searchParams.has('retention')) {
        const partNumber = url.searchParams.has('partNumber') ? Number(url.searchParams.get('partNumber')) : null
        if (partNumber !== null && failPartOnce.delete(partNumber)) {
          xml(500, '<Error><Code>InternalError</Code><Message>Try again</Message></Error>')
          return
        }
        uploads.push({ key, partNumber, headers: request.headers, body })
        if (request.headers['content-md5'] !== createHash('md5').update(body).digest('base64')) {
          xml(400, '<Error><Code>InvalidRequest</Code><Message>Object Lock requires a valid checksum</Message></Error>')
          return
        }
        if (partNumber === null && request.headers['x-amz-object-lock-mode']) {
          retention = { mode: String(request.headers['x-amz-object-lock-mode']), retainUntil: new Date(String(request.headers['x-amz-object-lock-retain-until-date'])) }
        }
        response.writeHead(200, { etag: `"${createHash('md5').update(body).digest('hex')}"` }).end()
      } else if (request.method === 'POST' && url.searchParams.has('uploads')) {
        created.push(request.headers)
        if (request.headers['x-amz-object-lock-mode']) {
          retention = { mode: String(request.headers['x-amz-object-lock-mode']), retainUntil: new Date(String(request.headers['x-amz-object-lock-retain-until-date'])) }
        }
        xml(200, `<InitiateMultipartUploadResult><Bucket>test-backups</Bucket><Key>${key}</Key><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>`)
      } else if (request.method === 'POST' && url.searchParams.has('uploadId')) {
        completed.push(body.toString('utf8'))
        xml(200, `<CompleteMultipartUploadResult><Bucket>test-backups</Bucket><Key>${key}</Key><ETag>"done"</ETag></CompleteMultipartUploadResult>`)
      } else if (request.method === 'DELETE') {
        response.writeHead(204).end()
      } else if (request.method === 'HEAD') {
        response.writeHead(200, { 'content-length': '0' }).end()
      } else if (url.searchParams.has('object-lock')) {
        xml(200, '<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>')
      } else if (url.searchParams.has('retention')) {
        xml(200, `<Retention>${retention ? `<Mode>${retention.mode}</Mode>` : ''}${retention?.retainUntil ? `<RetainUntilDate>${retention.retainUntil.toISOString()}</RetainUntilDate>` : ''}</Retention>`)
      } else if (url.searchParams.has('uploads')) {
        // Two uploads per page, to exercise pagination.
        const keyMarker = url.searchParams.get('key-marker') ?? ''
        const remaining = pendingUploads.filter(upload => upload.key > keyMarker)
        const page = remaining.slice(0, 2), truncated = remaining.length > 2
        xml(200, `<ListMultipartUploadsResult><Bucket>test-backups</Bucket><IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextKeyMarker>${page.at(-1)!.key}</NextKeyMarker><NextUploadIdMarker>${page.at(-1)!.uploadId}</NextUploadIdMarker>` : ''}${
          page.map(upload => `<Upload><Key>${upload.key}</Key><UploadId>${upload.uploadId}</UploadId><Initiated>${upload.initiated.toISOString()}</Initiated></Upload>`).join('')
        }</ListMultipartUploadsResult>`)
      } else if (url.searchParams.has('list-type')) {
        xml(200, '<ListBucketResult><KeyCount>0</KeyCount></ListBucketResult>')
      } else if (url.searchParams.has('versions')) {
        xml(200, `<ListVersionsResult><IsTruncated>false</IsTruncated><Version><Key>${url.searchParams.get('prefix')}</Key><VersionId>probe-version</VersionId></Version></ListVersionsResult>`)
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
    }, PART_BYTES)
  })

  afterEach(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  /** Ciphertext arrives in chunks that do not line up with part boundaries. */
  function chunked(bytes: Buffer, size = 10_007): Readable {
    return Readable.from((function* () {
      for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size)
    })())
  }

  function ciphertext(length: number): Buffer {
    return Buffer.from(Array.from({ length }, (_, index) => (index * 31 + 7) % 251))
  }

  it('sends a valid checksum header for the empty connection probe', async () => {
    await store.testConnection()
    expect(uploads).toHaveLength(1)
    expect(uploads[0]!.body.length).toBe(0)
    expect(uploads[0]!.headers['x-amz-object-lock-mode']).toBe('COMPLIANCE')
  })

  it('uploads streamed ciphertext with a precomputed checksum and no chunked checksum trailer', async () => {
    const chunks = [Buffer.alloc(30_000, 17), Buffer.from('encrypted final chunk')]
    const ciphertext = Buffer.concat(chunks)
    await store.putEncrypted('pulpo/backup.age', Readable.from(chunks), ciphertext.length, 'job-1', 'fingerprint', new Date(Date.now() + 30_000))
    expect(uploads).toHaveLength(1)
    expect(uploads[0]!.partNumber).toBeNull()
    expect(uploads[0]!.body).toEqual(ciphertext)
    expect(uploads[0]!.headers['content-length']).toBe(String(ciphertext.length))
    expect(uploads[0]!.headers['x-amz-object-lock-mode']).toBe('COMPLIANCE')
    expect(uploads[0]!.headers['x-amz-trailer']).toBeUndefined()
    expect(uploads[0]!.headers['content-encoding']).toBeUndefined()
    expect(created).toHaveLength(0)
  })

  it('uploads an empty backup in one locked PUT', async () => {
    await store.putEncrypted('pulpo/empty.age', Readable.from([]), 0, 'job-1', 'fingerprint', new Date(Date.now() + 30_000))
    expect(uploads).toHaveLength(1)
    expect(uploads[0]!.body.length).toBe(0)
  })

  it('rounds the lock up to whole seconds, which is what Object Lock stores', async () => {
    const lockedUntil = new Date('2030-01-02T03:04:05.321Z')
    await store.putEncrypted('pulpo/backup.age', Readable.from([Buffer.from('x')]), 1, 'job-1', 'fingerprint', lockedUntil)
    expect(uploads[0]!.headers['x-amz-object-lock-retain-until-date']).toBe('2030-01-02T03:04:06Z')
  })

  it('propagates ciphertext stream failures before sending an upload', async () => {
    const body = Readable.from((async function* () {
      yield Buffer.from('partial ciphertext')
      throw new Error('encryption failed')
    })())
    await expect(store.putEncrypted('pulpo/failed.age', body, 18, 'job-1', 'fingerprint', new Date())).rejects.toThrow('encryption failed')
    expect(uploads).toHaveLength(0)
  })

  it('refuses a small upload whose ciphertext is longer than declared', async () => {
    await expect(store.putEncrypted('pulpo/long.age', Readable.from([Buffer.alloc(20)]), 10, 'job-1', 'fingerprint', new Date()))
      .rejects.toThrow('Encrypted backup is longer than the expected 10 bytes')
    expect(uploads).toHaveLength(0)
  })

  it('releases the ciphertext source when the multipart upload cannot start', async () => {
    server.prependListener('request', (request) => {
      if (request.method === 'POST' && request.url?.includes('uploads')) delete request.headers.authorization
    })
    const body = Readable.from((function* () { while (true) yield Buffer.alloc(1_024) })())
    await expect(store.putEncrypted('pulpo/denied.age', body, 2 * PART_BYTES, 'job-1', 'fingerprint', new Date(Date.now() + 30_000))).rejects.toThrow()
    expect(body.destroyed).toBe(true)
    expect(uploads).toHaveLength(0)
  })

  it('verifies Compliance retention down to whole seconds', async () => {
    retention = { mode: 'COMPLIANCE', retainUntil: new Date('2030-01-02T03:04:05.000Z') }
    await store.verifyRetention('pulpo/backup.age', new Date('2030-01-02T03:04:05.900Z'))
    await expect(store.verifyRetention('pulpo/backup.age', new Date('2030-01-02T03:04:06.000Z'))).rejects.toThrow('did not apply Compliance retention')
    retention = { mode: 'GOVERNANCE', retainUntil: new Date('2031-01-01T00:00:00.000Z') }
    await expect(store.verifyRetention('pulpo/backup.age', new Date('2030-01-02T03:04:05.000Z'))).rejects.toThrow('did not apply Compliance retention')
    retention = null
    await expect(store.verifyRetention('pulpo/backup.age', new Date('2030-01-02T03:04:05.000Z'))).rejects.toThrow('did not apply Compliance retention')
  })

  it('uploads a backup larger than one part as locked multipart parts with per-part checksums', async () => {
    const bytes = ciphertext(2 * PART_BYTES + 1_234)
    const lockedUntil = new Date('2030-01-02T03:04:05.321Z')
    await store.putEncrypted('pulpo/large.age', chunked(bytes), bytes.length, 'job-1', 'fingerprint', lockedUntil)

    expect(created).toHaveLength(1)
    expect(created[0]!['x-amz-object-lock-mode']).toBe('COMPLIANCE')
    expect(created[0]!['x-amz-object-lock-retain-until-date']).toBe('2030-01-02T03:04:06Z')
    expect(created[0]!['x-amz-meta-pulpo-job-id']).toBe('job-1')
    expect(created[0]!['x-amz-meta-pulpo-recipient']).toBe('fingerprint')
    expect(uploads.map(upload => [upload.partNumber, upload.body.length])).toEqual([[1, PART_BYTES], [2, PART_BYTES], [3, 1_234]])
    expect(uploads.every(upload => upload.headers['x-amz-trailer'] === undefined)).toBe(true)
    expect(Buffer.concat(uploads.map(upload => upload.body)).equals(bytes)).toBe(true)
    expect(completed).toHaveLength(1)
    for (const upload of uploads) {
      expect(completed[0]).toContain(`<PartNumber>${upload.partNumber}</PartNumber>`)
      expect(completed[0]).toContain(createHash('md5').update(upload.body).digest('hex'))
    }
    expect(requests.some(request => request.query.includes('retention'))).toBe(true)
  })

  it('retries a failed part with the same bytes', async () => {
    failPartOnce.add(2)
    const bytes = ciphertext(PART_BYTES + 10)
    await store.putEncrypted('pulpo/retry.age', chunked(bytes), bytes.length, 'job-1', 'fingerprint', new Date(Date.now() + 30_000))
    expect(uploads.map(upload => upload.partNumber)).toEqual([1, 2])
    expect(Buffer.concat(uploads.map(upload => upload.body)).equals(bytes)).toBe(true)
    expect(completed).toHaveLength(1)
  })

  it('aborts the multipart upload when encryption fails partway', async () => {
    const body = Readable.from((async function* () {
      yield ciphertext(PART_BYTES + 5)
      throw new Error('encryption failed')
    })())
    await expect(store.putEncrypted('pulpo/failed.age', body, 3 * PART_BYTES, 'job-1', 'fingerprint', new Date(Date.now() + 30_000)))
      .rejects.toThrow('encryption failed')
    expect(completed).toHaveLength(0)
    expect(requests.filter(request => request.method === 'DELETE' && request.query.includes('uploadId=upload-1'))).toHaveLength(1)
  })

  it('aborts the multipart upload when the ciphertext is shorter than declared', async () => {
    const bytes = ciphertext(PART_BYTES + 5)
    await expect(store.putEncrypted('pulpo/short.age', chunked(bytes), bytes.length + 1, 'job-1', 'fingerprint', new Date(Date.now() + 30_000)))
      .rejects.toThrow(`Encrypted backup is ${bytes.length} bytes; expected ${bytes.length + 1}`)
    expect(completed).toHaveLength(0)
    expect(requests.filter(request => request.method === 'DELETE' && request.query.includes('uploadId=upload-1'))).toHaveLength(1)
  })

  it('aborts the multipart upload when a part keeps failing', async () => {
    const bytes = ciphertext(PART_BYTES + 5)
    let failures = 0
    server.prependListener('request', (request) => {
      if (request.method === 'PUT' && request.url?.includes('partNumber=2')) { failPartOnce.add(2); failures += 1 }
    })
    await expect(store.putEncrypted('pulpo/broken.age', chunked(bytes), bytes.length, 'job-1', 'fingerprint', new Date(Date.now() + 30_000))).rejects.toThrow()
    // The SDK's standard retry policy makes three attempts.
    expect(failures).toBe(3)
    expect(completed).toHaveLength(0)
    expect(requests.filter(request => request.method === 'DELETE' && request.query.includes('uploadId=upload-1'))).toHaveLength(1)
  })

  it('deletes a multipart backup and fails when Compliance retention did not apply', async () => {
    server.prependListener('request', (request) => {
      // Simulate a store that ignores Object Lock headers on multipart uploads.
      if (request.method === 'POST' && request.url?.includes('uploads')) delete request.headers['x-amz-object-lock-mode']
    })
    const bytes = ciphertext(PART_BYTES + 5)
    await expect(store.putEncrypted('pulpo/unlocked.age', chunked(bytes), bytes.length, 'job-1', 'fingerprint', new Date(Date.now() + 30_000)))
      .rejects.toThrow('Backblaze did not apply Compliance retention to the backup')
    expect(completed).toHaveLength(1)
    expect(requests.filter(request => request.method === 'DELETE' && request.query.includes('versionId=probe-version'))).toHaveLength(1)
  })

  it('deletes a single-PUT backup and fails when Compliance retention did not apply', async () => {
    server.prependListener('request', (request) => {
      if (request.method === 'PUT' && !request.url?.includes('retention')) delete request.headers['x-amz-object-lock-mode']
    })
    await expect(store.putEncrypted('pulpo/unlocked.age', Readable.from([Buffer.from('x')]), 1, 'job-1', 'fingerprint', new Date(Date.now() + 30_000)))
      .rejects.toThrow('Backblaze did not apply Compliance retention to the backup')
    expect(uploads).toHaveLength(1)
    expect(requests.filter(request => request.method === 'DELETE' && request.query.includes('versionId=probe-version'))).toHaveLength(1)
  })

  it('aborts only multipart uploads started before the cutoff, across pages', async () => {
    const cutoff = new Date('2030-01-02T00:00:00.000Z')
    pendingUploads = [
      { key: 'pulpo/a.age', uploadId: 'old-a', initiated: new Date('2030-01-01T00:00:00.000Z') },
      { key: 'pulpo/b.age', uploadId: 'new-b', initiated: new Date('2030-01-02T00:00:00.000Z') },
      { key: 'pulpo/c.age', uploadId: 'old-c', initiated: new Date('2029-12-01T00:00:00.000Z') },
    ]
    expect(await store.abortStaleUploads(cutoff)).toBe(2)
    expect(requests.filter(request => request.method === 'GET' && request.query.includes('uploads')).every(request => request.query.includes('prefix=pulpo%2F'))).toBe(true)
    expect(requests.filter(request => request.method === 'DELETE').map(request => [request.key, new URLSearchParams(request.query).get('uploadId')]))
      .toEqual([['pulpo/a.age', 'old-a'], ['pulpo/c.age', 'old-c']])
  })
})
