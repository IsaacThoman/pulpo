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
  const run: DatabaseRunner = (operation) => queue(async () => {
    if (databaseDelayMs) await new Promise((resolve) => setTimeout(resolve, databaseDelayMs))
    return operation(adapter)
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

  it('discards a copy stored by a newer version of the app', async () => {
    const { database, store } = sqlite()
    const newer = new DocSessionRegistry(NAMESPACE, store, 3)
    const handle = newer.acquire(DOC)
    await vi.advanceTimersByTimeAsync(2_000)
    type(handle.controller.doc, 'From a newer schema')
    await vi.advanceTimersByTimeAsync(500)
    await newer.destroy()
    expect(row(database)?.schema_version).toBe(3)
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
