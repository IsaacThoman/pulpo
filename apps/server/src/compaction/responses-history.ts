import { isSummaryText, summaryMessageText } from './prompt.js'
import { selectRetainedUserMessages, type RetainedUserMessage } from './retained-user-messages.js'

type UserTextItem = { role: 'user'; content: [{ type: 'input_text'; text: string }] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const itemType = (item: unknown) => isRecord(item) && typeof item.type === 'string' ? item.type : undefined

const isUserMessage = (item: unknown) =>
  isRecord(item) && item.role === 'user' && (item.type === undefined || item.type === 'message')

/** Text of a real user message; input_text parts joined with '' like Codex. */
export function responsesUserText(item: unknown): string | undefined {
  if (!isUserMessage(item)) return undefined
  const { content } = item as Record<string, unknown>
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => isRecord(part) && part.type === 'input_text' && typeof part.text === 'string' ? part.text : '').join('')
      : ''
  if (!text.trim() || isSummaryText(text)) return undefined
  return text
}

export function responsesUserTextItem(text: string): UserTextItem {
  return { role: 'user', content: [{ type: 'input_text', text }] }
}

export function responsesSummaryItem(summary: string): UserTextItem {
  return responsesUserTextItem(summaryMessageText(summary))
}

/** Codex replacement history: retained user messages followed by the summary. */
export function buildCompactedResponsesHistory(
  items: readonly unknown[],
  summary: string,
  retainedUserTokens: number,
): { items: unknown[]; retained: RetainedUserMessage[] } {
  const texts = items.flatMap((item) => {
    const text = responsesUserText(item)
    return text === undefined ? [] : [text]
  })
  const retained = selectRetainedUserMessages(texts, retainedUserTokens)
  return {
    items: [...retained.map((message) => responsesUserTextItem(message.text)), responsesSummaryItem(summary)],
    retained,
  }
}

const CALL_TYPES = new Set(['function_call', 'custom_tool_call'])
const OUTPUT_TYPES = new Set(['function_call_output', 'custom_tool_call_output'])

function callId(item: unknown, types: ReadonlySet<string>): string | undefined {
  const type = itemType(item)
  if (!type || !types.has(type)) return undefined
  const id = (item as Record<string, unknown>).call_id
  return typeof id === 'string' ? id : undefined
}

/**
 * Codex remove_first_item for Responses items. A leading user message is kept
 * until it is the only item left. Undefined only for an empty history.
 */
export function dropOldestResponsesUnit(items: readonly unknown[]): unknown[] | undefined {
  if (!items.length) return undefined
  const start = isUserMessage(items[0]) && items.length > 1 ? 1 : 0
  // Reasoning items belong to the item that follows them.
  let end = start
  while (end < items.length && itemType(items[end]) === 'reasoning') end += 1
  if (end < items.length) end += 1
  const removed = items.slice(start, end)
  const removedCalls = new Set(removed.flatMap((item) => callId(item, CALL_TYPES) ?? []))
  const removedOutputs = new Set(removed.flatMap((item) => callId(item, OUTPUT_TYPES) ?? []))
  const kept = [...items.slice(0, start), ...items.slice(end)].filter((item) => {
    const output = callId(item, OUTPUT_TYPES)
    if (output !== undefined) return !removedCalls.has(output)
    const call = callId(item, CALL_TYPES)
    return call === undefined || !removedOutputs.has(call)
  })
  // Outputs whose call is gone would be rejected by the provider. A plain loop:
  // trimming runs this once per dropped unit over the whole history.
  const calls = new Set<string>()
  for (const item of kept) {
    const call = callId(item, CALL_TYPES)
    if (call !== undefined) calls.add(call)
  }
  return kept.filter((item) => {
    const output = callId(item, OUTPUT_TYPES)
    return output === undefined || calls.has(output)
  })
}
