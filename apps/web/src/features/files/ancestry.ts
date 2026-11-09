import type { QueryClient } from '@tanstack/react-query'
import type { FileListing, FileNode } from '@pulpo/contracts'
import { fileNodeQueryKey, folderQueryKey } from './api'

/** The folders above `folderId`, as far as cached Files data knows them. */
function cachedAncestorIds(queryClient: QueryClient, userId: string | undefined, folderId: string): string[] {
  const listing = queryClient.getQueryData<FileListing>(folderQueryKey(userId, folderId))
  const node = queryClient.getQueryData<{ ancestors?: FileNode[] }>(fileNodeQueryKey(userId, folderId))
  return (listing?.ancestors ?? node?.ancestors ?? []).map((ancestor) => ancestor.id)
}

/**
 * Whether moving `nodes` into `folderId` would put a folder inside itself, as far as cached data
 * shows (the server refuses it either way). A Files tab can show a folder inside the ones dragged.
 */
export function movesIntoItself(queryClient: QueryClient, userId: string | undefined, folderId: string | null, nodes: readonly Pick<FileNode, 'id'>[]): boolean {
  if (!folderId) return false
  const ids = new Set(nodes.map((node) => node.id))
  return ids.has(folderId) || cachedAncestorIds(queryClient, userId, folderId).some((id) => ids.has(id))
}
