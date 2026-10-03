import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderDown } from 'lucide-react'
import { uit, ui } from '@/i18n/ui'
import type { Attachment } from '@/lib/types'
import { useAuth } from '@/stores/auth'
import { deleteFileNodes, filesQueryKey, trashFileNodes } from '@/features/files/api'
import { FolderPickerDialog } from '@/features/files/FileMoveDialog'
import { useFileToasts } from '@/features/files/browser/toasts'
import { useSidePanel } from '@/features/side-panel/store'
import { useOpenBeside } from '@/features/side-panel/use-panel-actions'
import { saveAttachmentToFiles } from './attachment-actions'

/**
 * Whether attachments can be saved to Files here. Admin chat views, the only screens without a
 * side panel, show another account's chat, whose attachments must not land in anyone's Files.
 */
function useCanSaveToFiles(): boolean {
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const panelEnabled = useSidePanel((state) => state.enabled)
  return filesEnabled && panelEnabled
}

/**
 * "Save to Files": choose a folder, then the attachment is copied there on the server. The toast
 * offers to show the new file beside the chat, or to undo.
 */
export function SaveToFilesButton({ attachment, className, iconClassName }: { attachment: Attachment; className: string; iconClassName?: string }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const show = useFileToasts((state) => state.show)
  const openBeside = useOpenBeside()
  if (!useCanSaveToFiles()) return null

  const refresh = () => queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
  const save = async (parentId: string | null) => {
    const node = await saveAttachmentToFiles(attachment.id, parentId)
    void refresh()
    show({
      message: uit`Saved "${node.name}" to Files`,
      action: { label: ui("Show"), run: () => openBeside({ kind: 'file', id: node.id }) },
      undo: async () => {
        try {
          await deleteFileNodes(await trashFileNodes([node.id]))
        } finally {
          await refresh()
        }
      },
    })
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={uit`Save ${attachment.name} to Files`} title={ui("Save to Files")} className={className}>
        <FolderDown className={iconClassName ?? 'size-4'} aria-hidden="true" />
      </button>
      <FolderPickerDialog
        open={open}
        title={uit`Save "${attachment.name}" to Files`}
        confirmLabel={ui("Save here")}
        startFolderId={null}
        onOpenChange={setOpen}
        onConfirm={save}
      />
    </>
  )
}
