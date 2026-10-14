import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { isContextOverflow, type AssistantMessage, type AssistantMessageEventStream, type Context, type Message, type Tool, type ToolChoice, type Usage } from '@earendil-works/pi-ai'
import type { CompactionItem } from '@pulpo/contracts'
import { autoCompactLimit, effectiveRetainedUserTokens, hardContextLimit } from '../compaction/policy.js'
import { buildCompactedPiHistory, dropOldestPiUnit, piUserTextMessage } from '../compaction/pi-history.js'
import { SUMMARIZATION_PROMPT } from '../compaction/prompt.js'
import { CompactionError, CompactionOverflowError, summarizeWithOverflowRetry, trimHistoryToTokenLimit } from '../compaction/summarize.js'
import { piContextTokens, piFullEstimate, type ContextTokenCount } from '../compaction/tokens.js'

export type AgentCompactionPhase = CompactionItem['phase']

/** System prompt and tools around a history, plus the run's abort signal; the summarizer reuses them so the provider prompt cache still hits. */
export type AgentRequestFrame = { systemPrompt: string; tools: readonly Tool[]; signal?: AbortSignal }

export type AgentCompactionSettings = {
  enabled: boolean
  modelId: string
  thresholdTokens: number
  contextWindow: number
  retainedUserTokens: number
  summaryMaxTokens: number
}

export type AgentCompactionRequest = AgentRequestFrame & {
  phase: AgentCompactionPhase
  /** History to count, summarize and replace; like Codex, an incoming prompt is not part of it. */
  messages: AgentMessage[]
  /** The incoming prompt of a pre_response compaction: never summarized, but compacting is due when it would not fit. */
  pending?: AgentMessage[]
  /** Overflow recovery: compact below the limit, and fail when that does not shrink the context. */
  force?: boolean
  /** Display turn the next assistant message takes; mid-run only. */
  beforeAgentTurn?: number
}

/** A compaction must be expected to remove more than about one summary's worth of history. */
const COMPACTION_MIN_SAVING_TOKENS = 2_000

type TokenContext = { systemPrompt?: string; messages: readonly unknown[]; tools?: readonly unknown[] }

/** pi-agent-core's default convertToLlm: only these roles reach the provider. */
export function llmMessages(messages: readonly AgentMessage[]): Message[] {
  return messages.filter((message): message is Message => (
    message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult'
  ))
}

/** Pre-response ids are fixed; mid-run ids count up across resume because existing items are seeded from stored output. */
export function agentCompactionItemId(responseId: string, phase: AgentCompactionPhase, items: readonly CompactionItem[]): string {
  if (phase === 'pre_response') return `${responseId}:compaction:pre_response:0`
  const ids = new Set(items.map((item) => item.id))
  let index = 1 + items.filter((item) => item.phase === 'agent_mid_run').length
  while (ids.has(`${responseId}:compaction:agent_mid_run:${index}`)) index += 1
  return `${responseId}:compaction:agent_mid_run:${index}`
}

/** Items a crash left in progress; a resumed run closes them as failed so they never show as running. */
export function interruptedCompactionItems(items: readonly CompactionItem[]): CompactionItem[] {
  return items.flatMap((item) => item.status === 'in_progress'
    ? [{ ...item, status: 'failed' as const, error: 'Context compaction was interrupted' }]
    : [])
}

const zeroUsage = (): Usage => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
})

/**
 * The real conversation with the summary prompt appended as the final user message. Usage is cleared so
 * pi-ai sizes the output cap from this request, not from the last turn's usage of the untrimmed history,
 * which clamps it to 1; usage never goes on the wire, so the cached prefix is unchanged.
 */
export function agentSummaryContext(history: readonly Message[], frame: AgentRequestFrame): Context {
  return {
    systemPrompt: frame.systemPrompt,
    messages: [
      ...history.map((message) => message.role === 'assistant' ? { ...message, usage: zeroUsage() } : message),
      piUserTextMessage(SUMMARIZATION_PROMPT),
    ],
    tools: [...frame.tools],
  }
}

export function agentSummaryText(message: AssistantMessage): string {
  return message.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n')
}

/** One summarizer attempt. Tool calls are ignored; a context overflow lets the caller drop history and retry. */
export async function completeAgentSummary(options: {
  context: Context
  contextWindow: number
  stream: (context: Context, toolChoice: ToolChoice | undefined) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>
}): Promise<AssistantMessage> {
  const toolChoice = options.context.tools?.length ? 'none' : undefined
  const message = await (await options.stream(options.context, toolChoice)).result()
  if (!agentSummaryText(message).trim() && isContextOverflow(message, options.contextWindow)) {
    throw new CompactionOverflowError()
  }
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    throw new Error(`Context compaction failed: ${message.errorMessage || message.stopReason}`)
  }
  return message
}

/**
 * Codex-style compaction: summarize the real history with the chat's own request frame,
 * then keep only recent user messages plus the summary. Resolves undefined when skipped.
 */
