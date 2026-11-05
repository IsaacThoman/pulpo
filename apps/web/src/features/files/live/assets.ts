import { liveAssetHash, type LiveAssetRef, type LiveAssetStore } from '@pulpo/client-core/office'
import { fetchApiBlobResponse } from '@/lib/api'

/**
 * A live document's assets as the web app reaches them: fetched from the server by hash (and
 * kept for the page's lifetime, since a hash always means the same bytes), and uploaded when an
 * editor adds one.
 */
export class ApiLiveAssetStore implements LiveAssetStore {
  private readonly cache = new Map<string, Promise<Uint8Array>>()
  private readonly docId: string

  constructor(docId: string) {
    this.docId = docId
  }

  async put(bytes: Uint8Array, mimeType: string): Promise<LiveAssetRef> {
    const hash = await liveAssetHash(bytes)
    const response = await fetchApiBlobResponse(`/api/files/${this.docId}/assets?type=${encodeURIComponent(mimeType)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes as Uint8Array<ArrayBuffer>,
    })
    const ref = await response.json() as LiveAssetRef
    if (ref.hash !== hash) throw new Error('The server stored different bytes')
    this.cache.set(hash, Promise.resolve(bytes.slice()))
    return ref
  }

  get(hash: string): Promise<Uint8Array> {
    let pending = this.cache.get(hash)
    if (!pending) {
      pending = fetchApiBlobResponse(`/api/files/${this.docId}/assets/${hash}`)
        .then(async (response) => new Uint8Array(await response.arrayBuffer()))
      // A failure is not remembered, so a later read can try again.
      pending.catch(() => this.cache.delete(hash))
      this.cache.set(hash, pending)
    }
    return pending.then((bytes) => bytes.slice())
  }
}
