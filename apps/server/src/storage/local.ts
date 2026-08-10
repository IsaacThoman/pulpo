import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import type { BlobMetadata, BlobStore } from './blob-store.js'

export class LocalBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const resolved = path.resolve(this.root, key)
    const root = path.resolve(this.root) + path.sep
    if (!resolved.startsWith(root)) throw new Error('Invalid object key')
    return resolved
  }

  async put(key: string, body: Uint8Array, _metadata: BlobMetadata): Promise<void> {
    const target = this.resolve(key)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, body)
  }

  async putStream(key: string, body: Readable, _metadata: BlobMetadata): Promise<void> {
    const target = this.resolve(key)
    const temporary = `${target}.${randomUUID()}.upload`
    await mkdir(path.dirname(target), { recursive: true })
    try {
      await pipeline(body, createWriteStream(temporary, { flags: 'wx' }))
      await rename(temporary, target)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async get(key: string): Promise<Uint8Array> {
    return readFile(this.resolve(key))
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.resolve(key))
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true })
  }

  async createUploadUrl(key: string): Promise<string> {
    return `/api/attachments/local-upload/${encodeURIComponent(key)}`
  }

  async createDownloadUrl(key: string): Promise<string> {
    return `/api/attachments/local-download/${encodeURIComponent(key)}`
  }
}
