import { io } from 'socket.io-client'
import { WorkspaceExecutor, type ExecutorConfig } from './workspace-executor'
import type { ComputerOperation } from '@pulpo/contracts'

type ParentPort = { on(event: string, listener: (event: { data: unknown }) => void): void; postMessage(value: unknown): void }
const port = (process as NodeJS.Process & { parentPort: ParentPort }).parentPort
let executor: WorkspaceExecutor | undefined
let stop: (() => void) | undefined
port.on('message', ({ data }) => {
  const input = data as { type: string; instanceUrl: string; token: string; config: ExecutorConfig }
  if (input.type === 'stop') { stop?.(); return }
  if (input.type !== 'start' || executor) return
  const socket = io(`${input.instanceUrl}/workspaces`, { auth: { token: input.token }, transports: ['websocket'], autoConnect: false, reconnection: true })
  executor = new WorkspaceExecutor(input.config, result => { const status = result.status; if (socket.connected) socket.emit('result', result, (ack: { ok?: boolean }) => { if (ack?.ok) executor?.acknowledge(result.id, status) }) })
  let polling = false
  const poll = () => {
    executor?.heartbeat()
    if (!socket.connected || polling) return
    polling = true
    socket.timeout(5000).emit('poll', (error: Error | null, reply: { operations: ComputerOperation[]; cancel: string[] }) => {
      polling = false
      if (error || !reply) return
      void (async () => { for (const id of reply.cancel) await executor?.cancel(id); for (const op of reply.operations) await executor?.accept(op) })().catch(() => socket.disconnect())
    })
  }
  const timer = setInterval(poll, 5000)
  stop = () => { clearInterval(timer); executor?.shutdown(); socket.disconnect(); setTimeout(() => process.exit(0), 1500) }
  socket.on('connect', () => { port.postMessage({ online: true }); poll() })
  socket.on('disconnect', () => port.postMessage({ online: false }))
  socket.on('connect_error', error => { if (error.message === 'unauthorized') { port.postMessage({ revoked: true }); stop?.() } })
  socket.on('revoked', () => { port.postMessage({ revoked: true }); stop?.() })
  socket.connect()
})
