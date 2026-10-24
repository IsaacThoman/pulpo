import type { FileNode } from '@pulpo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { queryKeys } from '../../data/queries'
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore'
import { filesErrorMessage } from '../files/display'
import { filesQueryKeys } from '../files/queries'
import { useFilesToasts } from '../files/toasts'
import { trashSidebarItems } from '../sidebar/api'
import { deleteTrashItems, emptyTrash, restoreTrashItems } from './api'

function count(items: readonly Pick<FileNode, 'name'>[], one: (name: string) => string, many: (count: number) => string): string {
  return items.length === 1 ? one(items[0]!.name) : many(items.length)
}

/**
 * What can be done with trashed items, as on the web (use-trash-operations.ts). Each action
 * refreshes every view it changes and confirms with a toast; failures become error toasts.
 *
 * `legacy` is a server that predates the shared trash: its trash only holds chats, which the chat
 * store restores and deletes.
 */
export function useTrashOperations(namespace: string, legacy = false) {
  const queryClient = useQueryClient()
  const show = useFilesToasts((state) => state.show)
  return useMemo(() => {
    // Restores and deletions change the drawer and the chat lists as well as Files and the trash.
    const refresh = () => Promise.all([
      queryClient.invalidateQueries({ queryKey: filesQueryKeys.all(namespace) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.deletedChats(namespace) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.folders(namespace) }),
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
    const store = () => usePrototypeStore.getState()

    return {
      refresh,

      /** Restores items where they were, or into `destination`, offering to undo it. */
      async restore(items: readonly FileNode[], destination?: { parentId: string | null }): Promise<FileNode[] | undefined> {
        if (!items.length) return undefined
        const message = count(items, (name) => `Restored “${name}”`, (total) => `Restored ${total} items`)
        if (legacy) {
          for (const item of items) store().restoreChat(item.id)
          show({ message })
          return [...items]
        }
        const restored = await run(() => restoreTrashItems(items.map((item) => item.id), destination))
        if (!restored) return undefined
        show({
          message,
          undo: async () => {
            try {
              await trashSidebarItems(restored.map((node) => node.id))
            } catch (cause) {
              show({ message: filesErrorMessage(cause), tone: 'error' })
            } finally {
              await refresh()
            }
          },
        })
        return restored
      },

      async deleteForever(items: readonly FileNode[]): Promise<boolean> {
        if (!items.length) return false
        if (legacy) {
          for (const item of items) store().permanentlyDeleteChat(item.id)
        } else {
          const done = await run(async () => { await deleteTrashItems(items.map((item) => item.id)); return true })
          if (!done) return false
        }
        show({ message: count(items, (name) => `Deleted “${name}” forever`, (total) => `Deleted ${total} items forever`) })
        return true
      },

      async empty(): Promise<boolean> {
        if (legacy) {
          store().emptyTrash()
        } else {
          const done = await run(async () => { await emptyTrash(); return true })
          if (!done) return false
        }
        show({ message: 'Emptied the trash' })
        return true
      },
    }
  }, [legacy, namespace, queryClient, show])
}
