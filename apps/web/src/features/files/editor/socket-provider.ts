import type { DocClosedEvent, DocSyncError, DocUpdateMessage } from '@pulpo/contracts'
import { DOC_SCHEMA_VERSION } from '@pulpo/client-core/doc-schema'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { PulpoSocket } from '@/lib/realtime-socket'

export type DocSyncStatus =
  | { state: 'connecting' }
  | { state: 'synced' }
  | { state: 'offline' }
  | { state: 'closed'; reason: DocClosedEvent['reason'] }
  | { state: 'error'; error: DocSyncError }

/** Local edits are coalesced for this long before one merged update is sent. */
const SEND_DELAY_MS = 50
const RATE_LIMIT_RETRY_MS = 1_000
const REMOTE = 'remote'

type AwarenessChange = { added: number[]; updated: number[]; removed: number[] }

/**
 * Syncs one Y.Doc over Pulpo's Socket.IO connection.
 *
 * Every (re)join sends the local state vector, applies what the server says is missing, then
 * pushes whatever the server lacks. That handshake alone reconciles offline edits and updates
 * whose acknowledgement was lost, so the send queue never has to survive a reconnect.
 */
export class SocketIOYProvider {
  readonly awareness: Awareness
  status: DocSyncStatus = { state: 'connecting' }
  private socket: PulpoSocket | null = null
  private joined = false
  private pending: Uint8Array[] = []
  private inflight = false
  private sendTimer: ReturnType<typeof setTimeout> | undefined
  private readonly listeners = new Set<(status: DocSyncStatus) => void>()
  private detachSocket: (() => void) | null = null

  readonly docId: string
  readonly doc: Y.Doc
  /** Update origins that are not user edits, such as the offline cache replaying stored state. */
  private readonly ignoredOrigins: unknown[]

  constructor(docId: string, doc: Y.Doc, ignoredOrigins: unknown[] = []) {
    this.docId = docId
    this.doc = doc
    this.ignoredOrigins = ignoredOrigins
    this.awareness = new Awareness(doc)
    doc.on('update', this.onDocUpdate)
    this.awareness.on('update', this.onAwarenessUpdate)
  }

  onStatus(listener: (status: DocSyncStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Switches to a new socket (or none, while signed out or reconnecting the account). */
  attach(socket: PulpoSocket | null): void {
    if (socket === this.socket) return
    this.detachSocket?.()
    this.detachSocket = null
    this.socket = socket
    this.joined = false
    if (!socket || this.isFinal()) return
    const onConnect = () => this.join()
    const onDisconnect = () => {
      this.joined = false
      this.inflight = false
      if (!this.isFinal()) this.setStatus({ state: 'offline' })
    }
    const onUpdate = (event: DocUpdateMessage) => {
      if (event.docId === this.docId && this.joined) Y.applyUpdate(this.doc, bytes(event.update), this)
    }
    const onAwareness = (event: DocUpdateMessage) => {
      if (event.docId === this.docId && this.joined) applyAwarenessUpdate(this.awareness, bytes(event.update), REMOTE)
    }
    const onAwarenessQuery = (event: { docId: string }) => {
      if (event.docId === this.docId) this.sendAwareness([this.doc.clientID])
    }
    const onPeerLeft = (event: { docId: string; clientIds: number[] }) => {
      if (event.docId === this.docId) removeAwarenessStates(this.awareness, event.clientIds, REMOTE)
    }
    const onClosed = (event: DocClosedEvent) => {
      if (event.docId !== this.docId) return
      this.joined = false
      this.setStatus({ state: 'closed', reason: event.reason })
      this.clearRemoteAwareness()
    }
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('doc.update', onUpdate)
    socket.on('doc.awareness', onAwareness)
    socket.on('doc.awareness-query', onAwarenessQuery)
    socket.on('doc.peer-left', onPeerLeft)
    socket.on('doc.closed', onClosed)
    this.detachSocket = () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('doc.update', onUpdate)
      socket.off('doc.awareness', onAwareness)
      socket.off('doc.awareness-query', onAwarenessQuery)
      socket.off('doc.peer-left', onPeerLeft)
      socket.off('doc.closed', onClosed)
      if (this.joined) socket.emit('doc.leave', { docId: this.docId })
      this.joined = false
    }
    if (socket.connected) this.join()
    else this.setStatus({ state: 'offline' })
  }

  /** Re-runs the join handshake, e.g. after cached offline edits finish loading. */
  resync(): void {
    if (this.socket?.connected && !this.isFinal()) this.join()
  }

  destroy(): void {
    if (this.sendTimer !== undefined) clearTimeout(this.sendTimer)
    this.flushNow()
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'local')
    this.attach(null)
    this.doc.off('update', this.onDocUpdate)
    this.awareness.off('update', this.onAwarenessUpdate)
    this.awareness.destroy()
    this.listeners.clear()
  }

