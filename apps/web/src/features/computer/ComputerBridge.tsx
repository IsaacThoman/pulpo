import { useEffect } from 'react'
import type { Socket } from 'socket.io-client'
import { COMPUTER_HOST_HEARTBEAT_MS, computerRequestSchema, type ComputerHost, type ComputerRequest, type ComputerResponse } from '@pulpo/contracts'
import { useRealtimeSocket } from '@/lib/realtime-socket'
import { desktopComputerApi } from '@/lib/runtime'
import {
  activeComputerSessionIds, hasRestoredComputerSessions, pruneRestoredComputerSessions, restoreComputerSessions, subscribeComputerSessions,
} from './sessions'

/** The realtime events this bridge uses, which the shared socket type does not list. */
type ComputerSocket = Socket<
  { 'computer.request': (request: unknown) => void },
  { 'computer.host': (host: ComputerHost) => void; 'computer.response': (response: ComputerResponse) => void }
>

/** The server allows this many sessions in one announcement. */
const MAX_ANNOUNCED = 200

/**
 * Serves the agent's requests for this computer: each `computer.request` from the server goes to
 * the desktop app's main process, and its answer goes back as `computer.response`. Requests are
 * independent, so a long poll never holds up a cancel. The sessions this app serves are announced
 * on connect, whenever they change, and as a heartbeat while any is active. Renders nothing, and
 * does nothing outside a desktop app with the bridge.
 */
export function ComputerBridge() {
  const socket = useRealtimeSocket((state) => state.socket) as unknown as ComputerSocket | null
  const api = desktopComputerApi()

  useEffect(() => {
    if (!api) return
    let cancelled = false
    // A reload mid-run keeps serving the sessions the main process still holds.
    void api.sessions().then((ids) => { if (!cancelled) restoreComputerSessions(ids) }, () => undefined)
    return () => { cancelled = true }
  }, [api])

  useEffect(() => {
    if (!api || !socket) return
    const announce = () => {
      socket.emit('computer.host', { sessionIds: activeComputerSessionIds().slice(-MAX_ANNOUNCED) })
    }
    const announceActive = () => { if (activeComputerSessionIds().length) announce() }
    const serve = (raw: unknown) => {
      const parsed = computerRequestSchema.safeParse(raw)
      if (!parsed.success) return
      const request: ComputerRequest = parsed.data
      void api.handle(request).catch((error: unknown): ComputerResponse => ({
        id: request.id, sessionId: request.sessionId, ok: false, code: 'failed',
        message: (error instanceof Error ? error.message : 'The desktop app could not answer').slice(0, 4_000),
      })).then((response) => { socket.emit('computer.response', response) })
    }
    socket.on('connect', announceActive)
    socket.on('computer.request', serve)
    const unsubscribe = subscribeComputerSessions(announce)
    const heartbeat = window.setInterval(() => {
      // Sessions restored after a reload expire in the desktop app; stop announcing those.
      if (hasRestoredComputerSessions()) void api.sessions().then(pruneRestoredComputerSessions, () => undefined)
      announceActive()
    }, COMPUTER_HOST_HEARTBEAT_MS)
    if (socket.connected) announceActive()
    return () => {
      socket.off('connect', announceActive)
      socket.off('computer.request', serve)
      unsubscribe()
      window.clearInterval(heartbeat)
    }
  }, [api, socket])

  return null
}
