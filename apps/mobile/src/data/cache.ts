import type { ServerChat } from '../types'

export function persistableChats(chats: ServerChat[]): ServerChat[] {
  return chats.filter((chat) => !chat.temporary)
}

/** A summaries refresh must not erase the detailed response graph held for offline use. */
export function mergeCachedChat(existing: ServerChat | null, incoming: ServerChat): ServerChat {
  if (!existing) return incoming
  return {
    ...existing,
    ...incoming,
    responses: incoming.responses ?? existing.responses,
    attachments: incoming.attachments ?? existing.attachments,
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
