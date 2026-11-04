import { convertedFileName, type FileNode, type MobileConfig, type OfficeEditableFormat } from '@pulpo/contracts'
import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { fetch as expoFetch } from 'expo/fetch'
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

const PDF_DIRECTORY = 'files-pdf'

/**
 * Downloads the server's PDF of an office file into the cache, named "<name>.pdf". The server
 * answers only once the conversion finished, which can take a while, so this uses a fetch with
 * its own long timeout (React Native's HTTP client has none; expo-file-system's download gives
 * up after 10 seconds on Android) and keeps the server's error for the message.
 */
export async function downloadOfficePdf(node: Pick<FileNode, 'id' | 'name'>): Promise<File> {
  if (!/^[\da-f-]{36}$/i.test(node.id)) throw new Error('This item’s id isn’t valid.')
  const url = apiUrl(`/api/files/${node.id}/pdf`)
  const response = await expoFetch(url, { headers: nativeAuthorizationHeaders(url), signal: AbortSignal.timeout(OFFICE_CONVERSION_TIMEOUT_MS) })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null
    throw new ApiError(response.status, body?.error?.code ?? 'office_pdf_export_failed', body?.error?.message ?? `PDF export failed (${response.status})`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const directory = new Directory(Paths.cache, PDF_DIRECTORY, node.id.toLowerCase())
  directory.create({ idempotent: true, intermediates: true })
  const destination = new File(directory, convertedFileName(node.name, 'pdf').replace(/[\\/:*?"<>|]+/g, '-'))
  if (destination.exists) destination.delete()
  destination.create()
  destination.write(bytes)
  return destination
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
