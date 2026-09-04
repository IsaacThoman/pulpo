import type { FriendsList, NoteDetail, NoteLinkPreview, NoteRole, NoteSourceLockResult, NoteSummary } from '@pulpo/contracts'
import { apiRequest, authenticatedFetch } from '@/lib/api'

export function notesQueryKey(userId: string | undefined, trash = false, query = '') {
  return ['notes', userId, trash ? 'trash' : 'active', query] as const
}

export async function listNotes(trash = false, query = ''): Promise<NoteSummary[]> {
  const params = new URLSearchParams()
  if (trash) params.set('scope', 'trash')
  if (query.trim()) params.set('q', query.trim())
  const suffix = params.size ? `?${params}` : ''
  return apiRequest<{ data: NoteSummary[] }>(`/api/notes${suffix}`).then((result) => result.data)
}

export const getNote = (noteId: string, trash = false) =>
  apiRequest<NoteDetail>(`/api/notes/${noteId}${trash ? '?trash=1' : ''}`)

export const createNote = () => apiRequest<NoteDetail>('/api/notes', { method: 'POST', body: {} })

export const pinNote = (noteId: string, pinned: boolean) =>
  apiRequest<{ pinned: boolean }>(`/api/notes/${noteId}/pin`, { method: 'PATCH', body: { pinned } })

export const trashOrLeaveNote = (noteId: string) =>
  apiRequest<void>(`/api/notes/${noteId}`, { method: 'DELETE' })

export const restoreNote = (noteId: string) =>
  apiRequest<NoteDetail>(`/api/notes/${noteId}/restore`, { method: 'POST' })

export const permanentlyDeleteNote = (noteId: string) =>
  apiRequest<void>(`/api/notes/${noteId}/permanent`, { method: 'DELETE' })

export const updateNoteMember = (noteId: string, userId: string, role: Exclude<NoteRole, 'owner'>) =>
  apiRequest<NoteDetail>(`/api/notes/${noteId}/members/${userId}`, { method: 'PUT', body: { role } })

export const removeNoteMember = (noteId: string, userId: string) =>
  apiRequest<void>(`/api/notes/${noteId}/members/${userId}`, { method: 'DELETE' })

export const getFriends = () => apiRequest<FriendsList>('/api/friends')

export const getLinkPreview = (url: string) =>
  apiRequest<NoteLinkPreview>('/api/notes/link-preview', { method: 'POST', body: { url } })

export const acquireSourceLock = (noteId: string, sessionId: string) =>
  apiRequest<NoteSourceLockResult>(`/api/notes/${noteId}/source-lock`, { method: 'POST', body: { sessionId } })

export const renewSourceLock = (noteId: string, sessionId: string, token: string) =>
  apiRequest<NoteSourceLockResult>(`/api/notes/${noteId}/source-lock`, { method: 'PUT', body: { sessionId, token } })

export const releaseSourceLock = (noteId: string, sessionId: string, token: string) =>
  apiRequest<void>(`/api/notes/${noteId}/source-lock`, { method: 'DELETE', body: { sessionId, token } })

export interface NoteAttachment {
  id: string
  originalName: string
  mimeType: string
  sizeBytes: number
}

export async function uploadNoteAttachment(noteId: string, file: File): Promise<NoteAttachment> {
  const created = await apiRequest<{
    attachment: NoteAttachment
    uploadUrl: string
    uploadHeaders: Record<string, string>
  }>('/api/attachments', {
    method: 'POST',
    body: { noteId, chatId: null, originalName: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size },
  })
  const uploaded = await authenticatedFetch(created.uploadUrl, {
    method: 'PUT',
    headers: created.uploadHeaders,
    body: file,
  })
  if (!uploaded.ok) throw new Error(`Upload failed (${uploaded.status})`)
  await apiRequest(`/api/attachments/${created.attachment.id}/confirm`, { method: 'POST' })
  return created.attachment
}
