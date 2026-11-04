import type { FileNode } from '@pulpo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { ui, uit } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'
import { deleteFileNodes, filesQueryKey, restoreFileNodes, trashFileNodes } from '@/features/files/api'
import { useFileToasts } from '@/features/files/browser/toasts'
import { revealFile } from '@/features/files/reveal'
import { useSidePanel } from '@/features/side-panel/store'
import { useMainNavigate } from '@/features/side-panel/use-panel-actions'

export type Saved = { node: FileNode; replacedId: string | null }
export type SaveToFilesInput = { parentId: string | null; name: string; replaceId?: string }

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
