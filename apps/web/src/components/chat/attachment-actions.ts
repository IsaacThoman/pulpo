import type { FileNode } from '@pulpo/contracts'
import type { Attachment } from '@/lib/types'
import { apiRequest } from '@/lib/api'
import { downloadBlob } from '@/lib/code-download'
import { downloadAttachment } from '@/lib/local-first/attachment-cache'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
import type { UploadRecord } from '@/stores/upload-outbox'
import { openBeside, panelContentPath } from '@/features/side-panel/use-panel-actions'
import { useSidePanel } from '@/features/side-panel/store'

export const attachmentQueryKey = (userId: string | undefined, id: string) => ['attachment', userId, id] as const

/** An attachment with the chat it was sent in, for linking back to it. */
export type ChatAttachment = Attachment & { chatId?: string | null }

export async function fetchAttachment(id: string): Promise<ChatAttachment> {
  const { attachment } = await apiRequest<{ attachment: Omit<ChatAttachment, 'type'> }>(`/api/attachments/${id}`)
  return { ...attachment, type: attachment.mimeType.startsWith('image/') ? 'image' : 'file' }
}

/**
 * Keeps a copy of a chat attachment in Files. A taken name gets a ` (n)` suffix, unless `replaceId`
 * names the file to overwrite, which moves to the trash (`replacedId`, for undo).
 */
export async function saveAttachmentToFiles(id: string, input: { parentId: string | null; name: string; replaceId?: string }): Promise<{ node: FileNode; replacedId: string | null }> {
  return apiRequest(`/api/attachments/${id}/save-to-files`, { method: 'POST', body: input })
}

/** Downloads an attachment still in the upload outbox: the local file while it has one, else the uploaded copy. */
export function downloadPendingAttachment(record: UploadRecord): void {
  if (record.file) {
    downloadBlob(record.file, record.file.name)
    return
  }
  const userId = useAuth.getState().user?.id
  if (!userId || !record.id) return
  void downloadAttachment(userId, {
    id: record.id,
    originalName: record.name,
    mimeType: record.mimeType,
    sizeBytes: record.size,
  }, useSettings.getState().localAttachmentCacheMb)
}

export function downloadChatAttachment(attachment: Attachment): void {
  const userId = useAuth.getState().user?.id
  if (!userId) return
  void downloadAttachment(userId, {
    id: attachment.id,
    originalName: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.size,
  }, useSettings.getState().localAttachmentCacheMb)
}

/**
 * Opens a sent attachment to the right of the chat, like a saved file; `main` opens it in the main
 * view instead. Returns false where there is no side panel (admin chat views), so the caller can
 * show its own preview.
 */
export function openAttachment(attachment: Attachment, go: (pathname: string) => void, main = false): boolean {
  if (!useSidePanel.getState().enabled) return false
  // The view starts from what the message already knows instead of fetching it again.
  queryClient.setQueryData(attachmentQueryKey(useAuth.getState().user?.id, attachment.id), attachment)
  const content = { kind: 'attachment' as const, id: attachment.id }
  if (main) go(panelContentPath(content))
  // Its tab is named before the view loads.
  else openBeside(content, go, { kind: 'blob', name: attachment.name, mimeType: attachment.mimeType })
  return true
}
