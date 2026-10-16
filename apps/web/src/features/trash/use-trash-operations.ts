import { useQueryClient } from '@tanstack/react-query'
import type { FileNode, TrashListing } from '@pulpo/contracts'
import { ui, uit } from '@/i18n/ui'
import { clearLocalChats } from '@/lib/local-first/chat-cache'
import { useAuth } from '@/stores/auth'
import { filesErrorMessage } from '@/features/files/file-display'
import { useFileToasts } from '@/features/files/browser/toasts'
import { deleteTrashItems, emptyTrash, restoreTrashItems, retrashItems, trashQueryKey } from './api'

function count(items: readonly FileNode[], one: (name: string) => string, many: (count: number) => string): string {
  return items.length === 1 ? one(items[0]!.name) : many(items.length)
}

/**
 * What can be done with trashed items, from the trash folder or by dragging them out of it. Each
 * action refreshes every view it changes and confirms with a toast; failures become error toasts.
 */
export function useTrashOperations() {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const show = useFileToasts((state) => state.show)

  // Restores and deletions change the sidebar, chat list, and Files views as well as the trash.
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: trashQueryKey(userId) }),
    queryClient.invalidateQueries({ queryKey: ['chats', userId] }),
    queryClient.invalidateQueries({ queryKey: ['files', userId] }),
    queryClient.invalidateQueries({ queryKey: ['folders', userId] }),
  ])

  const run = async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await action()
    } catch (cause) {
      show({ message: filesErrorMessage(cause), tone: 'error' })
      return undefined
    } finally {
      await refresh()
    }
  }

  const forgetChats = (items: readonly FileNode[]) => {
    const chatIds = items.filter((item) => item.kind === 'chat').map((item) => item.id)
    if (userId && chatIds.length) void clearLocalChats(userId, chatIds).catch(() => undefined)
  }

  /** Restores items where they were, or into `destination`, offering to undo it. */
  const restore = async (items: readonly FileNode[], destination?: { parentId: string | null }) => {
    if (!items.length) return undefined
    const restored = await run(() => restoreTrashItems(items.map((item) => item.id), destination))
    if (!restored) return undefined
    show({
      message: count(items, (name) => uit`Restored "${name}"`, (total) => uit`Restored ${total} items`),
      undo: async () => {
        try {
          await retrashItems(restored.map((node) => node.id))
        } finally {
          await refresh()
        }
      },
    })
    return restored
  }

  const deleteForever = async (items: readonly FileNode[]) => {
    if (!items.length) return
    const done = await run(async () => { await deleteTrashItems(items.map((item) => item.id)); return true })
    if (!done) return
    forgetChats(items)
    show({ message: count(items, (name) => uit`Deleted "${name}" forever`, (total) => uit`Deleted ${total} items forever`) })
  }

  const empty = async () => {
    // What the trash held, as last listed, so its chats leave this device's cache too.
    const items = queryClient.getQueryData<TrashListing>(trashQueryKey(userId))?.items ?? []
    const done = await run(async () => { await emptyTrash(); return true })
    if (!done) return
    forgetChats(items)
    show({ message: ui("Emptied the trash") })
  }

  return { restore, deleteForever, empty, refresh }
}
