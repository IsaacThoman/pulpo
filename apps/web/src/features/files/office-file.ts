import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { canExportOfficePdf, officeConversionTarget, type FileNode, type OfficeEditableFormat } from '@pulpo/contracts'
import { liveFormatOfName } from '@pulpo/client-core/office'
import { ui, uit } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'
import { convertOfficeFile, downloadFileAsPdf, filesQueryKey } from './api'
import { useFileToasts } from './browser/toasts'
import { filesErrorMessage } from './file-display'

/** What the server's office converter can do with a file, if it is configured. */
export function officeFileActions(node: Pick<FileNode, 'kind' | 'name'>, enabled: boolean): { target: OfficeEditableFormat | null; pdf: boolean } {
  if (!enabled || (node.kind !== 'blob' && node.kind !== 'doc')) return { target: null, pdf: false }
  if (node.kind === 'doc' && !['document', 'sheet', 'presentation'].includes(liveFormatOfName(node.name)?.id ?? '')) return { target: null, pdf: false }
  return { target: node.kind === 'blob' ? officeConversionTarget(node.name) : null, pdf: canExportOfficePdf(node.name) }
}

/**
 * Converting and exporting with progress and toasts. Conversion takes a few seconds on the
 * server; the copy appears beside the original and the toast offers to open it.
 */
export function useOfficeConversion(onOpen: (node: FileNode) => void) {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const show = useFileToasts((state) => state.show)
  const dismiss = useFileToasts((state) => state.dismiss)
  // Ids of files being converted or exported; several can run at once.
  const [converting, setConverting] = useState<ReadonlySet<string>>(new Set())
  const [exporting, setExporting] = useState<ReadonlySet<string>>(new Set())
  // The same, read synchronously: menus built before an export started still see it.
  const exportingIds = useRef(new Set<string>())
  const toggle = (set: typeof setConverting, id: string, on: boolean) => set((current) => {
    const next = new Set(current)
    if (on) next.add(id)
    else next.delete(id)
    return next
  })

  const convert = async (node: FileNode, to: OfficeEditableFormat) => {
    toggle(setConverting, node.id, true)
    // Converting takes a few seconds; from the Files list this is the only sign of progress.
    const progress = show({ message: uit`Converting “${node.name}”…`, persistent: true })
    try {
      const created = await convertOfficeFile(node.id, to)
      await queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
      show({ message: uit`Converted to “${created.name}”`, action: { label: ui("Open"), run: () => onOpen(created) } })
      return created
    } catch (cause) {
      show({ message: filesErrorMessage(cause, node.name), tone: 'error' })
      return null
    } finally {
      dismiss(progress)
      toggle(setConverting, node.id, false)
    }
  }

  const downloadPdf = async (node: FileNode) => {
    // One export per file at a time: picking it again while the server converts does nothing.
    if (exportingIds.current.has(node.id)) return
    exportingIds.current.add(node.id)
    toggle(setExporting, node.id, true)
    // The download starts only once the server has converted the file, which takes a few seconds.
    const progress = show({ message: uit`Exporting “${node.name}” as PDF…`, persistent: true })
    try {
      await downloadFileAsPdf(node)
    } catch (cause) {
      show({ message: filesErrorMessage(cause, node.name), tone: 'error' })
    } finally {
      dismiss(progress)
      exportingIds.current.delete(node.id)
      toggle(setExporting, node.id, false)
    }
  }

  return { convert, downloadPdf, converting, exporting }
}

export type OfficeConversion = ReturnType<typeof useOfficeConversion>
