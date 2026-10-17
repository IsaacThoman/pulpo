import type { QueryClient } from '@tanstack/react-query'
import type { PulpoSocket } from '../../providers/realtimeStore'
import { bindMobileDocSocket } from './doc/accountSessions'
import { resumeUploads } from './uploads'

/**
 * Files on the account's realtime socket: documents sync over it, and uploads that waited for a
 * connection resume whenever it (re)connects.
 */
export function bindMobileFilesSocket(namespace: string, socket: PulpoSocket, queryClient: QueryClient): () => void {
  const unbindDocs = bindMobileDocSocket(namespace, socket)
  const resume = () => { void resumeUploads(namespace, queryClient).catch(() => undefined) }
  socket.on('connect', resume)
  return () => {
    socket.off('connect', resume)
    unbindDocs()
  }
}
