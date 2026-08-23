import { S3Client } from '@aws-sdk/client-s3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { S3BlobStore } from './s3.js'

afterEach(() => vi.restoreAllMocks())

describe('S3BlobStore initialization', () => {
  it('retries initialization after a transient object-store failure', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send')
      .mockRejectedValueOnce(new Error('head unavailable'))
      .mockRejectedValueOnce(new Error('create unavailable'))
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({} as never)
    const store = new S3BlobStore({
      endpoint: 'http://storage.test',
      region: 'us-east-1',
      bucket: 'pulpo',
      accessKeyId: 'pulpo',
      secretAccessKey: 'secret',
      forcePathStyle: true,
    })
    const metadata = { contentType: 'text/plain', contentLength: 2 }

    await expect(store.put('first', Buffer.from('hi'), metadata)).rejects.toThrow('create unavailable')
    await expect(store.put('second', Buffer.from('hi'), metadata)).resolves.toBeUndefined()

    expect(send).toHaveBeenCalledTimes(4)
  })
})
