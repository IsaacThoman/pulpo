import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  GetObjectRetentionCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
  UploadPartCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3'
import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { AppError } from '../lib/errors.js'
import type { ResolvedBackupSettings } from './backup-settings.js'

// S3 caps a single PUT at 5 GiB, so larger backups are uploaded in parts.
// Each part is held in memory so its Content-MD5 is known before sending, and
// so the SDK can resend it when retrying a failed request.
const MULTIPART_PART_BYTES = 32 * 1024 * 1024
const MAX_MULTIPART_PARTS = 10_000

/** Object Lock stores whole seconds. Round up so the lock reads back exactly as sent and never ends early. */
function wholeSecondLock(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / 1_000) * 1_000)
}

/** Split a stream into buffers of exactly `size` bytes, except a shorter final one. */
async function* fixedSizeParts(source: AsyncIterable<Uint8Array | string>, size: number): AsyncGenerator<Buffer> {
  let part = Buffer.allocUnsafe(size)
  let filled = 0
  for await (const value of source) {
    const chunk = typeof value === 'string' ? Buffer.from(value) : value
    for (let offset = 0; offset < chunk.length;) {
      const length = Math.min(size - filled, chunk.length - offset)
      part.set(chunk.subarray(offset, offset + length), filled)
      filled += length
      offset += length
      if (filled === size) {
        yield part
        part = Buffer.allocUnsafe(size)
        filled = 0
      }
    }
  }
  if (filled) yield part.subarray(0, filled)
}

export interface B2BackupObjectMetadata {
  sizeBytes: number
  jobId: string | null
  recipientFingerprint: string | null
}

export function backupConnectionError(error: unknown): AppError {
  if (error instanceof AppError) return error
  const name = error instanceof Error ? error.name : ''
  if (['SignatureDoesNotMatch', 'InvalidAccessKeyId', 'InvalidToken', 'ExpiredToken'].includes(name)) {
    return new AppError(400, 'backup_credentials_invalid', 'Backblaze rejected the credentials. Check the application key ID, application key, and bucket endpoint.')
  }
  if (name === 'AccessDenied') {
    return new AppError(400, 'backup_access_denied', 'Backblaze denied access. Check that the application key allows this bucket and prefix, file list/read/write/delete access, and readBucketRetentions, readFileRetentions, and writeFileRetentions.')
  }
  if (name === 'NoSuchBucket') {
    return new AppError(400, 'backup_bucket_missing', 'Backblaze could not find the bucket. Check its name and endpoint.')
  }
  return new AppError(502, 'backup_connection_failed', 'Backblaze connection test failed. Check the server logs for details.', 'server_error')
}

export class B2BackupStore {
  private readonly client: S3Client

