import { useQuery } from '@tanstack/react-query'
import type { FileNode, FileProject, UpdateFileProjectInput } from '@pulpo/contracts'
import { create } from 'zustand'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { filesQueryKey } from './api'

/**
 * Project folders: a Files folder whose chats (in it or its subfolders, with their side chats and
 * threads) start with its instructions and memory.
 */

// Under ['files', userId], so the 'files' realtime scope (a rename, say) refreshes it.
export const folderProjectQueryKey = (userId: string | undefined, folderId: string) =>
  [...filesQueryKey(userId), 'project', folderId] as const

export async function fetchFolderProject(folderId: string, signal?: AbortSignal): Promise<FileProject | null> {
  return (await apiRequest<{ project: FileProject | null }>(`/api/files/${folderId}/project`, { signal })).project
}

/** Makes the folder a project, or updates it. */
export async function saveFolderProject(folderId: string, input: UpdateFileProjectInput): Promise<FileProject> {
  return (await apiRequest<{ project: FileProject }>(`/api/files/${folderId}/project`, { method: 'PUT', body: input })).project
}

/** Turns the project back into a plain folder; its chats and files stay. */
export function removeFolderProject(folderId: string): Promise<void> {
  return apiRequest<void>(`/api/files/${folderId}/project`, { method: 'DELETE' })
}

/** Whether a Files item can be made a project: a folder of the user's own, not a built-in one. */
export function canBeProject(node: Pick<FileNode, 'kind' | 'systemRole' | 'trashedAt'>): boolean {
  return node.kind === 'folder' && !node.systemRole && !node.trashedAt
}

/** The project a folder is, or null; loaded when `enabled`. */
export function useFolderProject(folderId: string | null | undefined, enabled = true) {
  const userId = useAuth((state) => state.user?.id)
  const filesEnabled = useAuth((state) => state.filesEnabled)
  return useQuery({
    queryKey: folderProjectQueryKey(userId, folderId ?? ''),
    queryFn: ({ signal }) => fetchFolderProject(folderId!, signal),
    enabled: Boolean(enabled && filesEnabled && userId && folderId),
    staleTime: 30_000,
    retry: false,
  })
}

/**
 * The folder whose project settings are open, if any. The Sidebar renders the dialog
 * (ProjectDialog), so any view can open it.
 */
export const useProjectEditor = create<{ folder: { id: string; name: string } | null }>()(() => ({ folder: null }))

export function editProject(folder: Pick<FileNode, 'id' | 'name'>) {
  useProjectEditor.setState({ folder: { id: folder.id, name: folder.name } })
}
