import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  GetObjectRetentionCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutObjectCommand,
  PutObjectRetentionCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3'
import { createHash, randomUUID, type Hash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AppError } from '../lib/errors.js'
import type { ResolvedBackupSettings } from './backup-settings.js'

// S3 caps a single PUT at 5 GiB, so larger backups are uploaded in parts.
const MULTIPART_PART_BYTES = 128 * 1024 * 1024
const MAX_MULTIPART_PARTS = 10_000
const PART_UPLOAD_ATTEMPTS = 3
const PART_RETRY_DELAY_MS = 1_000

/**
 * Current SDKs add a CRC32 checksum to operations that require one. Send the
 * Content-MD5 that S3-compatible stores have always accepted instead.
 */
function withContentMd5(command: PutObjectRetentionCommand): PutObjectRetentionCommand {
  command.middlewareStack.add((next) => async (args) => {
    const request = args.request as { headers: Record<string, string>; body?: unknown }
    for (const name of Object.keys(request.headers)) if (/^x-amz-(sdk-)?checksum-/i.test(name)) delete request.headers[name]
    request.headers['content-md5'] = createHash('md5').update(typeof request.body === 'string' ? request.body : '').digest('base64')
    return next(args)
  }, { step: 'build', priority: 'low', name: 'pulpoContentMd5' })
  return command
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
    private readonly multipart = { partSizeBytes: MULTIPART_PART_BYTES, retryDelayMs: PART_RETRY_DELAY_MS },
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
    // Object Lock requires a checksum header on every PUT. Spool ciphertext so
    // each part's digest is known before upload, without buffering the backup
    // in memory or using trailers.
    const partSize = Math.max(this.multipart.partSizeBytes, Math.ceil(contentLength / MAX_MULTIPART_PARTS))
    const directory = await mkdtemp(join(tmpdir(), 'pulpo-encrypted-upload-'))
    const file = join(directory, 'backup.age')
    const partHashes: Hash[] = []
    let written = 0
    let upload: Readable | undefined
    try {
      await pipeline(body, new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          for (let offset = 0; offset < chunk.length;) {
            const index = Math.floor(written / partSize)
            const length = Math.min(chunk.length - offset, (index + 1) * partSize - written)
            ;(partHashes[index] ??= createHash('md5')).update(chunk.subarray(offset, offset + length))
            offset += length
            written += length
          }
          callback(null, chunk)
        },
      }), createWriteStream(file, { mode: 0o600 }))
      if (written !== contentLength) throw new Error(`Encrypted backup is ${written} bytes; expected ${contentLength}`)
      const digests = partHashes.map(hash => hash.digest('base64'))
      const object = {
        Bucket: this.settings.bucket,
        Key: key,
        ContentType: 'application/octet-stream',
        ContentDisposition: 'attachment',
        ObjectLockMode: 'COMPLIANCE' as const,
        ObjectLockRetainUntilDate: lockedUntil,
        Metadata: { 'pulpo-job-id': jobId, 'pulpo-recipient': recipientFingerprint },
      }
      if (digests.length <= 1) {
        upload = createReadStream(file)
        await this.client.send(new PutObjectCommand({
          ...object,
          Body: upload,
          ContentLength: contentLength,
          ContentMD5: digests[0] ?? createHash('md5').digest('base64'),
        }))
        return
      }
      const { UploadId } = await this.client.send(new CreateMultipartUploadCommand(object))
      if (!UploadId) throw new Error('Backblaze did not return a multipart upload ID')
      try {
        const parts: CompletedPart[] = []
        for (const [index, digest] of digests.entries()) {
          const start = index * partSize
          const end = Math.min(start + partSize, contentLength)
          parts.push({ PartNumber: index + 1, ETag: await this.uploadPart(file, key, UploadId, index + 1, start, end, digest) })
        }
        await this.client.send(new CompleteMultipartUploadCommand({
          Bucket: this.settings.bucket, Key: key, UploadId, MultipartUpload: { Parts: parts },
        }))
      } catch (error) {
        await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.settings.bucket, Key: key, UploadId })).catch(() => undefined)
        throw error
      }
      // Never leave an unlocked backup behind: a retry would otherwise accept it as complete.
      const { Retention } = await this.client.send(new GetObjectRetentionCommand({ Bucket: this.settings.bucket, Key: key }))
      if (Retention?.Mode !== 'COMPLIANCE' || !Retention.RetainUntilDate || Retention.RetainUntilDate < lockedUntil) {
        await this.delete(key)
        throw new Error('Backblaze did not apply Compliance retention to the multipart backup')
      }
    } finally {
      upload?.destroy()
      await rm(directory, { recursive: true, force: true })
    }
  }

  private async uploadPart(file: string, key: string, uploadId: string, partNumber: number, start: number, end: number, digest: string): Promise<string> {
    // A consumed stream cannot be resent, so retry each part with a fresh read.
    for (let attempt = 1; ; attempt++) {
      const body = createReadStream(file, { start, end: end - 1 })
      try {
        const { ETag } = await this.client.send(new UploadPartCommand({
          Bucket: this.settings.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber,
          Body: body, ContentLength: end - start, ContentMD5: digest,
        }))
        if (!ETag) throw new Error(`Backblaze did not return an ETag for part ${partNumber}`)
        return ETag
      } catch (error) {
        if (attempt >= PART_UPLOAD_ATTEMPTS) throw error
        await new Promise((resolve) => setTimeout(resolve, attempt * this.multipart.retryDelayMs))
      } finally {
        body.destroy()
      }
    }
  }

  /** Compliance retention can only grow, so callers must never pass an earlier date. */
  async extendRetention(key: string, lockedUntil: Date): Promise<void> {
    await this.client.send(withContentMd5(new PutObjectRetentionCommand({
      Bucket: this.settings.bucket,
      Key: key,
      Retention: { Mode: 'COMPLIANCE', RetainUntilDate: lockedUntil },
    })))
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