  constructor(
    private readonly settings: ResolvedBackupSettings,
    private readonly partSizeBytes = MULTIPART_PART_BYTES,
  ) {
    this.client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: true,
      credentials: { accessKeyId: settings.keyId, secretAccessKey: settings.applicationKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }

  async testConnection(): Promise<void> {
    const lock = await this.client.send(new GetObjectLockConfigurationCommand({ Bucket: this.settings.bucket }))
    if (lock.ObjectLockConfiguration?.ObjectLockEnabled !== 'Enabled') {
      throw new AppError(400, 'backup_object_lock_required', 'Backblaze Object Lock must be enabled on the bucket')
    }
    if (lock.ObjectLockConfiguration.Rule) {
      throw new AppError(400, 'backup_default_retention', 'Remove the bucket default retention rule; Pulpo applies Compliance retention per backup')
    }

    const key = `${this.settings.prefix}/.pulpo-connection-test-${randomUUID()}`
    const lockedUntil = new Date(Date.now() + 2_000)
    let uploaded = false
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.settings.bucket,
        Key: key,
        Body: new Uint8Array(),
        ContentLength: 0,
        ContentMD5: createHash('md5').update(new Uint8Array()).digest('base64'),
        ContentType: 'application/octet-stream',
        ObjectLockMode: 'COMPLIANCE',
        ObjectLockRetainUntilDate: lockedUntil,
      }))
      uploaded = true
      await this.client.send(new HeadObjectCommand({ Bucket: this.settings.bucket, Key: key }))
      const downloaded = await this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }))
      if (downloaded.Body) await downloaded.Body.transformToByteArray()
      await this.client.send(new ListObjectsV2Command({ Bucket: this.settings.bucket, Prefix: key, MaxKeys: 1 }))
      await this.client.send(new GetObjectRetentionCommand({ Bucket: this.settings.bucket, Key: key }))
      const publicObjectUrl = `${this.settings.endpoint}/${encodeURIComponent(this.settings.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`
      const publicResponse = await fetch(publicObjectUrl, { method: 'GET', redirect: 'error' })
      await publicResponse.body?.cancel()
      if (publicResponse.ok) throw new AppError(400, 'backup_bucket_public', 'The Backblaze bucket must be private')
      if (![401, 403].includes(publicResponse.status)) {
        throw new Error(`Unable to verify that the Backblaze bucket is private (HTTP ${publicResponse.status})`)
      }
    } finally {
      if (uploaded) {
        const waitMs = lockedUntil.getTime() - Date.now() + 100
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
        await this.delete(key)
      }
    }
  }

  async head(key: string): Promise<B2BackupObjectMetadata | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.settings.bucket, Key: key }))
      return {
        sizeBytes: result.ContentLength ?? 0,
        jobId: result.Metadata?.['pulpo-job-id'] ?? null,
        recipientFingerprint: result.Metadata?.['pulpo-recipient'] ?? null,
      }
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (status === 404) return null
      throw error
    }
  }

  async putEncrypted(
    key: string,
    body: Readable,
    contentLength: number,
    jobId: string,
    recipientFingerprint: string,
    lockedUntil: Date,
  ): Promise<void> {
    // Object Lock requires a checksum header on every PUT. Buffer one part at a
    // time so its digest is known before upload, without spooling to disk or using trailers.
    try {
      await this.upload(key, body, contentLength, jobId, recipientFingerprint, wholeSecondLock(lockedUntil))
    } catch (error) {
      // Release the source even when the upload failed before reading it.
      body.destroy()
      throw error
    }
  }

  private async upload(key: string, body: Readable, contentLength: number, jobId: string, recipientFingerprint: string, retainUntil: Date): Promise<void> {
    const partSize = Math.max(this.partSizeBytes, Math.ceil(contentLength / MAX_MULTIPART_PARTS))
    const object = {
      Bucket: this.settings.bucket,
      Key: key,
      ContentType: 'application/octet-stream',
      ContentDisposition: 'attachment',
      ObjectLockMode: 'COMPLIANCE' as const,
      ObjectLockRetainUntilDate: retainUntil,
      Metadata: { 'pulpo-job-id': jobId, 'pulpo-recipient': recipientFingerprint },
    }

    if (contentLength <= partSize) {
      // Size the buffer to this backup; a longer stream spills into a second part.
      let upload: Buffer | undefined
      for await (const part of fixedSizeParts(body, Math.max(contentLength, 1))) {
        if (upload) throw new Error(`Encrypted backup is longer than the expected ${contentLength} bytes`)
        upload = part
      }
      upload ??= Buffer.alloc(0)
      if (upload.length !== contentLength) throw new Error(`Encrypted backup is ${upload.length} bytes; expected ${contentLength}`)
      await this.client.send(new PutObjectCommand({
        ...object,
        Body: upload,
        ContentLength: upload.length,
        ContentMD5: createHash('md5').update(upload).digest('base64'),
      }))
    } else {
      await this.uploadParts(key, body, contentLength, partSize, object)
    }
    try {
      await this.verifyRetention(key, retainUntil)
    } catch (error) {
      // Without Compliance retention the object can be removed, so a retry uploads it again.
      await this.delete(key).catch(() => undefined)
      throw error
    }
  }

  private async uploadParts(
    key: string,
    body: Readable,
    contentLength: number,
    partSize: number,
    object: Omit<PutObjectCommandInput, 'Body'>,
  ): Promise<void> {
    const { UploadId } = await this.client.send(new CreateMultipartUploadCommand(object))
    if (!UploadId) throw new Error('Backblaze did not return a multipart upload ID')
    try {
      const completed: CompletedPart[] = []
      let received = 0
      for await (const part of fixedSizeParts(body, partSize)) {
        const partNumber = completed.length + 1
        completed.push({ PartNumber: partNumber, ETag: await this.uploadPart(key, UploadId, partNumber, part) })
        received += part.length
      }
      if (received !== contentLength) throw new Error(`Encrypted backup is ${received} bytes; expected ${contentLength}`)
      await this.client.send(new CompleteMultipartUploadCommand({
        Bucket: this.settings.bucket, Key: key, UploadId, MultipartUpload: { Parts: completed },
      }))
    } catch (error) {
      await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.settings.bucket, Key: key, UploadId })).catch(() => undefined)
      throw error
    }
  }

  /** Fail unless the object is under Compliance retention until at least `lockedUntil`. */
  async verifyRetention(key: string, lockedUntil: Date): Promise<void> {
    const { Retention } = await this.client.send(new GetObjectRetentionCommand({ Bucket: this.settings.bucket, Key: key }))
    // Object Lock stores whole seconds, so compare at that precision.
    const required = Math.floor(lockedUntil.getTime() / 1_000) * 1_000
    if (Retention?.Mode !== 'COMPLIANCE' || !Retention.RetainUntilDate || Retention.RetainUntilDate.getTime() < required) {
      throw new Error('Backblaze did not apply Compliance retention to the backup')
    }
  }

  private async uploadPart(key: string, uploadId: string, partNumber: number, body: Buffer): Promise<string> {
    const { ETag } = await this.client.send(new UploadPartCommand({
      Bucket: this.settings.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber,
      Body: body, ContentLength: body.length, ContentMD5: createHash('md5').update(body).digest('base64'),
    }))
    if (!ETag) throw new Error(`Backblaze did not return an ETag for part ${partNumber}`)
    return ETag
  }

  /** Abort multipart uploads that a crashed worker left behind; their parts are billed but never locked. */
  async abortStaleUploads(initiatedBefore: Date): Promise<number> {
    let aborted = 0
    let keyMarker: string | undefined, uploadIdMarker: string | undefined
    do {
      const page = await this.client.send(new ListMultipartUploadsCommand({
        Bucket: this.settings.bucket, Prefix: `${this.settings.prefix}/`, KeyMarker: keyMarker, UploadIdMarker: uploadIdMarker,
      }))
      for (const upload of page.Uploads ?? []) {
        // An upload of unknown age might still be running, so leave it alone.
        if (!upload.Key || !upload.UploadId || !upload.Initiated || upload.Initiated >= initiatedBefore) continue
        await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.settings.bucket, Key: upload.Key, UploadId: upload.UploadId }))
        aborted += 1
      }
      if (!page.IsTruncated) break
      if (page.NextKeyMarker === keyMarker && page.NextUploadIdMarker === uploadIdMarker) throw new Error('Backblaze upload listing did not advance')
      keyMarker = page.NextKeyMarker; uploadIdMarker = page.NextUploadIdMarker
    } while (keyMarker || uploadIdMarker)
    return aborted
  }

  async getStream(key: string): Promise<{ body: Readable; contentLength?: number }> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }))
    if (!result.Body) throw new Error('Backblaze returned an empty object body')
    return { body: Readable.from(result.Body as AsyncIterable<Uint8Array>, { objectMode: false }), contentLength: result.ContentLength }
  }

  async delete(key: string): Promise<void> {
    // B2 inserts a hide marker for unversioned DELETE. Remove exact versions
    // so retention cleanup actually releases storage, including earlier retries.
    let keyMarker: string | undefined, versionMarker: string | undefined
    do {
      const page = await this.client.send(new ListObjectVersionsCommand({
        Bucket: this.settings.bucket, Prefix: key, KeyMarker: keyMarker, VersionIdMarker: versionMarker,
      }))
      for (const version of [...page.Versions ?? [], ...page.DeleteMarkers ?? []]) {
        if (version.Key !== key) continue
        if (!version.VersionId) throw new Error('Backblaze returned a backup version without an ID')
        await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key, VersionId: version.VersionId }))
      }
      if (!page.IsTruncated) return
      if (!page.NextKeyMarker || (page.NextKeyMarker === keyMarker && page.NextVersionIdMarker === versionMarker)) {
        throw new Error('Backblaze version listing did not advance')
      }
      keyMarker = page.NextKeyMarker; versionMarker = page.NextVersionIdMarker
    } while (keyMarker)
  }
}
