import type { Attachment } from '@/lib/types'
import { apiRequest } from '@/lib/api'
import { downloadAttachment } from '@/lib/local-first/attachment-cache'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
import { openBeside, panelContentPath } from '@/features/side-panel/use-panel-actions'
import { useSidePanel } from '@/features/side-panel/store'

export const attachmentQueryKey = (userId: string | undefined, id: string) => ['attachment', userId, id] as const

/** An attachment with the chat it was sent in, for linking back to it. */
export type ChatAttachment = Attachment & { chatId?: string | null }

export async function fetchAttachment(id: string): Promise<ChatAttachment> {
  const { attachment } = await apiRequest<{ attachment: Omit<ChatAttachment, 'type'> }>(`/api/attachments/${id}`)
  return { ...attachment, type: attachment.mimeType.startsWith('image/') ? 'image' : 'file' }
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
  else openBeside(content, go)
  return true
}
