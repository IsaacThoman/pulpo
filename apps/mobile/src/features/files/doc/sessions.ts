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
  unsubscribe: () => void
}

function settled(status: DocSyncStatus): boolean {
  return status.state === 'synced' || status.state === 'closed' || status.state === 'error'
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

  constructor(
    private readonly namespace: string,
    private readonly store: DocStore,
    private readonly schemaVersion: number,
  ) {}

  acquire(docId: string): DocHandle {
    if (this.destroyed) throw new Error('The account signed out')
    const id = docId.toLowerCase()
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
          if (this.entries.has(docId)) continue
          const handle = this.acquire(docId)
          await this.waitUntilSettled(handle.controller, FLUSH_TIMEOUT_MS)
          handle.release()
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
    const entry: Entry = { docId, controller, persistence, users: 0, unsubscribe: () => {} }
    let previous = controller.getSnapshot().status
    entry.unsubscribe = controller.subscribe(() => {
      const { status } = controller.getSnapshot()
      if (status === previous) return
      previous = status
      if (status.state === 'synced') void persistence.markSynced()
      // A permanently deleted document's copy has nowhere to go.
      if (status.state === 'closed' && status.reason === 'deleted') void persistence.destroy().then(() => this.store.remove(this.namespace, docId))
      if (entry.users === 0 && settled(status)) this.closeSoon(entry, 0)
    })
    controller.attach(this.socket)
    this.entries.set(docId, entry)
    return entry
  }

  private release(entry: Entry): void {
    entry.users -= 1
    if (entry.users > 0 || this.entries.get(entry.docId) !== entry) return
    this.closeSoon(entry, settled(entry.controller.getSnapshot().status) ? 0 : LINGER_MS)
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
    await entry.persistence.whenLoaded
    await entry.persistence.flush()
    // Fold the log into one snapshot while the document is still in memory.
    const state = Y.encodeStateAsUpdate(entry.controller.doc)
    entry.controller.destroy()
    await this.store.compact(this.namespace, entry.docId, state, this.schemaVersion).catch(() => undefined)
  }

  private waitUntilSettled(controller: DocSessionController, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        unsubscribe()
        resolve()
      }
      const timer = setTimeout(done, timeoutMs)
      const unsubscribe = controller.subscribe(() => {
        if (settled(controller.getSnapshot().status)) done()
      })
      if (settled(controller.getSnapshot().status)) done()
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
