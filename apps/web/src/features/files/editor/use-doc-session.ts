import { useEffect, useState } from 'react'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { DOC_FRAGMENT_NAME } from '@pulpo/client-core/doc-schema'
import { localAccountKey } from '@/lib/local-first/database'
import { docCacheName } from '@/lib/local-first/doc-cache'
import { useRealtimeSocket } from '@/lib/realtime-socket'
import { sessionColor } from './presence'
import { SocketIOYProvider, type DocSyncStatus } from './socket-provider'

export interface DocSession {
  doc: Y.Doc
  provider: SocketIOYProvider
  /** Set before the editor mounts, so its default empty paragraph is never mistaken for cache. */
  hasCachedContent?: boolean
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
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState<DocSyncStatus>({ state: 'connecting' })
  const [peers, setPeers] = useState<PresencePeer[]>([])

  useEffect(() => {
    const doc = new Y.Doc()
    const persistence = new IndexeddbPersistence(docCacheName(localAccountKey(userId), docId), doc)
    const provider = new SocketIOYProvider(docId, doc, [persistence])
    const unsubscribe = provider.onStatus((next) => {
      setStatus(next)
      if (next.state === 'synced') setReady(true)
    })
    let active = true
    const updatePeers = () => {
      const next: PresencePeer[] = []
      provider.awareness.getStates().forEach((state, clientId) => {
        const user = (state as { user?: { name?: string; color?: string } }).user
        if (clientId !== doc.clientID && user?.name) next.push({ clientId, name: user.name, color: user.color ?? sessionColor(clientId) })
      })
      // Keep the list when nothing visible changed, e.g. this session's own cursor moving.
      setPeers((current) => samePeers(current, next) ? current : next)
    }
    // The editor sets this session's awareness while it renders; update the list afterwards.
    const onAwareness = () => queueMicrotask(() => { if (active) updatePeers() })
    provider.awareness.on('change', onAwareness)
    let joinedBeforeCache = false
    const start = () => { if (active) setSession({ doc, provider, hasCachedContent: doc.getXmlFragment(DOC_FRAGMENT_NAME).length > 0 }) }
    // Joining after the cached copy loads lets the handshake upload any edits made offline.
    const timer = window.setTimeout(() => { joinedBeforeCache = true; start() }, LOCAL_CACHE_WAIT_MS)
    void persistence.whenSynced.then(() => {
      if (!active) return
      window.clearTimeout(timer)
      setReady(true)
      if (joinedBeforeCache) {
        start()
        provider.resync()
      }
      else start()
    })
    return () => {
      active = false
      window.clearTimeout(timer)
      unsubscribe()
      provider.awareness.off('change', onAwareness)
      provider.destroy()
      void persistence.destroy()
      doc.destroy()
      setSession(null)
      setReady(false)
      setPeers([])
      setStatus({ state: 'connecting' })
    }
  }, [userId, docId])

  useEffect(() => {
    session?.provider.attach(socket)
  }, [session, socket])

  // The timeout starts networking independently of IndexedDB, but an editor must not create
  // default content until at least one source has loaded. A late empty cache stays empty.
  return { session: ready ? session : null, status, peers }
}

function samePeers(left: PresencePeer[], right: PresencePeer[]): boolean {
  return left.length === right.length && left.every((peer, index) => {
    const other = right[index]!
    return peer.clientId === other.clientId && peer.name === other.name && peer.color === other.color
  })
}
