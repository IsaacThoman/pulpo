import type { FileNode } from '@pulpo/contracts'
import { uniqueChildName } from '@pulpo/client-core/files'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore'
import {
  copyFileNodes,
  createDoc,
  createFolder,
  deleteFileNodes,
  moveFileNodes,
  pinItems,
  resolveFileSuggestion,
  restoreFileNodes,
  trashFileNodes,
  updateFileNode,
} from './api'
import { filesErrorMessage } from './display'
import { filesQueryKeys } from './queries'
import { useFilesToasts } from './toasts'

function count(nodes: readonly Pick<FileNode, 'name'>[], one: (name: string) => string, many: (count: number) => string): string {
  return nodes.length === 1 ? one(nodes[0]!.name) : many(nodes.length)
}

/** Refetches every Files view (the trash among them), and the chat lists when chats moved or were trashed through Files. */
export function refreshFiles(queryClient: QueryClient, namespace: string, chats = false): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: filesQueryKeys.all(namespace) }),
    chats ? queryClient.invalidateQueries({ queryKey: ['chats', namespace] }) : null,
    chats ? queryClient.invalidateQueries({ queryKey: ['folders', namespace] }) : null,
  ])
}

/**
 * Every tree action Files offers on mobile, as on the web (use-file-operations.ts): each one
 * refreshes Files views, confirms with a toast that can undo it unless the change shows in place,
 * and reports failures in an error toast instead of throwing. They need a connection; documents
 * are what can be edited offline.
 */
