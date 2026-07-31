import { getConfig } from '../config.js'
import type { BlobStore } from './blob-store.js'
import { LocalBlobStore } from './local.js'
import { S3BlobStore } from './s3.js'

let store: BlobStore | undefined

export function getBlobStore(): BlobStore {
  const config = getConfig()
  store ??= config.STORAGE_DRIVER === 's3'
    ? new S3BlobStore({
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        bucket: config.S3_BUCKET,
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
        forcePathStyle: config.S3_FORCE_PATH_STYLE,
      })
    : new LocalBlobStore(config.STORAGE_LOCAL_PATH)
  return store
}
