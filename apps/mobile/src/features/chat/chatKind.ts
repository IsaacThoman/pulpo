import type { ChatKind } from '@pulpo/contracts'

/**
 * A side chat or thread: reached from the chat it came from, so it is kept out of the chat list,
 * the trash, and the offline list cache. Older servers and caches send no kind (an ordinary chat).
 */
export function isAsideChat(chat: { kind?: ChatKind | string | null }): boolean {
  return chat.kind === 'side' || chat.kind === 'thread'
}

/** Whether the sidebar lists a chat. */
export function isListedChat(chat: { kind?: ChatKind | string | null }): boolean {
  return !isAsideChat(chat)
}
