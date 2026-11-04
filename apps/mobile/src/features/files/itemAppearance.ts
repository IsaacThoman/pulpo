import type { FileListing, FileNode, SidebarState } from '@pulpo/contracts'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { apiRequest } from '../../api/client'
import { productionActions, runProductionAction } from '../../mockup5/src/production/productionActions'
import { isTrashFolder } from '../trash/folder'
import { restyled, storedAppearanceIds, type AppearanceChange } from './appearance'
import { filesErrorMessage } from './display'
import { refreshFiles } from './operations'
import { filesQueryKeys, type FileNodeLookup } from './queries'
import { useFilesToasts, type FilesToast } from './toasts'

/** Changes an item's color or icon; the sidebar route takes Files items whether or not Files is on (as on the web). */
export function setItemAppearance(id: string, change: AppearanceChange): Promise<FileNode> {
  return apiRequest<FileNode>(`/api/sidebar/items/${id}`, { method: 'PATCH', body: change })
}

/**
 * Shows the change at once wherever Files and the drawer list these items (folder listings,
 * looked-up items such as a chat's scope, and the sidebar), shortcuts to them included.
 */
export function restyleCachedItems(client: QueryClient, namespace: string, ids: readonly string[], change: AppearanceChange): void {
  const changed = new Set(ids)
  const restyle = (node: FileNode) => restyled(node, changed, change)
  for (const [key, data] of client.getQueriesData<unknown>({ queryKey: filesQueryKeys.all(namespace) })) {
    if (!data) continue
    const [, , area, part] = key
    if (area === 'folder') {
      const listing = data as FileListing
      client.setQueryData<FileListing>(key, {
        ...listing,
        folder: listing.folder && restyle(listing.folder),
        ancestors: listing.ancestors.map(restyle),
        children: listing.children.map(restyle),
      })
    } else if (area === 'node') {
      const lookup = data as FileNodeLookup
      client.setQueryData<FileNodeLookup>(key, { ...lookup, node: restyle(lookup.node) })
    } else if (area === 'sidebar' && part === 'items') {
      client.setQueryData<FileNode[]>(key, (data as FileNode[]).map(restyle))
    } else if (area === 'sidebar' && part === 'state') {
      const state = data as SidebarState
      if (state.pinnedItems) client.setQueryData<SidebarState>(key, { ...state, pinnedItems: state.pinnedItems.map(restyle) })
    }
  }
}

type ShowToast = (toast: Omit<FilesToast, 'id' | 'tone'> & { tone?: FilesToast['tone'] }) => void

/**
 * Applies one color or icon choice to files and folders, as the web's appearance dialog does: it
 * shows at once, is sent, and is confirmed or put back by refetching; failures show in a toast.
 * The trash isn't stored in Files, so its color is the synchronized `trashColor` setting.
 */
export async function applyItemAppearance(client: QueryClient, namespace: string, show: ShowToast, nodes: readonly FileNode[], change: AppearanceChange): Promise<void> {
  if ('color' in change && nodes.some(isTrashFolder)) {
    runProductionAction(productionActions.setPreference('trashColor', change.color), {
      onError: (cause) => show({ message: filesErrorMessage(cause), tone: 'error' }),
    })
  }
  const ids = storedAppearanceIds(nodes)
  if (!ids.length) return
  await client.cancelQueries({ queryKey: filesQueryKeys.all(namespace) })
  restyleCachedItems(client, namespace, ids, change)
  try {
    await Promise.all(ids.map((id) => setItemAppearance(id, change)))
  } catch (cause) {
    show({ message: filesErrorMessage(cause, nodes.length === 1 ? nodes[0]!.name : undefined), tone: 'error' })
  } finally {
    await refreshFiles(client, namespace)
  }
}

export function useItemAppearance(namespace: string) {
  const client = useQueryClient()
  const show = useFilesToasts((state) => state.show)
  return useMemo(() => (nodes: readonly FileNode[], change: AppearanceChange) => applyItemAppearance(client, namespace, show, nodes, change), [client, namespace, show])
}