export function createAgentCompactor(deps: {
  responseId: string
  settings: () => AgentCompactionSettings
  items: () => readonly CompactionItem[]
  summarize: (history: Message[], frame: AgentRequestFrame) => Promise<string>
  updateItem: (item: CompactionItem) => Promise<void>
  contextTokens?: (context: TokenContext) => ContextTokenCount
  /** Model-visible size of bare history, used to tell whether compacting can save anything. */
  historyTokens?: (messages: readonly Message[]) => number
  now?: () => number
}): (request: AgentCompactionRequest) => Promise<Message[] | undefined> {
  const contextTokens = deps.contextTokens ?? piContextTokens
  const historyTokens = deps.historyTokens ?? ((messages: readonly Message[]) => piFullEstimate({ messages }))
  const now = deps.now ?? Date.now
  return async (request) => {
    const settings = deps.settings()
    const limit = autoCompactLimit(settings.thresholdTokens, settings.contextWindow)
    const frame: AgentRequestFrame = { systemPrompt: request.systemPrompt, tools: request.tools, signal: request.signal }
    const counted = (messages: readonly AgentMessage[]): TokenContext => ({ systemPrompt: request.systemPrompt, messages, tools: request.tools })
    const before = contextTokens(counted(request.messages))
    if (!settings.enabled || !request.messages.length) return undefined
    const retainedUserTokens = effectiveRetainedUserTokens(settings.retainedUserTokens, limit)
    if (!request.force) {
      // Like Codex the history decides, unless the incoming prompt would not fit beside it at all.
      const pending = request.pending ?? []
      const due = before.tokens >= limit || (pending.length > 0
        && contextTokens(counted([...request.messages, ...pending])).tokens > hardContextLimit(settings.contextWindow))
      if (!due) return undefined
      // Skip a billed summary that cannot shrink the history by more than a summary's size.
      const history = llmMessages(request.messages)
      const retained = buildCompactedPiHistory(history, '', retainedUserTokens).messages.slice(0, -1)
      if (historyTokens(history) - historyTokens(retained) <= Math.min(COMPACTION_MIN_SAVING_TOKENS, settings.summaryMaxTokens)) return undefined
    }

    const startedAt = now()
    const base: CompactionItem = {
      id: agentCompactionItemId(deps.responseId, request.phase, deps.items()),
      type: 'pulpo_compaction',
      phase: request.phase,
      status: 'in_progress',
      model_id: settings.modelId,
      strategy: 'user_messages',
      estimated_tokens: before.tokens,
      token_source: before.source,
      threshold_tokens: limit,
      retained_turns: [],
      retained_context: [],
      retained_context_turns: [],
      summary: '',
      started_at: new Date(startedAt).toISOString(),
      ...(request.phase === 'agent_mid_run' && request.beforeAgentTurn ? { before_agent_turn: request.beforeAgentTurn } : {}),
    }
    const fail = (error: unknown) => deps.updateItem({
      ...base,
      status: 'failed',
      duration_ms: Math.max(0, now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    })
    await deps.updateItem(base)
    try {
      const promptTokens = piFullEstimate({ messages: [piUserTextMessage(SUMMARIZATION_PROMPT)] })
      // Best effort: a history that still does not fit goes out most-trimmed, and an overflow drops more.
      const trimmed = await trimHistoryToTokenLimit({
        history: llmMessages(request.messages),
        tokens: (history) => piFullEstimate({ systemPrompt: request.systemPrompt, messages: history, tools: request.tools }) + promptTokens,
        limit: Math.max(1, hardContextLimit(settings.contextWindow) - settings.summaryMaxTokens),
        dropOldest: dropOldestPiUnit,
      })
      const { summary } = await summarizeWithOverflowRetry({
        history: trimmed.history,
        dropOldest: dropOldestPiUnit,
        invoke: (history) => deps.summarize(history, frame),
      })
      // Retained user messages come from the full history, not the trimmed summarizer input.
      const compacted = buildCompactedPiHistory(request.messages, summary, retainedUserTokens)
      const after = contextTokens(counted(compacted.messages))
      if (after.tokens >= before.tokens) {
        // No unit word here: Codex treats error texts mentioning tokens as expired logins.
        const error = new CompactionError(`Context compaction did not shrink the context (${before.tokens} to ${after.tokens})`)
        // Only recovery must shrink; a threshold compaction that cannot help leaves the run uncompacted.
        if (request.force) throw error
        await fail(error)
        return undefined
      }
      await deps.updateItem({
        ...base,
        status: 'completed',
        summary,
        retained_turns: compacted.retained.map((message) => ({ role: 'user' as const, content: message.text })),
        tokens_after: after.tokens,
        duration_ms: Math.max(0, now() - startedAt),
      })
      return compacted.messages
    } catch (error) {
      await fail(error)
      throw error
    }
  }
}
