import type * as Y from 'yjs'
import type { LiveAssetRef, LiveAssetStore } from './live-format.js'
import { LiveFormatError } from './live-format.js'

/** Lower-case hex SHA-256, the address of a live document's binary part. */
export async function liveAssetHash(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('SHA-256 is not available in this runtime')
  const digest = await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Whether `value` looks like an asset address, so routes and stores can refuse anything else. */
export function isLiveAssetHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}

/**
 * Keeps assets in memory: for tests, for codecs run on a scratch document (diffs, previews), and
 * for clients that import a file locally before it has a home on the server.
 */
export class MemoryLiveAssetStore implements LiveAssetStore {
  private readonly assets = new Map<string, { bytes: Uint8Array; ref: LiveAssetRef }>()

  async put(bytes: Uint8Array, mimeType: string): Promise<LiveAssetRef> {
    const hash = await liveAssetHash(bytes)
    const existing = this.assets.get(hash)
    if (existing) return existing.ref
    const ref = { hash, mimeType, sizeBytes: bytes.byteLength }
    this.assets.set(hash, { bytes: bytes.slice(), ref })
    return ref
  }

  async get(hash: string): Promise<Uint8Array> {
    const asset = this.assets.get(hash)
    if (!asset) throw new LiveFormatError('corrupt', `The document refers to a missing part (${hash.slice(0, 12)})`)
    return asset.bytes.slice()
  }

  /** Every stored asset, e.g. to upload them once the document exists on the server. */
  list(): LiveAssetRef[] {
    return [...this.assets.values()].map((asset) => asset.ref)
  }
}

/**
 * Runs `change` in one transaction with `origin` and tells whether it changed the document.
 * State vectors cannot tell: they count insertions only, so a deletion leaves them as they were.
 */
export function transactChanges(doc: Y.Doc, change: () => void, origin?: unknown): boolean {
  let changed = false
  const onUpdate = () => { changed = true }
  doc.on('update', onUpdate)
  try {
    doc.transact(change, origin)
  } finally {
    doc.off('update', onUpdate)
  }
  return changed
}
