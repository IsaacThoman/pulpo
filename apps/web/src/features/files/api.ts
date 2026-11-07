import type {
  FileChangesResponse,
  FileConversionPreview,
  FileFolderLayout,
  FileListing,
  FileNode,
  FileUploadReservation,
  MoveFileNodes,
  OfficeEditableFormat,
  UpdateFileFolderLayout,
  UpdateFileNode,
} from '@pulpo/contracts'
import { formatAttachmentSizeLimit } from '@pulpo/client-core'
import { convertedFileName } from '@pulpo/contracts'
import { ApiError, apiDownloadUrl, apiRequest, authenticatedFetch, downloadApiFile, fetchApiBlob, fetchApiBlobResponse } from '@/lib/api'
import { uit } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'

// Every Files query starts with ['files', userId] so the 'files' realtime scope refreshes them all.
export const filesQueryKey = (userId: string | undefined) => ['files', userId] as const
export const folderQueryKey = (userId: string | undefined, folderId: string | null) =>
  [...filesQueryKey(userId), 'folder', folderId ?? 'root'] as const
export const folderLayoutQueryKey = (userId: string | undefined, folderId: string | null) =>
  [...filesQueryKey(userId), 'layout', folderId ?? 'root'] as const

export function fetchFolderLayout(folderId: string | null): Promise<FileFolderLayout> {
  return apiRequest<FileFolderLayout>(folderId ? `/api/files/layout?folderId=${encodeURIComponent(folderId)}` : '/api/files/layout')
}

export function updateFolderLayout(input: UpdateFileFolderLayout): Promise<FileFolderLayout> {
  return apiRequest<FileFolderLayout>('/api/files/layout', { method: 'PATCH', body: input })
}

export function fetchFolder(folderId: string | null): Promise<FileListing> {
  return apiRequest<FileListing>(folderId ? `/api/files?parentId=${encodeURIComponent(folderId)}` : '/api/files')
}

export function createFolder(parentId: string | null, name: string): Promise<FileNode> {
  return apiRequest<FileNode>('/api/files/folders', { method: 'POST', body: { parentId, name } })
}

export const fileNodeQueryKey = (userId: string | undefined, id: string) => [...filesQueryKey(userId), 'node', id] as const

export function fetchFileNode(id: string): Promise<{ node: FileNode; ancestors: FileNode[] }> {
  return apiRequest<{ node: FileNode; ancestors: FileNode[] }>(`/api/files/${id}`)
}

export function createDoc(parentId: string | null, name: string, markdown?: string): Promise<FileNode> {
  return apiRequest<FileNode>('/api/files/docs', { method: 'POST', body: { parentId, name, markdown } })
}

/** A web page saved as a document; the server fetches it with the providers the agent's web_fetch uses. */
export function importFromUrl(parentId: string | null, url: string): Promise<FileNode> {
  return apiRequest<FileNode>('/api/files/import-url', { method: 'POST', body: { parentId, url } })
}

export { normalizeImportUrl } from '@pulpo/client-core/files'

/** Dry run of making an uploaded Markdown file editable; nothing changes on the server. */
export function fetchConversionPreview(id: string): Promise<FileConversionPreview> {
  return apiRequest<FileConversionPreview>(`/api/files/${id}/conversion`)
}

/** Makes an uploaded Markdown file an editable document. */
export function convertToDoc(id: string): Promise<FileNode> {
  return apiRequest<FileNode>(`/api/files/${id}/convert`, { method: 'POST' })
}

/** A converted copy of an office file beside it ("Report.doc" gets "Report.docx"); the original stays. */
export function convertOfficeFile(id: string, to: OfficeEditableFormat): Promise<FileNode> {
  return apiRequest<FileNode>(`/api/files/${id}/conversions`, { method: 'POST', body: { to } })
}

/** An office file rendered as PDF by the server, for previews. Nothing is stored. */
export function fetchFilePdf(node: Pick<FileNode, 'id'>, signal?: AbortSignal): Promise<Blob> {
  return fetchApiBlob(`/api/files/${node.id}/pdf?inline=1`, { signal })
}

