import { ComposerSync, type ComposerCheckpoint } from '@pulpo/client-core'
import type { Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents, ComposerAck } from '@pulpo/contracts'
import { localAccountKey, localDb } from './database'

const coordinators = new Map<string, ComposerSync>()
export function webComposerSync(userId: string): ComposerSync {
  const account = localAccountKey(userId)
  let sync = coordinators.get(account)
  if (!sync) {
    sync = new ComposerSync({
      load: async (id) => (await localDb.kv.get(`composer-sync:${account}:${id}`))?.value as ComposerCheckpoint | undefined ?? null,
      save: async (id, value) => { await localDb.kv.put({ key: `composer-sync:${account}:${id}`, value, updatedAt: Date.now() }) },
    }, crypto.randomUUID())
    coordinators.set(account, sync)
  }
  return sync
}
export function bindWebComposerSocket(userId: string, socket: Socket<ServerToClientEvents, ClientToServerEvents>): () => void {
  const sync = webComposerSync(userId)
  const connect = () => sync.connect({
    read: (draftId) => new Promise<ComposerAck>((resolve, reject) => socket.timeout(5000).emit('composer.read', { draftId }, (err, result) => err ? reject(err) : resolve(result))),
    write: (input) => new Promise<ComposerAck>((resolve, reject) => socket.timeout(5000).emit('composer.write', input, (err, result) => err ? reject(err) : resolve(result))),
  })
  const disconnect = () => sync.disconnect()
  const receive = sync.receive.bind(sync)
  socket.on('connect', connect)
  socket.on('disconnect', disconnect)
  socket.on('composer.changed', receive)
  window.addEventListener('online', connect)
  const foreground = () => { if (document.visibilityState === 'visible' && socket.connected) connect() }
  document.addEventListener('visibilitychange', foreground)
  if (socket.connected) connect()
  return () => {
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
