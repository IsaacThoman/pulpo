import { ui, uit } from '@/i18n/ui'
import { ApiError, apiRequest } from '@/lib/api'
import type { Chat } from '@/lib/types'
import { useChat } from '@/stores/chat'
import { useFileToasts } from '@/features/files/browser/toasts'
import { filesErrorMessage } from '@/features/files/file-display'

/*
 * Chat actions offered both by the sidebar's chat menu and by Files for the chats it lists (see
 * also ChatExpiryMenuItem).
 */

const toast = (message: string, options: { tone?: 'error'; undo?: () => Promise<unknown> } = {}) =>
  useFileToasts.getState().show({ message, ...options })

/** Copies a link to the chat's share page, saying so (or why not) in a toast. */
export async function copyChatShareLink(chatId: string): Promise<void> {
  try {
    const url = await useChat.getState().shareChat(chatId)
    await navigator.clipboard.writeText(url)
    toast(ui("Copied share link"))
  } catch (cause) {
    toast(filesErrorMessage(cause), { tone: 'error' })
  }
}

/** Copies chats, history included, beside the originals, and offers to undo it. Resolves with the copies' ids. */
export async function duplicateChats(chats: readonly Pick<Chat, 'id' | 'title'>[]): Promise<string[]> {
  if (!chats.length) return []
  let copies: string[]
  try {
    copies = await Promise.all(chats.map((chat) => useChat.getState().duplicateChat(chat.id)))
  } catch (cause) {
    toast(filesErrorMessage(cause), { tone: 'error' })
    return []
  }
  toast(chats.length === 1 ? uit`Duplicated "${chats[0]!.title}"` : uit`Duplicated ${chats.length} items`, {
    // Like undoing a duplicate in Files, this deletes the copies for good.
    undo: async () => {
      await Promise.all(copies.map((id) => useChat.getState().deleteChat(id)))
      await Promise.all(copies.map((id) => apiRequest(`/api/chats/${id}/permanent`, { method: 'DELETE' }).catch(() => undefined)))
    },
  })
  return copies
}

/** Why a fork or side chat could not open, in the app's words where it knows the reason. */
export function threadActionErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    switch (cause.code) {
      case 'fork_in_progress': return ui('Wait for this reply to finish before forking from it')
      case 'fork_unsupported': return ui('Save this temporary chat before forking it')
      case 'side_chat_unsupported': return ui('Side chats can only be opened from an ordinary chat')
    }
  }
  return filesErrorMessage(cause)
}

/** Copies the chat up to a reply into a new chat. Resolves with its id, or null after saying why it could not. */
export async function forkFromReply(responseId: string): Promise<string | null> {
  try {
    return await useChat.getState().forkChat(responseId)
  } catch (cause) {
    toast(threadActionErrorMessage(cause), { tone: 'error' })
    return null
  }
}

/**
 * Opens a side chat beside `chatId` that sees it up to `responseId` (its active reply when absent).
 * Resolves with its id, or null after saying why it could not.
 */
export async function openSideChatAt(chatId: string, responseId?: string | null): Promise<string | null> {
  try {
    return await useChat.getState().openSideChat(chatId, responseId)
  } catch (cause) {
    toast(threadActionErrorMessage(cause), { tone: 'error' })
    return null
  }
}
