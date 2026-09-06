import { ComposerSync, type ComposerCheckpoint } from '@pulpo/client-core'
import type { Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents, ComposerAck, ComposerSnapshot } from '@pulpo/contracts'
import { useComposerSyncPreference } from '@/stores/composer-sync-preference'
import { localAccountKey, localDb } from './database'

const coordinators = new Map<string, ComposerSync>()
export function webComposerSync(userId: string): ComposerSync | null {
  const { enabled, generation } = useComposerSyncPreference.getState()
  if (!enabled) return null
  const account = localAccountKey(userId)
  let sync = coordinators.get(account)
  if (!sync) {
    const key = (id: string) => `composer-sync:${account}:${generation ? `${generation}:` : ''}${id}`
    sync = new ComposerSync({
      recoverShelfContent: async (state) => {
        const drafts = await import('./composer-drafts')
        const local = drafts.runtimeComposerDraft(userId, 'new') ?? await drafts.loadComposerDraft(userId, 'new')
        const attachments = local?.content === state.content ? local.attachments.map((a) => ({
          localId: a.localId, id: a.status === 'ready' ? a.serverId : undefined,
          name: a.name, mimeType: a.mimeType, size: a.size, source: a.file,
        })) : state.attachments.map((a) => ({ ...a, localId: a.id }))
        await (await import('./shelf')).webShelf(userId).saveCopy(state.content, attachments)
      },
      load: async (id) => (await localDb.kv.get(key(id)))?.value as ComposerCheckpoint | undefined ?? null,
      save: async (id, value) => { await localDb.kv.put({ key: key(id), value, updatedAt: Date.now() }) },
    }, crypto.randomUUID())
    coordinators.set(account, sync)
  }
  return sync
}
export function bindWebComposerSocket(userId: string, socket: Socket<ServerToClientEvents, ClientToServerEvents>): () => void {
  let sync: ComposerSync | null = null
  const connect = () => {
    const { enabled, generation } = useComposerSyncPreference.getState()
    socket.auth = { ...(typeof socket.auth === 'object' ? socket.auth : {}), composerSyncEnabled: enabled }
    if (!socket.connected) return
    socket.emit('composer.configure', { enabled })
    sync = webComposerSync(userId)
    if (!sync) return
    const allowed = () => {
      const current = useComposerSyncPreference.getState()
      return current.enabled && current.generation === generation && socket.connected
    }
    sync.connect({
      read: (draftId) => new Promise<ComposerAck>((resolve, reject) => {
        if (!allowed()) { reject(new Error('composer_sync_disabled')); return }
        socket.timeout(5000).emit('composer.read', { draftId }, (err, result) => err ? reject(err) : resolve(result))
      }),
      write: (input) => new Promise<ComposerAck>((resolve, reject) => {
        if (!allowed()) { reject(new Error('composer_sync_disabled')); return }
        socket.timeout(5000).emit('composer.write', input, (err, result) => err ? reject(err) : resolve(result))
      }),
    })
  }
  const disconnect = () => sync?.disconnect()
  const receive = (snapshot: ComposerSnapshot) => {
    if (useComposerSyncPreference.getState().enabled) sync?.receive(snapshot)
  }
  const unsubscribe = useComposerSyncPreference.subscribe((state, previous) => {
    if (state.enabled !== previous.enabled || state.generation !== previous.generation) connect()
  })
  socket.on('connect', connect)
  socket.on('disconnect', disconnect)
  socket.on('composer.changed', receive)
  window.addEventListener('online', connect)
  const foreground = () => { if (document.visibilityState === 'visible' && socket.connected) connect() }
  document.addEventListener('visibilitychange', foreground)
  connect()
  return () => {
    unsubscribe()
    disconnect()
    socket.off('connect', connect); socket.off('disconnect', disconnect); socket.off('composer.changed', receive)
    window.removeEventListener('online', connect)
    document.removeEventListener('visibilitychange', foreground)
  }
}
export function clearWebComposerSync(): void {
  for (const sync of coordinators.values()) sync.dispose()
  coordinators.clear()
}
useComposerSyncPreference.subscribe((state, previous) => {
  if (!state.enabled || state.generation !== previous.generation) clearWebComposerSync()
})
