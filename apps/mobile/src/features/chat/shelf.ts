import { AppState } from 'react-native'
import { Directory, File, Paths } from 'expo-file-system'
import * as Crypto from 'expo-crypto'
import { ShelfSync, type ShelfAttachment } from '@pulpo/client-core'
import type { ShelfSnapshot } from '@pulpo/contracts'
import { getValue, saveShelfCheckpoint, shelfFileIsUsedByDraft, cacheNamespace } from '../../data/database'
import { createOperationQueue } from '../../data/operationQueue'
import { apiRequest } from '../../api/client'
import { usePreferencesStore } from '../../store/preferences'
import { uploadAttachment } from './api'
import type { PulpoSocket } from '../../providers/realtimeStore'

import { mobileShelves as shelves } from './shelf-registry'
export { clearMobileShelf } from './shelf-registry'
export function shelfComposerAttachments(attachments: ShelfAttachment[]) {
  return attachments.map((a) => ({
    id: a.id ?? a.localId, serverId: a.id, localId: a.localId, ownerId: 'draft:new',
    name: a.name, mimeType: a.mimeType, size: a.size, uri: typeof a.source === 'string' ? a.source : '',
    kind: a.mimeType.startsWith('image/') ? 'image' as const : 'file' as const,
    state: a.id ? 'ready' as const : 'local' as const, managed: !a.id, attempt: 0,
  }))
}
export function durableShelfAttachments(namespace: string, attachments: Array<{ localId: string; serverId?: string; name: string; mimeType: string; size?: number; uri: string; state?: string }>): ShelfAttachment[] {
  const directory = new Directory(Paths.document, 'shelved-drafts', encodeURIComponent(namespace))
  directory.create({ intermediates: true, idempotent: true })
  return attachments.map((a) => {
    let source: string | undefined
    if (a.uri && new File(a.uri).exists) {
      const destination = new File(directory, encodeURIComponent(a.localId))
      if (!destination.exists) new File(a.uri).copy(destination)
      source = destination.uri
    }
    if (!source && !(a.serverId && a.state === 'ready')) throw new Error(`The local file “${a.name}” is unavailable`)
    return { localId: a.localId, id: a.state === 'ready' ? a.serverId : undefined, name: a.name, mimeType: a.mimeType, size: a.size ?? 0, source }
  })
}
export function mobileShelf(namespace: string): ShelfSync {
  let shelf = shelves.get(namespace)
  if (!shelf) {
    const assertSession = async () => {
      const { useSessionStore } = await import('../../store/session')
      const session = useSessionStore.getState()
      if (!session.user || cacheNamespace(session.instanceUrl, session.user.id) !== namespace) throw new Error('Shelf session ended')
    }
    const request = async <T,>(path: string, options?: Parameters<typeof apiRequest>[1]): Promise<T> => { await assertSession(); return apiRequest<T>(path, options) }
    shelf = new ShelfSync({
      uuid: () => Crypto.randomUUID(), lock: createOperationQueue(),
      load: () => getValue(namespace, 'shelved-drafts'),
      save: (checkpoint, handoff) => {
        const preference = usePreferencesStore.getState()
        return saveShelfCheckpoint(namespace, checkpoint, handoff ? {
          body: handoff.after.content, attachments: shelfComposerAttachments(handoff.after.attachments), handoff,
          syncKey: preference.composerSyncEnabled ? `composer-sync:${preference.composerSyncGeneration ? `${preference.composerSyncGeneration}:` : ''}new` : undefined,
        } : undefined)
      },
      read: () => request<ShelfSnapshot>('/api/shelved-drafts'),
      mutate: (body) => request<ShelfSnapshot>('/api/shelved-drafts', { method: 'POST', body }),
      release: async (attachments) => {
        for (const a of attachments) {
          if (await shelfFileIsUsedByDraft(namespace, a.localId, a.id)) continue
          if (a.id) {
            try { await request(`/api/attachments/${a.id}`, { method: 'DELETE' }) } catch { continue }
          }
          if (typeof a.source === 'string') { const file = new File(a.source); if (file.exists) file.delete() }
        }
      },
      upload: async (a) => (await uploadAttachment({ localId: a.localId, name: a.name, mimeType: a.mimeType,
        sizeBytes: a.size, uri: String(a.source), state: 'uploading' }, null, assertSession)).id,
    })
    shelves.set(namespace, shelf)
  }
  return shelf
}
export function bindMobileShelfSocket(namespace: string, socket: PulpoSocket): () => void {
  const shelf = mobileShelf(namespace)
  const sync = () => { void shelf.sync() }
  const changed = (event: { scopes?: string[] }) => { if (!event.scopes?.length || event.scopes.includes('shelved-drafts')) sync() }
  socket.on('connect', sync); socket.on('account.revision', changed)
  const appState = AppState.addEventListener('change', (state) => { if (state === 'active') sync() })
  void shelf.hydrate().then(sync).catch(() => undefined)
  return () => { socket.off('connect', sync); socket.off('account.revision', changed); appState.remove() }
}