export function useFileOperations(namespace: string) {
  const queryClient = useQueryClient()
  const show = useFilesToasts((state) => state.show)
  return useMemo(() => {
    const refresh = (chats = false) => refreshFiles(queryClient, namespace, chats)
    const run = async <T>(action: () => Promise<T>, name?: string, chats = false): Promise<T | undefined> => {
      try {
        return await action()
      } catch (cause) {
        show({ message: filesErrorMessage(cause, name), tone: 'error' })
        return undefined
      } finally {
        await refresh(chats)
      }
    }
    const undoable = (message: string, undo: () => Promise<unknown>, chats = false) => show({
      message,
      undo: async () => {
        try {
          await undo()
        } catch (cause) {
          show({ message: filesErrorMessage(cause), tone: 'error' })
        } finally {
          await refresh(chats)
        }
      },
    })
    const hasChats = (nodes: readonly FileNode[]) => nodes.some((node) => node.kind === 'chat')

    return {
      refresh,
      notify: (message: string, tone: 'default' | 'error' = 'default') => show({ message, tone }),
      fail: (cause: unknown, name?: string) => show({ message: filesErrorMessage(cause, name), tone: 'error' }),

      async createFolder(parentId: string | null, name: string): Promise<FileNode | undefined> {
        return run(() => createFolder(parentId, name.trim()), name.trim())
      },

      /** A new empty document named after `siblings`' free "Untitled.md". */
      async createDocument(parentId: string | null, siblings: readonly FileNode[], name = 'Untitled.md'): Promise<FileNode | undefined> {
        return run(() => createDoc(parentId, uniqueChildName(name, siblings)))
      },

      /** Resolves false when the rename was refused, so a prompt can offer it again. */
      async rename(node: FileNode, name: string): Promise<boolean> {
        const next = name.trim()
        if (!next || next === node.name) return true
        return Boolean(await run(() => updateFileNode(node.id, { name: next, expectedRevision: node.revision }), next, node.kind === 'chat'))
      },

      async move(nodes: readonly FileNode[], parentId: string | null): Promise<void> {
        const moving = nodes.filter((node) => node.id !== parentId && node.parentId !== parentId)
        if (!moving.length) return
        const chats = hasChats(moving)
        const moved = await run(() => moveFileNodes(moving.map((node) => ({ id: node.id, parentId }))), undefined, chats)
        if (!moved) return
        const originals = new Map(moving.map((node) => [node.id, node]))
        const renamed = moved.some((node) => originals.get(node.id)?.name !== node.name)
        undoable(
          renamed
            ? count(moving, (name) => `Moved “${name}” and kept both copies`, (total) => `Moved ${total} items; some were renamed to keep both`)
            : count(moving, (name) => `Moved “${name}”`, (total) => `Moved ${total} items`),
          // The server skips items whose folder is also being moved; undo exactly what it moved.
          () => moveFileNodes(moved.map((node) => originals.get(node.id)!).map((node) => ({ id: node.id, parentId: node.parentId, name: node.name }))),
          chats,
        )
      },

      async duplicate(all: readonly FileNode[], parentId: string | null): Promise<FileNode[] | undefined> {
        // Chats filed here are duplicated from the chat menu, never copied from Files.
        const nodes = all.filter((node) => node.kind !== 'chat')
        if (!nodes.length) return undefined
        const created = await run(() => copyFileNodes(nodes.map((node) => node.id), parentId))
        if (!created) return undefined
        const ids = created.map((node) => node.id)
        undoable(count(nodes, (name) => `Duplicated “${name}”`, (total) => `Duplicated ${total} items`), async () => { await deleteFileNodes(await trashFileNodes(ids)) })
        return created
      },

      async trash(nodes: readonly FileNode[]): Promise<boolean> {
        if (!nodes.length) return false
        const chats = hasChats(nodes)
        const roots = await run(() => trashFileNodes(nodes.map((node) => node.id)), undefined, chats)
        if (!roots) return false
        // With instant retention, chats are deleted for good rather than trashed, so they cannot come back.
        const chatIds = new Set(nodes.filter((node) => node.kind === 'chat').map((node) => node.id))
        const forGood = chatIds.size > 0 && usePrototypeStore.getState().preferences.trashRetention === 'instant'
        const restorable = forGood ? roots.filter((id) => !chatIds.has(id)) : roots
        const message = forGood
          ? count(nodes, (name) => `Deleted “${name}”`, (total) => `Deleted ${total} items`)
          : count(nodes, (name) => `Moved “${name}” to the trash`, (total) => `Moved ${total} items to the trash`)
        if (restorable.length) undoable(message, () => restoreFileNodes(restorable), chats)
        else show({ message })
        return true
      },

      async restore(nodes: readonly FileNode[]): Promise<void> {
        if (!nodes.length) return
        const restored = await run(() => restoreFileNodes(nodes.map((node) => node.id)), undefined, hasChats(nodes))
        if (!restored) return
        undoable(count(nodes, (name) => `Restored “${name}”`, (total) => `Restored ${total} items`), () => trashFileNodes(restored.map((node) => node.id)), hasChats(nodes))
      },

      async deleteForever(nodes: readonly FileNode[]): Promise<void> {
        if (!nodes.length) return
        const done = await run(async () => { await deleteFileNodes(nodes.map((node) => node.id)); return true }, undefined, hasChats(nodes))
        if (done) show({ message: count(nodes, (name) => `Deleted “${name}” forever`, (total) => `Deleted ${total} items forever`) })
      },

      async setPinned(nodes: readonly FileNode[], pinned: boolean): Promise<void> {
        if (!nodes.length) return
        await run(() => pinItems(nodes.map((node) => node.id), pinned), undefined, hasChats(nodes))
      },

      /** Accepts or rejects an item the agent suggested creating; rejecting deletes it. */
      async resolveSuggestion(node: FileNode, action: 'accept' | 'reject'): Promise<FileNode | null | undefined> {
        const result = await run(() => resolveFileSuggestion(node.id, action), node.name)
        if (result !== undefined) {
          show({ message: action === 'accept' ? `Kept “${node.name}”` : `Removed “${node.name}”` })
          await queryClient.invalidateQueries({ queryKey: filesQueryKeys.changes(namespace) })
        }
        return result
      },
    }
  }, [namespace, queryClient, show])
}

export type FileOperations = ReturnType<typeof useFileOperations>
