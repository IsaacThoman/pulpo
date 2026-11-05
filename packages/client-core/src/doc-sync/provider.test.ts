import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { FakeServer, FakeSocket } from './testing.js'
import { DOC_GENERATION_KEY, DOC_META_MAP } from '../doc-schema/version.js'
import { isStaleCopy, SocketIOYProvider, type DocSocket } from './provider.js'

const text = (doc: Y.Doc) => doc.getText('t').toString()

describe('SocketIOYProvider', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function open(server: FakeServer) {
    const doc = new Y.Doc()
    const socket = new FakeSocket(server)
    const provider = new SocketIOYProvider('doc-1', doc)
    provider.attach(socket as unknown as DocSocket)
    return { doc, socket, provider }
  }

  it('converges two sessions through the server and does not echo remote updates back', () => {
    const server = new FakeServer()
    const a = open(server)
    const b = open(server)
    a.doc.getText('t').insert(0, 'hello')
    vi.advanceTimersByTime(100)
    expect(text(b.doc)).toBe('hello')
    expect(server.received).toBe(1)
    b.doc.getText('t').insert(5, ' world')
    vi.advanceTimersByTime(100)
    expect(text(a.doc)).toBe('hello world')
    expect(text(server.doc)).toBe('hello world')
    expect(server.received).toBe(2)
    expect(a.provider.status.state).toBe('synced')
  })

  it('refuses to merge a cached copy of an earlier document under the same id', () => {
    const server = new FakeServer()
    server.doc.transact(() => {
      server.doc.getMap(DOC_META_MAP).set(DOC_GENERATION_KEY, 'new')
      server.doc.getText('t').insert(0, 'fresh')
    })
    server.generation = 'new'
    // This device still holds the document that was there before (another generation, or none).
    for (const generation of ['old', undefined]) {
      const doc = new Y.Doc()
      if (generation) doc.getMap(DOC_META_MAP).set(DOC_GENERATION_KEY, generation)
      doc.getText('t').insert(0, 'stale')
      const provider = new SocketIOYProvider('doc-1', doc)
      provider.attach(new FakeSocket(server) as unknown as DocSocket)
      vi.advanceTimersByTime(100)
      expect(provider.status).toEqual({ state: 'error', error: 'stale_copy' })
      expect(text(server.doc)).toBe('fresh')
      expect(server.received).toBe(0)
    }
    // A copy of this generation, or an empty one, joins as usual.
    const current = new Y.Doc()
    Y.applyUpdate(current, Y.encodeStateAsUpdate(server.doc))
    expect(isStaleCopy(current, 'new')).toBe(false)
    expect(isStaleCopy(new Y.Doc(), 'new')).toBe(false)
    expect(open(server).provider.status.state).toBe('synced')
    // Documents from before generations are never refused.
    expect(isStaleCopy(current, undefined)).toBe(false)
  })

  it('batches rapid keystrokes into one update', () => {
    const server = new FakeServer()
    const a = open(server)
    for (const character of 'typing') a.doc.getText('t').insert(a.doc.getText('t').length, character)
    vi.advanceTimersByTime(100)
    expect(server.received).toBe(1)
    expect(text(server.doc)).toBe('typing')
  })

  it('uploads edits made while offline when the connection returns', () => {
    const server = new FakeServer()
    const a = open(server)
    const b = open(server)
    a.socket.disconnect()
    expect(a.provider.status.state).toBe('offline')
    a.doc.getText('t').insert(0, 'offline ')
    b.doc.getText('t').insert(0, 'online')
    vi.advanceTimersByTime(100)
    expect(text(server.doc)).toBe('online')
    a.socket.reconnect()
    vi.advanceTimersByTime(100)
    expect(text(server.doc)).toBe(text(a.doc))
    expect(text(b.doc)).toBe(text(a.doc))
    expect(text(a.doc)).toContain('offline ')
  })

  it('stops syncing and clears peers when the document is closed', () => {
    const server = new FakeServer()
    const a = open(server)
    a.socket.deliver('doc.closed', { docId: 'doc-1', reason: 'trashed' })
    expect(a.provider.status).toEqual({ state: 'closed', reason: 'trashed' })
    a.doc.getText('t').insert(0, 'late')
    vi.advanceTimersByTime(100)
    expect(server.received).toBe(0)
  })

  it('shares cursor state between sessions and drops it when a peer leaves', () => {
    const server = new FakeServer()
    const a = open(server)
    const b = open(server)
    a.provider.awareness.setLocalStateField('user', { name: 'Chrome on macOS' })
    expect(b.provider.awareness.getStates().get(a.doc.clientID)).toMatchObject({ user: { name: 'Chrome on macOS' } })
    b.socket.deliver('doc.peer-left', { docId: 'doc-1', clientIds: [a.doc.clientID] })
    expect(b.provider.awareness.getStates().has(a.doc.clientID)).toBe(false)
  })
})
