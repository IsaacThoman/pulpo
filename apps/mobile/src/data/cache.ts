import type { ServerChat } from '../types'

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
  limit: number,
): string[] {
  const obsolete = new Set(ordered.flatMap((chat) => {
    const inScope = scope === 'all' || (scope === 'deleted' ? Boolean(chat.deletedAt) : !chat.deletedAt)
    return inScope && !incomingIds.has(chat.id) ? [chat.id] : []
  }))
  const overflow = ordered.filter((chat) => !obsolete.has(chat.id)).slice(Math.max(0, limit)).map((chat) => chat.id)
  return [...new Set([...obsolete, ...overflow])]
}
