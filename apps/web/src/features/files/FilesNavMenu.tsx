import { useRef } from 'react'
import { FILE_SCOPE_ROOT } from '@pulpo/contracts'
import { FilePlus2, FolderPlus, PanelRight, SquarePen, Upload } from 'lucide-react'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { FileContextMenu, type ContextMenuPoint } from '@/features/files/browser/FileContextMenu'
import { useFilesPageRequest, type FilesPageRequest } from '@/features/files/files-page-request'
import { openInNewChat } from '@/features/side-panel/agent'
import { useSidePanel } from '@/features/side-panel/store'
import { openBeside } from '@/features/side-panel/use-panel-actions'

/**
 * The right-click menu for the sidebar's Files button: the My files background menu, so files
 * can be created or uploaded without opening the page first.
 */
export function FilesNavMenu({ point, onClose, go }: {
  point: ContextMenuPoint | null
  onClose: () => void
  go: (pathname: string) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const splitAvailable = useSidePanel((state) => state.splitAvailable)
  // The page carries the request out, so new items are renamed in place and uploads show progress.
  const request = (next: FilesPageRequest) => {
    useFilesPageRequest.setState({ request: next })
    go('/files')
  }
  return (
    <>
      <FileContextMenu point={point} onClose={onClose}>
        <DropdownMenuItem onSelect={() => request({ kind: 'newFile' })}><FilePlus2 /> {ui("New file")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => request({ kind: 'newFolder' })}><FolderPlus /> {ui("New folder")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => fileInput.current?.click()}><Upload /> {ui("Upload files")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {splitAvailable && <DropdownMenuItem onSelect={() => openBeside({ kind: 'folder', id: null }, go)}><PanelRight /> {ui("Open to the right")}</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => openInNewChat([FILE_SCOPE_ROOT], null, go)}><SquarePen /> {ui("Open in new chat")}</DropdownMenuItem>
      </FileContextMenu>
      {/* Outside the menu, which closes before the file picker returns. */}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length) request({ kind: 'upload', files })
        }}
      />
    </>
  )
}
