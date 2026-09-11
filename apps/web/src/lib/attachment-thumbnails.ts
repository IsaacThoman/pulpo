import { createUploadQueue, retryBusyUpload } from '@pulpo/client-core'
import { fetchApiBlob } from './api'

const enqueue = createUploadQueue(2)
const cached = new Map<string, Blob>()
const pending = new Map<string, { work: Promise<Blob>; signals: Set<AbortSignal> }>()
let bytes = 0
const MAX_BYTES = 16 * 1024 * 1024

export function loadAttachmentThumbnail(account: string, id: string, signal: AbortSignal): Promise<Blob> {
  const key = `${account}:${id}`
  const hit = cached.get(key)
  if (hit) { cached.delete(key); cached.set(key, hit); return Promise.resolve(hit) }
  const existing = pending.get(key)
  if (existing) { existing.signals.add(signal); return existing.work }
  const signals = new Set([signal])
  const work = enqueue(async () => {
    const blob = await retryBusyUpload(() => {
      if ([...signals].every((value) => value.aborted)) throw new DOMException('Preview no longer visible', 'AbortError')
      return fetchApiBlob(`/api/attachments/${id}/thumbnail`)
    })
    if (blob.size <= MAX_BYTES) {
      cached.set(key, blob); bytes += blob.size
      while (bytes > MAX_BYTES) {
        const oldest = cached.entries().next().value!
        cached.delete(oldest[0]); bytes -= oldest[1].size
      }
    }
    return blob
  }).finally(() => { if (pending.get(key)?.work === work) pending.delete(key) })
  pending.set(key, { work, signals })
  return work
}
