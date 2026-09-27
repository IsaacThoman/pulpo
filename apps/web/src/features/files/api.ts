import type { FileListing, FileNode, FileUploadReservation, UpdateFileNode } from '@pulpo/contracts'
import { formatAttachmentSizeLimit } from '@pulpo/client-core'
import { ApiError, apiRequest, authenticatedFetch, downloadApiFile, fetchApiBlob } from '@/lib/api'
import { uit } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'

// Every Files query starts with ['files', userId] so the 'files' realtime scope refreshes them all.
export const filesQueryKey = (userId: string | undefined) => ['files', userId] as const
export const folderQueryKey = (userId: string | undefined, folderId: string | null) =>
  [...filesQueryKey(userId), 'folder', folderId ?? 'root'] as const
export const trashQueryKey = (userId: string | undefined) => [...filesQueryKey(userId), 'trash'] as const

export function fetchFolder(folderId: string | null): Promise<FileListing> {
  return apiRequest<FileListing>(folderId ? `/api/files?parentId=${encodeURIComponent(folderId)}` : '/api/files')
}

export async function fetchTrash(): Promise<FileNode[]> {
  return (await apiRequest<{ items: FileNode[] }>('/api/files/trash')).items
}

export function createFolder(parentId: string | null, name: string): Promise<FileNode> {
  return apiRequest<FileNode>('/api/files/folders', { method: 'POST', body: { parentId, name } })
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
