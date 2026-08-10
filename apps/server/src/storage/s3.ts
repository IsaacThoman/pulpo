import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutBucketCorsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Readable } from 'node:stream'
import type { BlobMetadata, BlobStore } from './blob-store.js'

export interface S3BlobStoreOptions {
  endpoint: string
  publicEndpoint?: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
  corsOrigins?: string[]
}

export class S3BlobStore implements BlobStore {
  private readonly client: S3Client
  private readonly publicClient: S3Client
  private ready: Promise<void> | undefined

  constructor(private readonly options: S3BlobStoreOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
    this.publicClient = options.publicEndpoint ? new S3Client({
      endpoint: options.publicEndpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }) : this.client
  }

  private ensureReady(): Promise<void> {
    this.ready ??= this.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }))
      .then(() => undefined)
      .catch(async () => { await this.client.send(new CreateBucketCommand({ Bucket: this.options.bucket })) })
      .then(async () => {
        if (!this.options.corsOrigins) return
        await this.client.send(new PutBucketCorsCommand({
          Bucket: this.options.bucket,
          CORSConfiguration: { CORSRules: [{
            AllowedOrigins: this.options.corsOrigins, AllowedMethods: ['GET', 'PUT', 'HEAD'],
            AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3_600,
          }] },
        }))
      })
    return this.ready
  }

  async put(key: string, body: Uint8Array, metadata: BlobMetadata): Promise<void> {
    await this.ensureReady()
    await this.client.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      Body: body,
      ContentType: metadata.contentType,
      ContentLength: metadata.contentLength,
      ContentDisposition: metadata.contentDisposition,
      ChecksumSHA256: metadata.checksum,
    }))
  }

  async putStream(key: string, body: Readable, metadata: BlobMetadata): Promise<void> {
    await this.ensureReady()
    await this.client.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      Body: body,
      ContentType: metadata.contentType,
      ContentLength: metadata.contentLength,
      ContentDisposition: metadata.contentDisposition,
    }))
  }

  async get(key: string): Promise<Uint8Array> {
    await this.ensureReady()
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }))
    if (!result.Body) throw new Error('Object body is empty')
    return result.Body.transformToByteArray()
  }

  async getStream(key: string): Promise<Readable> {
    await this.ensureReady()
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }))
    if (!result.Body) throw new Error('Object body is empty')
    return Readable.from(result.Body as AsyncIterable<Uint8Array>, { objectMode: false })
  }

  async delete(key: string): Promise<void> {
    await this.ensureReady()
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }))
  }

  async createUploadUrl(key: string, metadata: BlobMetadata, expiresInSeconds: number): Promise<string> {
    await this.ensureReady()
    return getSignedUrl(this.publicClient, new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      ContentType: metadata.contentType,
      ContentLength: metadata.contentLength,
    }), { expiresIn: expiresInSeconds })
  }

  async createDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    await this.ensureReady()
    return getSignedUrl(this.publicClient, new GetObjectCommand({ Bucket: this.options.bucket, Key: key }), { expiresIn: expiresInSeconds })
  }
}
