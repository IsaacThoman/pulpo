import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { BlobMetadata, BlobStore } from './blob-store.js'

export interface S3BlobStoreOptions {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

export class S3BlobStore implements BlobStore {
  private readonly client: S3Client

  constructor(private readonly options: S3BlobStoreOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    })
  }

  async put(key: string, body: Uint8Array, metadata: BlobMetadata): Promise<void> {
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

  async get(key: string): Promise<Uint8Array> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }))
    if (!result.Body) throw new Error('Object body is empty')
    return result.Body.transformToByteArray()
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }))
  }

  createUploadUrl(key: string, metadata: BlobMetadata, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      ContentType: metadata.contentType,
      ContentLength: metadata.contentLength,
    }), { expiresIn: expiresInSeconds })
  }

  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.options.bucket, Key: key }), { expiresIn: expiresInSeconds })
  }
}
