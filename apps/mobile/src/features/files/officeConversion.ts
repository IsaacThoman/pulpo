import { convertedFileName, type FileNode, type MobileConfig, type OfficeEditableFormat } from '@pulpo/contracts'
import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { ApiError, apiRequest, apiUrl, nativeAuthorizationHeaders } from '../../api/client'
import { useSessionStore } from '../../store/session'
import { filesCapability } from './availability'

/*
 * Office conversion, as on the web (apps/web/src/features/files/office-file.ts): the server's
 * office converter turns legacy, OpenDocument, and iWork files into docx/xlsx/pptx beside the
 * original, and exports any office file as PDF. Viewing needs nothing new: Quick Look and the
 * Android viewer already open these files.
 */

/** Whether the instance can convert office files; it needs Files and the converter service. */
export function officeConversionAvailable(config: MobileConfig | null | undefined): boolean {
  return filesCapability(config).enabled && config?.capabilities.files?.officeConversion === true
}

export function useOfficeConversionEnabled(): boolean {
  return useSessionStore((state) => officeConversionAvailable(state.config))
}

/** The server waits for the converter, which may queue the job behind others and allows each a minute. */
export const OFFICE_CONVERSION_TIMEOUT_MS = 200_000

/** A converted copy beside the original ("Report.doc" gets "Report.docx", or the next free name). */
export function convertOfficeFile(id: string, to: OfficeEditableFormat): Promise<FileNode> {
  return apiRequest<FileNode>(`/api/files/${id}/conversions`, { method: 'POST', body: { to }, timeoutMs: OFFICE_CONVERSION_TIMEOUT_MS })
}

/** Why a PDF export failed, from the HTTP status the download reported (its body isn't readable there). */
export function pdfExportErrorMessage(error: unknown): string {
  const status = Number(/\b([45]\d\d)\b/.exec(error instanceof Error ? error.message : String(error))?.[1])
  if (status === 422) return 'This file can’t be exported as PDF. It may be password-protected or damaged.'
  if (status === 413) return 'This file is too large to export as PDF.'
  if (status === 503 || status === 429) return 'The converter is busy. Try again in a moment.'
  if (status === 504) return 'Exporting took too long. Try again later.'
  if (status === 404) return 'This file no longer exists, or this server can’t export it.'
  return 'This file couldn’t be exported as PDF. Try again later.'
}

const PDF_DIRECTORY = 'files-pdf'

/** Downloads the server's PDF of an office file into the cache, named "<name>.pdf". */
export async function downloadOfficePdf(node: Pick<FileNode, 'id' | 'name'>): Promise<File> {
  const url = apiUrl(`/api/files/${encodeURIComponent(node.id)}/pdf`)
  const directory = new Directory(Paths.cache, PDF_DIRECTORY, node.id.replace(/[^\da-f-]/gi, ''))
  directory.create({ idempotent: true, intermediates: true })
  const destination = new File(directory, convertedFileName(node.name, 'pdf').replace(/[\\/:*?"<>|]+/g, '-'))
  if (destination.exists) destination.delete()
  try {
    return await File.downloadFileAsync(url, destination, { idempotent: true, headers: nativeAuthorizationHeaders(url) })
  } catch (error) {
    throw new ApiError(0, 'office_pdf_export_failed', pdfExportErrorMessage(error))
  }
}

/** Exports an office file as PDF through the share sheet (save to Files, AirDrop, print, …). */
export async function shareOfficePdf(node: Pick<FileNode, 'id' | 'name'>): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing isn’t available on this device.')
  const file = await downloadOfficePdf(node)
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: convertedFileName(node.name, 'pdf') })
}

/** Removes exported PDFs (signing out). */
export function clearOfficePdfExports(): void {
  try {
    const directory = new Directory(Paths.cache, PDF_DIRECTORY)
    if (directory.exists) directory.delete()
  } catch {
    // Nothing to remove.
  }
}
