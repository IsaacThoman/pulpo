import type { FileNode, SidebarState } from '@pulpo/contracts'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'

// 'sidebar' keeps the persisted cache apart from the old chat folder list stored at ['folders', userId].
export const sidebarQueryKey = (userId: string | undefined) => ['folders', userId, 'sidebar'] as const
export const sidebarItemsKey = (userId: string | undefined, folderId: string) => ['folders', userId, 'items', folderId] as const

/**
 * The lowest order among the Files items the sidebar has loaded for a folder (null: the Chats
 * folder). Chats and items share one order, so a chat placed at the top goes above this.
 */
export function sidebarItemsFloor(folderId: string | null): number {
  const userId = useAuth.getState().user?.id
  const id = folderId ?? queryClient.getQueryData<SidebarState>(sidebarQueryKey(userId))?.chatsFolderId
  if (!id) return Infinity
  const items = queryClient.getQueryData<FileNode[]>(sidebarItemsKey(userId, id)) ?? []
  return items.reduce((min, item) => Math.min(min, item.sortOrder ?? 0), Infinity)
}
