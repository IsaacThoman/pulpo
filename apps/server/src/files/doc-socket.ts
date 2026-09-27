import type { Server, Socket } from 'socket.io'
import * as Y from 'yjs'
import { z } from 'zod'
import { DOC_SCHEMA_VERSION } from '@pulpo/client-core/doc-schema'
import type { ClientToServerEvents, DocClosedEvent, DocSyncError, ServerToClientEvents } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { AppError } from '../lib/errors.js'
import type { SocketData } from '../realtime/socket.js'
import { resolveFileAccess } from './access.js'
import { appendDocUpdate, loadDocUpdate, MAX_DOC_UPDATE_BYTES } from './doc-store.js'
import { filesFeatureEnabled } from './request.js'

type PulpoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
type PulpoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>

export const MAX_AWARENESS_BYTES = 16_384
export const docRoom = (docId: string) => `doc:${docId}`

const bytes = z.instanceof(Uint8Array)
const joinSchema = z.object({
  docId: z.uuid(),
  stateVector: bytes,
  awarenessClientId: z.number().int().nonnegative().max(0xffffffff),
  schemaVersion: z.number().int(),
})
const messageSchema = z.object({ docId: z.uuid(), update: bytes })
const leaveSchema = z.object({ docId: z.uuid() })

/** Per-socket budget covering both message count and bytes, refilled continuously. */
export class TokenBucket {
  private messages: number
  private bytes: number
  private updatedAt: number

  constructor(
    private readonly messagesPerSecond: number,
    private readonly bytesPerSecond: number,
    private readonly burstSeconds = 2,
    private readonly now: () => number = Date.now,
  ) {
    this.messages = messagesPerSecond * burstSeconds
    this.bytes = bytesPerSecond * burstSeconds
    this.updatedAt = now()
  }

  take(byteLength: number): boolean {
    const now = this.now()
    const elapsed = Math.max(0, now - this.updatedAt) / 1_000
    this.updatedAt = now
    this.messages = Math.min(this.messagesPerSecond * this.burstSeconds, this.messages + elapsed * this.messagesPerSecond)
    this.bytes = Math.min(this.bytesPerSecond * this.burstSeconds, this.bytes + elapsed * this.bytesPerSecond)
    if (this.messages < 1 || this.bytes < byteLength) return false
    this.messages -= 1
    this.bytes -= byteLength
    return true
  }
}

function syncError(error: unknown): DocSyncError {
  if (error instanceof AppError) {
    if (error.code === 'not_found') return 'not_found'
    if (error.code === 'doc_too_large') return 'doc_too_large'
    if (error.code === 'invalid_update') return 'invalid_update'
  }
  return 'failed'
}

/**
 * Relays Yjs sync and awareness for `doc:<id>` rooms. API instances keep no document in memory:
 * joins are answered from the database, and every update is persisted before it is broadcast.
 */
export function bindDocSocket(socket: PulpoSocket): void {
  const userId = socket.data.user.id
  const adminChatAccess = Boolean(socket.data.adminChatAccess)
  // Awareness client ids per joined doc, so peers can drop this socket's cursor when it leaves.
  const awarenessIds = new Map<string, number>()
  const budget = new TokenBucket(40, 2_000_000)
  const member = (docId: string) => socket.rooms.has(docRoom(docId))

  const leave = (docId: string) => {
    const clientId = awarenessIds.get(docId)
    awarenessIds.delete(docId)
    if (!member(docId)) return
    void socket.leave(docRoom(docId))
    if (clientId !== undefined) socket.to(docRoom(docId)).emit('doc.peer-left', { docId, clientIds: [clientId] })
  }

  socket.on('doc.join', (raw, ack) => {
    if (typeof ack !== 'function') return
    void (async () => {
      const parsed = joinSchema.safeParse(raw)
      if (!parsed.success) return ack({ ok: false, error: 'not_found' })
      const input = parsed.data
      if (adminChatAccess || !await filesFeatureEnabled()) return ack({ ok: false, error: 'unauthorized' })
      if (input.schemaVersion !== DOC_SCHEMA_VERSION) return ack({ ok: false, error: 'schema_outdated' })
      const access = await resolveFileAccess(db, userId, input.docId)
      if (!access || access.node.kind !== 'doc' || access.node.trashedAt) return ack({ ok: false, error: 'not_found' })
      // Join before reading so any update committed after the read still reaches this socket.
      await socket.join(docRoom(input.docId))
      const merged = await loadDocUpdate(input.docId)
      let update: Uint8Array
      try {
        update = Y.diffUpdate(merged, input.stateVector)
      } catch {
        update = merged
      }
      awarenessIds.set(input.docId, input.awarenessClientId)
      ack({ ok: true, update, stateVector: Y.encodeStateVectorFromUpdate(merged) })
      socket.to(docRoom(input.docId)).emit('doc.awareness-query', { docId: input.docId })
    })().catch((error: unknown) => {
      console.error('[realtime] doc.join failed', error)
      ack({ ok: false, error: syncError(error) })
    })
  })

  socket.on('doc.update', (raw, ack) => {
    if (typeof ack !== 'function') return
    void (async () => {
      const parsed = messageSchema.safeParse(raw)
      if (!parsed.success || parsed.data.update.byteLength > MAX_DOC_UPDATE_BYTES) return ack({ ok: false, error: 'invalid_update' })
      const { docId, update } = parsed.data
      if (!member(docId)) return ack({ ok: false, error: 'unauthorized' })
      if (!budget.take(update.byteLength)) return ack({ ok: false, error: 'rate_limited' })
      await appendDocUpdate({ nodeId: docId, actorUserId: socket.data.actorUser.id, update, origin: 'client' })
      socket.to(docRoom(docId)).emit('doc.update', { docId, update })
      ack({ ok: true })
    })().catch((error: unknown) => {
      if (!(error instanceof AppError)) console.error('[realtime] doc.update failed', error)
      ack({ ok: false, error: syncError(error) })
    })
  })

  socket.on('doc.awareness', (raw) => {
    const parsed = messageSchema.safeParse(raw)
    if (!parsed.success || parsed.data.update.byteLength > MAX_AWARENESS_BYTES) return
    const { docId, update } = parsed.data
    if (!member(docId) || !budget.take(update.byteLength)) return
    // Cursor positions are ephemeral; dropping one under load is fine.
    socket.to(docRoom(docId)).volatile.emit('doc.awareness', { docId, update })
  })

  socket.on('doc.leave', (raw) => {
    const parsed = leaveSchema.safeParse(raw)
    if (parsed.success) leave(parsed.data.docId)
  })

  socket.on('disconnecting', () => {
    for (const docId of [...awarenessIds.keys()]) leave(docId)
  })
}

/** Runs on every API instance for each published close, so only local sockets are touched. */
export function closeDocsLocally(io: PulpoServer, event: { docIds: string[]; reason: DocClosedEvent['reason'] }): void {
  for (const docId of event.docIds) {
    const room = docRoom(docId)
    io.local.to(room).emit('doc.closed', { docId, reason: event.reason })
    io.local.in(room).socketsLeave(room)
  }
}
