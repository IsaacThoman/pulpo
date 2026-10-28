import { randomBytes, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { AbortMultipartUploadCommand, CreateBucketCommand, CreateMultipartUploadCommand, GetObjectRetentionCommand, HeadBucketCommand, ListMultipartUploadsCommand, ListObjectVersionsCommand, S3Client } from '@aws-sdk/client-s3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { B2BackupStore } from './b2-backup-store.js'
import { wholeSecondLock } from './backup-retention.js'

/**
 * Runs the Backblaze store against a real S3 implementation with Compliance
 * Object Lock: a disposable SeaweedFS in CI, or a B2 test bucket locally.
 * Objects are locked for seconds so the suite can clean up after itself.
 */
const env = {
  endpoint: process.env.PULPO_BACKUP_S3_TEST_ENDPOINT,
  region: process.env.PULPO_BACKUP_S3_TEST_REGION ?? 'us-east-1',
  bucket: process.env.PULPO_BACKUP_S3_TEST_BUCKET ?? 'pulpo-backup-test',
  keyId: process.env.PULPO_BACKUP_S3_TEST_KEY_ID ?? '',
  applicationKey: process.env.PULPO_BACKUP_S3_TEST_KEY ?? '',
  prefix: `${process.env.PULPO_BACKUP_S3_TEST_PREFIX ?? 'pulpo-test'}/${randomUUID()}`,
}
const PART_BYTES = 5 * 1024 * 1024

const settings = {
  enabled: false, endpoint: env.endpoint ?? '', region: env.region, bucket: env.bucket, prefix: env.prefix,
  keyId: env.keyId, applicationKey: env.applicationKey, encryptedApplicationKey: null, recipient: '',
  intervalHours: 24 as const, retentionDays: 1, fullArchiveIntervalDays: 0 as const, nextRunAt: null,
}
const client = new S3Client({
  endpoint: settings.endpoint, region: settings.region, forcePathStyle: true,
  credentials: { accessKeyId: settings.keyId, secretAccessKey: settings.applicationKey },
  requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
})
const store = new B2BackupStore(settings, { partSizeBytes: PART_BYTES, retryDelayMs: 100 })
const created: string[] = []
// Production lock dates carry milliseconds; Object Lock stores whole seconds.
const seconds = (count: number) => new Date(Date.now() + count * 1_000 + 321)
const read = async (key: string) => {
  const { body } = await store.getStream(key)
  const chunks: Buffer[] = []; for await (const chunk of body) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
const retention = (key: string) => client.send(new GetObjectRetentionCommand({ Bucket: env.bucket, Key: key })).then(result => result.Retention)
async function put(key: string, body: Buffer, lockedUntil: Date) {
  created.push(key)
  await store.putEncrypted(key, Readable.from([body]), body.length, 'job-1', 'fingerprint', lockedUntil)
}

describe.skipIf(!env.endpoint)('Backblaze store against S3 Compliance Object Lock', () => {
  beforeAll(async () => {
    await client.send(new HeadBucketCommand({ Bucket: env.bucket })).catch(async () => {
      if (process.env.PULPO_BACKUP_S3_TEST_CREATE_BUCKET !== 'true') throw new Error(`Bucket ${env.bucket} does not exist`)
      await client.send(new CreateBucketCommand({ Bucket: env.bucket, ObjectLockEnabledForBucket: true }))
    })
  })

  afterAll(async () => {
    // Every object was locked for seconds; wait them out, then remove all versions.
    await new Promise(resolve => setTimeout(resolve, 6_000))
    for (const key of created) await store.delete(key).catch(() => undefined)
    const remaining = await client.send(new ListObjectVersionsCommand({ Bucket: env.bucket, Prefix: env.prefix }))
    expect([...remaining.Versions ?? [], ...remaining.DeleteMarkers ?? []]).toEqual([])
  }, 60_000)

  it('passes the connection test with Object Lock enabled and no default retention', async () => {
    await store.testConnection()
  }, 30_000)

  it('uploads a small backup in one locked PUT with recovery metadata', async () => {
    const key = `${env.prefix}/small.age`, lockedUntil = seconds(4)
    await put(key, Buffer.from('small ciphertext'), lockedUntil)
    expect(await read(key)).toEqual(Buffer.from('small ciphertext'))
    expect(await store.head(key)).toEqual({ sizeBytes: 16, jobId: 'job-1', recipientFingerprint: 'fingerprint' })
    expect(await retention(key)).toEqual({ Mode: 'COMPLIANCE', RetainUntilDate: wholeSecondLock(lockedUntil) })
  }, 30_000)

  it('uploads a large backup as locked multipart parts', async () => {
    const key = `${env.prefix}/large.age`, body = randomBytes(2 * PART_BYTES + 12_345), lockedUntil = seconds(4)
    await put(key, body, lockedUntil)
    expect((await read(key)).equals(body)).toBe(true)
    expect(await retention(key)).toEqual({ Mode: 'COMPLIANCE', RetainUntilDate: wholeSecondLock(lockedUntil) })
  }, 60_000)

  it('extends Compliance retention, refuses to shorten it, and refuses deletion while locked', async () => {
    const key = `${env.prefix}/extended.age`
    await put(key, Buffer.from('blob'), seconds(2))
    const extended = seconds(5)
    await store.extendRetention(key, extended)
    expect(await retention(key)).toEqual({ Mode: 'COMPLIANCE', RetainUntilDate: wholeSecondLock(extended) })
    expect(await store.retention(key)).toEqual({ mode: 'COMPLIANCE', retainUntil: wholeSecondLock(extended) })
    await expect(store.extendRetention(key, seconds(3))).rejects.toThrow()
    await expect(store.delete(key)).rejects.toThrow()
    expect(await read(key)).toEqual(Buffer.from('blob'))
  }, 30_000)

  it('aborts only multipart uploads older than the cutoff', async () => {
    const stale = `${env.prefix}/stale.age`, fresh = `${env.prefix}/fresh.age`
    for (const key of [stale, fresh]) {
      // Upload start times are reported to the second.
      if (key === fresh) await new Promise(resolve => setTimeout(resolve, 1_100))
      await client.send(new CreateMultipartUploadCommand({ Bucket: env.bucket, Key: key, ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: seconds(4) }))
    }
    const pending = async () => (await client.send(new ListMultipartUploadsCommand({ Bucket: env.bucket, Prefix: `${env.prefix}/` }))).Uploads ?? []
    const cutoff = (await pending()).find(upload => upload.Key === fresh)!.Initiated
    try {
      if (!cutoff) {
        // SeaweedFS omits start times; an upload of unknown age is never aborted.
        expect(await store.abortStaleUploads(`${env.prefix}/`, new Date(Date.now() + 60_000))).toBe(0)
        return
      }
      expect(await store.abortStaleUploads(`${env.prefix}/`, cutoff)).toBe(1)
      expect((await pending()).map(upload => upload.Key)).toEqual([fresh])
      expect(await store.abortStaleUploads(`${env.prefix}/`, new Date(Date.now() + 60_000))).toBe(1)
    } finally {
      for (const upload of await pending()) await client.send(new AbortMultipartUploadCommand({ Bucket: env.bucket, Key: upload.Key!, UploadId: upload.UploadId! }))
    }
    expect(await pending()).toEqual([])
  }, 30_000)

  it('reports a missing object so a vanished blob can be replaced', async () => {
    await expect(store.extendRetention(`${env.prefix}/missing.age`, seconds(5))).rejects.toSatisfy((error: unknown) => {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      return status === 404 || (error instanceof Error && ['NoSuchKey', 'NotFound'].includes(error.name))
    })
  }, 30_000)

  it('serves blobs to the offline assembler through its own SigV4 signer', async () => {
    const key = `${env.prefix}/blobs/it's (1)*.age`
    await put(key, Buffer.from('signed download'), seconds(4))
    const { fetchS3Object } = await import(/* @vite-ignore */ new URL('../../../cli/src/backup-assemble.ts', import.meta.url).href) as {
      fetchS3Object(location: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }, key: string): Promise<AsyncIterable<Uint8Array>>
    }
    const body = await fetchS3Object({ endpoint: env.endpoint!, region: env.region, bucket: env.bucket, accessKeyId: env.keyId, secretAccessKey: env.applicationKey }, key)
    const chunks: Buffer[] = []; for await (const chunk of body) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString()).toBe('signed download')
  }, 30_000)
})
