import type { CompactionItem, CompactionRetainedEntry } from '@pulpo/contracts'
import { estimateInputTokens } from '../accounting/pricing.js'
import { sanitizeContextForStorage } from './public-output.js'
import { assistantOutputText } from './output-text.js'

export const COMPACTION_PROMPT = `Create a handoff summary for another model that will continue this conversation.

Output exactly this Markdown structure and keep the section order. Do not mention that context was compacted.

## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Important Details
- [constraints, decisions, facts, assumptions, or "(none)"]

## Work State
### Completed
- [finished work or verified facts, or "(none)"]

### Active
- [current work or investigation state, or "(none)"]

### Blocked
- [blockers, failing commands, or unknowns, or "(none)"]

## Next Move
1. [immediate concrete action, or "(none)"]

## Relevant Files
- [path: why it matters, or "(none)"]

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers.`

type HistoryResponse = {
  id: string
  status: string
  agentMode?: boolean
  input: unknown
  output: unknown
}

type HistoryChunk = {
  responseId?: string
  context: unknown[]
  retainable: boolean
}

function itemText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return String(value ?? '')
  const item = value as Record<string, unknown>
  if (item.type === 'input_file') {
    const label = typeof item.name === 'string' ? item.name : typeof item.attachment_id === 'string' ? item.attachment_id : 'attachment'
    return `[Attachment: ${label}]`
  }
  if (item.type === 'input_image') return '[Image]'
  if (item.type === 'pulpo_attachment') {
    return `[Attachment: ${typeof item.name === 'string' ? item.name : 'generated file'}]`
  }
  if (typeof item.text === 'string') return item.text
  if (typeof item.content === 'string') return item.content
  if (Array.isArray(item.content)) return item.content.map(itemText).filter(Boolean).join('\n')
  if (Array.isArray(item.summary)) return item.summary.map(itemText).filter(Boolean).join('\n')
  if (typeof item.output === 'string') return item.output
  return ''
}

function contextEntries(context: unknown[]): CompactionRetainedEntry[] {
  return context.flatMap((raw): CompactionRetainedEntry[] => {
    const item = raw as Record<string, unknown>
    const type = typeof item.type === 'string' ? item.type : ''
    if (type === 'reasoning') {
      const content = itemText(item.summary)
      return content ? [{ role: 'assistant', content: `[Reasoning summary]\n${content}` }] : []
    }
    if (type === 'pulpo_tool') {
      const tool = typeof item.tool === 'string' ? item.tool : 'tool'
      return [{ role: 'tool', content: `${tool}: ${itemText(item.output)}` }]
    }
    const role = item.role === 'developer' || item.role === 'assistant' || item.role === 'tool'
      ? item.role : item.role === 'toolResult' ? 'tool' : 'user'
    const content = itemText(item.content ?? item)
    return content ? [{ role, content }] : []
  })
}

function completedCheckpoint(response: HistoryResponse): CompactionItem | undefined {
  // Agent checkpoints retain Pi tool-protocol messages, which are not valid
  // input for the plain Responses API path.
  if (response.status !== 'completed' || response.agentMode) return undefined
  const output = Array.isArray(response.output) ? response.output : []
  return output.findLast((raw): raw is CompactionItem => {
    const item = raw as Partial<CompactionItem>
    return item.type === 'pulpo_compaction' && item.phase === 'pre_response' && item.status === 'completed' && typeof item.summary === 'string'
  })
}

