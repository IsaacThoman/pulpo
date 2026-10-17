import type { QueryClient } from '@tanstack/react-query'
import type { PulpoSocket } from '../../providers/realtimeStore'
import { registerAccountCleanup } from '../../store/accountCleanup'
import { bindMobileDocSocket, closeDocSessions } from './doc/accountSessions'
import { clearUploads, resumeUploads } from './uploads'

// Signing out closes the account's documents and forgets its queued uploads.
registerAccountCleanup(async (namespace) => {
  await closeDocSessions(namespace)
  await clearUploads(namespace)
})

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
