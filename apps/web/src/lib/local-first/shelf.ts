import { ShelfSync, shelfComposerCheckpoint, type ComposerCheckpoint, type ShelfAttachment, type ShelfCheckpoint, type ShelfHandoff } from '@pulpo/client-core'
import type { ShelfSnapshot, ClientToServerEvents, ServerToClientEvents } from '@pulpo/contracts'
import type { Socket } from 'socket.io-client'
import { apiRequest, authenticatedFetch, type ApiRequestOptions } from '@/lib/api'
import { useComposerSyncPreference } from '@/stores/composer-sync-preference'
import { localAccountKey, localDb } from './database'
import { saveComposerDraft, type PersistedDraftAttachment } from './composer-drafts'

import { webShelves as shelves } from './shelf-registry'
export { clearWebShelves } from './shelf-registry'
export function shelfDraftAttachments(attachments: ShelfAttachment[]): PersistedDraftAttachment[] {
  return attachments.map((a) => ({ localId: a.localId, serverId: a.id, name: a.name, mimeType: a.mimeType,
    size: a.size, status: a.id ? 'ready' : 'uploading', file: a.source instanceof Blob ? a.source : undefined }))
}
export function webShelf(userId: string): ShelfSync {
  const account = localAccountKey(userId)
  let shelf = shelves.get(account)
  if (shelf) return shelf
  const key = `shelf:${account}`
  const assertSession = async () => {
    const { useAuth } = await import('@/stores/auth')
    if (useAuth.getState().user?.id !== userId || localAccountKey(userId) !== account) throw new Error('Shelf session ended')
  }
  const request = async <T,>(path: string, options?: ApiRequestOptions): Promise<T> => { await assertSession(); return apiRequest<T>(path, options) }
  let tail = Promise.resolve()
  const localLock = <T,>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work, work)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
  shelf = new ShelfSync({
    uuid: () => crypto.randomUUID(),
    replayLock: (work) => typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request(`${key}:replay`, work) : work(),
    lock: (work) => typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request(key, work) : localLock(work),
    load: async () => (await localDb.kv.get(key))?.value as ShelfCheckpoint | undefined ?? null,
    save: async (checkpoint: ShelfCheckpoint, handoff?: ShelfHandoff) => {
      await localDb.transaction('rw', localDb.kv, localDb.drafts, async () => {
        await localDb.kv.put({ key, value: checkpoint, updatedAt: Date.now() })
        if (handoff) {
          if (handoff.isCurrent && !handoff.isCurrent()) throw new Error('The composer changed. Please try again.')
          await saveComposerDraft(userId, 'new', { content: handoff.after.content, attachments: shelfDraftAttachments(handoff.after.attachments) })
          const preference = useComposerSyncPreference.getState()
          if (preference.enabled) {
            const composerKey = `composer-sync:${account}:${preference.generation ? `${preference.generation}:` : ''}new`
            const saved = (await localDb.kv.get(composerKey))?.value as ComposerCheckpoint | undefined
            await localDb.kv.put({ key: composerKey, value: shelfComposerCheckpoint(saved ?? null, handoff), updatedAt: Date.now() })
          }
        }
      })
    },
    read: () => request<ShelfSnapshot>('/api/shelved-drafts'),
    mutate: (body) => request<ShelfSnapshot>('/api/shelved-drafts', { method: 'POST', body }),
    release: async (attachments) => {
      const drafts = await localDb.drafts.where('userId').equals(account).toArray()
      for (const a of attachments) {
        const used = drafts.some((draft) => (draft.attachments as PersistedDraftAttachment[] | undefined)?.some((current) => current.localId === a.localId || a.id && current.serverId === a.id))
        if (!used && a.id) await request(`/api/attachments/${a.id}`, { method: 'DELETE' }).catch(() => undefined)
      }
    },
    upload: async (attachment) => {
      if (!(attachment.source instanceof Blob)) throw new Error(`The local file “${attachment.name}” is unavailable`)
      const reservation = await request<{ attachment: { id: string }; uploadUrl: string; uploadHeaders: Record<string, string> }>('/api/attachments', {
        method: 'POST', body: { chatId: null, originalName: attachment.name, mimeType: attachment.mimeType, sizeBytes: attachment.size },
      })
      try {
        await assertSession()
        const uploaded = await authenticatedFetch(reservation.uploadUrl, { method: 'PUT', body: attachment.source, headers: reservation.uploadHeaders })
        if (!uploaded.ok) throw new Error(`Upload failed (${uploaded.status})`)
        await request(`/api/attachments/${reservation.attachment.id}/confirm`, { method: 'POST' })
        return reservation.attachment.id
      } catch (error) {
        void request(`/api/attachments/${reservation.attachment.id}`, { method: 'DELETE' }).catch(() => undefined)
        throw error
      }
    },
  })
  shelves.set(account, shelf)
  return shelf
}
export function bindWebShelfSocket(userId: string, socket: Socket<ServerToClientEvents, ClientToServerEvents>): () => void {
  const shelf = webShelf(userId)
  const sync = () => { void shelf.sync() }
  const changed = (event: { scopes?: string[] }) => { if (!event.scopes?.length || event.scopes.includes('shelved-drafts')) sync() }
  const foreground = () => { if (document.visibilityState === 'visible') sync() }
  socket.on('connect', sync); socket.on('account.revision', changed)
  window.addEventListener('online', sync); document.addEventListener('visibilitychange', foreground)
  void shelf.hydrate().then(sync).catch(() => undefined)
  return () => { socket.off('connect', sync); socket.off('account.revision', changed); window.removeEventListener('online', sync); document.removeEventListener('visibilitychange', foreground) }
}
