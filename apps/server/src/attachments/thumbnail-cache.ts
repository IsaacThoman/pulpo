import { createUploadQueue } from '@pulpo/client-core'
import { AppError } from '../lib/errors.js'

/** Lazy sources: queued requests hold metadata, never open object streams. */
export class ThumbnailCache {
  private cached = new Map<string, Buffer>()
  private pending = new Map<string, Promise<Buffer>>()
  private bytes = 0
  private enqueue = createUploadQueue(2)
  constructor(private maxBytes = 32 * 1024 * 1024, private maxPending = 64) {}

  get(key: string, render: () => Promise<Buffer>): Promise<Buffer> {
    const hit = this.cached.get(key)
    if (hit) {
      this.cached.delete(key); this.cached.set(key, hit)
      return Promise.resolve(hit)
    }
    const existing = this.pending.get(key)
    if (existing) return existing
    if (this.pending.size >= this.maxPending) throw new AppError(503, 'attachment_busy', 'Image previews are busy. Please retry shortly.', 'server_error')
    const work = this.enqueue(async () => {
      const data = await render()
      if (data.byteLength <= this.maxBytes) {
        this.cached.set(key, data); this.bytes += data.byteLength
        while (this.bytes > this.maxBytes) {
          const oldest = this.cached.entries().next().value!
          this.cached.delete(oldest[0]); this.bytes -= oldest[1].byteLength
        }
      }
      return data
    }).finally(() => { this.pending.delete(key) })
    this.pending.set(key, work)
    return work
  }
}
