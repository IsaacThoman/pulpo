import { DocSessionController, type DocSocket, type DocSyncStatus } from '@pulpo/client-core/doc-sync'
import * as Y from 'yjs'
import { SqliteDocPersistence } from './persistence'
import type { DocStore } from './store'

/** A closed document stays connected this long, at most, to finish uploading its edits. */
export const LINGER_MS = 30_000
/** How long a background flush waits for one document before moving on. */
const FLUSH_TIMEOUT_MS = 20_000

export interface DocHandle {
  readonly docId: string
  readonly controller: DocSessionController
  readonly persistence: SqliteDocPersistence
  release(): void
}

interface Entry {
  docId: string
  controller: DocSessionController
  persistence: SqliteDocPersistence
  users: number
  lingerTimer?: ReturnType<typeof setTimeout>
  /** Replaced by a fresh session (see `restart`); closes once its last user lets go. */
  stale: boolean
  unsubscribe: () => void
}

/** Nothing more will happen without a new join: in sync, closed, or failed (rate limits retry). */
function settled(status: DocSyncStatus): boolean {
  return status.state === 'synced' || status.state === 'closed' || (status.state === 'error' && status.error !== 'rate_limited')
}

/** Whether an entry has nothing left to upload: settled, with this device's copy in the document. */
function done(entry: Entry): boolean {
  return entry.persistence.ready && settled(entry.controller.getSnapshot().status)
}

/**
 * The open documents of one account on this device. Every view of a document shares one session
 * (one Y.Doc, provider, and room membership), so two editors never fight over the socket's room.
 * Released sessions linger until their edits are uploaded; on reconnect, copies with unsynced
 * edits that are not open are opened in the background just long enough to upload them.
 */
export class DocSessionRegistry {
  private readonly entries = new Map<string, Entry>()
  private socket: DocSocket | null = null
  private destroyed = false
  private flushing: Promise<void> | null = null
  /**
   * Documents the server said are gone (deleted, or in the trash) since the app started. Their
   * unsynced copies are kept, in case the document comes back, but not retried on every reconnect.
   */
  private readonly unreachable = new Set<string>()
  /** Sessions replaced by `restart` that still have views, by document. */
  private readonly replaced = new Map<string, Set<Entry>>()

  constructor(
    private readonly namespace: string,
    private readonly store: DocStore,
    private readonly schemaVersion: number,
  ) {}

  acquire(docId: string, options: { background?: boolean } = {}): DocHandle {
    if (this.destroyed) throw new Error('The account signed out')
    const id = docId.toLowerCase()
    // Opening a document on purpose tries it again, e.g. after it was restored.
    if (!options.background) this.unreachable.delete(id)
    let entry = this.entries.get(id)
    if (!entry) entry = this.open(id)
    if (entry.lingerTimer !== undefined) clearTimeout(entry.lingerTimer)
    entry.lingerTimer = undefined
    entry.users += 1
    const current = entry
    let released = false
    return {
      docId: id,
      controller: current.controller,
      persistence: current.persistence,
      release: () => {
        if (released) return
        released = true
        this.release(current)
      },
    }
  }

  /**
   * Starts a document's session over, e.g. after it was restored from the trash or failed: the
   * current one leaves the document at once and closes when its views let go; the next `acquire`
   * opens a new one.
   */
  restart(docId: string): void {
    const id = docId.toLowerCase()
    const entry = this.entries.get(id)
    this.unreachable.delete(id)
    if (!entry) return
    this.entries.delete(id)
    entry.stale = true
    const replaced = this.replaced.get(id) ?? new Set<Entry>()
    replaced.add(entry)
    this.replaced.set(id, replaced)
    // Leave the room before the new session joins it on the same socket.
    entry.controller.attach(null)
    if (entry.users === 0) void this.close(entry)
  }

  /** Switches every session to the account's current socket (or none). */
  attach(socket: DocSocket | null): void {
    this.socket = socket
    for (const entry of this.entries.values()) entry.controller.attach(socket)
  }

  /** Uploads unsynced edits of documents that are not open. Safe to call repeatedly. */
  flushDirty(): Promise<void> {
    if (this.destroyed) return Promise.resolve()
    this.flushing ??= (async () => {
      try {
        const ids = await this.store.dirtyDocIds(this.namespace)
        for (const docId of ids) {
          if (this.destroyed || !this.socket?.connected) return
          if (this.entries.has(docId) || this.unreachable.has(docId)) continue
          const handle = this.acquire(docId, { background: true })
          try {
            await this.uploadWhenLoaded(handle, FLUSH_TIMEOUT_MS)
          } finally {
            handle.release()
          }
        }
      } catch {
        // The next reconnect tries again.
      } finally {
        this.flushing = null
      }
    })()
    return this.flushing
  }

  openDocIds(): string[] {
    return [...this.entries.keys()]
  }

