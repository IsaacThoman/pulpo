import * as Y from 'yjs'
import { DOC_FRAGMENT_NAME } from '../doc-schema/version.js'
import { presencePeers, samePeers, type PresencePeer } from './presence.js'
import { SocketIOYProvider, type DocSocket, type DocSyncStatus } from './provider.js'

/** A device's own copy of a document, e.g. IndexedDB on the web or SQLite on mobile. */
export interface DocPersistence {
  /** Resolves once the stored copy has been applied to the document, or there was none. */
  readonly whenLoaded: Promise<void>
  /**
   * The origin the store applies its stored updates with. Those are not edits made here, so the
   * provider does not send them on their own; the next join's handshake includes them.
   */
  readonly origin: unknown
  destroy(): void | Promise<void>
}

export interface DocSessionOptions {
  docId: string
  /** Opens the local copy for the session's document. */
  persistence: (doc: Y.Doc) => DocPersistence
  /** Waits this long for the local copy before joining without it; late loads trigger a resync. */
  cacheWaitMs?: number
  /** See `SocketIOYProviderOptions.schemaVersion`. */
  schemaVersion?: number
}

export interface DocSession {
  doc: Y.Doc
  provider: SocketIOYProvider
  /** Set before the editor mounts, so its default empty paragraph is never mistaken for cache. */
  hasCachedContent?: boolean
}

export interface DocSessionSnapshot {
  /**
   * The session, once the local copy or the server has loaded. An editor must not mount before
   * then: it would create default content, and a late empty cache stays empty.
   */
  session: DocSession | null
  status: DocSyncStatus
  peers: PresencePeer[]
}

export const LOCAL_CACHE_WAIT_MS = 1_500

/**
 * Owns the Y.Doc, its local copy, and the realtime provider for one open document. Networking
 * starts once the local copy has loaded (so the handshake uploads edits made offline) or after
 * `cacheWaitMs`, whichever comes first.
 */
export class DocSessionController {
  readonly doc = new Y.Doc()
  readonly provider: SocketIOYProvider
  private readonly persistence: DocPersistence
  private readonly listeners = new Set<() => void>()
  private readonly timer: ReturnType<typeof setTimeout>
  private socket: DocSocket | null = null
  private started: DocSession | null = null
  private ready = false
  private destroyed = false
  private joinedBeforeCache = false
  private snapshot: DocSessionSnapshot = { session: null, status: { state: 'connecting' }, peers: [] }

  constructor({ docId, persistence, cacheWaitMs = LOCAL_CACHE_WAIT_MS, schemaVersion }: DocSessionOptions) {
    this.persistence = persistence(this.doc)
    this.provider = new SocketIOYProvider(docId, this.doc, { ignoredOrigins: [this.persistence.origin], schemaVersion })
    this.provider.onStatus((status) => {
      if (status.state === 'synced') this.ready = true
      this.publish({ status })
    })
    // The editor sets this session's awareness while it renders; update the list afterwards.
    this.provider.awareness.on('change', this.onAwareness)
    this.timer = setTimeout(() => {
      this.joinedBeforeCache = true
      this.start()
    }, cacheWaitMs)
    void this.persistence.whenLoaded.then(() => {
      if (this.destroyed) return
      clearTimeout(this.timer)
      this.ready = true
      this.start()
      if (this.joinedBeforeCache) this.provider.resync()
    })
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): DocSessionSnapshot => this.snapshot

  /** Switches to the account's current socket, or none while signed out or reconnecting. */
  attach(socket: DocSocket | null): void {
    this.socket = socket
    if (this.started && !this.destroyed) this.provider.attach(socket)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    clearTimeout(this.timer)
    this.provider.awareness.off('change', this.onAwareness)
    this.provider.destroy()
    void this.persistence.destroy()
    this.doc.destroy()
    this.listeners.clear()
  }

  private start(): void {
    if (this.destroyed) return
    this.started = { doc: this.doc, provider: this.provider, hasCachedContent: this.doc.getXmlFragment(DOC_FRAGMENT_NAME).length > 0 }
    this.provider.attach(this.socket)
    this.publish({})
  }

  private readonly onAwareness = () => queueMicrotask(() => {
    if (this.destroyed) return
    const peers = presencePeers(this.provider.awareness, this.doc.clientID)
    // Keep the list when nothing visible changed, e.g. this session's own cursor moving.
    if (!samePeers(this.snapshot.peers, peers)) this.publish({ peers })
  })

  private publish(change: Partial<Omit<DocSessionSnapshot, 'session'>>): void {
    if (this.destroyed) return
    const session = this.ready ? this.started : null
    const next = { ...this.snapshot, ...change, session }
    if (next.session === this.snapshot.session && next.status === this.snapshot.status && next.peers === this.snapshot.peers) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}
