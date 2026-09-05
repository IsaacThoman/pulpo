import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  GetObjectRetentionCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AppError } from '../lib/errors.js'
import type { ResolvedBackupSettings } from './backup-settings.js'

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

  constructor(private readonly settings: ResolvedBackupSettings) {
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
        await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }))
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
    // Object Lock requires a checksum header. Spool ciphertext so its digest is
    // known before upload, without buffering the backup in memory or using trailers.
    const directory = await mkdtemp(join(tmpdir(), 'pulpo-encrypted-upload-'))
    const file = join(directory, 'backup.age')
    const hash = createHash('md5')
    let upload: Readable | undefined
    try {
      await pipeline(body, new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk)
          callback(null, chunk)
        },
      }), createWriteStream(file, { mode: 0o600 }))
      upload = createReadStream(file)
      await this.client.send(new PutObjectCommand({
        Bucket: this.settings.bucket,
        Key: key,
        Body: upload,
        ContentLength: contentLength,
        ContentMD5: hash.digest('base64'),
        ContentType: 'application/octet-stream',
        ContentDisposition: 'attachment',
        ObjectLockMode: 'COMPLIANCE',
        ObjectLockRetainUntilDate: lockedUntil,
        Metadata: { 'pulpo-job-id': jobId, 'pulpo-recipient': recipientFingerprint },
      }))
    } finally {
      upload?.destroy()
      await rm(directory, { recursive: true, force: true })
    }
  }

  async getStream(key: string): Promise<{ body: Readable; contentLength?: number }> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }))
    if (!result.Body) throw new Error('Backblaze returned an empty object body')
    return { body: Readable.from(result.Body as AsyncIterable<Uint8Array>, { objectMode: false }), contentLength: result.ContentLength }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }))
  }
}
