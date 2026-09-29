import type { FileConversionPreview, FileFolderLayout, FileListing, FileNode, FileUploadReservation, MoveFileNodes, UpdateFileFolderLayout, UpdateFileNode } from '@pulpo/contracts'
import { formatAttachmentSizeLimit } from '@pulpo/client-core'
import { ApiError, apiRequest, authenticatedFetch, downloadApiFile, fetchApiBlob } from '@/lib/api'
import { uit } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'

// Every Files query starts with ['files', userId] so the 'files' realtime scope refreshes them all.
export const filesQueryKey = (userId: string | undefined) => ['files', userId] as const
export const folderQueryKey = (userId: string | undefined, folderId: string | null) =>
  [...filesQueryKey(userId), 'folder', folderId ?? 'root'] as const
export const trashQueryKey = (userId: string | undefined) => [...filesQueryKey(userId), 'trash'] as const
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

export async function fetchTrash(): Promise<FileNode[]> {
  return (await apiRequest<{ items: FileNode[] }>('/api/files/trash')).items
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

/** Dry run of making an uploaded Markdown file editable; nothing changes on the server. */
export function fetchConversionPreview(id: string): Promise<FileConversionPreview> {
  return apiRequest<FileConversionPreview>(`/api/files/${id}/conversion`)
}

/** Makes an uploaded Markdown file an editable document. */
export function convertToDoc(id: string): Promise<FileNode> {
  return apiRequest<FileNode>(`/api/files/${id}/convert`, { method: 'POST' })
}

/** Saves a document as a .md file, with the latest edits folded in by the server. */
export async function downloadDocMarkdown(node: Pick<FileNode, 'id' | 'name'>): Promise<void> {
  const { markdown } = await apiRequest<{ name: string; markdown: string }>(`/api/files/${node.id}/markdown`)
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = /\.(md|markdown)$/i.test(node.name) ? node.name : `${node.name}.md`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
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

export function emptyTrash(): Promise<void> {
  return apiRequest<void>('/api/files/trash', { method: 'DELETE' })
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
