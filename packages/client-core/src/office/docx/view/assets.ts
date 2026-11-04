import type { LiveAssetStore } from '../../live-format.js'
import { sniffImage } from '../export.js'

/** Formats browsers can draw; others (EMF, WMF, TIFF) show a placeholder. */
const DRAWABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp', 'image/svg+xml'])

/**
 * Object URLs for a document's images, fetched once per hash and revoked with the editor. SVG
 * is shown through `<img>`, which never runs its scripts.
 */
export class AssetUrls {
  private readonly urls = new Map<string, Promise<string | null>>()
  private readonly created: string[] = []

  constructor(private readonly assets: LiveAssetStore) {}

  url(hash: string): Promise<string | null> {
    let url = this.urls.get(hash)
    if (!url) {
      url = this.assets.get(hash).then((bytes) => {
        const { mimeType } = sniffImage(bytes)
        if (!DRAWABLE.has(mimeType) || typeof URL.createObjectURL !== 'function') return null
        const objectUrl = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }))
        this.created.push(objectUrl)
        return objectUrl
      }, () => null)
      this.urls.set(hash, url)
    }
    return url
  }

  destroy(): void {
    for (const url of this.created) URL.revokeObjectURL(url)
    this.created.length = 0
    this.urls.clear()
  }
}
