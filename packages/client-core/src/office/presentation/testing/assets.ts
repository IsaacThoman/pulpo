import { createHash } from 'node:crypto'
import type { LiveAssetStore } from '../../live-format.js'

/** An in-memory asset store for tests. */
export function memoryAssets(): LiveAssetStore & { size(): number } {
  const store = new Map<string, Uint8Array>()
  return {
    async put(bytes, mimeType) {
      const hash = createHash('sha256').update(bytes).digest('hex')
      store.set(hash, bytes)
      return { hash, mimeType, sizeBytes: bytes.byteLength }
    },
    async get(hash) {
      const bytes = store.get(hash)
      if (!bytes) throw new Error(`Missing asset ${hash}`)
      return bytes
    },
    size: () => store.size,
  }
}
