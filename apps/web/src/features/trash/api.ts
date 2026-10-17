import type { FileNode, TrashFolderListing, TrashListing } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'

/** Trashed chats and Files items. Chat and Files changes both refresh this key and those below it. */
export const trashQueryKey = (userId: string | undefined) => ['trash', userId] as const
export const trashFolderQueryKey = (userId: string | undefined, folderId: string) => [...trashQueryKey(userId), 'folder', folderId] as const

export function fetchTrash(): Promise<TrashListing> {
  return apiRequest<TrashListing>('/api/trash')
}

/** A trashed folder's contents. */
export function fetchTrashFolder(folderId: string): Promise<TrashFolderListing> {
  return apiRequest<TrashFolderListing>(`/api/trash/folders/${folderId}`)
}

/**
 * Restores items, from the trash or from inside trashed folders: back where they were, or into
 * `destination` (a null `parentId` is the top of My files).
 */
export async function restoreTrashItems(ids: string[], destination?: { parentId: string | null }): Promise<FileNode[]> {
  const body = destination ? { ids, parentId: destination.parentId } : { ids }
  return (await apiRequest<{ items: FileNode[] }>('/api/trash/restore', { method: 'POST', body })).items
}

export function deleteTrashItems(ids: string[]): Promise<void> {
  return apiRequest<void>('/api/trash/delete', { method: 'POST', body: { ids } })
}

export function emptyTrash(): Promise<void> {
  return apiRequest<void>('/api/trash', { method: 'DELETE' })
}

/** Moves restored items back to the trash (undo). Works for chats and Files items, with or without Files. */
export async function retrashItems(ids: string[]): Promise<string[]> {
  return (await apiRequest<{ ids: string[] }>('/api/sidebar/trash', { method: 'POST', body: { ids } })).ids
}
