import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { FakeServer, FakeSocket } from './testing.js'
import { SocketIOYProvider, type DocSocket } from './provider.js'

/** Persists requests normally but lets replies arrive late, out of order, or never. */
class DelayedSocket extends FakeSocket {
  hold = new Set<string>()
  replies: Array<{ event: string; reply: (override?: unknown) => void }> = []
  sent: string[] = []
  rateLimitNext = false
  override emit(event: string, input: Parameters<FakeSocket['emit']>[1], ack?: (result: unknown) => void) {
    this.sent.push(event)
    if (event === 'doc.update' && this.rateLimitNext) {
      this.rateLimitNext = false
      ack?.({ ok: false, error: 'rate_limited' })
      return this
    }
    return super.emit(event, input, ack && ((result) => {
      if (this.hold.has(event)) this.replies.push({ event, reply: (override) => ack(override ?? result) })
      else ack(result)
    }))
  }
  release(event: string) {
    const index = this.replies.findIndex((entry) => entry.event === event)
    this.replies.splice(index, 1)[0]!.reply()
  }
}

describe('document sync under delayed acknowledgements', () => {
  const providers: SocketIOYProvider[] = []
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    for (const provider of providers.splice(0)) { provider.destroy(); provider.doc.destroy() }
    vi.useRealTimers()
  })

  function open(server: FakeServer, hold: string[] = []) {
    const socket = new DelayedSocket(server)
    socket.hold = new Set(hold)
    const doc = new Y.Doc()
    const provider = new SocketIOYProvider('doc-1', doc)
    providers.push(provider)
    provider.attach(socket as unknown as DocSocket)
    return { socket, doc, provider }
  }

  it('keeps peer updates that arrive between the join snapshot and its acknowledgement', () => {
    const server = new FakeServer()
    const a = open(server, ['doc.join'])
    const b = open(server)
    b.doc.getText('t').insert(0, 'during join')
    vi.advanceTimersByTime(100)
    a.socket.release('doc.join')
    expect(a.doc.getText('t').toString()).toBe('during join')
  })

  it('does not reopen a closed document when a pending join completes or the socket reconnects', () => {
    const a = open(new FakeServer(), ['doc.join'])
    a.socket.deliver('doc.closed', { docId: 'doc-1', reason: 'trashed' })
    a.socket.release('doc.join')
    expect(a.provider.status).toEqual({ state: 'closed', reason: 'trashed' })
    a.socket.hold.clear()
    a.socket.disconnect()
    a.socket.reconnect()
    expect(a.provider.status).toEqual({ state: 'closed', reason: 'trashed' })
  })

  it('ignores replies to a superseded join after disconnecting', () => {
    const a = open(new FakeServer(), ['doc.join'])
    a.provider.resync()
    // The second join answers first.
    a.socket.replies.splice(1, 1)[0]!.reply()
    expect(a.provider.status.state).toBe('synced')
    a.socket.disconnect()
    a.socket.release('doc.join')
    expect(a.provider.status.state).toBe('offline')
  })

  it('reports unsaved edits until the server acknowledges them', () => {
    const a = open(new FakeServer(), ['doc.update'])
    a.doc.getText('t').insert(0, 'not acknowledged')
    expect(a.provider.status.state).toBe('syncing')
    vi.advanceTimersByTime(100)
    expect(a.provider.status.state).toBe('syncing')
    a.socket.release('doc.update')
    expect(a.provider.status.state).toBe('synced')
  })

  it('recovers from a lost update acknowledgement without needing a reconnect or another edit', () => {
    const server = new FakeServer()
    const a = open(server, ['doc.update'])
    a.doc.getText('t').insert(0, 'first')
    vi.advanceTimersByTime(100)
    a.doc.getText('t').insert(5, ' second')
    a.socket.hold.clear()
    vi.advanceTimersByTime(30_000)
    expect(server.doc.getText('t').toString()).toBe('first second')
    expect(a.provider.status.state).toBe('synced')
  })

  it('can send after replacing a socket while an update acknowledgement is pending', () => {
    const server = new FakeServer()
    const a = open(server, ['doc.update'])
    a.doc.getText('t').insert(0, 'first')
    vi.advanceTimersByTime(100)
    a.provider.attach(null)
    a.doc.getText('t').insert(5, ' offline')
    const socket = new DelayedSocket(server)
    a.provider.attach(socket as unknown as DocSocket)
    a.doc.getText('t').insert(a.doc.getText('t').length, ' last')
    vi.advanceTimersByTime(100)
    expect(server.doc.getText('t').toString()).toBe('first offline last')
    expect(a.provider.status.state).toBe('synced')
  })

  it('cancels a pending server join when the document is unmounted', () => {
    const a = open(new FakeServer(), ['doc.join'])
    a.provider.destroy()
    expect(a.socket.sent).toContain('doc.leave')
    a.socket.release('doc.join')
    a.doc.getText('t').insert(0, 'after destroy')
    vi.advanceTimersByTime(30_000)
    expect(a.socket.sent.filter((event) => event === 'doc.join')).toHaveLength(1)
    expect(a.socket.sent).not.toContain('doc.update')
  })

  it('does not let an old send failure settle or fail the current in-flight edit', () => {
    const server = new FakeServer()
    const a = open(server, ['doc.update'])
    a.doc.getText('t').insert(0, 'one')
    vi.advanceTimersByTime(100)
    a.provider.resync()
    a.doc.getText('t').insert(3, ' two')
    vi.advanceTimersByTime(100)
    a.socket.replies.shift()!.reply({ ok: false, error: 'invalid_update' })
    expect(a.provider.status.state).toBe('syncing')
    a.socket.release('doc.update')
    expect(a.provider.status.state).toBe('synced')
    expect(server.doc.getText('t').toString()).toBe('one two')
  })

  it('retries an unanswered join and ignores its later failure', () => {
    const a = open(new FakeServer(), ['doc.join'])
    a.socket.hold.clear()
    vi.advanceTimersByTime(10_001)
    expect(a.provider.status.state).toBe('synced')
    a.socket.replies.shift()!.reply({ ok: false, error: 'not_found' })
    expect(a.provider.status.state).toBe('synced')
  })

  it('keeps rate-limited edits visibly unsaved and retries them together with later typing', () => {
    const server = new FakeServer()
    const a = open(server)
    a.socket.rateLimitNext = true
    a.doc.getText('t').insert(0, 'one')
    vi.advanceTimersByTime(100)
    a.doc.getText('t').insert(3, ' two')
    expect(a.provider.status.state).toBe('syncing')
    expect(server.doc.getText('t').toString()).toBe('')
    vi.advanceTimersByTime(1_100)
    expect(server.doc.getText('t').toString()).toBe('one two')
    expect(a.provider.status.state).toBe('synced')
  })

  it('converges three replicas through 120 edits, repeated offline windows, and delayed replies', () => {
    const server = new FakeServer()
    const clients = [open(server), open(server), open(server)]
    for (let edit = 0; edit < 120; edit++) {
      const client = clients[(edit * 7) % clients.length]!
      if (edit % 5 === 0) client.socket.hold.add('doc.update')
      if (edit % 7 === 0) for (const peer of clients) {
        peer.socket.hold.clear()
        for (const reply of peer.socket.replies.splice(0)) reply.reply()
      }
      if (edit % 11 === 0) client.socket.disconnect()
      if (edit % 13 === 0) client.socket.reconnect()
      client.doc.getText('t').insert(client.doc.getText('t').length, `[edit-${edit}]`)
      vi.advanceTimersByTime(60)
    }
    for (const client of clients) {
      client.socket.hold.clear()
      for (const reply of client.socket.replies.splice(0)) reply.reply()
      client.socket.reconnect()
    }
    vi.advanceTimersByTime(30_000)
    const expected = server.doc.getText('t').toString()
    for (const client of clients) expect(client.doc.getText('t').toString()).toBe(expected)
    for (let edit = 0; edit < 120; edit++) expect(expected.split(`[edit-${edit}]`)).toHaveLength(2)
  })
})
