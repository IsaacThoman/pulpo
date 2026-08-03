import type { Chat } from './types'

interface ResponseDetail {
  responses?: Array<{ id: string; status: string }>
}

export function reconcileStreamingResponseIds(
  chats: Chat[],
  previous: string[],
  detail?: ResponseDetail,
): string[] {
  const unfinished = new Set<string>()
  const known = new Set<string>()
  for (const response of detail?.responses ?? []) {
    known.add(response.id)
    if (response.status === 'queued' || response.status === 'in_progress') unfinished.add(response.id)
  }
  for (const chat of chats) {
    for (const message of chat.messages) {
      if (message.role !== 'assistant') continue
      known.add(message.id)
      if (!message.done) unfinished.add(message.id)
    }
  }
  const next = [
    ...unfinished,
    ...previous.filter((id) => !known.has(id) && !unfinished.has(id)),
  ]
  if (next.length === previous.length && next.every((id, index) => id === previous[index])) return previous
  return next
}

export function reindexDetailedChatResponses(
  index: Record<string, string>,
  chat: Chat,
  detail?: ResponseDetail,
): Record<string, string> {
  const next = { ...index }
  for (const response of detail?.responses ?? []) next[response.id] = chat.id
  for (const message of chat.messages) {
    if (message.role === 'assistant') next[message.id] = chat.id
  }
  return next
}
