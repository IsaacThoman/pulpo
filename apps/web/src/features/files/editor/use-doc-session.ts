import { useEffect, useState } from 'react'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { localAccountKey } from '@/lib/local-first/database'
import { docCacheName } from '@/lib/local-first/doc-cache'
import { useRealtimeSocket } from '@/lib/realtime-socket'
import { sessionColor } from './presence'
import { SocketIOYProvider, type DocSyncStatus } from './socket-provider'

export interface DocSession {
  doc: Y.Doc
  provider: SocketIOYProvider
}

export interface PresencePeer {
  clientId: number
  name: string
  color: string
}

/** Waits this long for the local copy before joining without it; late loads trigger a resync. */
const LOCAL_CACHE_WAIT_MS = 1_500

/** Owns the Y.Doc, its offline cache, and the realtime provider for one open document. */
export function useDocSession(userId: string, docId: string): {
  session: DocSession | null
  status: DocSyncStatus
  peers: PresencePeer[]
} {
  const socket = useRealtimeSocket((state) => state.socket)
  const [session, setSession] = useState<DocSession | null>(null)
  const [status, setStatus] = useState<DocSyncStatus>({ state: 'connecting' })
  const [peers, setPeers] = useState<PresencePeer[]>([])

  useEffect(() => {
    const doc = new Y.Doc()
    const persistence = new IndexeddbPersistence(docCacheName(localAccountKey(userId), docId), doc)
    const provider = new SocketIOYProvider(docId, doc, [persistence])
    const unsubscribe = provider.onStatus(setStatus)
    const updatePeers = () => {
      const next: PresencePeer[] = []
      provider.awareness.getStates().forEach((state, clientId) => {
        const user = (state as { user?: { name?: string; color?: string } }).user
        if (clientId !== doc.clientID && user?.name) next.push({ clientId, name: user.name, color: user.color ?? sessionColor(clientId) })
      })
      setPeers(next)
    }
    provider.awareness.on('change', updatePeers)
    let active = true
    let joinedBeforeCache = false
    const start = () => { if (active) setSession({ doc, provider }) }
    // Joining after the cached copy loads lets the handshake upload any edits made offline.
    const timer = window.setTimeout(() => { joinedBeforeCache = true; start() }, LOCAL_CACHE_WAIT_MS)
    void persistence.whenSynced.then(() => {
      if (!active) return
      window.clearTimeout(timer)
      if (joinedBeforeCache) provider.resync()
      else start()
    })
    return () => {
      active = false
      window.clearTimeout(timer)
      unsubscribe()
      provider.awareness.off('change', updatePeers)
      provider.destroy()
      void persistence.destroy()
      doc.destroy()
      setSession(null)
      setPeers([])
      setStatus({ state: 'connecting' })
    }
  }, [userId, docId])

  useEffect(() => {
    session?.provider.attach(socket)
  }, [session, socket])

  return { session, status, peers }
}