  private isFinal(): boolean {
    return this.status.state === 'closed' || (this.status.state === 'error' && this.status.error !== 'rate_limited')
  }

  private setStatus(status: DocSyncStatus): void {
    this.status = status
    for (const listener of this.listeners) listener(status)
  }

  private join(): void {
    const socket = this.socket
    if (!socket) return
    this.setStatus({ state: 'connecting' })
    socket.emit('doc.join', {
      docId: this.docId,
      stateVector: Y.encodeStateVector(this.doc),
      awarenessClientId: this.doc.clientID,
      schemaVersion: DOC_SCHEMA_VERSION,
    }, (result) => {
      if (socket !== this.socket) return
      if (!result.ok) {
        this.setStatus(result.error === 'not_found' ? { state: 'closed', reason: 'deleted' } : { state: 'error', error: result.error })
        return
      }
      Y.applyUpdate(this.doc, bytes(result.update), this)
      this.joined = true
      this.inflight = false
      // Everything the server lacks, including edits made offline, in one update.
      const missing = Y.encodeStateAsUpdate(this.doc, bytes(result.stateVector))
      this.pending = hasChanges(missing) ? [missing] : []
      this.setStatus({ state: 'synced' })
      this.flushNow()
      this.sendAwareness([this.doc.clientID])
    })
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.ignoredOrigins.includes(origin)) return
    this.pending.push(update)
    if (this.sendTimer === undefined) this.sendTimer = setTimeout(() => this.flushNow(), SEND_DELAY_MS)
  }

  private flushNow(): void {
    if (this.sendTimer !== undefined) clearTimeout(this.sendTimer)
    this.sendTimer = undefined
    const socket = this.socket
    if (!socket || !this.joined || this.inflight || !this.pending.length) return
    const update = this.pending.length === 1 ? this.pending[0]! : Y.mergeUpdates(this.pending)
    this.pending = []
    this.inflight = true
    socket.emit('doc.update', { docId: this.docId, update }, (result) => {
      if (socket !== this.socket || !this.inflight) return
      this.inflight = false
      if (result.ok) {
        this.flushNow()
        return
      }
      this.pending.unshift(update)
      if (result.error === 'rate_limited') {
        this.sendTimer = setTimeout(() => this.flushNow(), RATE_LIMIT_RETRY_MS)
        return
      }
      this.joined = false
      this.setStatus(result.error === 'not_found' ? { state: 'closed', reason: 'deleted' } : { state: 'error', error: result.error })
    })
  }

  private readonly onAwarenessUpdate = ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
    if (origin === REMOTE) return
    this.sendAwareness([...added, ...updated, ...removed])
  }

  private sendAwareness(clientIds: number[]): void {
    if (!this.socket || !this.joined || !clientIds.length) return
    this.socket.emit('doc.awareness', { docId: this.docId, update: encodeAwarenessUpdate(this.awareness, clientIds) })
  }

  private clearRemoteAwareness(): void {
    const others = [...this.awareness.getStates().keys()].filter((clientId) => clientId !== this.doc.clientID)
    removeAwarenessStates(this.awareness, others, REMOTE)
  }
}

/** socket.io-client delivers binary payloads as ArrayBuffers in browsers. */
function bytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

/** An update is worth sending if it carries new items or deletions. */
function hasChanges(update: Uint8Array): boolean {
  const decoded = Y.decodeUpdate(update)
  return decoded.structs.length > 0 || decoded.ds.clients.size > 0
}
