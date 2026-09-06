import type { Chat } from './types'

let previousChats: readonly Chat[] | undefined
let availableIds: ReadonlySet<string> | null = null

/** Shared by recall links only; content updates preserve the selected value. */
export function selectAvailableChatIds({ chats }: { chats: readonly Chat[] }): ReadonlySet<string> | null {
  if (chats === previousChats) return availableIds
  previousChats = chats
  if (!chats.length) return availableIds = null
  const next = new Set(chats.filter((chat) => !chat.expired).map((chat) => chat.id))
  if (!availableIds || next.size !== availableIds.size || [...next].some((id) => !availableIds!.has(id))) {
    availableIds = next
  }
  return availableIds
}
