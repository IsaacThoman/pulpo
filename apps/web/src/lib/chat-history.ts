import { lineageFromLeaf } from '@pulpo/client-core'

export const HISTORY_PAGE_TURNS = 500
export const HISTORY_PREFETCH_MESSAGES = 400
export interface ChatHistory {
  hasMore: boolean
  before: string | null
  leafId: string | null
  offset: number
}

export function historyUrl(chatId: string, before?: string) {
  return `/api/chats/${chatId}?format=compact&scope=active&historyLimit=${HISTORY_PAGE_TURNS}${before ? `&before=${encodeURIComponent(before)}` : ''}`
}

/** Keep only the connected active lineage; branch changes must not resurrect cached siblings. */
export function mergeHistory<T extends { id: string; parentResponseId: string | null }>(cached: T[], incoming: T[], history: ChatHistory) {
  const rows = new Map(cached.map(row => [row.id, row]))
  for (const row of incoming) rows.set(row.id, row)
  const lineage = lineageFromLeaf([...rows.values()], history.leafId)
  const firstIncoming = lineage.findIndex(row => row.id === incoming[0]?.id)
  const offset = Math.max(0, history.offset - Math.max(0, firstIncoming))
  return { responses: lineage, history: { ...history, offset, hasMore: offset > 0, before: lineage[0]?.id ?? null } }
}
