import type {
  FileChangesResponse,
  FileConversionPreview,
  FileListing,
  FileNode,
  FileUploadReservation,
  MoveFileNodes,
  UpdateFileNode,
} from '@pulpo/contracts'
import { attachmentValidationError, retryBusyUpload } from '@pulpo/client-core'
import { Directory, File, Paths } from 'expo-file-system'
import { ApiError, apiRequest, apiUrl, nativeAuthorizationHeaders } from '../../api/client'
import { cacheNamespace } from '../../data/database'
import { useSessionStore } from '../../store/session'
import { cachedFileUri, recordCachedFile } from './cache'

/*
 * The Files API, as the web client uses it (apps/web/src/features/files/api.ts). Every call takes
 * the bearer session; Files routes answer 403 `files_disabled` while an administrator has Files off.
 */

export function fetchFolder(folderId: string | null, signal?: AbortSignal): Promise<FileListing> {
  return apiRequest<FileListing>(folderId ? `/api/files?parentId=${encodeURIComponent(folderId)}` : '/api/files', { signal })
}

export function fetchFileNode(id: string, signal?: AbortSignal): Promise<{ node: FileNode; ancestors: FileNode[] }> {
  return apiRequest<{ node: FileNode; ancestors: FileNode[] }>(`/api/files/${encodeURIComponent(id)}`, { signal })
}

export function createFolder(parentId: string | null, name: string): Promise<FileNode> {
  return apiRequest<FileNode>('/api/files/folders', { method: 'POST', body: { parentId, name } })
}

export function createDoc(parentId: string | null, name: string, markdown?: string): Promise<FileNode> {
  return apiRequest<FileNode>('/api/files/docs', { method: 'POST', body: { parentId, name, markdown } })
}

