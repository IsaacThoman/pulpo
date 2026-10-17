import { useEffect, useState, useSyncExternalStore } from 'react'
import { IndexeddbPersistence } from 'y-indexeddb'
import { DocSessionController, type DocSessionSnapshot } from '@pulpo/client-core/doc-sync'
import { localAccountKey } from '@/lib/local-first/database'
import { docCacheName } from '@/lib/local-first/doc-cache'
import { useRealtimeSocket } from '@/lib/realtime-socket'

export type { DocSession, PresencePeer } from '@pulpo/client-core/doc-sync'

const CLOSED: DocSessionSnapshot = { session: null, status: { state: 'connecting' }, peers: [] }
const noSubscription = () => () => {}

/** Owns the Y.Doc, its offline cache (IndexedDB), and the realtime provider for one open document. */
export function useDocSession(userId: string, docId: string): DocSessionSnapshot {
  const socket = useRealtimeSocket((state) => state.socket)
  const [controller, setController] = useState<DocSessionController | null>(null)

  useEffect(() => {
    const next = new DocSessionController({
      docId,
      persistence: (doc) => {
        const persistence = new IndexeddbPersistence(docCacheName(localAccountKey(userId), docId), doc)
        return { whenLoaded: persistence.whenSynced.then(() => undefined), origin: persistence, destroy: () => persistence.destroy() }
      },
    })
    // The current socket at once, so a cache that loads before the next render never starts the
    // session without one (which would show it offline for a moment).
    next.attach(useRealtimeSocket.getState().socket)
    setController(next)
    return () => {
      next.destroy()
      setController(null)
    }
  }, [userId, docId])

  useEffect(() => {
    controller?.attach(socket)
  }, [controller, socket])

  return useSyncExternalStore(controller?.subscribe ?? noSubscription, controller?.getSnapshot ?? (() => CLOSED))
}
