import type { Server } from 'socket.io'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { computerOperationResultSchema, type ComputerOperation } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { workspaceComputers, workspaceOperations } from '../database/schema.js'
import { authorizedComputer } from './service.js'

export function registerWorkspaceGateway(io: Server): void {
  const namespace = io.of('/workspaces')
  namespace.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token
      const computer = typeof token === 'string' ? await authorizedComputer(token) : undefined
      if (!computer) return next(new Error('unauthorized'))
      await db.update(workspaceComputers).set({ connectionId: socket.id }).where(eq(workspaceComputers.id, computer.id))
      next()
    } catch { next(new Error('unauthorized')) }
  })
  namespace.on('connection', socket => {
    console.info(JSON.stringify({ event: 'workspace.connected', connectionId: socket.id }))
    const token = String(socket.handshake.auth.token)
    let busy = false
    socket.on('poll', async (ack: unknown) => {
      if (busy || typeof ack !== 'function') return
      busy = true
      try {
        const computer = await authorizedComputer(token)
        if (!computer) { socket.emit('revoked'); socket.disconnect(true); return }
        if (computer.connectionId !== socket.id) { socket.disconnect(true); return }
        await db.update(workspaceComputers).set({ lastSeenAt: new Date() }).where(eq(workspaceComputers.id, computer.id))
        const rows = await db.select().from(workspaceOperations).where(and(eq(workspaceOperations.deviceId, computer.id), or(isNull(workspaceOperations.result), sql`${workspaceOperations.result}->>'status' = 'running'`)))
        const operations: ComputerOperation[] = rows.filter(row => !row.retiredAt && !row.cancelRequested && (!row.result || row.result.status === 'running')).map(row => ({
          id: row.id, generation: row.generation, rootId: row.rootId, sessionId: row.responseId,
          reconcileOnly: !!row.dispatchedAt, type: row.type, args: row.arguments, hash: row.hash, deadline: row.deadline.toISOString(),
        }))
        for (const operation of operations) {
          await db.update(workspaceOperations).set({ dispatchedAt: new Date() }).where(and(eq(workspaceOperations.id, operation.id), isNull(workspaceOperations.dispatchedAt)))
        }
        ack({ operations, cancel: rows.filter(row => row.cancelRequested || row.retiredAt).map(row => row.id) })
      } catch { socket.disconnect(true) } finally { busy = false }
    })
    socket.on('result', async (value: unknown, ack: unknown) => {
      try {
        const computer = await authorizedComputer(token)
        if (!computer) { socket.emit('revoked'); socket.disconnect(true); return }
        if (computer.connectionId !== socket.id) { socket.disconnect(true); return }
        const result = computerOperationResultSchema.parse(value)
        // Keep late results for reconciliation, but never change a response here.
        await db.update(workspaceOperations).set({ result, lastSeenAt: new Date(), updatedAt: new Date() })
          .where(and(eq(workspaceOperations.id, result.id), eq(workspaceOperations.deviceId, computer.id), or(isNull(workspaceOperations.result), sql`${workspaceOperations.result}->>'status' = 'running'`, result.status !== 'running' ? sql`${workspaceOperations.result}->>'status' = 'unknown'` : undefined)))
        if (typeof ack === 'function') ack({ ok: true })
      } catch { if (typeof ack === 'function') ack({ ok: false }) }
    })
    socket.on('disconnect', () => {
      console.info(JSON.stringify({ event: 'workspace.disconnected', connectionId: socket.id }))
      void authorizedComputer(token).then(async computer => {
        if (computer?.connectionId === socket.id) await db.update(workspaceComputers).set({ lastSeenAt: null }).where(and(eq(workspaceComputers.id, computer.id), isNull(workspaceComputers.revokedAt)))
      }).catch(() => undefined)
    })
  })
}
