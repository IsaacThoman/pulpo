import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
import type { CompactionItem } from '@pulpo/contracts'
import { checkpointRetainedUserTexts, findLatestCheckpoint, isUserMessagesCheckpoint, USER_MESSAGES_STRATEGY, type HistoryResponseRow } from '../compaction/checkpoint.js'
import { buildCompactedPiHistory, dropOldestPiUnit, piSummaryMessage, piUserTextMessage } from '../compaction/pi-history.js'
import { autoCompactLimit, effectiveRetainedUserTokens, hardContextLimit, shouldAutoCompact, summaryMaxOutputTokens } from '../compaction/policy.js'
import { SUMMARIZATION_PROMPT } from '../compaction/prompt.js'
import { buildCompactedResponsesHistory, dropOldestResponsesUnit, responsesSummaryItem, responsesUserTextItem } from '../compaction/responses-history.js'
import type { RetainedUserMessage } from '../compaction/retained-user-messages.js'
import { CompactionError, summarizeWithOverflowRetry, trimHistoryToTokenLimit } from '../compaction/summarize.js'
import { estimatePiMessageTokens, estimatePiToolsTokens, estimateResponsesItemsTokens, responseUsageAnchor, type ContextTokenCount } from '../compaction/tokens.js'
import { approxTokenCount } from '../compaction/truncate.js'
import { responseInputText } from '../messages/input.js'
import { GenerationAttemptError, isContextOverflowError } from './fallback-policy.js'
import { assistantOutputText, generationOutputHasStarted } from './output-text.js'

/** A lineage row as the responses paths replay it. */
export type HistoryResponse = HistoryResponseRow & { input: unknown; usage: unknown }

export type CodexHistoryResponse = HistoryResponse & {
  modelId: string
  actualModelId: string | null
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}

