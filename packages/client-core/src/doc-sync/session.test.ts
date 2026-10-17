import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { applyMarkdownToYDoc } from '../doc-schema/index.js'
import { FakeServer, FakeSocket } from './testing.js'
import type { DocSocket } from './provider.js'
import { DocSessionController, type DocPersistence } from './session.js'

/** A local copy that loads when the test says so. */
function controllableCache() {
  const caches: Array<{ doc: Y.Doc; load: () => void; destroyed: boolean }> = []
  const persistence = (doc: Y.Doc): DocPersistence => {
    let load!: () => void
    const whenLoaded = new Promise<void>((resolve) => { load = resolve })
    const entry = { doc, load, destroyed: false }
    caches.push(entry)
    return { whenLoaded, origin: entry, destroy: () => { entry.destroyed = true } }
  }
  return { caches, persistence }
}

describe('DocSessionController', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('does not mistake the editor initializing its empty paragraph for an offline copy', async () => {
    const { caches, persistence } = controllableCache()
    const controller = new DocSessionController({ docId: 'doc-1', persistence })
    caches[0]!.load()
    await vi.advanceTimersByTimeAsync(0)
    const session = controller.getSnapshot().session!
    expect(session.hasCachedContent).toBe(false)
    session.doc.getXmlFragment('default').push([new Y.XmlElement('paragraph')])
    expect(controller.getSnapshot().session?.hasCachedContent).toBe(false)
    controller.destroy()
    expect(caches[0]!.destroyed).toBe(true)
  })

  it('exposes a cached document while the socket is offline', async () => {
    const { caches, persistence } = controllableCache()
    const controller = new DocSessionController({ docId: 'doc-1', persistence })
    applyMarkdownToYDoc(caches[0]!.doc, '# Offline copy')
    caches[0]!.load()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot().session?.hasCachedContent).toBe(true)
    expect(controller.getSnapshot().status.state).toBe('offline')
  })

  it('recognizes a cached document that loads after the initial wait and resyncs it', async () => {
    const { caches, persistence } = controllableCache()
    const server = new FakeServer()
    const controller = new DocSessionController({ docId: 'doc-1', persistence })
    controller.attach(new FakeSocket(server) as unknown as DocSocket)
    await vi.advanceTimersByTimeAsync(1_501)
    // Joined without the copy: synced, so the session shows the (empty) server document.
    expect(controller.getSnapshot().status.state).toBe('synced')
    applyMarkdownToYDoc(caches[0]!.doc, 'Late offline edits')
    caches[0]!.load()
    await vi.advanceTimersByTimeAsync(100)
    expect(controller.getSnapshot().session?.hasCachedContent).toBe(true)
    // The late copy was never a local edit; the resync's handshake uploads it.
    expect(server.doc.getXmlFragment('default').length).toBeGreaterThan(0)
  })

  it('does not expose a session before a source loads, nor invent content from a late empty cache', async () => {
    const { caches, persistence } = controllableCache()
    const controller = new DocSessionController({ docId: 'doc-1', persistence })
    await vi.advanceTimersByTimeAsync(1_501)
    expect(controller.getSnapshot().session).toBeNull()
    caches[0]!.load()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot().session?.hasCachedContent).toBe(false)
    expect(controller.getSnapshot().session?.doc.getXmlFragment('default').length).toBe(0)
  })

  it('lists other sessions with a user, ignoring its own and unnamed states', async () => {
    const { caches, persistence } = controllableCache()
    const controller = new DocSessionController({ docId: 'doc-1', persistence })
    caches[0]!.load()
    await vi.advanceTimersByTimeAsync(0)
    const { awareness } = controller.provider
    awareness.setLocalStateField('user', { name: 'Me', color: '#000' })
    const remote = new Y.Doc()
    awareness.states.set(remote.clientID, { user: { name: 'Safari on iOS' } })
    awareness.states.set(remote.clientID + 1, { cursor: null })
    awareness.emit('change', [{ added: [remote.clientID, remote.clientID + 1], updated: [], removed: [] }, 'remote'])
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot().peers).toEqual([{ clientId: remote.clientID, name: 'Safari on iOS', color: expect.any(String) }])
    const before = controller.getSnapshot()
    awareness.setLocalStateField('cursor', { anchor: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot()).toBe(before)
  })

  it('ignores a cache that loads after the session was destroyed', async () => {
    const { caches, persistence } = controllableCache()
    const controller = new DocSessionController({ docId: 'doc-1', persistence })
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.destroy()
    caches[0]!.load()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(listener).not.toHaveBeenCalled()
    expect(controller.getSnapshot().session).toBeNull()
  })
})