export function effectiveHistoryChunks(history: HistoryResponse[]): HistoryChunk[] {
  let checkpointIndex = -1
  let checkpoint: CompactionItem | undefined
  for (let index = history.length - 1; index >= 0; index -= 1) {
    checkpoint = completedCheckpoint(history[index]!)
    if (checkpoint) {
      checkpointIndex = index
      break
    }
  }
  const chunks: HistoryChunk[] = []
  if (checkpoint) {
    chunks.push({ context: [{ role: 'developer', content: `Summary of earlier conversation:\n${checkpoint.summary}` }], retainable: false })
    const retainedTurns = checkpoint.retained_context_turns?.length
      ? checkpoint.retained_context_turns
      : checkpoint.retained_context?.length ? [checkpoint.retained_context] : []
    chunks.push(...retainedTurns.map((context) => ({ context, retainable: true })))
  }
  for (const response of history.slice(Math.max(0, checkpointIndex))) {
    const agentText = response.agentMode && response.status === 'completed'
      ? assistantOutputText(response.output)
      : ''
    chunks.push({
      responseId: response.id,
      retainable: true,
      context: [
        ...(Array.isArray(response.input) ? response.input : []),
        ...(response.status === 'completed' && Array.isArray(response.output)
          ? response.agentMode
            ? agentText ? [{ role: 'assistant', content: agentText }] : []
            : response.output.filter((item) => (item as { type?: string }).type !== 'pulpo_compaction')
          : []),
      ],
    })
  }
  return chunks.filter((chunk) => chunk.context.length > 0)
}

export async function compactConversation(options: {
  responseId: string
  modelId: string
  enabled: boolean
  thresholdTokens: number
  retainedTurns: number
  fixedContext: unknown[]
  currentInput: unknown[]
  history: HistoryResponse[]
  existingItem?: CompactionItem
  invoke: (olderContext: unknown[]) => Promise<string>
  onUpdate: (item: CompactionItem) => Promise<void>
}): Promise<{ conversation: unknown[]; item?: CompactionItem }> {
  const chunks = effectiveHistoryChunks(options.history)
  const conversation = chunks.flatMap((chunk) => chunk.context)
  const estimatedTokens = estimateInputTokens([...options.fixedContext, ...conversation, ...options.currentInput])
  const retainable = chunks.filter((chunk) => chunk.retainable)
  if (!options.enabled || estimatedTokens <= options.thresholdTokens || retainable.length <= options.retainedTurns) {
    return { conversation }
  }
  if (options.existingItem?.status === 'completed' && options.existingItem.model_id === options.modelId) {
    return {
      conversation: [
        { role: 'developer', content: `Summary of earlier conversation:\n${options.existingItem.summary}` },
        ...options.existingItem.retained_context,
      ],
      item: options.existingItem,
    }
  }
  const retainedChunks = retainable.slice(-options.retainedTurns)
  const retainedContext = retainedChunks.flatMap((chunk) => chunk.context)
  const storedRetainedContext = sanitizeContextForStorage(retainedContext)
  const storedRetainedTurns = sanitizeContextForStorage(retainedChunks.map((chunk) => chunk.context))
  const firstRetainedIndex = chunks.indexOf(retainedChunks[0]!)
  const olderChunks = chunks.slice(0, firstRetainedIndex)
  const olderContext = olderChunks.flatMap((chunk) => chunk.context)
  const started = Date.now()
  const base: CompactionItem = {
    id: `${options.responseId}:compaction:pre_response`,
    type: 'pulpo_compaction',
    phase: 'pre_response',
    status: 'in_progress',
    model_id: options.modelId,
    estimated_tokens: estimatedTokens,
    threshold_tokens: options.thresholdTokens,
    retained_turns: contextEntries(retainedContext),
    retained_context: storedRetainedContext,
    retained_context_turns: storedRetainedTurns,
    summary: '',
    started_at: new Date(started).toISOString(),
    covered_through_response_id: olderChunks.findLast((chunk) => chunk.responseId)?.responseId,
  }
  await options.onUpdate(base)
  try {
    const summary = await options.invoke(olderContext)
    const item: CompactionItem = { ...base, status: 'completed', summary, duration_ms: Date.now() - started }
    await options.onUpdate(item)
    return {
      conversation: [{ role: 'developer', content: `Summary of earlier conversation:\n${summary}` }, ...retainedContext],
      item,
    }
  } catch (error) {
    const item: CompactionItem = {
      ...base,
      status: 'failed',
      duration_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }
    await options.onUpdate(item)
    throw new Error(`Compaction failed: ${item.error}`, { cause: error })
  }
}

export function retainedEntries(context: unknown[]): CompactionRetainedEntry[] {
  return contextEntries(context)
}
