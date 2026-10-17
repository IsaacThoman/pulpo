import type { FileChangesResponse, FileListing, FileNode, SidebarState } from '@pulpo/contracts'
import { queryOptions } from '@tanstack/react-query'
import { isNetworkError } from '../../api/client'
import { fetchFileChanges, fetchFileNode, fetchFolder, fetchSidebar } from './api'
import { cachedListing, cachedNode, cacheListing, cacheNode, forgetStaleDocCopies } from './cache'

/** Every Files query starts with ['files', namespace], so the `files` realtime scope refreshes them all. */
export const filesQueryKeys = {
  all: (namespace: string) => ['files', namespace] as const,
  folder: (namespace: string, folderId: string | null) => ['files', namespace, 'folder', folderId ?? 'root'] as const,
  node: (namespace: string, id: string) => ['files', namespace, 'node', id.toLowerCase()] as const,
  changes: (namespace: string) => ['files', namespace, 'changes'] as const,
  responseChanges: (namespace: string, responseId: string) => ['files', namespace, 'changes', responseId] as const,
  sidebar: (namespace: string) => ['files', namespace, 'sidebar'] as const,
}

/** A listing, from the server when reachable; offline, the last one seen on this device. */
export function folderQuery(namespace: string, folderId: string | null) {
  return queryOptions({
    queryKey: filesQueryKeys.folder(namespace, folderId),
    queryFn: async ({ signal }): Promise<FileListing & { offline?: boolean }> => {
      try {
        const listing = await fetchFolder(folderId, signal)
        void cacheListing(namespace, folderId, listing).catch(() => undefined)
        void forgetStaleDocCopies(namespace, listing.children).catch(() => undefined)
        return listing
      } catch (error) {
        if (isNetworkError(error)) {
          const cached = await cachedListing(namespace, folderId)
          if (cached) return { ...cached, offline: true }
        }
        throw error
      }
    },
  })
}

export type FileNodeLookup = { node: FileNode; ancestors: FileNode[]; offline?: boolean }

/** An item, from the server when reachable; offline, as last seen on this device. Asks once. */
export async function lookUpFileNode(namespace: string, id: string, signal?: AbortSignal): Promise<FileNodeLookup> {
  try {
    const value = await fetchFileNode(id, signal)
    void cacheNode(namespace, value).catch(() => undefined)
    void forgetStaleDocCopies(namespace, [value.node]).catch(() => undefined)
    return value
  } catch (error) {
    if (isNetworkError(error)) {
      const cached = await cachedNode(namespace, id)
      if (cached) return { ...cached, offline: true }
    }
    throw error
  }
}

export function fileNodeQuery(namespace: string, id: string) {
  return queryOptions({
    queryKey: filesQueryKeys.node(namespace, id),
    queryFn: ({ signal }): Promise<FileNodeLookup> => lookUpFileNode(namespace, id, signal),
  })
}

export function fileChangesQuery(namespace: string, responseId: string) {
  return queryOptions({
    queryKey: filesQueryKeys.responseChanges(namespace, responseId),
    queryFn: ({ signal }): Promise<FileChangesResponse> => fetchFileChanges(responseId, signal),
    staleTime: 5_000,
  })
}

export function sidebarQuery(namespace: string) {
  return queryOptions({
    queryKey: filesQueryKeys.sidebar(namespace),
    queryFn: ({ signal }): Promise<SidebarState> => fetchSidebar(signal),
  })
}
