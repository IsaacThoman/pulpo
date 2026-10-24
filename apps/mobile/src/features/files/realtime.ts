import type { QueryClient } from '@tanstack/react-query'
import type { PulpoSocket } from '../../providers/realtimeStore'
import { registerAccountCleanup } from '../../store/accountCleanup'
import { useSessionStore } from '../../store/session'
import { clearMarkdownExports } from './api'
import { filesCapability } from './availability'
import { bindMobileDocSocket, closeDocSessions } from './doc/accountSessions'
import { clearUploads, resumeUploads } from './uploads'

// Signing out closes the account's documents, forgets its queued uploads, and removes exports.
registerAccountCleanup(async (namespace) => {
  await closeDocSessions(namespace)
  await clearUploads(namespace)
  clearMarkdownExports()
})

/**
 * Files on the account's realtime socket: documents sync over it, and uploads that waited for a
 * connection (or for an administrator to turn Files back on) resume whenever it (re)connects.
 */
export function bindMobileFilesSocket(namespace: string, socket: PulpoSocket, queryClient: QueryClient): () => void {
  const unbindDocs = bindMobileDocSocket(namespace, socket)
  const resume = () => { void resumeUploads(namespace, queryClient).catch(() => undefined) }
  socket.on('connect', resume)
  let enabled = filesCapability(useSessionStore.getState().config).enabled
  const unsubscribe = useSessionStore.subscribe((state) => {
    const next = filesCapability(state.config).enabled
    if (next && !enabled && socket.connected) resume()
    enabled = next
  })
  return () => {
    socket.off('connect', resume)
    unsubscribe()
    unbindDocs()
  }
}
