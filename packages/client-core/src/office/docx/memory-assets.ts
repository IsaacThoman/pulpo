import type { LiveAssetRef, LiveAssetStore } from '../live-format.js'

/**
 * A LiveAssetStore in memory: for tests, previews, and editors without a server (the harness).
 * Hashes are SHA-256 like the server's, so models built here export anywhere.
 */
export class MemoryAssetStore implements LiveAssetStore {
  readonly assets = new Map<string, { bytes: Uint8Array; mimeType: string }>()

  async put(bytes: Uint8Array, mimeType: string): Promise<LiveAssetRef> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    if (!this.assets.has(hash)) this.assets.set(hash, { bytes: bytes.slice(), mimeType })
    return { hash, mimeType, sizeBytes: bytes.byteLength }
  }

  async get(hash: string): Promise<Uint8Array> {
    const asset = this.assets.get(hash)
    if (!asset) throw new Error(`Unknown asset ${hash}`)
    return asset.bytes
  }

  mimeType(hash: string): string | undefined {
    return this.assets.get(hash)?.mimeType
  }
}
