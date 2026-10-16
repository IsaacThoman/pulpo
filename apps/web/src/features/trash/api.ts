import type { FileNode, TrashListing } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'

/** Trashed chats and Files items. Chat and Files changes both refresh this key. */
export const trashQueryKey = (userId: string | undefined) => ['trash', userId] as const

export function fetchTrash(): Promise<TrashListing> {
  return apiRequest<TrashListing>('/api/trash')
}

export async function restoreTrashItems(ids: string[]): Promise<FileNode[]> {
  return (await apiRequest<{ items: FileNode[] }>('/api/trash/restore', { method: 'POST', body: { ids } })).items
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
