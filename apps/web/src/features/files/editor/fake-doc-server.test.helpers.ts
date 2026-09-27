import * as Y from 'yjs'

type Handler = (...args: unknown[]) => void

/** A minimal in-memory stand-in for the server's doc room: persists, then relays to peers. */
export class FakeServer {
  readonly doc = new Y.Doc()
  readonly sockets = new Set<FakeSocket>()
  received = 0

  broadcast(from: FakeSocket, event: string, payload: unknown) {
    for (const socket of this.sockets) if (socket !== from && socket.connected) socket.deliver(event, payload)
  }
}

export class FakeSocket {
  connected = true
  private handlers = new Map<string, Set<Handler>>()
  private readonly server: FakeServer
  constructor(server: FakeServer) {
    this.server = server
    server.sockets.add(this)
  }

  on(event: string, handler: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler)
    return this
  }

  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler)
    return this
  }

  deliver(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args)
  }

  emit(event: string, input: { docId: string; update?: Uint8Array; stateVector?: Uint8Array }, ack?: (result: unknown) => void) {
    if (!this.connected) return this
    if (event === 'doc.join') {
      ack?.({ ok: true, update: Y.encodeStateAsUpdate(this.server.doc, input.stateVector), stateVector: Y.encodeStateVector(this.server.doc) })
    } else if (event === 'doc.update') {
      this.server.received += 1
      Y.applyUpdate(this.server.doc, input.update!)
      ack?.({ ok: true })
      this.server.broadcast(this, 'doc.update', { docId: input.docId, update: input.update })
    } else if (event === 'doc.awareness') {
      this.server.broadcast(this, 'doc.awareness', { docId: input.docId, update: input.update })
    }
    return this
  }

  disconnect() {
    this.connected = false
    this.deliver('disconnect')
  }

  reconnect() {
    this.connected = true
    this.deliver('connect')
  }
}
