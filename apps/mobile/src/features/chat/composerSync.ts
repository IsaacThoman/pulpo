import { AppState } from 'react-native'
import { ComposerSync, type ComposerCheckpoint } from '@pulpo/client-core'
import type { ComposerAck } from '@pulpo/contracts'
import { getValue, setValue } from '../../data/database'
import type { PulpoSocket } from '../../providers/realtimeStore'

const coordinators = new Map<string, ComposerSync>()
export function mobileComposerSync(namespace: string): ComposerSync {
  let sync = coordinators.get(namespace)
  if (!sync) {
    sync = new ComposerSync({
      load: (id) => getValue<ComposerCheckpoint>(namespace, `composer-sync:${id}`),
      save: (id, value) => setValue(namespace, `composer-sync:${id}`, value),
    }, `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    coordinators.set(namespace, sync)
  }
  return sync
}
export function bindMobileComposerSocket(namespace: string, socket: PulpoSocket): () => void {
  const sync = mobileComposerSync(namespace)
  const connect = () => sync.connect({
    read: (draftId) => new Promise<ComposerAck>((resolve, reject) => socket.timeout(5000).emit('composer.read', { draftId }, (err, result) => err ? reject(err) : resolve(result))),
    write: (input) => new Promise<ComposerAck>((resolve, reject) => socket.timeout(5000).emit('composer.write', input, (err, result) => err ? reject(err) : resolve(result))),
  })
  const disconnect = () => sync.disconnect()
  const receive = sync.receive.bind(sync)
  socket.on('connect', connect); socket.on('disconnect', disconnect); socket.on('composer.changed', receive)
  const appState = AppState.addEventListener('change', (phase) => { if (phase === 'active' && socket.connected) connect() })
  if (socket.connected) connect()
  return () => { appState.remove(); disconnect(); socket.off('connect', connect); socket.off('disconnect', disconnect); socket.off('composer.changed', receive) }
}
export function clearMobileComposerSync(namespace: string): void {
  coordinators.get(namespace)?.dispose()
  coordinators.delete(namespace)
}
