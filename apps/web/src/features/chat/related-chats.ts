import type { ChatThreadStatus, RelatedChat, RelatedChats } from '@pulpo/contracts'

/** Side chats, threads, origin, and project of one chat. Realtime chat changes invalidate it (ChatDataBridge). */
export function relatedChatsQueryKey(userId: string | undefined, chatId?: string): unknown[] {
  return chatId ? ['chat-related', userId, chatId] : ['chat-related', userId]
}

export const THREAD_STATUS_ORDER: readonly ChatThreadStatus[] = ['working', 'attention', 'done', 'resolved']

/** Threads by status, in the order the threads list shows them; empty groups are left out. */
export function groupThreads(threads: readonly RelatedChat[]): Array<{ status: ChatThreadStatus; threads: RelatedChat[] }> {
  return THREAD_STATUS_ORDER.flatMap((status) => {
    const matching = threads.filter((thread) => (thread.status ?? 'working') === status)
    return matching.length ? [{ status, threads: matching }] : []
  })
}

/** What the threads button counts and flags. */
export function relatedChatsSummary(related: RelatedChats | undefined): { count: number; open: number; attention: boolean; working: boolean } {
  const threads = related?.threads ?? []
  return {
    count: threads.length + (related?.sideChats.length ?? 0),
    open: threads.filter((thread) => thread.status !== 'resolved').length,
    attention: threads.some((thread) => thread.status === 'attention'),
    working: threads.some((thread) => thread.status === 'working'),
  }
}