export function updateFileNode(id: string, input: UpdateFileNode): Promise<FileNode> {
  return apiRequest<FileNode>(`/api/files/${id}`, { method: 'PATCH', body: input })
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

/** Dry run of making an uploaded Markdown file editable; nothing changes on the server. */
export function fetchConversionPreview(id: string): Promise<FileConversionPreview> {
  return apiRequest<FileConversionPreview>(`/api/files/${id}/conversion`)
}

export function convertToDoc(id: string): Promise<FileNode> {
  return apiRequest<FileNode>(`/api/files/${id}/convert`, { method: 'POST' })
}

/** A document's Markdown as the server has it, without pending suggestions. */
export async function fetchDocMarkdown(id: string): Promise<{ name: string; markdown: string }> {
  return apiRequest<{ name: string; markdown: string }>(`/api/files/${id}/markdown`)
}

export function pinItems(ids: string[], pinned: boolean): Promise<unknown> {
  return apiRequest('/api/sidebar/pin', { method: 'POST', body: { ids, pinned } })
}

/** Saves a chat attachment into Files; `replaceId` overwrites that file instead of keeping both. */
export function saveAttachmentToFiles(attachmentId: string, input: { parentId: string | null; name?: string; replaceId?: string }): Promise<FileNode> {
  return apiRequest<FileNode>(`/api/attachments/${attachmentId}/save-to-files`, { method: 'POST', body: input })
}

export function fetchFileChanges(responseId: string, signal?: AbortSignal): Promise<FileChangesResponse> {
  return apiRequest<FileChangesResponse>(`/api/responses/${responseId}/file-changes`, { signal })
}

/**
 * Acts on all of a reply's changes: `undo`/`redo` its Write-mode changes, `accept`/`reject` its
 * pending suggestions. Undo and redo fail with `file_changes_conflict` when items changed since.
 */
export function updateFileChanges(responseId: string, action: 'undo' | 'redo' | 'accept' | 'reject'): Promise<FileChangesResponse> {
  return apiRequest<FileChangesResponse>(`/api/responses/${responseId}/file-changes/${action}`, { method: 'POST', timeoutMs: 60_000 })
}

export function resolveFileChange(changeId: string, action: 'accept' | 'reject'): Promise<FileChangesResponse> {
  return apiRequest<FileChangesResponse>(`/api/file-changes/${changeId}/${action}`, { method: 'POST', timeoutMs: 60_000 })
}

/** Accepts or rejects an item an agent suggested creating; rejecting deletes it (`node` is then null). */
export async function resolveFileSuggestion(id: string, action: 'accept' | 'reject'): Promise<FileNode | null> {
  return (await apiRequest<{ node: FileNode | null }>(`/api/files/${id}/suggestion/${action}`, { method: 'POST', timeoutMs: 60_000 })).node
}

export interface LocalUpload {
  uri: string
  name: string
  mimeType: string
  sizeBytes: number
}

/**
 * Reserve, PUT the bytes, confirm. `onReserved` reports the placeholder as soon as it exists, so
 * the caller (the upload queue) can release it if anything later fails; `assertActive` stops the
 * upload when the account it belongs to is no longer the one signed in.
 */
export async function uploadFile(parentId: string | null, upload: LocalUpload, options: {
  onReserved?: (node: FileNode) => void
  assertActive?: () => void
} = {}): Promise<FileNode> {
  const maxBytes = useSessionStore.getState().config?.limits?.maxAttachmentBytes
  const validation = attachmentValidationError({ name: upload.name, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes }, maxBytes)
  if (validation) throw new ApiError(413, 'file_too_large', validation)
  options.assertActive?.()
  const reservation = await apiRequest<FileUploadReservation>('/api/files/uploads', {
    method: 'POST',
    body: { parentId, name: upload.name, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes },
  })
  options.onReserved?.(reservation.node)
  const url = apiUrl(reservation.uploadUrl)
  const source = new File(upload.uri)
  const result = await retryBusyUpload(async () => {
    options.assertActive?.()
    let response: Awaited<ReturnType<File['upload']>>
    try {
      response = await source.upload(url, {
        httpMethod: 'PUT',
        mimeType: upload.mimeType,
        headers: { ...reservation.uploadHeaders, ...nativeAuthorizationHeaders(url) },
      })
    } catch (error) {
      // The system's own transfer failed without an answer from the server (the connection went,
      // or timed out; its wording varies by platform and language). With the file still there, the
      // upload is tried again on reconnecting (a few times; see the upload queue).
      if (!source.exists) throw error
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { retry: true, transfer: true })
    }
    if (response.status === 503) throw Object.assign(new Error('Uploads are busy'), { status: 503 })
    return response
  })
  if (result.status < 200 || result.status >= 300) throw new ApiError(result.status, 'file_upload_failed', `Upload failed (${result.status})`)
  options.assertActive?.()
  // The server reads the whole object back to check it, which takes a while for large files.
  return apiRequest<FileNode>(`/api/files/${reservation.node.id}/confirm`, { method: 'POST', timeoutMs: 120_000 })
}

/** What identifies an uploaded file's current content; new content changes it. */
export function fileContentVersion(node: Pick<FileNode, 'updatedAt' | 'sizeBytes' | 'revision' | 'contentChecksum'>): string {
  // Node revisions include metadata changes. A checksum follows only the bytes, so renaming or
  // moving a downloaded file (also from another device) keeps it available offline. Without a
  // checksum from an older server, keep conservative invalidation rather than risk stale bytes.
  if (node.contentChecksum) return `checksum:${node.contentChecksum}|${node.sizeBytes}`
  return `${node.updatedAt}|${node.sizeBytes}|${node.revision}`
}

