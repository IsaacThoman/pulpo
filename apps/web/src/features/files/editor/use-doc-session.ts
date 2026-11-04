import { useEffect, useState, useSyncExternalStore } from 'react'
import { IndexeddbPersistence } from 'y-indexeddb'
import { DocSessionController, type DocSessionSnapshot } from '@pulpo/client-core/doc-sync'
import { MARKDOWN_FORMAT, type LiveFormatInfo } from '@pulpo/client-core/office'
import { localAccountKey } from '@/lib/local-first/database'
import { docCacheName } from '@/lib/local-first/doc-cache'
import { useRealtimeSocket } from '@/lib/realtime-socket'

export type { DocSession, PresencePeer } from '@pulpo/client-core/doc-sync'

const CLOSED: DocSessionSnapshot = { session: null, status: { state: 'connecting' }, peers: [] }
const noSubscription = () => () => {}

/**
 * Owns the Y.Doc, its offline cache (IndexedDB), and the realtime provider for one open document
 * of `format` (Markdown unless given), whose schema version the join announces.
 */
export function useDocSession(userId: string, docId: string, format: LiveFormatInfo = MARKDOWN_FORMAT): DocSessionSnapshot {
  const socket = useRealtimeSocket((state) => state.socket)
  const [controller, setController] = useState<DocSessionController | null>(null)
  // Bumped to start over without this device's copy (see `stale_copy`).
  const [restarts, setRestarts] = useState(0)

  useEffect(() => {
    let cache: IndexeddbPersistence | null = null
    const next = new DocSessionController({
      docId,
      schemaVersions: { [format.id]: format.schemaVersion },
      hasContent: format.hasContent,
      persistence: (doc) => {
        const persistence = new IndexeddbPersistence(docCacheName(localAccountKey(userId), docId), doc)
        cache = persistence
        return { whenLoaded: persistence.whenSynced.then(() => undefined), origin: persistence, destroy: () => persistence.destroy() }
      },
    })
    // The cached copy is of an earlier document under the same id (a file made a document again):
    // it must not be merged into this one, so it is deleted and the session starts afresh.
    const unsubscribe = next.subscribe(() => {
      const { status } = next.getSnapshot()
      if (status.state !== 'error' || status.error !== 'stale_copy') return
      unsubscribe()
      void (cache?.clearData() ?? Promise.resolve()).catch(() => undefined).then(() => setRestarts((count) => count + 1))
    })
    // The current socket at once, so a cache that loads before the next render never starts the
    // session without one (which would show it offline for a moment).
    next.attach(useRealtimeSocket.getState().socket)
    setController(next)
    return () => {
      unsubscribe()
      next.destroy()
      setController(null)
    }
  }, [userId, docId, format, restarts])

  useEffect(() => {
    controller?.attach(socket)
  }, [controller, socket])

  return useSyncExternalStore(controller?.subscribe ?? noSubscription, controller?.getSnapshot ?? (() => CLOSED))
}
