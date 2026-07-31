export interface BlobMetadata {
  contentType: string
  contentLength?: number
  checksum?: string
  contentDisposition?: string
}

export interface BlobStore {
  put(key: string, body: Uint8Array, metadata: BlobMetadata): Promise<void>
  get(key: string): Promise<Uint8Array>
  delete(key: string): Promise<void>
  createUploadUrl(key: string, metadata: BlobMetadata, expiresInSeconds: number): Promise<string>
  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string>
}
