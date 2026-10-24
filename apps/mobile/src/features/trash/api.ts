import type { FileNode, TrashFolderListing, TrashItem, TrashListing, TrashRetention } from '@pulpo/contracts'
import { queryOptions } from '@tanstack/react-query'
import { ApiError, apiRequest, isNetworkError } from '../../api/client'
import { getValue, setValue } from '../../data/database'
import { formatBytes, formatModified } from '../files/display'

/** The trash, or a trashed folder in it, as a Files listing with each item's deadline (as on the web). */
export interface TrashView {
  folder: TrashItem | null
  /** The trashed folders above `folder`, from the one the trash lists down to its parent. */
  ancestors: FileNode[]
  children: TrashItem[]
  retention: TrashRetention
  /** Whether Files items are included (the administrator can turn Files off). */
  files: boolean
  /** Shown from this device's last copy while offline. */
  offline?: boolean
}

/**
 * Under ['files', namespace], so whatever refreshes Files views refreshes the trash too. Chat
 * changes refresh `trashQueryKeys.all`, since trashed chats are listed here as well.
 */
export const trashQueryKeys = {
  all: (namespace: string) => ['files', namespace, 'trash'] as const,
  folder: (namespace: string, folderId: string | null) => ['files', namespace, 'trash', folderId ?? 'root'] as const,
}

const cacheKey = (folderId: string | null) => `files:trash:${folderId ?? 'root'}`

/** Resolves null on servers that predate the shared trash, where the trash only holds chats. */
async function fetchTrashView(folderId: string | null, signal?: AbortSignal): Promise<TrashView | null> {
  if (folderId) return apiRequest<TrashFolderListing>(`/api/trash/folders/${encodeURIComponent(folderId)}`, { signal })
  try {
    const listing = await apiRequest<TrashListing>('/api/trash', { signal })
    return { folder: null, ancestors: [], children: listing.items, retention: listing.retention, files: listing.files }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/**
 * The trash (`folderId` null) or a trashed folder: from the server when reachable; offline, the last
 * copy seen on this device. Deadlines move, so it refreshes now and then while shown.
 */
export function trashQuery(namespace: string, folderId: string | null) {
  return queryOptions({
    queryKey: trashQueryKeys.folder(namespace, folderId),
    queryFn: async ({ signal }): Promise<TrashView | null> => {
      try {
        const view = await fetchTrashView(folderId, signal)
        if (view) void setValue(namespace, cacheKey(folderId), view).catch(() => undefined)
        return view
      } catch (error) {
        if (isNetworkError(error)) {
          const cached = await getValue<TrashView>(namespace, cacheKey(folderId))
          if (cached) return { ...cached, offline: true }
        }
        throw error
      }
    },
    refetchInterval: 60_000,
  })
}

/**
 * Restores items, from the trash or from inside trashed folders: back where they were, or into
 * `destination` (a null `parentId` is the top of My files).
 */
export async function restoreTrashItems(ids: string[], destination?: { parentId: string | null }): Promise<FileNode[]> {
  const body = destination ? { ids, parentId: destination.parentId } : { ids }
  return (await apiRequest<{ items: FileNode[] }>('/api/trash/restore', { method: 'POST', body })).items
}

export function deleteTrashItems(ids: string[]): Promise<unknown> {
  return apiRequest('/api/trash/delete', { method: 'POST', body: { ids } })
}

export function emptyTrash(): Promise<unknown> {
  return apiRequest('/api/trash', { method: 'DELETE' })
}

type TrashedChat = { id: string; title: string; createdAt: number; updatedAt: number; deletedAt: number | null; purgeAt?: number | null }

/** The trash of a server that predates the shared trash: the chat store's trashed chats. */
export function legacyTrashView(chats: readonly TrashedChat[], retention: TrashRetention): TrashView {
  const iso = (time: number) => new Date(time).toISOString()
  const children = chats.filter((chat) => chat.deletedAt !== null).map((chat): TrashItem => ({
    id: chat.id, parentId: null, kind: 'chat', name: chat.title, status: 'ready', mimeType: null, sizeBytes: 0, revision: 0,
    trashedAt: iso(chat.deletedAt!), createdAt: iso(chat.createdAt), updatedAt: iso(chat.updatedAt),
    purgeAt: chat.purgeAt == null ? null : iso(chat.purgeAt),
  }))
  return { folder: null, ancestors: [], children, retention, files: false }
}

/** The line under a trashed item's name: when it was trashed, when it goes, and a file's size. */
export function trashItemSubtitle(item: Pick<TrashItem, 'kind' | 'trashedAt' | 'purgeAt' | 'sizeBytes'>, now = Date.now()): string {
  return [formatModified(item.trashedAt, new Date(now)), trashDeletesLabel(item.purgeAt, now), item.kind === 'blob' ? formatBytes(item.sizeBytes) : null].filter(Boolean).join(' · ')
}

/** When a trashed item is deleted for good, relative to `now`. */
export function trashDeletesLabel(purgeAt: string | null, now = Date.now()): string {
  if (!purgeAt) return 'Kept indefinitely'
  const ms = Date.parse(purgeAt) - now
  if (ms <= 0) return 'Deletes now'
  if (ms < 3_600_000) return `Deletes in ${Math.max(1, Math.ceil(ms / 60_000))}m`
  if (ms < 86_400_000) return `Deletes in ${Math.ceil(ms / 3_600_000)}h`
  return `Deletes in ${Math.ceil(ms / 86_400_000)}d`
}

export const TRASH_RETENTION_LABELS: Record<TrashRetention, string> = {
  instant: 'No retention', '24h': '24 hours', '7d': '7 days', '30d': '30 days', '90d': '90 days', indefinite: 'Indefinitely',
}

/** What the retention setting means for each kind of item, for the trash and Settings. */
export function trashRetentionSummary(retention: TrashRetention, files: boolean): string {
  if (retention === 'instant') {
    return files
      ? 'Chats are deleted right away. Files stay in the trash for 24 hours.'
      : 'Chats are deleted right away. Folders stay in the trash for 24 hours.'
  }
  if (retention === 'indefinite') return 'Items stay in the trash until you delete them.'
  return `Items are deleted forever after ${TRASH_RETENTION_LABELS[retention].toLowerCase()}.`
}