function safeName(name: string): string {
  const cleaned = Array.from(name, (character) => (character.codePointAt(0) ?? 0) < 32 ? '-' : character).join('')
    .replace(/[\\/:*?"<>|]+/g, '-').trim().replace(/^\.+$/, '')
  return cleaned.slice(-120) || 'file'
}

const ITEM_ID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

function cacheDestination(node: Pick<FileNode, 'id' | 'name'>): File {
  // The id names a directory, so it must be one (never a path from an untrusted server).
  if (!ITEM_ID.test(node.id)) throw new Error('This item’s id isn’t valid.')
  const directory = new Directory(Paths.cache, 'files', node.id.toLowerCase())
  directory.create({ idempotent: true, intermediates: true })
  return new File(directory, safeName(node.name))
}

function currentNamespace(): string | null {
  const { instanceUrl, user } = useSessionStore.getState()
  return user ? cacheNamespace(instanceUrl, user.id) : null
}

/** Keeps a just-uploaded file's bytes as the account's downloaded copy, so opening it needs no download. */
export async function cacheUploadedFile(namespace: string, node: FileNode, sourceUri: string): Promise<void> {
  const source = new File(sourceUri)
  if (!source.exists) return
  const destination = cacheDestination(node)
  if (source.uri !== destination.uri) await source.copy(destination, { overwrite: true })
  await recordCachedFile(namespace, node.id, fileContentVersion(node), destination)
}

const downloads = new Map<string, Promise<File>>()

/**
 * The uploaded file's bytes on this device: the cached copy while its content is unchanged,
 * else downloaded (presigned object-store URL, or the instance's own route with the session).
 */
export function downloadFile(node: FileNode): Promise<File> {
  const version = fileContentVersion(node)
  const key = `${node.id}|${version}`
  const existing = downloads.get(key)
  if (existing) return existing
  const pending = (async () => {
    const namespace = currentNamespace()
    if (namespace) {
      const cached = await cachedFileUri(namespace, node.id, version)
      if (cached) {
        const file = new File(cached)
        if (file.exists) {
          const destination = cacheDestination(node)
          if (file.uri === destination.uri) return file
          // Quick Look and sharing take the displayed name from this path. Keep the bytes
          // through a rename too; only retire the old path after the new copy is recorded.
          try {
            await file.copy(destination, { overwrite: true })
          } catch {
            return file
          }
          if (currentNamespace() !== namespace) {
            if (destination.exists) destination.delete()
            throw new Error('The account changed while the file was opening.')
          }
          await recordCachedFile(namespace, node.id, version, destination)
          return destination
        }
      }
    }
    const { url: rawUrl } = await apiRequest<{ url: string }>(`/api/files/${node.id}/download`)
    const url = apiUrl(rawUrl)
    const destination = cacheDestination(node)
    if (destination.exists) destination.delete()
    const file = await File.downloadFileAsync(url, destination, { idempotent: true, headers: nativeAuthorizationHeaders(url) })
    // Signed out (or switched) meanwhile: that account's files were removed, and this one goes too.
    if (currentNamespace() !== namespace) {
      if (file.exists) file.delete()
      throw new Error('The account changed while the file was downloading.')
    }
    if (namespace) await recordCachedFile(namespace, node.id, version, file)
    return file
  })()
  downloads.set(key, pending)
  void pending.then(() => downloads.delete(key), () => downloads.delete(key))
  return pending
}

const EXPORT_DIRECTORY = 'files-export'

/** Writes Markdown to a shareable temporary file named after the document. */
export function markdownExportFile(name: string, markdown: string): File {
  const directory = new Directory(Paths.cache, EXPORT_DIRECTORY)
  directory.create({ idempotent: true, intermediates: true })
  const file = new File(directory, safeName(/\.(md|markdown)$/i.test(name) ? name : `${name}.md`))
  if (file.exists) file.delete()
  file.create()
  file.write(markdown)
  return file
}

/** Removes exported Markdown (signing out); exports are only kept for the share sheet. */
export function clearMarkdownExports(): void {
  try {
    const directory = new Directory(Paths.cache, EXPORT_DIRECTORY)
    if (directory.exists) directory.delete()
  } catch {
    // Nothing to remove.
  }
}
