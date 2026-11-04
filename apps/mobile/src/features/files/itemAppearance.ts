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

/** Each item's latest appearance save, so successive choices reach the server in the order they were made. */
const appearanceWrites = new Map<string, Promise<unknown>>()

/**
 * Sends a change after any earlier one for the same item has settled. Tapping colors quickly would
 * otherwise send overlapping requests, and the server keeps whichever arrives last.
 */
function queueItemAppearance(id: string, change: AppearanceChange): Promise<FileNode> {
  const write = (appearanceWrites.get(id) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => setItemAppearance(id, change))
  appearanceWrites.set(id, write)
  const settle = () => { if (appearanceWrites.get(id) === write) appearanceWrites.delete(id) }
  write.then(settle, settle)
  return write
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
  // Every save in the batch settles before deciding whether to refresh, so a refused item is put back
  // even while another one was still being saved.
  const results = await Promise.allSettled(ids.map((id) => queueItemAppearance(id, change)))
  const refused = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (refused) show({ message: filesErrorMessage(refused.reason, nodes.length === 1 ? nodes[0]!.name : undefined), tone: 'error' })
  // A later choice for these items is still on its way; refetching now would briefly show this one.
  // That later change refreshes once it is saved.
  if (!ids.some((id) => appearanceWrites.has(id))) await refreshFiles(client, namespace)
}

export function useItemAppearance(namespace: string) {
  const client = useQueryClient()
  const show = useFilesToasts((state) => state.show)
  return useMemo(() => (nodes: readonly FileNode[], change: AppearanceChange) => applyItemAppearance(client, namespace, show, nodes, change), [client, namespace, show])
}
