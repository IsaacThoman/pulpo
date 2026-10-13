import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'

const APPROX_BYTES_PER_TOKEN = 4
/** Codex's 10k-token tool output policy plus its 20% serialization allowance. */
export const TOOL_OUTPUT_MAX_TOKENS = 12_000
export const TOOL_OUTPUT_MAX_BYTES = TOOL_OUTPUT_MAX_TOKENS * APPROX_BYTES_PER_TOKEN

/** read pages its own output (50 KiB plus a continuation hint); middle truncation would break paging. */
const SELF_BOUNDED_TOOLS = new Set(['read'])
const WORKSPACE_OUTPUT_TOOLS = new Set(['bash', 'find', 'grep', 'ls'])

type ToolContent = (TextContent | ImageContent)[]

export type SavedToolOutputDetails = {
  fullOutputPath: string
  fullOutputBytes: number
  fullOutputComplete: boolean
}

const approxTokens = (bytes: number) => Math.ceil(bytes / APPROX_BYTES_PER_TOKEN)
const formatCount = (value: number) => value.toLocaleString('en-US')
const isContinuationByte = (byte: number) => (byte & 0xc0) === 0x80

export function savedToolOutput(details: unknown): SavedToolOutputDetails | undefined {
  if (!details || typeof details !== 'object') return undefined
  const { fullOutputPath, fullOutputBytes, fullOutputComplete } = details as Record<string, unknown>
  if (typeof fullOutputPath !== 'string' || !fullOutputPath) return undefined
  return {
    fullOutputPath,
    fullOutputBytes: typeof fullOutputBytes === 'number' ? fullOutputBytes : 0,
    fullOutputComplete: fullOutputComplete !== false,
  }
}

function truncationNotice(toolName: string, originalBytes: number, lineCount: number, saved?: SavedToolOutputDetails): string {
  const summary = `Warning: truncated output (original token count: ${formatCount(approxTokens(originalBytes))}, total output lines: ${formatCount(lineCount)}). Only the beginning and end are shown.`
  if (saved) {
    const partial = saved.fullOutputComplete ? '' : ' The saved file stops at the workspace capture limit.'
    return `${summary} Full output saved to ${saved.fullOutputPath}; inspect it with read (offset/limit) or grep instead of printing it again.${partial}`
  }
  if (WORKSPACE_OUTPUT_TOOLS.has(toolName)) {
    return `${summary} To see the rest, rerun the command with output redirected to a file and inspect that file with read (offset/limit) or grep.`
  }
  return summary
}

/** Keep the first and last halves of a byte budget without splitting UTF-8 characters. */
export function truncateMiddleUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= maxBytes) return text
  const markerFor = (removedBytes: number) => `\n…${formatCount(approxTokens(removedBytes))} tokens truncated…\n`
  // The removed count only shrinks as the budget is spent, so this marker length is an upper bound.
  const contentBudget = Math.max(0, maxBytes - Buffer.byteLength(markerFor(bytes.length), 'utf8'))
  let headEnd = Math.floor(contentBudget / 2)
  while (headEnd > 0 && isContinuationByte(bytes[headEnd]!)) headEnd -= 1
  let tailStart = bytes.length - (contentBudget - Math.floor(contentBudget / 2))
  while (tailStart < bytes.length && isContinuationByte(bytes[tailStart]!)) tailStart += 1
  return `${bytes.subarray(0, headEnd).toString('utf8')}${markerFor(tailStart - headEnd)}${bytes.subarray(tailStart).toString('utf8')}`
}

/**
 * Bound tool output before it enters model context, as Codex does when recording history.
 * Text parts are combined into one truncated part at the first text position; images keep
 * their positions. Returns undefined when the content already fits.
 */
export function boundToolOutputContent(toolName: string, content: ToolContent | undefined, details?: unknown): ToolContent | undefined {
  if (!content?.length || SELF_BOUNDED_TOOLS.has(toolName)) return undefined
  const texts = content.flatMap((part) => part.type === 'text' ? [part.text] : [])
  const text = texts.join('\n')
  const originalBytes = Buffer.byteLength(text, 'utf8')
  if (originalBytes <= TOOL_OUTPUT_MAX_BYTES) return undefined
  const notice = `${truncationNotice(toolName, originalBytes, text.split('\n').length, savedToolOutput(details))}\n\n`
  const bounded = `${notice}${truncateMiddleUtf8(text, TOOL_OUTPUT_MAX_BYTES - Buffer.byteLength(notice, 'utf8'))}`
  let placed = false
  return content.flatMap((part): ToolContent => {
    if (part.type !== 'text') return [part]
    if (placed) return []
    placed = true
    return [{ ...part, text: bounded }]
  })
}

/** Apply the same bound to saved history so contexts recorded before the cap stay usable. */
export function boundToolResultMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => {
    if (message.role !== 'toolResult') return message
    const content = boundToolOutputContent(message.toolName, message.content, message.details)
    return content ? { ...message, content } : message
  })
}
