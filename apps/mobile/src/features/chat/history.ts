export function visibleHistoryChats<T extends { deletedAt: number | null; temporary: boolean }>(chats: T[]): T[] {
  return chats.filter((chat) => chat.deletedAt === null && !chat.temporary)
}

export type HistoryChatSummary = {
  id: string
  title: string
  modelId: string
  time: string
  /** Last-activity label shown in previews; list placement comes from sortOrder. */
  section: string
  pinned: boolean
  folderId: string | null
  sortOrder: number
  createdAt: number
  expiresAt: number | null
}

export type HistoryChatSection = {
  title: string
  data: HistoryChatSummary[]
}

type OrderedChat = { id: string; pinned: boolean; folderId: string | null; sortOrder: number; createdAt: number }

/** Matches the web sidebar: manual order first, newest first among ties. Activity never moves a chat. */
export function compareChatOrder(left: Pick<OrderedChat, 'sortOrder' | 'createdAt'>, right: Pick<OrderedChat, 'sortOrder' | 'createdAt'>): number {
  return left.sortOrder - right.sortOrder || right.createdAt - left.createdAt
}

/** The sort order that places a chat above every other chat in its destination list. */
export function topChatSortOrder<T extends OrderedChat>(
  chats: T[],
  folderIds: ReadonlySet<string>,
  folderId: string | null,
  excludeId?: string,
): number {
  return chats
    .filter((chat) => chat.id !== excludeId && !chat.pinned && (folderId
      ? chat.folderId === folderId
      : !(chat.folderId && folderIds.has(chat.folderId))))
    .reduce((min, chat) => Math.min(min, chat.sortOrder), 1) - 1
}

/**
 * Pinned chats, then unfiled chats, each in their manual order. Filed chats live in their folders
 * unless `includeFiled` is set (search), where they follow the unfiled chats in folder order.
 */
export function historyChatSections(
  chats: HistoryChatSummary[],
  folders: readonly { id: string }[] = [],
  includeFiled = false,
): HistoryChatSection[] {
  const folderIndex = new Map(folders.map((folder, index) => [folder.id, index]))
  const pinned: HistoryChatSummary[] = []
  const loose: HistoryChatSummary[] = []
  const filed: HistoryChatSummary[] = []
  for (const chat of chats) {
    if (chat.pinned) pinned.push(chat)
    else if (chat.folderId && folderIndex.has(chat.folderId)) filed.push(chat)
    else loose.push(chat)
  }
  pinned.sort(compareChatOrder)
  loose.sort(compareChatOrder)
  filed.sort((left, right) => folderIndex.get(left.folderId!)! - folderIndex.get(right.folderId!)! || compareChatOrder(left, right))
  const unpinned = includeFiled ? [...loose, ...filed] : loose
  const sections: HistoryChatSection[] = []
  if (pinned.length) sections.push({ title: 'Pinned', data: pinned })
  if (unpinned.length) sections.push({ title: 'Chats', data: unpinned })
  return sections
}

export type HistoryChatExpiryMenuAction =
  | { kind: 'enable'; periodLabel: '24h' | '7d' }
  | { kind: 'disable' }
  | null

export function resolveHistoryChatExpiryMenuAction(
  expiresAt: number | null,
  automaticChatExpiration: 'disabled' | '24h' | '7d',
): HistoryChatExpiryMenuAction {
  if (expiresAt !== null) return { kind: 'disable' }
  if (automaticChatExpiration === 'disabled') return null
  return { kind: 'enable', periodLabel: automaticChatExpiration }
}

type HistoryChatSource = {
  id: string
  title: string
  modelId: string
  updatedAt: number
  createdAt: number
  pinned: boolean
  folderId: string | null
  sortOrder: number
  expiresAt?: number | null
}

function historySection(updatedAt: number, now: number): string {
  const days = Math.floor((now - updatedAt) / 86_400_000)
  if (days < 1) return 'Today'
  if (days < 2) return 'Yesterday'
  if (days < 7) return 'Previous 7 Days'
  return 'Previous 30 Days'
}

let timeFormatter: Intl.DateTimeFormat | undefined
let dateFormatter: Intl.DateTimeFormat | undefined

export function historyChatSummary<T extends HistoryChatSource>(chat: T, now = Date.now()): HistoryChatSummary {
  return {
    id: chat.id,
    title: chat.title,
    modelId: chat.modelId,
    time: chat.updatedAt > now - 86_400_000
      ? (timeFormatter ??= new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' })).format(chat.updatedAt)
      : (dateFormatter ??= new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' })).format(chat.updatedAt),
    section: chat.pinned ? 'Pinned' : historySection(chat.updatedAt, now),
    pinned: chat.pinned,
    folderId: chat.folderId,
    sortOrder: chat.sortOrder,
    createdAt: chat.createdAt,
    expiresAt: chat.expiresAt ?? null,
  }
}

/** Cache metadata, not transcript objects, so streaming doesn't reformat the whole drawer. */
export function createHistoryProjector(project = historyChatSummary) {
  let cached = new Map<string, { updatedAt: number; timeOnly: boolean; summary: HistoryChatSummary }>()
  let previous: HistoryChatSummary[] = []
  return (chats: Array<HistoryChatSource & { deletedAt: number | null; temporary: boolean }>, now = Date.now()) => {
    const nextCache = new Map<string, { updatedAt: number; timeOnly: boolean; summary: HistoryChatSummary }>()
    const next: HistoryChatSummary[] = []
    let changed = false
    for (const chat of chats) {
      if (chat.deletedAt !== null || chat.temporary) continue
      const existing = cached.get(chat.id)
      const row = existing?.summary
      const timeOnly = chat.updatedAt > now - 86_400_000
      const section = chat.pinned ? 'Pinned' : historySection(chat.updatedAt, now)
      const entry = existing && row && existing.updatedAt === chat.updatedAt && existing.timeOnly === timeOnly
        && row.title === chat.title && row.modelId === chat.modelId && row.pinned === chat.pinned
        && row.folderId === chat.folderId && row.sortOrder === chat.sortOrder && row.expiresAt === (chat.expiresAt ?? null) && row.section === section
        ? existing : { updatedAt: chat.updatedAt, timeOnly, summary: project(chat, now) }
      nextCache.set(chat.id, entry)
      if (entry.summary !== previous[next.length]) changed = true
      next.push(entry.summary)
    }
    if (next.length !== previous.length) changed = true
    cached = nextCache
    if (changed) previous = next
    return previous
  }
}

export function historyFolderItems<T extends { id: string; name: string }>(folders: T[], chats: HistoryChatSummary[]) {
  const grouped = new Map<string, HistoryChatSummary[]>()
  for (const chat of chats) {
    if (chat.folderId === null || chat.pinned) continue
    const group = grouped.get(chat.folderId)
    if (group) group.push(chat)
    else grouped.set(chat.folderId, [chat])
  }
  return folders.map((folder) => ({ id: folder.id, name: folder.name, chats: (grouped.get(folder.id) ?? []).sort(compareChatOrder) }))
}

function historyChatSummaryEqual(left: HistoryChatSummary, right: HistoryChatSummary): boolean {
  return left.id === right.id
    && left.title === right.title
    && left.modelId === right.modelId
    && left.time === right.time
    && left.section === right.section
    && left.pinned === right.pinned
    && left.folderId === right.folderId
    && left.sortOrder === right.sortOrder
    && left.expiresAt === right.expiresAt
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
