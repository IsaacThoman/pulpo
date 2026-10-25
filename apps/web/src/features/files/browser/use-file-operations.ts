import { useQueryClient } from '@tanstack/react-query'
import type { FileNode } from '@pulpo/contracts'
import { uit } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
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
import { trashQueryKey } from '@/features/trash/api'
import { filesErrorMessage } from '../file-display'
import { downloadRecordingClip, fetchRecording } from '../recording/api'
import { useFileToasts } from './toasts'

function count(nodes: readonly FileNode[], one: (name: string) => string, many: (count: number) => string): string {
  return nodes.length === 1 ? one(nodes[0]!.name) : many(nodes.length)
}

/**
 * Every tree action the browser offers. Each one refreshes Files views, confirms with a toast
 * that can undo it unless the change shows in place (a move or rename), and reports failures as
 * an error toast instead of throwing.
 */
export function useFileOperations() {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const show = useFileToasts((state) => state.show)
  // The trash lists what Files trashes, so it refreshes with it.
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) }),
    queryClient.invalidateQueries({ queryKey: trashQueryKey(userId) }),
  ])

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
    // A move shows in place, as in the sidebar, so it only needs a toast when names changed to
    // keep both copies. The server skips items whose folder is also being moved; undo exactly what it moved.
    const originals = new Map(moving.map((node) => [node.id, node]))
    if (!moved.some((node) => originals.get(node.id)?.name !== node.name)) return
    undoable(
      count(moving, (name) => uit`Moved "${name}" and kept both copies`, (total) => uit`Moved ${total} items; some were renamed to keep both`),
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
    // With instant retention, chats are deleted for good rather than trashed, so they cannot come
    // back; the sidebar says the same.
    const chatIds = new Set(nodes.filter((node) => node.kind === 'chat').map((node) => node.id))
    const forGood = chatIds.size > 0 && useSettings.getState().trashRetention === 'instant'
    const restorable = forGood ? roots.filter((id) => !chatIds.has(id)) : roots
    const message = forGood
      ? count(nodes, (name) => uit`Deleted "${name}"`, (total) => uit`Deleted ${total} items`)
      : count(nodes, (name) => uit`Moved "${name}" to the trash`, (total) => uit`Moved ${total} items to the trash`)
    if (restorable.length) undoable(message, () => restoreFileNodes(restorable))
    else show({ message })
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
    // A rename shows in place, as in the sidebar, so it needs no toast.
    return Boolean(await run(() => updateFileNode(node.id, { name, expectedRevision: node.revision }), name))
  }

  const download = async (nodes: readonly FileNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'folder' || node.kind === 'chat' || node.kind === 'shortcut') continue
      try {
        if (node.kind === 'doc') await downloadDocMarkdown(node)
        else if (node.kind === 'recording') {
          // A recording downloads as the audio of its takes.
          for (const clip of (await fetchRecording(node.id)).clips) await downloadRecordingClip(node.id, clip.id)
        } else await downloadFile(node)
      } catch (cause) {
        show({ message: filesErrorMessage(cause, node.name), tone: 'error' })
      }
    }
  }

  const notify = (message: string, tone: 'default' | 'error' = 'default') => show({ message, tone })
  const fail = (cause: unknown) => show({ message: filesErrorMessage(cause), tone: 'error' })

  return { move, copy, trash, restore, deleteForever, rename, download, refresh, notify, fail }
}
