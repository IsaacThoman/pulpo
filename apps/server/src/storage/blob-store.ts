export interface BlobMetadata {
  contentType: string
  contentLength?: number
  checksum?: string
  contentDisposition?: string
}

export interface BlobStore {
  put(key: string, body: Uint8Array, metadata: BlobMetadata): Promise<void>
  putStream(key: string, body: Readable, metadata: BlobMetadata): Promise<void>
  get(key: string): Promise<Uint8Array>
  /** Streams the object, or only the inclusive byte range when one is given. */
  getStream(key: string, range?: BlobByteRange): Promise<Readable>
  delete(key: string): Promise<void>
  /** Duplicates an object within the store without routing its bytes through the API. */
  copy(sourceKey: string, targetKey: string): Promise<void>
  createUploadUrl(key: string, metadata: BlobMetadata, expiresInSeconds: number): Promise<string>
  createDownloadUrl(key: string, expiresInSeconds: number, options?: BlobDownloadOptions): Promise<string>
}

export interface BlobDownloadOptions {
  /** Content-Disposition for the response, where the driver can set it on a signed URL. */
  contentDisposition?: string
  /** Content-Type for the response, where the driver can override the stored type on a signed URL. */
  contentType?: string
}

export interface BlobByteRange {
  start: number
  /** Inclusive. */
  end: number
}
import type { Readable } from 'node:stream'