  /** Signs out: closes every session, writing what is pending. */
  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    const entries = [...this.entries.values()]
    this.entries.clear()
    await Promise.all(entries.map((entry) => this.close(entry)))
  }

  private open(docId: string): Entry {
    let persistence!: SqliteDocPersistence
    const controller = new DocSessionController({
      docId,
      schemaVersion: this.schemaVersion,
      persistence: (doc) => {
        persistence = new SqliteDocPersistence(this.store, this.namespace, docId, doc, this.schemaVersion)
        return persistence
      },
    })
    const entry: Entry = { docId, controller, persistence, users: 0, stale: false, unsubscribe: () => {} }
    let previous = controller.getSnapshot().status
    entry.unsubscribe = controller.subscribe(() => {
      const { status } = controller.getSnapshot()
      if (status === previous) return
      previous = status
      // While a replaced session of the document is open, edits only it has may be on the device:
      // the copy stays flagged until they are merged here (see `close`).
      if (status.state === 'synced' && !this.replaced.has(docId)) void persistence.markSynced()
      // The server answers a trashed document as not found, so "deleted" may only mean trashed:
      // a copy with edits not uploaded yet is kept for when it is restored.
      if (status.state === 'closed' && (status.reason === 'deleted' || status.reason === 'trashed')) {
        this.unreachable.add(docId)
        if (status.reason === 'deleted') void persistence.whenLoaded.then(() => this.store.removeIfClean(this.namespace, docId)).catch(() => undefined)
      }
      if (entry.users === 0 && !entry.stale && done(entry)) this.closeSoon(entry, 0)
    })
    controller.attach(this.socket)
    this.entries.set(docId, entry)
    return entry
  }

  private release(entry: Entry): void {
    entry.users -= 1
    if (entry.users > 0) return
    if (entry.stale) {
      void this.close(entry)
      return
    }
    if (this.entries.get(entry.docId) !== entry) return
    this.closeSoon(entry, done(entry) ? 0 : LINGER_MS)
  }

  private closeSoon(entry: Entry, delay: number): void {
    if (entry.lingerTimer !== undefined) clearTimeout(entry.lingerTimer)
    entry.lingerTimer = setTimeout(() => {
      if (entry.users > 0 || this.entries.get(entry.docId) !== entry) return
      this.entries.delete(entry.docId)
      void this.close(entry).then(() => this.store.evict(this.namespace, this.openDocIds())).catch(() => undefined)
    }, delay)
  }

  private async close(entry: Entry): Promise<void> {
    if (entry.lingerTimer !== undefined) clearTimeout(entry.lingerTimer)
    entry.unsubscribe()
    // Leave the document at once, so a session opened for it meanwhile keeps the socket's room.
    entry.controller.attach(null)
    await entry.persistence.whenLoaded
    await entry.persistence.flush()
    if (entry.stale) this.mergeReplaced(entry)
    // Fold the log into one snapshot while the document is in memory, but only when it holds
    // this device's copy; otherwise the snapshot would replace stored edits it lacks.
    const state = entry.persistence.ready ? Y.encodeStateAsUpdate(entry.controller.doc) : null
    entry.controller.destroy()
    if (state) await this.store.compact(this.namespace, entry.docId, state, this.schemaVersion).catch(() => undefined)
  }

  /**
   * A replaced session is closing: anything typed in it after it was replaced reaches the server
   * through the session that replaced it (merging is idempotent), which then shakes hands again so
   * the copy can be marked in sync once that is confirmed.
   */
  private mergeReplaced(entry: Entry): void {
    const replaced = this.replaced.get(entry.docId)
    replaced?.delete(entry)
    if (replaced && !replaced.size) this.replaced.delete(entry.docId)
    const current = this.entries.get(entry.docId)
    if (!current || this.destroyed) return
    Y.applyUpdate(current.controller.doc, Y.encodeStateAsUpdate(entry.controller.doc))
    if (!this.replaced.has(entry.docId)) current.controller.provider.resync()
  }

  /**
   * Waits until a document's stored copy is loaded and a handshake made after that settled, so
   * whatever the copy holds reached the server (or the server said where it stands).
   */
  private async uploadWhenLoaded(handle: DocHandle, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    const timeout = <T>(promise: Promise<T>, ms: number) => Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, ms))])
    await timeout(handle.persistence.whenLoaded, timeoutMs)
    if (!handle.persistence.ready) return
    const { controller } = handle
    const before = controller.getSnapshot().status
    if (settled(before) && before.state !== 'synced') return
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        unsubscribe()
        resolve()
      }
      const timer = setTimeout(finish, Math.max(0, deadline - Date.now()))
      const unsubscribe = controller.subscribe(() => {
        const { status } = controller.getSnapshot()
        if (status !== before && settled(status)) finish()
      })
      // A fresh handshake: one made before the copy loaded did not include it.
      controller.provider.resync()
    })
  }
}

const registries = new Map<string, DocSessionRegistry>()

/** The account's registry, created on first use. */
export function docSessions(namespace: string, create: () => DocSessionRegistry): DocSessionRegistry {
  let registry = registries.get(namespace)
  if (!registry) {
    registry = create()
    registries.set(namespace, registry)
  }
  return registry
}

/** Signs an account out of its documents. */
export async function closeDocSessions(namespace: string): Promise<void> {
  const registry = registries.get(namespace)
  registries.delete(namespace)
  await registry?.destroy()
}
