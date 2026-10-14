import type { AssistantMessage, Message, UserMessage } from '@earendil-works/pi-ai'
import { isSummaryText, summaryMessageText } from './prompt.js'
import { selectRetainedUserMessages, type RetainedUserMessage } from './retained-user-messages.js'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** Text of a real user message; parts joined with '' like Codex, images dropped. */
export function piUserMessageText(message: unknown): string | undefined {
  if (!isRecord(message) || message.role !== 'user') return undefined
  const { content } = message
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : '').join('')
      : ''
  if (!text.trim() || isSummaryText(text)) return undefined
  return text
}

export function piUserTextMessage(text: string, timestamp = Date.now()): UserMessage {
  return { role: 'user', content: [{ type: 'text', text }], timestamp }
}

export function piSummaryMessage(summary: string, timestamp = Date.now()): UserMessage {
  return piUserTextMessage(summaryMessageText(summary), timestamp)
}

/** Codex replacement history: retained user messages followed by the summary. */
export function buildCompactedPiHistory(
  messages: readonly unknown[],
  summary: string,
  retainedUserTokens: number,
): { messages: Message[]; retained: RetainedUserMessage[] } {
  const texts = messages.flatMap((message) => {
    const text = piUserMessageText(message)
    return text === undefined ? [] : [text]
  })
  const retained = selectRetainedUserMessages(texts, retainedUserTokens)
  const timestamp = Date.now()
  return {
    messages: [...retained.map((message) => piUserTextMessage(message.text, timestamp)), piSummaryMessage(summary, timestamp)],
    retained,
  }
}

const toolCallIds = (message: AssistantMessage) =>
  message.content.flatMap((part) => part.type === 'toolCall' ? [part.id] : [])

/** Remove a tool call whose result was dropped; assistant messages left empty go too. */
function withoutToolCall(messages: Message[], callId: string): Message[] {
  return messages.flatMap((message): Message[] => {
    if (message.role !== 'assistant' || !toolCallIds(message).includes(callId)) return [message]
    const content = message.content.filter((part) => part.type !== 'toolCall' || part.id !== callId)
    return content.length ? [{ ...message, content }] : []
  })
}

function withoutOrphanToolResults(messages: Message[]): Message[] {
  // Plain loops: trimming runs this once per dropped unit over the whole history.
  const callIds = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.content) if (part.type === 'toolCall') callIds.add(part.id)
  }
  return messages.filter((message) => message.role !== 'toolResult' || callIds.has(message.toolCallId))
}

/**
 * Codex remove_first_item for pi messages. A leading user message is kept so the
 * history still opens with the user, and goes last so an oversized one can still
 * be compacted. Undefined only for an empty history.
 */
export function dropOldestPiUnit(messages: readonly Message[]): Message[] | undefined {
  const start = messages[0]?.role === 'user' && messages.length > 1 ? 1 : 0
  const target = messages[start]
  if (!target) return undefined
  let next = messages.filter((_, index) => index !== start)
  const ids = target.role === 'assistant' ? new Set(toolCallIds(target)) : undefined
  if (ids?.size) {
    // Results answering this message follow it, up to the next assistant message.
    const nextAssistant = next.findIndex((message, index) => index >= start && message.role === 'assistant')
    const end = nextAssistant === -1 ? next.length : nextAssistant
    next = next.filter((message, index) => !(index >= start && index < end && message.role === 'toolResult' && ids.has(message.toolCallId)))
  } else if (target.role === 'toolResult') {
    next = withoutToolCall(next, target.toolCallId)
  }
  return withoutOrphanToolResults(next)
}