/** Saves an office file as "<name>.pdf". Failures carry the server's reason (password-protected, damaged…). */
export async function downloadFileAsPdf(node: Pick<FileNode, 'id' | 'name'>): Promise<void> {
  const blob = await fetchApiBlob(`/api/files/${node.id}/pdf`)
  const url = URL.createObjectURL(blob.slice(0, blob.size, 'application/pdf'))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = convertedFileName(node.name, 'pdf')
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/** An open editor exports its local snapshot, including offline edits; the browser fetches others. */
export async function downloadDocMarkdown(node: Pick<FileNode, 'id' | 'name'>, snapshot?: string): Promise<void> {
  const markdown = snapshot ?? (await apiRequest<{ name: string; markdown: string }>(`/api/files/${node.id}/markdown`)).markdown
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = /\.(md|markdown)$/i.test(node.name) ? node.name : `${node.name}.md`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/** Saves bytes under a file's name, like a download the browser started itself. */
function saveBytes(bytes: Uint8Array, name: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/**
 * Downloads a live document as its real file: the open editor's export when given (it includes
 * offline edits), or the server's.
 */
export async function downloadLiveDoc(node: Pick<FileNode, 'id' | 'name' | 'mimeType'>, snapshot?: Uint8Array): Promise<void> {
  if (snapshot) return saveBytes(snapshot, node.name, node.mimeType ?? 'application/octet-stream')
  return downloadApiFile(`/api/files/${node.id}/export`, node.name)
}

/** One side of a live document's agent change, for its review diff. */
export async function fetchChangeContent(changeId: string, side: 'before' | 'after'): Promise<Uint8Array> {
  const response = await fetchApiBlobResponse(`/api/file-changes/${changeId}/content/${side}`)
  return new Uint8Array(await response.arrayBuffer())
}

export function updateFileNode(id: string, input: UpdateFileNode): Promise<FileNode> {
  return apiRequest<FileNode>(`/api/files/${id}`, { method: 'PATCH', body: input })
}

export function trashFileNode(id: string): Promise<void> {
  return apiRequest<void>(`/api/files/${id}/trash`, { method: 'POST' })
}

export function restoreFileNode(id: string): Promise<FileNode> {
  return apiRequest<FileNode>(`/api/files/${id}/restore`, { method: 'POST' })
}

export function deleteFileNode(id: string): Promise<void> {
  return apiRequest<void>(`/api/files/${id}`, { method: 'DELETE' })
}

// Batch operations change every listed item or none of them.
export async function moveFileNodes(items: MoveFileNodes['items']): Promise<FileNode[]> {
  return (await apiRequest<{ nodes: FileNode[] }>('/api/files/batch/move', { method: 'POST', body: { items } })).nodes
}

export async function copyFileNodes(ids: string[], parentId: string | null): Promise<FileNode[]> {
  return (await apiRequest<{ nodes: FileNode[] }>('/api/files/batch/copy', { method: 'POST', body: { ids, parentId } })).nodes
}

/** Returns the ids that became trash entries; a folder's selected contents travel with it. */
export async function trashFileNodes(ids: string[]): Promise<string[]> {
  return (await apiRequest<{ ids: string[] }>('/api/files/batch/trash', { method: 'POST', body: { ids } })).ids
}

export async function restoreFileNodes(ids: string[]): Promise<FileNode[]> {
  return (await apiRequest<{ nodes: FileNode[] }>('/api/files/batch/restore', { method: 'POST', body: { ids } })).nodes
}

export function deleteFileNodes(ids: string[]): Promise<void> {
  return apiRequest<void>('/api/files/batch/delete', { method: 'POST', body: { ids } })
}

/** Reserve → PUT bytes → confirm. A failed upload releases its reservation so the name and quota free up. */
export async function uploadFile(parentId: string | null, file: File): Promise<FileNode> {
  const maxBytes = useAuth.getState().maxAttachmentBytes
  if (file.size > maxBytes) throw new Error(uit`${file.name} is larger than the ${formatAttachmentSizeLimit(maxBytes)} upload limit`)
  const mimeType = file.type || 'application/octet-stream'
  const reservation = await apiRequest<FileUploadReservation>('/api/files/uploads', {
    method: 'POST',
    body: { parentId, name: file.name, mimeType, sizeBytes: file.size },
  })
  try {
    const upload = await authenticatedFetch(reservation.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: reservation.uploadHeaders,
      credentials: reservation.uploadUrl.startsWith('/api/') ? 'include' : 'omit',
    })
    if (!upload.ok) throw new ApiError(upload.status, 'file_upload_failed', uit`Upload failed (${upload.status})`)
    return await apiRequest<FileNode>(`/api/files/${reservation.node.id}/confirm`, { method: 'POST' })
  } catch (error) {
    void deleteFileNode(reservation.node.id).catch(() => undefined)
    throw error
  }
}

export async function fileUrl(node: FileNode): Promise<string> {
  return (await apiRequest<{ url: string }>(`/api/files/${node.id}/download`)).url
}

/**
 * A URL an audio or video element can stream with range requests on its own: signed, so it needs
 * neither the session cookie nor the desktop app's bearer header, and typed as playable media.
 */
export async function fileStreamUrl(node: FileNode): Promise<string> {
  return apiDownloadUrl((await apiRequest<{ url: string }>(`/api/files/${node.id}/stream-url`)).url)
}

/** Local-driver URLs are API routes that need the session; object-store URLs are presigned. */
export const isApiUrl = (url: string) => url.startsWith('/api/')

export async function downloadFile(node: FileNode): Promise<void> {
  const url = await fileUrl(node)
  if (isApiUrl(url)) return downloadApiFile(url, node.name)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = node.name
  anchor.rel = 'noopener'
  anchor.click()
}

export async function fetchFileBlob(node: FileNode): Promise<Blob> {
  const url = await fileUrl(node)
  if (isApiUrl(url)) return fetchApiBlob(url)
  const response = await fetch(url)
  if (!response.ok) throw new ApiError(response.status, 'file_download_failed', uit`Download failed (${response.status})`)
  return response.blob()
}

/** Every reply's list of Files changes; under the Files prefix so Files updates refresh them. */
export const allFileChangesQueryKey = (userId: string | undefined) => [...filesQueryKey(userId), 'changes'] as const
export const fileChangesQueryKey = (userId: string | undefined, responseId: string) =>
  [...allFileChangesQueryKey(userId), responseId] as const

export function fetchFileChanges(responseId: string): Promise<FileChangesResponse> {
  return apiRequest<FileChangesResponse>(`/api/responses/${responseId}/file-changes`)
}

/**
 * Acts on all of a reply's changes: `undo`/`redo` its Write-mode changes, `accept`/`reject` its
 * pending suggestions. Undo and redo fail with `file_changes_conflict` when items changed since.
 */
export function updateFileChanges(responseId: string, action: 'undo' | 'redo' | 'accept' | 'reject'): Promise<FileChangesResponse> {
  return apiRequest<FileChangesResponse>(`/api/responses/${responseId}/file-changes/${action}`, { method: 'POST' })
}

/** Accepts or rejects one suggested change (for a document, all of its suggestions from that reply). */
export function resolveFileChange(changeId: string, action: 'accept' | 'reject'): Promise<FileChangesResponse> {
  return apiRequest<FileChangesResponse>(`/api/file-changes/${changeId}/${action}`, { method: 'POST' })
}

/** Accepts or rejects an item an agent suggested creating; rejecting deletes it (`node` is then null). */
export async function resolveFileSuggestion(id: string, action: 'accept' | 'reject'): Promise<FileNode | null> {
  return (await apiRequest<{ node: FileNode | null }>(`/api/files/${id}/suggestion/${action}`, { method: 'POST' })).node
}
