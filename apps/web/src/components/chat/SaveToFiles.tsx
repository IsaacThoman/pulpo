import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, FolderDown, FolderInput } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { uit, ui } from '@/i18n/ui'
import type { Attachment } from '@/lib/types'
import { useAuth } from '@/stores/auth'
import { deleteFileNodes, filesQueryKey, trashFileNodes } from '@/features/files/api'
import { FolderPickerDialog } from '@/features/files/FileMoveDialog'
import { useFileToasts } from '@/features/files/browser/toasts'
import { revealFile } from '@/features/files/reveal'
import { useSidePanel } from '@/features/side-panel/store'
import { useMainNavigate } from '@/features/side-panel/use-panel-actions'
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
 * Keeping an attachment: one button whose menu downloads it or saves it to Files. Saving asks
 * for a folder, copies the attachment there on the server, and offers to show it in that folder
 * or to undo. Where Files is unavailable the button simply downloads.
 */
export function AttachmentSaveMenu({ attachment, onDownload, className }: {
  attachment: Attachment
  onDownload: () => void
  className: string
}) {
  const [picking, setPicking] = useState(false)
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const show = useFileToasts((state) => state.show)
  const go = useMainNavigate()
  const canSave = useCanSaveToFiles()

  if (!canSave) {
    return (
      <button type="button" onClick={onDownload} aria-label={uit`Download ${attachment.name}`} title={ui("Download")} className={className}>
        <Download className="size-4" aria-hidden="true" />
      </button>
    )
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
  const save = async (parentId: string | null) => {
    const node = await saveAttachmentToFiles(attachment.id, parentId)
    void refresh()
    show({
      message: uit`Saved "${node.name}" to Files`,
      action: { label: ui("Show"), run: () => revealFile(node, go) },
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={uit`Save ${attachment.name}`} title={ui("Save")} className={className}>
            <FolderDown className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onDownload}><Download /> {ui("Download")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPicking(true)}><FolderInput /> {ui("Save to Files…")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FolderPickerDialog
        open={picking}
        title={uit`Save "${attachment.name}" to Files`}
        confirmLabel={ui("Save here")}
        startFolderId={null}
        onOpenChange={setPicking}
        onConfirm={save}
      />
    </>
  )
}
