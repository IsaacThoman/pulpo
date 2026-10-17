// @vitest-environment node
import { applyMarkdownToYDoc, ydocToMarkdown } from '@pulpo/client-core/doc-schema'
import type { DocSocket } from '@pulpo/client-core/doc-sync'
import { FakeServer, FakeSocket } from '@pulpo/client-core/doc-sync/testing'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createOperationQueue } from '../../../data/operationQueue'
import { MOBILE_SCHEMA } from '../../../data/schema'
import { DocSessionRegistry, LINGER_MS } from './sessions'
import { COMPACT_AFTER_UPDATES, DocStore, type DatabaseRunner, type DocDatabase } from './store'

const NAMESPACE = 'https://pulpo.test|user-1'
const DOC = '0B0C9C2E-6D2A-4C0B-9E8B-1F2D3C4B5A69'

/** Every database operation waits this long first, like a busy queue on a slow device. */
let databaseDelayMs = 0
/** Writes that fail before reaching the database, e.g. while the device is full. */
let failingWrites = 0

function sqlite() {
  const database = new DatabaseSync(':memory:')
  database.exec(MOBILE_SCHEMA)
  const adapter: DocDatabase = {
    runAsync: async (source, ...params) => database.prepare(source).run(...params),
    getFirstAsync: async <T,>(source: string, ...params: Array<string | number | Uint8Array | null>) => (database.prepare(source).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T,>(source: string, ...params: Array<string | number | Uint8Array | null>) => database.prepare(source).all(...params) as T[],
    withTransactionAsync: async (task) => {
      database.exec('BEGIN')
      try {
        await task()
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
  const queue = createOperationQueue()
  const failing: DocDatabase = {
    ...adapter,
    withTransactionAsync: async (task) => {
      if (failingWrites > 0) {
        failingWrites -= 1
        throw new Error('database or disk is full')
      }
      return adapter.withTransactionAsync(task)
    },
  }
  const run: DatabaseRunner = (operation) => queue(async () => {
    if (databaseDelayMs) await new Promise((resolve) => setTimeout(resolve, databaseDelayMs))
    return operation(failing)
  })
  return { database, store: new DocStore(run) }
}

function row(database: DatabaseSync) {
  return database.prepare('SELECT dirty, schema_version FROM file_docs WHERE namespace = ? AND doc_id = ?').get(NAMESPACE, DOC.toLowerCase()) as { dirty: number; schema_version: number } | undefined
}

/** Edits from an editor page are applied with the page's own origin (see EditorBridge). */
const EDITOR_ORIGIN = { editor: true }

/** An edit in the editor, as the bridge applies it. */
function type(doc: Y.Doc, markdown: string) {
  const editor = new Y.Doc()
  Y.applyUpdate(editor, Y.encodeStateAsUpdate(doc))
  applyMarkdownToYDoc(editor, markdown)
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(editor, Y.encodeStateVector(doc)), EDITOR_ORIGIN)
}

describe('document sessions on the device', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    databaseDelayMs = 0
    failingWrites = 0
  })
  afterEach(() => { vi.useRealTimers() })

  it('keeps offline edits across a relaunch and uploads them once a socket connects', async () => {
    const { database, store } = sqlite()
    const server = new FakeServer()
    const first = new DocSessionRegistry(NAMESPACE, store, 2)
    const handle = first.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(handle.controller.getSnapshot().status.state).toBe('offline')
    type(handle.controller.doc, '# Written offline')
    await vi.advanceTimersByTimeAsync(500)
    expect(row(database)).toMatchObject({ dirty: 1, schema_version: 2 })
    handle.release()
    await vi.advanceTimersByTimeAsync(LINGER_MS + 1_000)
    expect(first.openDocIds()).toEqual([])

    // The app relaunches; nothing is open when the socket connects.
    const second = new DocSessionRegistry(NAMESPACE, store, 2)
    const socket = new FakeSocket(server)
    second.attach(socket as unknown as DocSocket)
    const flushed = second.flushDirty()
    await vi.advanceTimersByTimeAsync(2_000)
    await flushed
    expect(ydocToMarkdown(server.doc).trim()).toBe('# Written offline')
    expect(row(database)?.dirty).toBe(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(second.openDocIds()).toEqual([])
  })

  it('caches what the server sends without marking it unsynced, and opens it offline later', async () => {
    const { database, store } = sqlite()
    const server = new FakeServer()
    applyMarkdownToYDoc(server.doc, 'From the server')
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    registry.attach(new FakeSocket(server) as unknown as DocSocket)
    const handle = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(handle.controller.getSnapshot().status.state).toBe('synced')
    expect(row(database)?.dirty).toBe(0)
    handle.release()
    await vi.advanceTimersByTimeAsync(100)

    const offline = new DocSessionRegistry(NAMESPACE, store, 2)
    const reopened = offline.acquire(DOC)
    await vi.advanceTimersByTimeAsync(0)
    const { session } = reopened.controller.getSnapshot()
    expect(session?.hasCachedContent).toBe(true)
    expect(ydocToMarkdown(reopened.controller.doc).trim()).toBe('From the server')
  })

  it('shares one session between views of a document, whatever the id casing', async () => {
    const { store } = sqlite()
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    const a = registry.acquire(DOC)
    const b = registry.acquire(DOC.toLowerCase())
    expect(a.controller).toBe(b.controller)
    a.release()
    await vi.advanceTimersByTimeAsync(LINGER_MS + 1)
    expect(registry.openDocIds()).toEqual([DOC.toLowerCase()])
    b.release()
  })

  it('keeps a closed document connected until its edits are acknowledged', async () => {
    const { database, store } = sqlite()
    const server = new FakeServer()
    const socket = new FakeSocket(server)
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    registry.attach(socket as unknown as DocSocket)
    const handle = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    socket.connected = false
    type(handle.controller.doc, 'Typed, then closed')
    handle.release()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(registry.openDocIds()).toEqual([DOC.toLowerCase()])
    socket.reconnect()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(ydocToMarkdown(server.doc).trim()).toBe('Typed, then closed')
    expect(registry.openDocIds()).toEqual([])
    expect(row(database)?.dirty).toBe(0)
  })

  it('forgets the copy of a permanently deleted document', async () => {
    const { database, store } = sqlite()
    const server = new FakeServer()
    const socket = new FakeSocket(server)
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    registry.attach(socket as unknown as DocSocket)
    const handle = registry.acquire(DOC)
    type(handle.controller.doc, 'Soon gone')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(row(database)).toBeDefined()
    socket.deliver('doc.closed', { docId: DOC.toLowerCase(), reason: 'deleted' })
    await vi.advanceTimersByTimeAsync(100)
    expect(handle.controller.getSnapshot().status).toEqual({ state: 'closed', reason: 'deleted' })
    expect(row(database)).toBeUndefined()
    handle.release()
  })

  it('compacts a long log into one snapshot and keeps unsynced copies when evicting', async () => {
    const { database, store } = sqlite()
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    const handle = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    for (let index = 0; index < COMPACT_AFTER_UPDATES + 5; index += 1) {
      type(handle.controller.doc, `Line ${index}`)
      await vi.advanceTimersByTimeAsync(300)
    }
    const updates = database.prepare('SELECT COUNT(*) AS count FROM file_doc_updates').get() as { count: number }
    expect(updates.count).toBeLessThan(COMPACT_AFTER_UPDATES)
    const reloaded = new Y.Doc()
    const stored = await store.load(NAMESPACE, DOC.toLowerCase())
    Y.applyUpdate(reloaded, stored.update!)
    expect(ydocToMarkdown(reloaded).trim()).toBe(`Line ${COMPACT_AFTER_UPDATES + 4}`)
    expect(await store.evict(NAMESPACE, [], 0)).toEqual([])
    handle.release()
  })

  it('discards a copy stored by a newer version of the app once the server has it', async () => {
    const { database, store } = sqlite()
    const newer = new DocSessionRegistry(NAMESPACE, store, 3)
    const handle = newer.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    type(handle.controller.doc, 'From a newer schema')
    await vi.advanceTimersByTimeAsync(500)
    await newer.destroy()
    await store.markSynced(NAMESPACE, DOC.toLowerCase())
    expect(row(database)).toMatchObject({ dirty: 0, schema_version: 3 })
    const older = new DocSessionRegistry(NAMESPACE, store, 2)
    const reopened = older.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(ydocToMarkdown(reopened.controller.doc).trim()).toBe('')
    expect(row(database)).toBeUndefined()
    reopened.release()
  })

  it('uploads offline edits even when the stored copy loads after the first handshake', async () => {
    const { database, store } = sqlite()
    const server = new FakeServer()
    const first = new DocSessionRegistry(NAMESPACE, store, 2)
    const handle = first.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    type(handle.controller.doc, '# Written offline')
    await vi.advanceTimersByTimeAsync(500)
    handle.release()
    await vi.advanceTimersByTimeAsync(LINGER_MS + 1_000)
    expect(row(database)?.dirty).toBe(1)

    // The app relaunches with a busy database: the copy loads after the session joined without it,
    // and the server answers only when the test lets it.
    class HeldAckSocket extends FakeSocket {
      held: Array<() => void> = []
      override emit(event: string, input: Parameters<FakeSocket['emit']>[1], ack?: (result: unknown) => void) {
        return super.emit(event, input, ack && ((result) => { this.held.push(() => ack(result)) }))
      }
      answer() {
        const held = this.held
        this.held = []
        for (const reply of held) reply()
      }
    }
    databaseDelayMs = 2_000
    const second = new DocSessionRegistry(NAMESPACE, store, 2)
    const socket = new HeldAckSocket(server)
    second.attach(socket as unknown as DocSocket)
    const flushed = second.flushDirty()
    await vi.advanceTimersByTimeAsync(2_100) // the dirty list is read; the copy starts loading
    await vi.advanceTimersByTimeAsync(1_500) // the cache wait passes; the session joins without it
    socket.answer() // the (empty) server document: synced, before the copy loaded
    for (let step = 0; step < 6; step += 1) {
      await vi.advanceTimersByTimeAsync(2_500)
      socket.answer()
    }
    await flushed
    await vi.advanceTimersByTimeAsync(5_000)
    // Never claimed in sync before the edit reached the server.
    expect(ydocToMarkdown(server.doc).trim()).toBe('# Written offline')
    expect(row(database)?.dirty).toBe(0)
  })

  it('keeps unsynced edits to a document trashed elsewhere, and stops retrying it until opened', async () => {
    const { database, store } = sqlite()
    const server = new FakeServer()
    applyMarkdownToYDoc(server.doc, 'Original')
    class TrashedDocSocket extends FakeSocket {
      trashed = false
      joins = 0
      override emit(event: string, input: Parameters<FakeSocket['emit']>[1], ack?: (result: unknown) => void) {
        if (event === 'doc.join') this.joins += 1
        // The server answers a join for a trashed document as not found.
        if (event === 'doc.join' && this.trashed) {
          if (this.connected) ack?.({ ok: false, error: 'not_found' })
          return this
        }
        return super.emit(event, input, ack)
      }
    }
    const socket = new TrashedDocSocket(server)
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    registry.attach(socket as unknown as DocSocket)
    const handle = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    socket.disconnect()
    type(handle.controller.doc, 'Original\n\nWritten offline')
    await vi.advanceTimersByTimeAsync(500)
    handle.release()
    await vi.advanceTimersByTimeAsync(LINGER_MS + 1_000)
    expect(row(database)?.dirty).toBe(1)

    socket.trashed = true
    socket.reconnect()
    await registry.flushDirty()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(row(database)?.dirty).toBe(1)
    const joins = socket.joins
    await registry.flushDirty()
    expect(socket.joins).toBe(joins)

    // Restored on the web, then opened here: the edits go up.
    socket.trashed = false
    const reopened = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(ydocToMarkdown(server.doc).trim()).toBe('Original\n\nWritten offline')
    reopened.release()
  })

  it('restarts a failed session for its views, leaving the room before the new one joins', async () => {
    const { store } = sqlite()
    const server = new FakeServer()
    const socket = new FakeSocket(server)
    const order: string[] = []
    const emit = socket.emit.bind(socket)
    socket.emit = ((event: string, input: Parameters<FakeSocket['emit']>[1], ack?: (result: unknown) => void) => {
      order.push(event)
      return emit(event, input, ack)
    }) as FakeSocket['emit']
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    registry.attach(socket as unknown as DocSocket)
    const handle = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    socket.deliver('doc.closed', { docId: DOC.toLowerCase(), reason: 'trashed' })
    expect(handle.controller.getSnapshot().status).toEqual({ state: 'closed', reason: 'trashed' })
    order.length = 0
    registry.restart(DOC)
    const fresh = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fresh.controller).not.toBe(handle.controller)
    expect(fresh.controller.getSnapshot().status.state).toBe('synced')
    expect(order.indexOf('doc.join')).toBeGreaterThan(-1)
    handle.release()
    fresh.release()
  })

  it('never marks the copy in sync over a later edit still waiting for a busy database', async () => {
    const { database, store } = sqlite()
    const server = new FakeServer()
    const socket = new FakeSocket(server)
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    registry.attach(socket as unknown as DocSocket)
    const handle = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    // Writes take a second; the second edit's write is queued while the first one's still runs.
    databaseDelayMs = 1_000
    type(handle.controller.doc, 'Acknowledged edit')
    await vi.advanceTimersByTimeAsync(100)
    expect(handle.controller.getSnapshot().status.state).toBe('synced')
    // A second edit, made as the connection drops: only this device has it.
    type(handle.controller.doc, 'Acknowledged edit\n\nOnly on this device')
    socket.disconnect()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(ydocToMarkdown(server.doc).trim()).toBe('Acknowledged edit')
    expect(row(database)?.dirty).toBe(1)
    handle.release()
  })

  it('brings edits made in a replaced session\'s view to the server once that view closes', async () => {
    const { database, store } = sqlite()
    const server = new FakeServer()
    applyMarkdownToYDoc(server.doc, 'Original')
    const socket = new FakeSocket(server)
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    registry.attach(socket as unknown as DocSocket)
    const stale = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    registry.restart(DOC)
    const fresh = registry.acquire(DOC)
    // The old view takes a last keystroke before it goes; its session no longer has the room.
    type(stale.controller.doc, 'Original\n\nTyped in the old view')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fresh.controller.getSnapshot().status.state).toBe('synced')
    expect(row(database)?.dirty).toBe(1)
    stale.release()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(ydocToMarkdown(server.doc).trim()).toBe('Original\n\nTyped in the old view')
    expect(row(database)?.dirty).toBe(0)
    fresh.release()
  })
  it('keeps a newer version\'s unsynced edits untouched until that version is back', async () => {
    const { database, store } = sqlite()
    const newer = new DocSessionRegistry(NAMESPACE, store, 3)
    const handle = newer.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    type(handle.controller.doc, 'From a newer schema')
    await vi.advanceTimersByTimeAsync(500)
    await newer.destroy()

    // An older version leaves the copy out of its background upload, and writes nothing over it.
    const server = new FakeServer()
    const older = new DocSessionRegistry(NAMESPACE, store, 2)
    older.attach(new FakeSocket(server) as unknown as DocSocket)
    await older.flushDirty()
    expect(older.openDocIds()).toEqual([])
    const opened = older.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(ydocToMarkdown(opened.controller.doc).trim()).toBe('')
    type(opened.controller.doc, 'Typed in the older version')
    await vi.advanceTimersByTimeAsync(500)
    opened.release()
    await vi.advanceTimersByTimeAsync(LINGER_MS + 1_000)
    expect(row(database)).toMatchObject({ dirty: 1, schema_version: 3 })

    const back = new DocSessionRegistry(NAMESPACE, store, 3)
    const reopened = back.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(ydocToMarkdown(reopened.controller.doc).trim()).toBe('From a newer schema')
    reopened.release()
  })

  it('writes an edit again when storing it failed', async () => {
    const { store } = sqlite()
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    const handle = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    failingWrites = 1
    type(handle.controller.doc, 'Kept through a full disk')
    await vi.advanceTimersByTimeAsync(500)
    expect(failingWrites).toBe(0)
    await vi.advanceTimersByTimeAsync(3_000)
    // Read back from the database while the session is still open (closing stores a snapshot anyway).
    const stored = await store.load(NAMESPACE, DOC.toLowerCase())
    expect(stored.dirty).toBe(true)
    const reloaded = new Y.Doc()
    Y.applyUpdate(reloaded, stored.update!)
    expect(ydocToMarkdown(reloaded).trim()).toBe('Kept through a full disk')
    handle.release()
  })

  it('writes what open documents have pending at once when asked, e.g. as the app leaves', async () => {
    const { database, store } = sqlite()
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    const handle = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    type(handle.controller.doc, 'Typed just before leaving')
    await registry.flushOpen()
    expect(row(database)?.dirty).toBe(1)
    handle.release()
  })

  it('tries a document again later when it closed before its edits were uploaded', async () => {
    const { database, store } = sqlite()
    const server = new FakeServer()
    let failing = true
    class FlakySocket extends FakeSocket {
      override emit(event: string, input: { docId: string; update?: Uint8Array; stateVector?: Uint8Array }, ack?: (result: unknown) => void) {
        if (event === 'doc.update' && failing) {
          ack?.({ ok: false, error: 'failed' })
          return this
        }
        return super.emit(event, input, ack)
      }
    }
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    registry.attach(new FlakySocket(server) as unknown as DocSocket)
    const handle = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    type(handle.controller.doc, 'Saved on the second try')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(handle.controller.getSnapshot().status).toMatchObject({ state: 'error', error: 'failed' })
    // The screen is left instead of retrying; the server recovers meanwhile.
    handle.release()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(registry.openDocIds()).toEqual([])
    expect(row(database)?.dirty).toBe(1)
    failing = false
    await vi.advanceTimersByTimeAsync(31_000)
    expect(ydocToMarkdown(server.doc).trim()).toBe('Saved on the second try')
    expect(row(database)?.dirty).toBe(0)
    await registry.destroy()
  })

  it('closes replaced sessions too when signing out, so nothing is written after', async () => {
    const { database, store } = sqlite()
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    const view = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    type(view.controller.doc, 'Before signing out')
    registry.restart(DOC)
    await registry.destroy()
    // Signing out then deletes the account's data.
    database.exec('DELETE FROM file_docs; DELETE FROM file_doc_updates;')
    // The replaced view's editor hands over its final state as it goes.
    type(view.controller.doc, 'Before signing out\n\nAfter signing out')
    view.release()
    await vi.advanceTimersByTimeAsync(LINGER_MS + 1_000)
    expect(row(database)).toBeUndefined()
  })
  it('does not try again a document the server refuses until something changes', async () => {
    const { database, store } = sqlite()
    const server = new FakeServer()
    let joins = 0
    class RefusingSocket extends FakeSocket {
      override emit(event: string, input: { docId: string; update?: Uint8Array; stateVector?: Uint8Array }, ack?: (result: unknown) => void) {
        if (event === 'doc.join') joins += 1
        if (event === 'doc.update') {
          ack?.({ ok: false, error: 'doc_too_large' })
          return this
        }
        return super.emit(event, input, ack)
      }
    }
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    registry.attach(new RefusingSocket(server) as unknown as DocSocket)
    const handle = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    type(handle.controller.doc, 'Far too long')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(handle.controller.getSnapshot().status).toMatchObject({ state: 'error', error: 'doc_too_large' })
    handle.release()
    await vi.advanceTimersByTimeAsync(1_000)
    const before = joins
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(joins).toBe(before)
    expect(row(database)?.dirty).toBe(1)
    await registry.destroy()
  })

  it('discards the copy of a document that became an ordinary file, so a document made from it later starts afresh', async () => {
    const { database, store } = sqlite()
    const server = new FakeServer()
    const socket = new FakeSocket(server)
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    registry.attach(socket as unknown as DocSocket)
    const handle = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    type(handle.controller.doc, 'Before it became a file')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(ydocToMarkdown(server.doc).trim()).toBe('Before it became a file')

    // Renamed away from Markdown elsewhere: the server drops the document.
    socket.deliver('doc.closed', { docId: DOC.toLowerCase(), reason: 'converted' })
    await vi.advanceTimersByTimeAsync(500)
    expect(row(database)).toBeUndefined()
    type(handle.controller.doc, 'Before it became a file\n\nTyped after')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(row(database)).toBeUndefined()

    // Made into a document again, it starts afresh on the server under the same id.
    const fresh = new FakeServer()
    registry.attach(new FakeSocket(fresh) as unknown as DocSocket)
    const early = registry.acquire(DOC)
    expect(early.controller).not.toBe(handle.controller)
    handle.release()
    early.release()
    await vi.advanceTimersByTimeAsync(LINGER_MS + 1_000)
    const reopened = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(ydocToMarkdown(fresh.doc).trim()).toBe('')
    expect(ydocToMarkdown(reopened.controller.doc).trim()).toBe('')
    reopened.release()
    await registry.destroy()
  })

  it('discards sessions replaced by Retry or Restore too when the document becomes a file', async () => {
    const { database, store } = sqlite()
    const server = new FakeServer()
    const socket = new FakeSocket(server)
    const registry = new DocSessionRegistry(NAMESPACE, store, 2)
    registry.attach(socket as unknown as DocSocket)
    const lower = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    type(lower.controller.doc, 'Original')
    await vi.advanceTimersByTimeAsync(1_000)
    // Retry on another view of the document replaces the session the lower view still holds.
    registry.restart(DOC)
    const upper = registry.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    socket.deliver('doc.closed', { docId: DOC.toLowerCase(), reason: 'converted' })
    await vi.advanceTimersByTimeAsync(500)
    type(lower.controller.doc, 'Original\n\nTyped in the lower view')
    await vi.advanceTimersByTimeAsync(1_000)
    upper.release()
    lower.release()
    await vi.advanceTimersByTimeAsync(LINGER_MS + 1_000)
    expect(row(database)).toBeUndefined()
    await registry.destroy()
  })

})

describe('the document store', () => {
  it('never drops another session\'s stored edits when compacting', async () => {
    const { store } = sqlite()
    const first = new Y.Doc()
    applyMarkdownToYDoc(first, 'From the closing session')
    const second = new Y.Doc()
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first))
    applyMarkdownToYDoc(second, 'From the closing session\n\nTyped in the new session')
    const id = DOC.toLowerCase()
    await store.append(NAMESPACE, id, [Y.encodeStateAsUpdate(first)], { local: true, schemaVersion: 2, snapshot: () => Y.encodeStateAsUpdate(first) })
    // The new session appends its edit, then the old one (which never saw it) compacts.
    await store.append(NAMESPACE, id, [Y.encodeStateAsUpdate(second, Y.encodeStateVector(first))], { local: true, schemaVersion: 2, snapshot: () => Y.encodeStateAsUpdate(second) })
    await store.compact(NAMESPACE, id, Y.encodeStateAsUpdate(first), 2)
    const stored = await store.load(NAMESPACE, id)
    const reloaded = new Y.Doc()
    Y.applyUpdate(reloaded, stored.update!)
    expect(ydocToMarkdown(reloaded).trim()).toBe('From the closing session\n\nTyped in the new session')
  })

})
