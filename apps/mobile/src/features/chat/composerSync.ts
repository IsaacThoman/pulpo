import { AppState } from 'react-native'
import { ComposerSync, type ComposerCheckpoint } from '@pulpo/client-core'
import type { ComposerAck, ComposerSnapshot } from '@pulpo/contracts'
import { getValue, setValue } from '../../data/database'
import { usePreferencesStore } from '../../store/preferences'
import type { PulpoSocket } from '../../providers/realtimeStore'

const coordinators = new Map<string, ComposerSync>()
export function mobileComposerSync(namespace: string): ComposerSync | null {
  const { composerSyncEnabled, composerSyncGeneration } = usePreferencesStore.getState()
  if (!composerSyncEnabled) return null
  let sync = coordinators.get(namespace)
  if (!sync) {
    const key = (id: string) => `composer-sync:${composerSyncGeneration ? `${composerSyncGeneration}:` : ''}${id}`
    sync = new ComposerSync({
      recoverShelfContent: async (state) => {
        const { cachedComposerDraft } = await import('./composerDraftCache')
        const local = cachedComposerDraft<{ localId: string; serverId?: string; name: string; mimeType: string; size?: number; uri: string; state?: string }>(`${namespace}\u0000new`)
        const { mobileShelf, durableShelfAttachments } = await import('./shelf')
        const attachments = local?.body === state.content ? durableShelfAttachments(namespace, local.attachments)
          : state.attachments.map((a) => ({ ...a, localId: a.id }))
        await mobileShelf(namespace).saveCopy(state.content, attachments)
      },
      load: (id) => getValue<ComposerCheckpoint>(namespace, key(id)),
      save: (id, value) => setValue(namespace, key(id), value),
    }, `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    coordinators.set(namespace, sync)
  }
  return sync
}
export function bindMobileComposerSocket(namespace: string, socket: PulpoSocket): () => void {
  let sync: ComposerSync | null = null
  const connect = () => {
    const { composerSyncEnabled: enabled, composerSyncGeneration: generation } = usePreferencesStore.getState()
    socket.auth = { ...(typeof socket.auth === 'object' ? socket.auth : {}), composerSyncEnabled: enabled }
    if (!socket.connected) return
    socket.emit('composer.configure', { enabled })
    sync = mobileComposerSync(namespace)
    const allowed = () => {
      const state = usePreferencesStore.getState()
      return state.composerSyncEnabled && state.composerSyncGeneration === generation && socket.connected
    }
    sync?.connect({
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
  const unsubscribe = usePreferencesStore.subscribe((state, previous) => {
    if (state.composerSyncEnabled !== previous.composerSyncEnabled || state.composerSyncGeneration !== previous.composerSyncGeneration) connect()
  })
  const disconnect = () => sync?.disconnect()
  const receive = (snapshot: ComposerSnapshot) => { if (usePreferencesStore.getState().composerSyncEnabled) sync?.receive(snapshot) }
  socket.on('connect', connect); socket.on('disconnect', disconnect); socket.on('composer.changed', receive)
  const appState = AppState.addEventListener('change', (phase) => { if (phase === 'active' && socket.connected) connect() })
  connect()
  return () => { unsubscribe(); appState.remove(); disconnect(); socket.off('connect', connect); socket.off('disconnect', disconnect); socket.off('composer.changed', receive) }
}
export function clearMobileComposerSync(namespace: string): void {
  coordinators.get(namespace)?.dispose()
  coordinators.delete(namespace)
}
usePreferencesStore.subscribe((state, previous) => {
  if (!state.composerSyncEnabled || state.composerSyncGeneration !== previous.composerSyncGeneration) {
    for (const namespace of coordinators.keys()) clearMobileComposerSync(namespace)
  }
})
