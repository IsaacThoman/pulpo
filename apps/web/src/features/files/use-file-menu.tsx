import { useState, type ReactNode, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import type { FileNode } from '@pulpo/contracts'
import { ui } from '@/i18n/ui'
import { writeClipboardText } from '@/lib/clipboard'
import { runtimeInstanceUrl } from '@/lib/runtime'
import { pinSidebarItems } from '@/features/sidebar/api'
import { useSidePanel } from '@/features/side-panel/store'
import { useMainNavigate } from '@/features/side-panel/use-panel-actions'
import { createDoc } from './api'
import { useFileOperations } from './browser/use-file-operations'
import { FileDetailsDialog } from './FileDetailsDialog'
import { FileMoveDialog } from './FileMoveDialog'
import type { FileMenuHost } from './live/chrome/file-menu'
import { focusFileEditorIn } from './live/chrome/use-editor-shortcuts'
import { liveFormatsForNew } from './live/registry'
import { revealFileInPlace } from './reveal'
import { requestTitleFocus } from './title-focus'

/** A file's link in this Pulpo (the desktop app's points at its server). */
export function fileLink(node: Pick<FileNode, 'id'>): string {
  return `${runtimeInstanceUrl()}/files/d/${node.id}`
}

/**
 * The Files page's side of an open document's File menu: New, Make a copy, Download, Copy link,
 * Rename, Move, Pin, Show in folder, Move to trash, and Details, with their dialogs. New documents
 * and copies open where this one is shown; trashing leaves the view (the toast can undo it).
 */
export function useFileMenuHost({ node, ancestors, layout, titleRef, download, downloadPdf }: {
  node: FileNode | undefined
  ancestors: readonly FileNode[]
  layout: 'page' | 'panel'
  /** The title field, which Rename focuses. */
  titleRef: RefObject<HTMLInputElement | null>
  download?: () => void
  downloadPdf?: () => void
}): { host: FileMenuHost | undefined; dialogs: ReactNode } {
  const ops = useFileOperations()
  const navigate = useNavigate()
  const goMain = useMainNavigate()
  const [moving, setMoving] = useState<FileNode[] | null>(null)
  const [details, setDetails] = useState(false)

  if (!node) return { host: undefined, dialogs: null }

  const open = (id: string) => {
    if (layout === 'panel') useSidePanel.getState().open({ kind: 'file', id })
    else navigate(`/files/d/${id}`)
  }

  const host: FileMenuHost = {
    name: node.name,
    create: liveFormatsForNew().filter((entry) => entry.format.id !== 'text').map((entry) => ({
      id: `new-${entry.format.id}`,
      label: entry.typeLabel(),
      icon: entry.icon,
      onSelect: () => {
        void (async () => {
          try {
            const created = await createDoc(node.parentId, entry.newName())
            await ops.refresh()
            requestTitleFocus(created.id)
            open(created.id)
          } catch (cause) {
            ops.fail(cause)
          }
        })()
      },
    })),
    makeCopy: () => {
      void ops.copy([node], node.parentId, 'duplicate').then((created) => {
        const copy = created?.[0]
        if (copy) open(copy.id)
      })
    },
    download,
    downloadPdf,
    copyLink: () => {
      void writeClipboardText(fileLink(node)).then((copied) => ops.notify(copied ? ui("Link copied") : ui("Couldn't copy the link"), copied ? 'default' : 'error'))
    },
    rename: () => titleRef.current?.focus(),
    move: () => setMoving([node]),
    pin: {
      pinned: Boolean(node.pinned),
      toggle: () => { void pinSidebarItems([node.id], !node.pinned, [node]).then(() => ops.refresh(), ops.fail) },
    },
    showInFolder: () => revealFileInPlace(node, layout === 'panel', goMain),
    trash: () => {
      void ops.trash([node]).then((trashed) => {
        if (!trashed) return
        if (layout === 'panel') useSidePanel.getState().close()
        else navigate(node.parentId ? `/files/f/${node.parentId}` : '/files', { replace: true })
      })
    },
    details: () => setDetails(true),
    locked: node.trashedAt !== null,
  }

  // The menu item that opened a dialog is gone once it closes: focus goes back to the document.
  const returnFocus = () => focusFileEditorIn(titleRef.current?.closest('[data-file-view]') ?? null)
  const dialogs = (
    <>
      <FileMoveDialog nodes={moving} onOpenChange={(next) => { if (!next) setMoving(null) }} onMove={(nodes, parentId) => ops.move(nodes, parentId)} returnFocus={returnFocus} />
      <FileDetailsDialog node={node} ancestors={ancestors} open={details} onOpenChange={setDetails} returnFocus={returnFocus} />
    </>
  )
  return { host, dialogs }
}
