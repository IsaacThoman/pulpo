import type { FileNode } from '@pulpo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { ui, uit } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'
import { deleteFileNodes, fetchFolder, filesQueryKey, restoreFileNodes, trashFileNodes, uploadFile } from '@/features/files/api'
import { uniqueChildName } from '@/features/files/browser/sort'
import { useFileToasts } from '@/features/files/browser/toasts'
import { revealFile } from '@/features/files/reveal'
import { useSidePanel } from '@/features/side-panel/store'
import { useMainNavigate } from '@/features/side-panel/use-panel-actions'

export type Saved = { node: FileNode; replacedId: string | null }
export type SaveToFilesInput = { parentId: string | null; name: string; replaceId?: string }

/**
 * Uploads content made in the browser as a file. Overwriting trashes the old file first so the name
 * is free, and restores it if the upload fails; saving separately numbers the name like the server does.
 */
export async function saveContentToFiles(content: Blob, { parentId, name, replaceId }: SaveToFilesInput): Promise<Saved> {
  const finalName = replaceId ? name : uniqueChildName(name, (await fetchFolder(parentId)).children)
  if (replaceId) await trashFileNodes([replaceId])
  try {
    const node = await uploadFile(parentId, new File([content], finalName, { type: content.type }))
    return { node, replacedId: replaceId ?? null }
  } catch (error) {
    if (replaceId) await restoreFileNodes([replaceId]).catch(() => undefined)
    throw error
  }
}

/**
 * Whether attachments can be saved to Files here. Admin chat views, the only screens without a
 * side panel, show another account's chat, whose attachments must not land in anyone's Files.
 */
export function useCanSaveToFiles(): boolean {
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const panelEnabled = useSidePanel((state) => state.enabled)
  return filesEnabled && panelEnabled
}

/** After saving, the toast offers to show the file in its folder, or to undo (which also restores an overwritten file). */
export function useSavedToFilesToast(): (saved: Saved) => void {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const show = useFileToasts((state) => state.show)
  const go = useMainNavigate()
  return ({ node, replacedId }) => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
    void refresh()
    show({
      message: replacedId ? uit`Overwrote "${node.name}"` : uit`Saved "${node.name}" to Files`,
      action: { label: ui("Show"), run: () => revealFile(node, go) },
      undo: async () => {
        try {
          await deleteFileNodes(await trashFileNodes([node.id]))
          if (replacedId) await restoreFileNodes([replacedId])
        } finally {
          await refresh()
        }
      },
    })
  }
}