export type CompactionModel = {
  id: string
  contextWindow: number
  maxOutputTokens: number
  compactionEnabled: boolean
  compactionThresholdTokens: number
  compactionRetainedUserTokens: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isPulpoItem = (item: unknown) => isRecord(item) && typeof item.type === 'string' && item.type.startsWith('pulpo_')
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

/** The current response's own checkpoint, left by an earlier attempt. */
export function preResponseCompactionItem(output: unknown): CompactionItem | undefined {
  if (!Array.isArray(output)) return undefined
  return output.find((raw): raw is CompactionItem => {
    const item = raw as Partial<CompactionItem> | null
    return item?.type === 'pulpo_compaction' && item.phase === 'pre_response'
  })
}

// Non-agent chat: Responses-style input items.

/** A response replayed as its input, then its completed output without Pulpo bookkeeping. */
function responseItems(response: HistoryResponse): unknown[] {
  const input = Array.isArray(response.input) ? response.input : []
  if (response.status !== 'completed' || !Array.isArray(response.output)) return input
  if (response.agentMode) {
    // Agent tool protocol has no form here; replay only the final text.
    const text = assistantOutputText(response.output)
    return text ? [...input, { role: 'assistant', content: text }] : input
  }
  return [...input, ...response.output.filter((item) => !isPulpoItem(item))]
}

function responsesCheckpointHead(item: CompactionItem): unknown[] {
  return [...checkpointRetainedUserTexts(item).map(responsesUserTextItem), responsesSummaryItem(item.summary)]
}

/** Legacy checkpoints kept whole recent turns next to a developer summary. */
function legacyResponsesCheckpointHead(item: CompactionItem): unknown[] {
  const turns = item.retained_context_turns?.length
    ? item.retained_context_turns
    : item.retained_context?.length ? [item.retained_context] : []
  return [{ role: 'developer', content: `Summary of earlier conversation:\n${item.summary}` }, ...turns.flat()]
}

/** History for a non-agent request: the latest checkpoint, then every response from it onward. */
export function responsesConversation(lineage: readonly HistoryResponse[]): unknown[] {
  const checkpoint = findLatestCheckpoint(lineage)
  if (!checkpoint) return lineage.flatMap(responseItems)
  const head = isUserMessagesCheckpoint(checkpoint.item)
    ? responsesCheckpointHead(checkpoint.item)
    : legacyResponsesCheckpointHead(checkpoint.item)
  return [...head, ...lineage.slice(checkpoint.index).flatMap(responseItems)]
}

// Codex-backed chat: pi-ai messages.

function codexAssistantText(output: unknown): string {
  if (!Array.isArray(output)) return ''
  return output.flatMap((item) => {
    const content = (item as { content?: unknown[] } | null)?.content
    return Array.isArray(content) ? content.flatMap((part) => {
      const value = part as { type?: string; text?: string }
      return value.type === 'output_text' && value.text ? [value.text] : []
    }) : []
  }).join('\n')
}

const ZERO_USAGE: AssistantMessage['usage'] = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

/** One text-only exchange per response; images, attachments and reasoning are not replayed. */
function codexExchange(turn: CodexHistoryResponse): Message[] {
  const messages: Message[] = []
  const userText = responseInputText(turn.input)
  if (userText) messages.push({ role: 'user', content: userText, timestamp: turn.createdAt.getTime() })
  const assistantText = codexAssistantText(turn.output)
  if (assistantText) messages.push({
    role: 'assistant', content: [{ type: 'text', text: assistantText }], api: 'openai-codex-responses',
    provider: 'openai-codex', model: turn.actualModelId ?? turn.modelId, usage: ZERO_USAGE,
    stopReason: 'stop', timestamp: turn.completedAt?.getTime() ?? turn.updatedAt.getTime(),
  })
  return messages
}

function codexCheckpointHead(item: CompactionItem, timestamp = Date.now()): Message[] {
  return [...checkpointRetainedUserTexts(item).map((text) => piUserTextMessage(text, timestamp)), piSummaryMessage(item.summary, timestamp)]
}

/** History for a Codex request: the latest checkpoint, then every exchange it does not cover. */
export function codexConversation(lineage: readonly CodexHistoryResponse[]): Message[] {
  const checkpoint = findLatestCheckpoint(lineage)
  if (!checkpoint) return lineage.flatMap(codexExchange)
  const { item, index } = checkpoint
  const timestamp = lineage[index]!.createdAt.getTime()
  if (isUserMessagesCheckpoint(item)) return [...codexCheckpointHead(item, timestamp), ...lineage.slice(index).flatMap(codexExchange)]
  // Legacy Codex checkpoints resume after the response they cover.
  const covered = item.covered_through_response_id ? lineage.findIndex((turn) => turn.id === item.covered_through_response_id) : -1
  if (covered < 0) return lineage.flatMap(codexExchange)
  const summary: Message[] = item.summary ? [{ role: 'user', content: `Earlier conversation summary:\n${item.summary}`, timestamp }] : []
  return [...summary, ...lineage.slice(covered + 1).flatMap(codexExchange)]
}

// Pre-response compaction.

export type PreResponseCompaction<T> = {
  responseId: string
  model: CompactionModel
  /** The direct parent: its usage anchors the token count and the summary covers through it. */
  parent?: HistoryResponse
  conversation: T[]
  /** The current response's checkpoint from an earlier attempt. */
  existingItem?: CompactionItem
  /** Compact whatever the token count, e.g. after the provider reported an overflow. */
  force?: boolean
  /** Summarize the history with the summary prompt appended; throws CompactionOverflowError on overflow. */
  summarize: (history: T[]) => Promise<string>
  onUpdate: (item: CompactionItem) => Promise<void>
}

export type PreResponseCompactionResult<T> = { conversation: T[]; item?: CompactionItem }

type CompactionPlan<T> = {
  anchor: number | undefined
  /** System prompt, fixed context and tools. */
  fixedTokens: number
  historyTokens: (history: readonly T[]) => number
  dropOldest: (history: T[]) => T[] | undefined
  build: (history: readonly T[], summary: string, budget: number) => { history: T[]; retained: RetainedUserMessage[] }
  restore: (item: CompactionItem) => T[]
}

function reusableItem(item: CompactionItem | undefined, modelId: string): item is CompactionItem {
  return item?.status === 'completed' && isUserMessagesCheckpoint(item) && item.model_id === modelId
}

/**
 * Trim by estimate so the summary request and its output fit the window. The
 * most-trimmed history is sent even when it does not fit: the provider's
 * overflow response stays authoritative.
 */
async function trimmedForSummary<T>(history: T[], tokens: (history: T[]) => number, model: CompactionModel, dropOldest: CompactionPlan<T>['dropOldest']): Promise<T[]> {
  const limit = Math.max(1, hardContextLimit(model.contextWindow) - summaryMaxOutputTokens(model.maxOutputTokens))
  return (await trimHistoryToTokenLimit({ history, tokens, limit, dropOldest })).history
}

async function compactBeforeResponse<T>(options: PreResponseCompaction<T>, plan: CompactionPlan<T>): Promise<PreResponseCompactionResult<T>> {
  const { model, conversation } = options
  const limit = autoCompactLimit(model.compactionThresholdTokens, model.contextWindow)
  // Like Codex, only the context before this turn counts; an oversized current
  // input surfaces as a provider overflow, retried with a forced compaction.
  const before: ContextTokenCount = plan.anchor === undefined
    ? { tokens: plan.fixedTokens + plan.historyTokens(conversation), source: 'estimate' }
    : { tokens: plan.anchor, source: 'usage' }
  const due = conversation.length > 0 && (options.force
    ? model.compactionEnabled
    : shouldAutoCompact({ enabled: model.compactionEnabled, tokens: before.tokens, limit }))
  if (!due) return { conversation }
  // Retries must not summarize (and bill) again.
  if (reusableItem(options.existingItem, model.id)) return { conversation: plan.restore(options.existingItem), item: options.existingItem }
  const started = Date.now()
  const base: CompactionItem = {
    id: `${options.responseId}:compaction:pre_response`,
    type: 'pulpo_compaction',
    phase: 'pre_response',
    status: 'in_progress',
    strategy: USER_MESSAGES_STRATEGY,
    model_id: model.id,
    estimated_tokens: before.tokens,
    token_source: before.source,
    threshold_tokens: limit,
    retained_turns: [],
    retained_context: [],
    retained_context_turns: [],
    summary: '',
    started_at: new Date(started).toISOString(),
    ...(options.parent ? { covered_through_response_id: options.parent.id } : {}),
  }
  await options.onUpdate(base)
  try {
    const promptTokens = approxTokenCount(SUMMARIZATION_PROMPT)
    const requestTokens = (history: T[]) => plan.fixedTokens + plan.historyTokens(history) + promptTokens
    const { summary } = await summarizeWithOverflowRetry({
      history: await trimmedForSummary(conversation, requestTokens, model, plan.dropOldest),
      dropOldest: plan.dropOldest,
      invoke: options.summarize,
    })
    // Retained user messages come from the full history, not the trimmed summarizer input.
    const compacted = plan.build(conversation, summary, effectiveRetainedUserTokens(model.compactionRetainedUserTokens, limit))
    const item: CompactionItem = {
      ...base,
      status: 'completed',
      summary,
      retained_turns: compacted.retained.map((message) => ({ role: 'user', content: message.text })),
      tokens_after: plan.fixedTokens + plan.historyTokens(compacted.history),
      duration_ms: Date.now() - started,
    }
    await options.onUpdate(item)
    return { conversation: compacted.history, item }
  } catch (error) {
    await options.onUpdate({ ...base, status: 'failed', duration_ms: Date.now() - started, error: errorMessage(error) })
    // Fallback classification relies on the word "compaction".
    throw error instanceof CompactionError ? error : new CompactionError(`Compaction failed: ${errorMessage(error)}`, { cause: error })
  }
}

/** Non-agent chat: compacted history is retained user items plus a summary item. */
export function compactResponsesConversation(options: PreResponseCompaction<unknown> & {
  fixedContext: readonly unknown[]
  tools?: readonly unknown[]
  instructions?: string
}): Promise<PreResponseCompactionResult<unknown>> {
  return compactBeforeResponse(options, {
    // Earlier reasoning is not replayed: Pulpo does not request encrypted reasoning
    // here and providers drop it at a new user turn. A public-API client continuing
    // a tool call (function_call_output after previous_response_id) does get it back,
    // so that count runs low by up to one response's reasoning.
    anchor: responseUsageAnchor(options.parent, { excludeReasoning: true }),
    fixedTokens: estimateResponsesItemsTokens(options.fixedContext)
      + estimatePiToolsTokens(options.tools)
      + approxTokenCount(options.instructions ?? ''),
    historyTokens: estimateResponsesItemsTokens,
    dropOldest: dropOldestResponsesUnit,
    build: (history, summary, budget) => {
      const compacted = buildCompactedResponsesHistory(history, summary, budget)
      return { history: compacted.items, retained: compacted.retained }
    },
    restore: responsesCheckpointHead,
  })
}

/** Codex chat: compacted history is retained user messages plus a summary message. */
export function compactCodexConversation(options: PreResponseCompaction<Message> & {
  systemPrompt?: string
}): Promise<PreResponseCompactionResult<Message>> {
  return compactBeforeResponse(options, {
    // Codex history never replays reasoning, so it is not part of the next context.
    anchor: responseUsageAnchor(options.parent, { excludeReasoning: true }),
    fixedTokens: approxTokenCount(options.systemPrompt ?? ''),
    historyTokens: (history) => sum(history.map(estimatePiMessageTokens)),
    dropOldest: dropOldestPiUnit,
    build: (history, summary, budget) => {
      const compacted = buildCompactedPiHistory(history, summary, budget)
      return { history: compacted.messages, retained: compacted.retained }
    },
    restore: (item) => codexCheckpointHead(item),
  })
}

const SUMMARY_REQUEST_PARAMETERS = ['cache_control', 'prompt_cache_key', 'prompt_cache_retention', 'prompt_cache_options', 'instructions'] as const

/**
 * Summarizer parameters taken from the main request: the same cache identity,
 * instructions and tools keep the prompt prefix cacheable; tool use is disabled
 * so the model answers in text.
 */
export function summaryRequestParameters(mainParameters: Record<string, unknown>): Record<string, unknown> {
  const parameters: Record<string, unknown> = Object.fromEntries(SUMMARY_REQUEST_PARAMETERS
    .filter((key) => mainParameters[key] !== undefined)
    .map((key) => [key, mainParameters[key]]))
  const tools = mainParameters.tools
  return Array.isArray(tools) && tools.length ? { ...parameters, tools, tool_choice: 'none' } : parameters
}

/** Whether a failed attempt should be retried once with a forced compaction. */
export function canRetryOverflowWithCompaction(options: {
  error: unknown
  enabled: boolean
  hasHistory: boolean
  modelId: string
  /** The response output the failed attempt left behind. */
  output: unknown
}): boolean {
  if (!options.enabled || !options.hasHistory || !isContextOverflowError(options.error)) return false
  if (options.error instanceof GenerationAttemptError && options.error.outputStarted) return false
  if (generationOutputHasStarted(options.output)) return false
  // A context this model already compacted would be sent again unchanged.
  return !reusableItem(preResponseCompactionItem(options.output), options.modelId)
}
