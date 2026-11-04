import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { canExportOfficePdf, officeConversionTarget, type FileNode, type OfficeEditableFormat } from '@pulpo/contracts'
import { ui, uit } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'
import { convertOfficeFile, downloadFileAsPdf, filesQueryKey } from './api'
import { useFileToasts } from './browser/toasts'
import { filesErrorMessage } from './file-display'

/** What the server's office converter can do with a file, if it is configured. */
export function officeFileActions(node: Pick<FileNode, 'kind' | 'name'>, enabled: boolean): { target: OfficeEditableFormat | null; pdf: boolean } {
  if (!enabled || node.kind !== 'blob') return { target: null, pdf: false }
  return { target: officeConversionTarget(node.name), pdf: canExportOfficePdf(node.name) }
}

/**
 * Converting and exporting with progress and toasts. Conversion takes a few seconds on the
 * server; the copy appears beside the original and the toast offers to open it.
 */
export function useOfficeConversion(onOpen: (node: FileNode) => void) {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const show = useFileToasts((state) => state.show)
  const [converting, setConverting] = useState<string | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)

  const convert = async (node: FileNode, to: OfficeEditableFormat) => {
    setConverting(node.id)
    try {
      const created = await convertOfficeFile(node.id, to)
      await queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
      show({ message: uit`Converted to “${created.name}”`, action: { label: ui("Open"), run: () => onOpen(created) } })
      return created
    } catch (cause) {
      show({ message: filesErrorMessage(cause, node.name), tone: 'error' })
      return null
    } finally {
      setConverting(null)
    }
  }

  const downloadPdf = async (node: FileNode) => {
    setExporting(node.id)
    try {
      await downloadFileAsPdf(node)
    } catch (cause) {
      show({ message: filesErrorMessage(cause, node.name), tone: 'error' })
    } finally {
      setExporting(null)
    }
  }

  return { convert, downloadPdf, converting, exporting }
}

export type OfficeConversion = ReturnType<typeof useOfficeConversion>
