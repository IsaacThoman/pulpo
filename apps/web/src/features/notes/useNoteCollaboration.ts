import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { isDesktopRuntime, runtimeAccountKey, runtimeInstanceUrl, runtimeSessionToken } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'

export interface NotePresence {
  id: string
  name: string
  username?: string
  avatarUrl?: string | null
  color: string
  sessionId: string
}

function noteSessionId(): string {
  const existing = sessionStorage.getItem('pulpo-note-session-id')
  if (existing) return existing
  const created = crypto.randomUUID()
  sessionStorage.setItem('pulpo-note-session-id', created)
  return created
}

export function useNoteCollaboration(noteId: string) {
  const user = useAuth((state) => state.user)
  const sessionId = useMemo(noteSessionId, [])
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [synced, setSynced] = useState(false)
  const [unsyncedChanges, setUnsyncedChanges] = useState(0)
  const [offlineReady, setOfflineReady] = useState(false)
  const [accessRejected, setAccessRejected] = useState(false)
  const [presence, setPresence] = useState<NotePresence[]>([])
  const collaboration = useMemo(() => {
    if (!user) return null
    const document = new Y.Doc()
    const persistence = new IndexeddbPersistence(
      `pulpo-note:${runtimeAccountKey(user.id)}:${noteId}`,
      document,
    )
    const base = new URL(runtimeInstanceUrl())
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    base.pathname = '/notes-collaboration'
    base.search = ''
    base.hash = ''
    const provider = new HocuspocusProvider({
      url: base.toString(),
      name: `note:${noteId}`,
      document,
      token: JSON.stringify({
        sessionId,
        ...(isDesktopRuntime() ? { sessionToken: runtimeSessionToken() } : {}),
      }),
      preserveTrailingSlash: false,
      onStatus: ({ status: next }) => setStatus(next),
      onSynced: ({ state }) => setSynced(state),
      onUnsyncedChanges: ({ number }) => setUnsyncedChanges(number),
      onAuthenticationFailed: () => {
        setAccessRejected(true)
        void persistence.clearData()
      },
    })
    return { document, persistence, provider }
  }, [noteId, sessionId, user])

  useEffect(() => {
    if (!collaboration) return
    let cancelled = false
    void collaboration.persistence.whenSynced.then(() => { if (!cancelled) setOfflineReady(true) })
    const updatePresence = () => {
      const users: NotePresence[] = []
      for (const state of collaboration.provider.awareness?.getStates().values() ?? []) {
        const candidate = state.user as NotePresence | undefined
        if (candidate?.sessionId) users.push(candidate)
      }
      setPresence(users)
    }
    collaboration.provider.awareness?.on('change', updatePresence)
    updatePresence()
    return () => {
      cancelled = true
      collaboration.provider.awareness?.off('change', updatePresence)
      collaboration.provider.destroy()
      void collaboration.persistence.destroy()
      collaboration.document.destroy()
    }
  }, [collaboration])

  return {
    ...collaboration,
    sessionId,
    status,
    synced,
    unsyncedChanges,
    offlineReady,
    accessRejected,
    presence,
  }
}
