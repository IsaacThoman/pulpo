import { useQueryClient } from '@tanstack/react-query'
import type { FileNode } from '@pulpo/contracts'
import { uit } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'
import {
  copyFileNodes,
  deleteFileNodes,
  downloadDocMarkdown,
  downloadFile,
  filesQueryKey,
  moveFileNodes,
  restoreFileNodes,
  trashFileNodes,
  updateFileNode,
} from '../api'
import { filesErrorMessage } from '../file-display'
import { useFileToasts } from './toasts'

function count(nodes: readonly FileNode[], one: (name: string) => string, many: (count: number) => string): string {
  return nodes.length === 1 ? one(nodes[0]!.name) : many(nodes.length)
}

/**
 * Every tree action the browser offers. Each one refreshes Files views, confirms with a toast
 * that can undo it, and reports failures as an error toast instead of throwing.
 */
export function useFileOperations() {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const show = useFileToasts((state) => state.show)
  const refresh = () => queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })

  const run = async <T>(action: () => Promise<T>, name?: string): Promise<T | undefined> => {
    try {
      return await action()
    } catch (cause) {
      show({ message: filesErrorMessage(cause, name), tone: 'error' })
      return undefined
    } finally {
      await refresh()
    }
  }

  const undoable = (message: string, undo: () => Promise<unknown>) => show({
    message,
    undo: async () => {
      try {
        await undo()
      } finally {
        await refresh()
      }
    },
  })

  const move = async (nodes: readonly FileNode[], parentId: string | null) => {
    const moving = nodes.filter((node) => node.id !== parentId && node.parentId !== parentId)
    if (!moving.length) return
    const moved = await run(() => moveFileNodes(moving.map((node) => ({ id: node.id, parentId }))))
    if (!moved) return
    // The server skips items whose folder is also being moved; undo exactly what it moved.
    const originals = new Map(moving.map((node) => [node.id, node]))
    const renamed = moved.some((node) => originals.get(node.id)?.name !== node.name)
    undoable(
      renamed
        ? count(moving, (name) => uit`Moved "${name}" and kept both copies`, (total) => uit`Moved ${total} items; some were renamed to keep both`)
        : count(moving, (name) => uit`Moved "${name}"`, (total) => uit`Moved ${total} items`),
      () => moveFileNodes(moved.map((node) => originals.get(node.id)!).map((node) => ({ id: node.id, parentId: node.parentId, name: node.name }))),
    )
  }

  const copy = async (all: readonly FileNode[], parentId: string | null, verb: 'copy' | 'duplicate' = 'copy') => {
    // Chats filed here are moved, never copied, from Files.
    const nodes = all.filter((node) => node.kind !== 'chat')
    if (!nodes.length) return
    const created = await run(() => copyFileNodes(nodes.map((node) => node.id), parentId))
    if (!created) return
    const message = verb === 'duplicate'
      ? count(nodes, (name) => uit`Duplicated "${name}"`, (total) => uit`Duplicated ${total} items`)
      : count(nodes, (name) => uit`Pasted "${name}"`, (total) => uit`Pasted ${total} items`)
    const ids = created.map((node) => node.id)
    undoable(message, async () => { await deleteFileNodes(await trashFileNodes(ids)) })
    return created
  }

  const trash = async (nodes: readonly FileNode[]) => {
    if (!nodes.length) return
    const roots = await run(() => trashFileNodes(nodes.map((node) => node.id)))
    if (!roots) return
    undoable(
      count(nodes, (name) => uit`Moved "${name}" to the trash`, (total) => uit`Moved ${total} items to the trash`),
      () => restoreFileNodes(roots),
    )
  }

  const restore = async (nodes: readonly FileNode[]) => {
    if (!nodes.length) return
    const restored = await run(() => restoreFileNodes(nodes.map((node) => node.id)))
    if (!restored) return
    undoable(
      count(nodes, (name) => uit`Restored "${name}"`, (total) => uit`Restored ${total} items`),
      () => trashFileNodes(restored.map((node) => node.id)),
    )
  }

  const deleteForever = async (nodes: readonly FileNode[]) => {
    if (!nodes.length) return
    const done = await run(async () => { await deleteFileNodes(nodes.map((node) => node.id)); return true })
    if (done) show({ message: count(nodes, (name) => uit`Deleted "${name}" forever`, (total) => uit`Deleted ${total} items forever`) })
  }

  /** Resolves false when the rename was rejected, so an inline editor can stay open. */
  const rename = async (node: FileNode, name: string): Promise<boolean> => {
    if (name === node.name) return true
    const renamed = await run(() => updateFileNode(node.id, { name, expectedRevision: node.revision }), name)
    if (!renamed) return false
    undoable(uit`Renamed to "${name}"`, () => updateFileNode(node.id, { name: node.name }))
    return true
  }

  const download = async (nodes: readonly FileNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'folder' || node.kind === 'chat' || node.kind === 'shortcut') continue
      try {
        if (node.kind === 'doc') await downloadDocMarkdown(node)
        else await downloadFile(node)
      } catch (cause) {
        show({ message: filesErrorMessage(cause, node.name), tone: 'error' })
      }
    }
  }

  const notify = (message: string, tone: 'default' | 'error' = 'default') => show({ message, tone })
  const fail = (cause: unknown) => show({ message: filesErrorMessage(cause), tone: 'error' })

  return { move, copy, trash, restore, deleteForever, rename, download, refresh, notify, fail }
}
