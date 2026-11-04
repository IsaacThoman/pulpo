import type { LiveAssetRef, LiveAssetStore } from './live-format.js'

/** Lower-case hex SHA-256 of bytes (Web Crypto: Node 19+ and browsers). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A LiveAssetStore kept in memory: for tests, previews, and conversions without a server. */
export class MemoryAssetStore implements LiveAssetStore {
  readonly assets = new Map<string, { bytes: Uint8Array; mimeType: string }>()

  async put(bytes: Uint8Array, mimeType: string): Promise<LiveAssetRef> {
    const hash = await sha256Hex(bytes)
    if (!this.assets.has(hash)) this.assets.set(hash, { bytes: bytes.slice(), mimeType })
    return { hash, mimeType, sizeBytes: bytes.byteLength }
  }

  async get(hash: string): Promise<Uint8Array> {
    const asset = this.assets.get(hash)
    if (!asset) throw new Error(`Unknown asset ${hash}`)
    return asset.bytes
  }
}
