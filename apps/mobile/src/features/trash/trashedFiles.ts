import type { TrashItem, TrashListing } from '@pulpo/contracts'
import { ApiError, apiRequest } from '../../api/client'

/**
 * Files items (and sidebar folders) in the account trash. Trashed chats come from the chat store
 * instead, which works offline; these need a connection.
 */
export const trashedFilesQueryKey = (namespace: string) => ['trashed-files', namespace] as const

/** Resolves null on servers that predate the shared trash, so the screen just shows chats. */
export async function fetchTrashedFiles(): Promise<TrashItem[] | null> {
  try {
    const listing = await apiRequest<TrashListing>('/api/trash')
    return listing.items.filter((item) => item.kind !== 'chat')
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export function restoreTrashedFiles(ids: string[]): Promise<unknown> {
  return apiRequest('/api/trash/restore', { method: 'POST', body: { ids } })
}

export function deleteTrashedFiles(ids: string[]): Promise<unknown> {
  return apiRequest('/api/trash/delete', { method: 'POST', body: { ids } })
}

/** SF Symbol for a trashed Files item (mapped to Material on Android). */
export function trashedFileIcon(item: Pick<TrashItem, 'kind' | 'mimeType' | 'target'>): string {
  const kind = item.kind === 'shortcut' ? item.target?.kind ?? 'blob' : item.kind
  if (kind === 'folder') return 'folder'
  if (kind === 'chat') return 'bubble.left'
  if (kind === 'doc') return 'doc.text'
  return item.mimeType?.startsWith('image/') ? 'photo' : 'doc'
}

/** "deletes in 3d", "deletes in 5h", or "kept indefinitely". */
export function trashDeletesLabel(purgeAt: string | number | null, now = Date.now()): string {
  if (purgeAt === null) return 'kept indefinitely'
  const ms = (typeof purgeAt === 'number' ? purgeAt : Date.parse(purgeAt)) - now
  if (ms <= 0) return 'deletes now'
  if (ms < 3_600_000) return `deletes in ${Math.max(1, Math.ceil(ms / 60_000))}m`
  if (ms < 86_400_000) return `deletes in ${Math.ceil(ms / 3_600_000)}h`
  return `deletes in ${Math.ceil(ms / 86_400_000)}d`
}
