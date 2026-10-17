import { SocketIOYProvider, type DocPersistence } from '@pulpo/client-core/doc-sync'
import * as Y from 'yjs'
import type { DocStore } from './store'

/** How long updates gather before one write; a closing session writes at once. */
const WRITE_DELAY_MS = 250

/**
 * Keeps a document's Y.Doc in the device's SQLite copy: loads it on open, appends every later
 * update, and flags edits made here (anything not from the server) as unsynced.
 */
export class SqliteDocPersistence implements DocPersistence {
  readonly whenLoaded: Promise<void>
  /** Whether the stored copy had content, i.e. the document can be read offline. */
  hadCopy = false
  /**
   * The stored copy (if any) is in the document. Until then, the document may lack edits only this
   * device has, so being in sync with the server says nothing about them.
   */
  ready = false
  private pending: Uint8Array[] = []
  private pendingLocal = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private loaded = false
  private destroyed = false
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly store: DocStore,
    private readonly namespace: string,
    private readonly docId: string,
    private readonly doc: Y.Doc,
    private readonly schemaVersion: number,
  ) {
    doc.on('update', this.onUpdate)
    this.whenLoaded = store.load(namespace, docId).then(async (stored) => {
      if (this.destroyed) return
      // Schemas only grow, so a copy an earlier version of the app stored still fits. One from a
      // newer version (after a downgrade) may hold content this editor would drop: it is discarded.
      if (stored.schemaVersion !== null && stored.schemaVersion > schemaVersion) {
        await store.remove(namespace, docId)
        return
      }
      this.hadCopy = stored.update !== null
      if (stored.update) Y.applyUpdate(doc, stored.update, this)
      this.ready = !this.destroyed
    }).catch(() => undefined).finally(() => {
      this.loaded = true
      // Updates that arrived while loading (from the server) are written now.
      if (this.pending.length) this.schedule()
    })
  }

  get origin(): unknown {
    return this
  }

  /** Writes what is pending now; resolves once it is stored. */
  flush(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (!this.loaded || !this.pending.length) return this.tail
    const updates = this.pending
    const local = this.pendingLocal
    this.pending = []
    this.pendingLocal = false
    const doc = this.doc
    this.tail = this.store.append(this.namespace, this.docId, updates, {
      local,
      schemaVersion: this.schemaVersion,
      snapshot: () => Y.encodeStateAsUpdate(doc),
    }).catch(() => undefined)
    return this.tail
  }

  /**
   * The server has everything; called by the session once it reports synced. Ignored before the
   * stored copy is in the document: its edits reach the server only through the next handshake.
   */
  markSynced(): Promise<void> {
    if (!this.ready || this.destroyed) return this.tail
    // After pending writes, so an earlier local edit cannot set the flag again afterwards.
    void this.flush()
    this.tail = this.tail.then(() => this.store.markSynced(this.namespace, this.docId)).catch(() => undefined)
    return this.tail
  }

  destroy(): Promise<void> {
    if (this.destroyed) return this.tail
    const result = this.flush()
    this.destroyed = true
    this.doc.off('update', this.onUpdate)
    return result
  }

  private schedule(): void {
    if (this.timer === undefined) this.timer = setTimeout(() => { void this.flush() }, WRITE_DELAY_MS)
  }

  private readonly onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.destroyed) return
    this.pending.push(update)
    // The server's updates are cached for offline reading; everything else is an edit made here.
    if (!(origin instanceof SocketIOYProvider)) this.pendingLocal = true
    if (this.loaded) this.schedule()
  }
}
