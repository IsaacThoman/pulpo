export function visibleHistoryChats<T extends { deletedAt: number | null; temporary: boolean }>(chats: T[]): T[] {
  return chats.filter((chat) => chat.deletedAt === null && !chat.temporary)
}

export type HistoryChatSummary = {
  id: string
  title: string
  modelId: string
  time: string
  section: string
  pinned: boolean
  folderId: string | null
}

type HistoryChatSource = {
  id: string
  title: string
  modelId: string
  updatedAt: number
  pinned: boolean
  folderId: string | null
}

function historySection(updatedAt: number, now: number): string {
  const days = Math.floor((now - updatedAt) / 86_400_000)
  if (days < 1) return 'Today'
  if (days < 2) return 'Yesterday'
  if (days < 7) return 'Previous 7 Days'
  return 'Previous 30 Days'
}

export function historyChatSummary<T extends HistoryChatSource>(chat: T, now = Date.now()): HistoryChatSummary {
  return {
    id: chat.id,
    title: chat.title,
    modelId: chat.modelId,
    time: chat.updatedAt > now - 86_400_000
      ? new Date(chat.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : new Date(chat.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    section: chat.pinned ? 'Pinned' : historySection(chat.updatedAt, now),
    pinned: chat.pinned,
    folderId: chat.folderId,
  }
}

function historyChatSummaryEqual(left: HistoryChatSummary, right: HistoryChatSummary): boolean {
  return left.id === right.id
    && left.title === right.title
    && left.modelId === right.modelId
    && left.time === right.time
    && left.section === right.section
    && left.pinned === right.pinned
    && left.folderId === right.folderId
}

/** Preserve row and list identity when transcript-only chat state changes. */
export function reuseHistoryChatSummaries(
  previous: HistoryChatSummary[],
  projected: HistoryChatSummary[],
): HistoryChatSummary[] {
  const previousById = new Map(previous.map((chat) => [chat.id, chat]))
  let changed = previous.length !== projected.length
  const next = projected.map((chat, index) => {
    const existing = previousById.get(chat.id)
    const value = existing && historyChatSummaryEqual(existing, chat) ? existing : chat
    if (value !== previous[index]) changed = true
    return value
  })
  return changed ? next : previous
}
