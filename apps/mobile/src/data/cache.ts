import { mergeCachedResponseDetails } from '@pulpo/client-core'
import type { ServerChat } from '../types'

export const MAX_CACHED_CHAT_DETAIL_BYTES = 5 * 1024 * 1024
export const MAX_TOTAL_CACHED_CHAT_DETAIL_BYTES = 25 * 1024 * 1024

export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
  }
  return bytes
}

export interface CachedChatDetailRecord {
  chatId: string
  openedAt: number
  payloadBytes: number
}

export function cachedChatDetailIdsToEvict(
  records: CachedChatDetailRecord[],
  maxCount: number,
  maxBytes = MAX_TOTAL_CACHED_CHAT_DETAIL_BYTES,
): string[] {
  const ordered = [...records].sort((left, right) =>
    right.openedAt - left.openedAt || left.chatId.localeCompare(right.chatId))
  const retained = new Set<string>()
  let totalBytes = 0
  for (const record of ordered) {
    const bytes = Math.max(0, record.payloadBytes)
    if (retained.size >= Math.max(0, maxCount)
      || bytes > MAX_CACHED_CHAT_DETAIL_BYTES
      || bytes > maxBytes - totalBytes) continue
    retained.add(record.chatId)
    totalBytes += bytes
  }
  return ordered.flatMap((record) => retained.has(record.chatId) ? [] : [record.chatId])
}

export function persistableChats(chats: ServerChat[]): ServerChat[] {
  return chats.filter((chat) => !chat.temporary)
}

/** A summaries refresh must not erase the detailed response graph held for offline use. */
export function mergeCachedChat(existing: ServerChat | null, incoming: ServerChat): ServerChat {
  if (!existing) return incoming
  return {
    ...existing,
    ...incoming,
    responses: mergeCachedResponseDetails(existing.responses, incoming.responses),
    attachments: incoming.attachments ?? existing.attachments,
    queuedMessages: incoming.queuedMessages ?? existing.queuedMessages,
  }
}

export function cachedChatIdsToRemove(
  ordered: ServerChat[],
  incomingIds: Set<string>,
  scope: 'active' | 'deleted' | 'all',
): string[] {
  return ordered.flatMap((chat) => {
    const inScope = scope === 'all' || (scope === 'deleted' ? Boolean(chat.deletedAt) : !chat.deletedAt)
    return inScope && !incomingIds.has(chat.id) ? [chat.id] : []
  })
}

/** Keep the lightweight history record while evicting a conversation's offline document. */
export function withoutCachedChatDetails(chat: ServerChat): ServerChat {
  const { responses: _responses, attachments: _attachments, ...summary } = chat
  return summary
}
