export function visibleHistoryChats<T extends { deletedAt: number | null; temporary: boolean }>(chats: T[]): T[] {
  return chats.filter((chat) => chat.deletedAt === null && !chat.temporary)
}

export type HistoryChatSummary = {
  id: string
  title: string
  modelId: string
  time: string
  /** Last-activity label shown in previews and as the heading in recent order. */
  section: string
  pinned: boolean
  folderId: string | null
  /** Filed at the top of My files: outside the sidebar, which lists the Chats folder. */
  inFilesRoot: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
  expiresAt: number | null
}

export type HistoryChatSection = {
  title: string
  data: HistoryChatSummary[]
}

type OrderedChat = { id: string; pinned: boolean; folderId: string | null; inFilesRoot?: boolean; sortOrder: number; createdAt: number }

/** Matches the web sidebar: manual order first, newest first among ties. Activity never moves a chat. */
export function compareChatOrder(left: Pick<OrderedChat, 'sortOrder' | 'createdAt'>, right: Pick<OrderedChat, 'sortOrder' | 'createdAt'>): number {
  return left.sortOrder - right.sortOrder || right.createdAt - left.createdAt
}

/**
 * The sort order that places a chat above everything in its destination list: a folder, or (null)
 * the top of the sidebar. `floor` is the lowest sort order among the Files items listed there,
 * which share the list's order (as on the web).
 */
export function topChatSortOrder<T extends OrderedChat>(
  chats: T[],
  folderId: string | null,
  { excludeId, floor }: { excludeId?: string; floor?: number } = {},
): number {
  const top = chats
    .filter((chat) => chat.id !== excludeId && !chat.pinned && (folderId
      ? chat.folderId === folderId
      : !chat.folderId && !chat.inFilesRoot))
    .reduce((min, chat) => Math.min(min, chat.sortOrder), 1) - 1
  return floor === undefined ? top : Math.min(top, floor - 1)
}

/**
 * Pinned chats, then unfiled chats, each in their manual order. Filed chats (in a folder, or at
 * the top of My files) live in their folders unless `includeFiled` is set (search), where they
 * follow the unfiled chats in `folders` order; chats in folders the sidebar does not show come last.
 * Recent order matches the web sidebar: unpinned chats by last activity under time headings.
 */
export function historyChatSections(
  chats: HistoryChatSummary[],
  folders: readonly { id: string }[] = [],
  includeFiled = false,
  order: 'default' | 'recent' = 'default',
): HistoryChatSection[] {
  const folderIndex = new Map(folders.map((folder, index) => [folder.id, index]))
  const pinned: HistoryChatSummary[] = []
  const loose: HistoryChatSummary[] = []
  const filed: HistoryChatSummary[] = []
  for (const chat of chats) {
    if (chat.pinned) pinned.push(chat)
    else if (chat.folderId || chat.inFilesRoot) filed.push(chat)
    else loose.push(chat)
  }
  const place = (chat: HistoryChatSummary) => (chat.folderId ? folderIndex.get(chat.folderId) : undefined) ?? folders.length
  pinned.sort(compareChatOrder)
  loose.sort(compareChatOrder)
  filed.sort((left, right) => place(left) - place(right) || compareChatOrder(left, right))
  const unpinned = includeFiled ? [...loose, ...filed] : loose
  const sections: HistoryChatSection[] = []
  if (pinned.length) sections.push({ title: 'Pinned', data: pinned })
  if (order === 'recent') {
    for (const chat of [...unpinned].sort((left, right) => right.updatedAt - left.updatedAt)) {
      const last = sections.at(-1)
      if (last && last.title === chat.section && last.title !== 'Pinned') last.data.push(chat)
      else sections.push({ title: chat.section, data: [chat] })
    }
  } else if (unpinned.length) sections.push({ title: 'Chats', data: unpinned })
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
  inFilesRoot?: boolean
  sortOrder: number
  expiresAt?: number | null
}

/** Calendar-day buckets, matching the web sidebar's recent-order headings. */
export function historySection(updatedAt: number, now: number): string {
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (updatedAt >= startOfToday) return 'Today'
  if (updatedAt >= startOfToday - 86_400_000) return 'Yesterday'
  if (updatedAt >= startOfToday - 7 * 86_400_000) return 'Previous 7 Days'
  if (updatedAt >= startOfToday - 30 * 86_400_000) return 'Previous 30 Days'
  return 'Older'
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
    inFilesRoot: chat.inFilesRoot ?? false,
    sortOrder: chat.sortOrder,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
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
        && row.folderId === chat.folderId && row.inFilesRoot === (chat.inFilesRoot ?? false) && row.sortOrder === chat.sortOrder && row.expiresAt === (chat.expiresAt ?? null) && row.section === section
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

function historyChatSummaryEqual(left: HistoryChatSummary, right: HistoryChatSummary): boolean {
  return left.id === right.id
    && left.title === right.title
    && left.modelId === right.modelId
    && left.time === right.time
    && left.section === right.section
    && left.pinned === right.pinned
    && left.folderId === right.folderId
    && left.inFilesRoot === right.inFilesRoot
    && left.sortOrder === right.sortOrder
    && left.updatedAt === right.updatedAt
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
