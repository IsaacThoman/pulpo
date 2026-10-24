import type { FileNode, SidebarState } from '@pulpo/contracts'
import { ApiError, apiRequest } from '../../api/client'

/*
 * The sidebar is the Chats folder in Files, as on the web (apps/web/src/features/sidebar/api.ts):
 * its folders, files, shortcuts, and chats. These routes work with Files turned off too; the
 * server then lists only folders and shortcuts to folders or chats.
 */

/** The sidebar, or null from a server that predates it (its chat folders are only in /api/folders). */
export async function fetchSidebarState(signal?: AbortSignal): Promise<SidebarState | null> {
  try {
    return await apiRequest<SidebarState>('/api/sidebar', { signal })
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/** A folder's subfolders, files, and shortcuts; its chats come from the chat list. Pinned items are left out. */
export async function fetchSidebarItems(folderId: string, signal?: AbortSignal): Promise<FileNode[]> {
  return (await apiRequest<{ items: FileNode[] }>(`/api/sidebar/folders/${folderId}/items`, { signal })).items
}

/** `id` is chosen here, so a request replayed from the outbox creates the folder only once. */
export function createSidebarFolder(input: { id: string; parentId: string | null; name: string }): Promise<FileNode> {
  return apiRequest<FileNode>('/api/sidebar/folders', { method: 'POST', body: input })
}

/** Moves Files items to the top of a folder; null is the top of the sidebar (not of My files, as in Files). */
export function moveSidebarItems(ids: string[], parentId: string | null): Promise<unknown> {
  return apiRequest('/api/sidebar/move', { method: 'POST', body: { ids, parentId } })
}

/** Renames a folder, file, or shortcut; a name in use gets a number, as in Files. */
export function renameSidebarItem(id: string, name: string): Promise<FileNode> {
  return apiRequest<FileNode>(`/api/sidebar/items/${id}`, { method: 'PATCH', body: { name } })
}

/** Trashes Files items (chats in trashed folders go back to the top of the sidebar); resolves with the ids to restore. */
export async function trashSidebarItems(ids: string[]): Promise<string[]> {
  return (await apiRequest<{ ids: string[] }>('/api/sidebar/trash', { method: 'POST', body: { ids } })).ids
}

export function restoreSidebarItems(ids: string[]): Promise<unknown> {
  return apiRequest('/api/sidebar/restore', { method: 'POST', body: { ids } })
}

/** Moves chats and Files items into the Archive folder, unpinning them. */
export function archiveSidebarItems(input: { chatIds: string[]; fileIds: string[] }): Promise<unknown> {
  return apiRequest('/api/sidebar/archive', { method: 'POST', body: input })
}

/** Puts the pinned list (chats and Files items) in this order, pinning anything listed that is not. */
export function orderPinnedItems(ids: string[]): Promise<unknown> {
  return apiRequest('/api/sidebar/pinned', { method: 'PUT', body: { ids } })
}
