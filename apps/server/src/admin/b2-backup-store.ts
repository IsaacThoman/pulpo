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
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { ResolvedBackupSettings } from './backup-settings.js'

export interface B2BackupObjectMetadata {
  sizeBytes: number
  jobId: string | null
  recipientFingerprint: string | null
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
      throw new Error('Backblaze Object Lock must be enabled on the bucket')
    }
    if (lock.ObjectLockConfiguration.Rule) {
      throw new Error('Remove the bucket default retention rule; Pulpo applies Compliance retention per backup')
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
      if (publicResponse.ok) throw new Error('The Backblaze bucket must be private')
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
    await this.client.send(new PutObjectCommand({
      Bucket: this.settings.bucket,
      Key: key,
      Body: body,
      ContentLength: contentLength,
      ContentType: 'application/octet-stream',
      ContentDisposition: 'attachment',
      ObjectLockMode: 'COMPLIANCE',
      ObjectLockRetainUntilDate: lockedUntil,
      Metadata: { 'pulpo-job-id': jobId, 'pulpo-recipient': recipientFingerprint },
    }))
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
