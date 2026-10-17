import type { FileNode, SidebarState } from '@pulpo/contracts'
import { type QueryClient, useQuery } from '@tanstack/react-query'
import { pinItems } from './api'
import { refreshFiles } from './operations'
import { filesQueryKeys, sidebarQuery } from './queries'

/** A pinned Files item (folder, file, or shortcut) in the drawer's Pinned list. */
export interface PinnedFileEntry {
  kind: 'file'
  id: string
  node: FileNode
}

const EMPTY: readonly FileNode[] = []

/**
 * The pinned Files items, which share the drawer's Pinned list with the pinned chats (as in the web
 * sidebar). Pinned chats come from the chat list, so they are not among these.
 */
export function usePinnedFileItems(namespace: string, enabled: boolean): readonly FileNode[] {
  const query = useQuery({ ...sidebarQuery(namespace), enabled: enabled && Boolean(namespace), staleTime: 30_000 })
  return enabled ? query.data?.pinnedItems ?? EMPTY : EMPTY
}

/** The last position among pinned Files items, so a chat pinned now goes after them too. */
export function pinnedFileItemsCeiling(items: readonly FileNode[]): number {
  return items.reduce((max, item) => Math.max(max, item.sortOrder ?? 0), -1)
}

/** Unpins a Files item, taking it out of the drawer at once; it comes back if the server refuses. */
export async function unpinFileItem(queryClient: QueryClient, namespace: string, node: FileNode): Promise<void> {
  const key = filesQueryKeys.sidebar(namespace)
  await queryClient.cancelQueries({ queryKey: key })
  queryClient.setQueryData<SidebarState>(key, (state) => state && { ...state, pinnedItems: state.pinnedItems?.filter((item) => item.id !== node.id) })
  try {
    await pinItems([node.id], false)
  } finally {
    await refreshFiles(queryClient, namespace)
  }
}

type Ordered = { id: string; sortOrder: number; createdAt: number }

/**
 * Adds the pinned Files items to the Pinned section (creating it first when only Files items are
 * pinned), in the order the pinned list shares with chats: manual order, newest first among ties.
 */
export function withPinnedFileItems<T extends Ordered>(
  sections: ReadonlyArray<{ title: string; data: T[] }>,
  items: readonly FileNode[],
): Array<{ title: string; data: Array<T | PinnedFileEntry> }> {
  if (!items.length) return sections as Array<{ title: string; data: Array<T | PinnedFileEntry> }>
  const pinned = sections[0]?.title === 'Pinned' ? sections[0] : null
  const order = (entry: T | PinnedFileEntry) => 'node' in entry
    ? { sortOrder: entry.node.sortOrder ?? 0, createdAt: Date.parse(entry.node.createdAt) }
    : { sortOrder: entry.sortOrder, createdAt: entry.createdAt }
  const data: Array<T | PinnedFileEntry> = [
    ...(pinned?.data ?? []),
    ...items.map((node): PinnedFileEntry => ({ kind: 'file', id: node.id, node })),
  ].sort((left, right) => {
    const a = order(left)
    const b = order(right)
    return a.sortOrder - b.sortOrder || b.createdAt - a.createdAt
  })
  return [{ title: 'Pinned', data }, ...(pinned ? sections.slice(1) : sections)]
}

export function isPinnedFileEntry(entry: object): entry is PinnedFileEntry {
  return 'node' in entry && (entry as { kind?: unknown }).kind === 'file'
}
