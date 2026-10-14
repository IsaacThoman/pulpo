import { describe, expect, it, vi } from 'vitest'
import { Agent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core'
import {
  createAssistantMessageEventStream,
  Type,
  type Api,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type ToolChoice,
  type ToolResultMessage,
  type UserMessage,
} from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options'
import type { CompactionItem } from '@pulpo/contracts'
import {
  agentCompactionItemId,
  agentSummaryContext,
  interruptedCompactionItems,
  agentSummaryText,
  completeAgentSummary,
  createAgentCompactor,
  llmMessages,
  type AgentCompactionSettings,
} from './compaction.js'
import { SUMMARIZATION_PROMPT, SUMMARY_PREFIX, summaryMessageText } from '../compaction/prompt.js'
import { CompactionError, CompactionOverflowError } from '../compaction/summarize.js'
import type { ContextTokenCount } from '../compaction/tokens.js'

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }

function user(text: string): UserMessage {
  return { role: 'user', content: [{ type: 'text', text }], timestamp: 1 }
}

function assistant(content: AssistantMessage['content'], extra: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant', content, api: 'openai-responses', provider: 'openai', model: 'model',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: ZERO_COST },
    stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: 1,
    ...extra,
  }
}

function toolCall(id: string) {
  return { type: 'toolCall' as const, id, name: 'bash', arguments: {} }
}

function toolResult(id: string, text = `result ${id}`): ToolResultMessage {
  return { role: 'toolResult', toolCallId: id, toolName: 'bash', content: [{ type: 'text', text }], isError: false, timestamp: 1 }
}

function streamOf(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream()
  if (message.stopReason === 'error' || message.stopReason === 'aborted') stream.push({ type: 'error', reason: message.stopReason, error: message })
  else stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'length' | 'toolUse', message })
  return stream
}

/** before, then after; the compactor counts exactly twice per compaction. */
function tokenSequence(...counts: ContextTokenCount[]) {
  const fn = vi.fn((_context: { messages: readonly unknown[] }) => counts.shift() ?? { tokens: 0, source: 'estimate' as const })
  return fn
}

function setup(options: {
  settings?: Partial<AgentCompactionSettings>
  contextTokens?: (context: { messages: readonly unknown[] }) => ContextTokenCount
  historyTokens?: (messages: readonly Message[]) => number
  summarize?: (history: Message[]) => Promise<string>
  items?: CompactionItem[]
} = {}) {
  const items: CompactionItem[] = [...options.items ?? []]
  const updates: CompactionItem[] = []
  let clock = 1_000
  const summarize = vi.fn(options.summarize ?? (async () => '  Summary of the work so far.  '))
  const compact = createAgentCompactor({
    responseId: 'resp',
    settings: () => ({
      enabled: true, modelId: 'model', thresholdTokens: 1_000, contextWindow: 100_000,
      retainedUserTokens: 20_000, summaryMaxTokens: 1_000,
      ...options.settings,
    }),
    items: () => items,
    summarize,
    updateItem: async (item) => {
      updates.push(item)
      const index = items.findIndex((candidate) => candidate.id === item.id)
      if (index >= 0) items[index] = item
      else items.push(item)
    },
    contextTokens: options.contextTokens,
    // Unit histories are tiny; size each message like a long turn unless a test measures savings for real.
    historyTokens: options.historyTokens ?? ((messages) => messages.length * 10_000),
    now: () => (clock += 250),
  })
  return { compact, items, updates, summarize }
}

const frame = { systemPrompt: 'system', tools: [] }
const history = (): AgentMessage[] => [
  user('Fix the build'),
  assistant([{ type: 'text', text: 'Looking.' }, toolCall('call-1')]),
  toolResult('call-1'),
  user('Also update the docs'),
  assistant([{ type: 'text', text: 'Done.' }]),
]

describe('createAgentCompactor', () => {
  it('skips below the auto-compact limit', async () => {
    const { compact, updates, summarize } = setup({ contextTokens: tokenSequence({ tokens: 999, source: 'usage' }) })
    await expect(compact({ ...frame, phase: 'agent_mid_run', messages: history() })).resolves.toBeUndefined()
    expect(summarize).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it('compacts at min(threshold, 90% of the context window)', async () => {
    const { compact, items } = setup({
      settings: { thresholdTokens: 50_000, contextWindow: 1_000, summaryMaxTokens: 100 },
      contextTokens: tokenSequence({ tokens: 900, source: 'usage' }, { tokens: 100, source: 'estimate' }),
    })
    await expect(compact({ ...frame, phase: 'agent_mid_run', messages: history() })).resolves.toBeDefined()
    expect(items[0]).toMatchObject({ status: 'completed', threshold_tokens: 900, estimated_tokens: 900 })
  })

  it('compacts below the limit only when forced, and never when disabled or empty', async () => {
    const forced = setup({ contextTokens: tokenSequence({ tokens: 10, source: 'usage' }, { tokens: 5, source: 'estimate' }) })
    await expect(forced.compact({ ...frame, phase: 'agent_mid_run', messages: history(), force: true })).resolves.toBeDefined()

    const disabled = setup({ settings: { enabled: false }, contextTokens: tokenSequence({ tokens: 5_000, source: 'usage' }) })
    await expect(disabled.compact({ ...frame, phase: 'agent_mid_run', messages: history(), force: true })).resolves.toBeUndefined()
    expect(disabled.summarize).not.toHaveBeenCalled()

    const empty = setup({ contextTokens: tokenSequence({ tokens: 5_000, source: 'usage' }) })
    await expect(empty.compact({ ...frame, phase: 'pre_response', messages: [], force: true })).resolves.toBeUndefined()
    expect(empty.summarize).not.toHaveBeenCalled()
  })

  it('counts and compares only the history it replaces', async () => {
    const contextTokens = tokenSequence({ tokens: 1_200, source: 'usage' }, { tokens: 400, source: 'estimate' })
    const { compact, summarize, items } = setup({ contextTokens })
    const compacted = await compact({ ...frame, phase: 'pre_response', messages: history() })
    expect(contextTokens.mock.calls[0]![0].messages).toEqual(history())
    expect(contextTokens.mock.calls[1]![0].messages).toEqual(compacted)
    expect(summarize.mock.calls[0]![0]).toEqual(history())
    expect(compacted?.map((message) => message.role)).toEqual(['user', 'user', 'user'])
    expect(items[0]).toMatchObject({ status: 'completed', estimated_tokens: 1_200, tokens_after: 400 })
  })

  it.each(['pre_response', 'agent_mid_run'] as const)('skips a %s threshold compaction that cannot save more than a summary', async (phase) => {
    // A short exchange is over a tiny threshold, but summarizing it would not shrink anything.
    const { compact, summarize, updates } = setup({ settings: { thresholdTokens: 10 }, historyTokens: (messages) => messages.length * 10 })
    const messages = [user('Hi'), assistant([{ type: 'text', text: 'Hello! How can I help you today?' }])]
    await expect(compact({ ...frame, phase, messages })).resolves.toBeUndefined()
    expect(summarize).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it.each(['pre_response', 'agent_mid_run'] as const)('leaves the %s history uncompacted when a threshold compaction does not shrink it', async (phase) => {
    const contextTokens = tokenSequence({ tokens: 1_500, source: 'usage' }, { tokens: 1_600, source: 'estimate' })
    const { compact, summarize, updates } = setup({ contextTokens })
    await expect(compact({ ...frame, phase, messages: history() })).resolves.toBeUndefined()
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(updates.map((item) => item.status)).toEqual(['in_progress', 'failed'])
    const failed = updates.at(-1)!
    expect(failed.error).toBe('Context compaction did not shrink the context (1500 to 1600)')
    expect(failed.tokens_after).toBeUndefined()
  })

  it('compacts the history before a prompt that would not fit beside it, without summarizing the prompt', async () => {
    const pending = [user('A very large paste')]
    // History alone is under the limit; with the pending prompt the request would exceed 95% of the window.
    const contextTokens = vi.fn((context: { messages: readonly unknown[] }) => (
      context.messages.length > history().length
        ? { tokens: 96_000, source: 'usage' as const }
        : { tokens: context.messages.length === history().length ? 900 : 200, source: 'estimate' as const }
    ))
    const { compact, summarize, items } = setup({ contextTokens })
    const compacted = await compact({ ...frame, phase: 'pre_response', messages: history(), pending })
    expect(summarize.mock.calls[0]![0]).toEqual(history())
    expect(compacted?.at(-1)).toEqual(expect.objectContaining({ role: 'user' }))
    expect(JSON.stringify(compacted)).not.toContain('A very large paste')
    expect(items[0]).toMatchObject({ status: 'completed', estimated_tokens: 900, tokens_after: 200 })
  })

  it('does not count a pending prompt that fits', async () => {
    const contextTokens = vi.fn((context: { messages: readonly unknown[] }) => ({ tokens: context.messages.length * 100, source: 'estimate' as const }))
    const { compact, summarize } = setup({ contextTokens })
    await expect(compact({ ...frame, phase: 'pre_response', messages: history(), pending: [user('Next question')] })).resolves.toBeUndefined()
    expect(summarize).not.toHaveBeenCalled()
  })

  it('records Codex-style item fields and ids', async () => {
    const { compact, updates } = setup({ contextTokens: tokenSequence({ tokens: 1_500, source: 'usage' }, { tokens: 300, source: 'estimate' }) })
    const compacted = await compact({ ...frame, phase: 'agent_mid_run', messages: history(), beforeAgentTurn: 3 })
    expect(updates[0]).toMatchObject({
      id: 'resp:compaction:agent_mid_run:1', type: 'pulpo_compaction', phase: 'agent_mid_run', status: 'in_progress',
      model_id: 'model', strategy: 'user_messages', estimated_tokens: 1_500, token_source: 'usage', threshold_tokens: 1_000,
      retained_turns: [], retained_context: [], retained_context_turns: [], summary: '', before_agent_turn: 3,
    })
    expect(updates[1]).toEqual({
      ...updates[0],
      status: 'completed',
      summary: 'Summary of the work so far.',
      retained_turns: [{ role: 'user', content: 'Fix the build' }, { role: 'user', content: 'Also update the docs' }],
      tokens_after: 300,
      duration_ms: 250,
    })
    expect(compacted).toMatchObject([
      { role: 'user', content: [{ type: 'text', text: 'Fix the build' }] },
      { role: 'user', content: [{ type: 'text', text: 'Also update the docs' }] },
      { role: 'user', content: [{ type: 'text', text: summaryMessageText('Summary of the work so far.') }] },
    ])

    const pre = setup({ contextTokens: tokenSequence({ tokens: 1_500, source: 'estimate' }, { tokens: 300, source: 'estimate' }) })
    await pre.compact({ ...frame, phase: 'pre_response', messages: history(), beforeAgentTurn: 3 })
    expect(pre.updates[1]).toMatchObject({ id: 'resp:compaction:pre_response:0', phase: 'pre_response', token_source: 'estimate' })
    expect(pre.updates[1]).not.toHaveProperty('before_agent_turn')
  })

  it('numbers mid-run items after those already stored and never reuses an id', () => {
    const stored = (id: string): CompactionItem => ({
      id, type: 'pulpo_compaction', phase: 'agent_mid_run', status: 'completed', model_id: 'model', estimated_tokens: 1,
      threshold_tokens: 1, retained_turns: [], retained_context: [], retained_context_turns: [], summary: 's', started_at: new Date(0).toISOString(),
    })
    expect(agentCompactionItemId('resp', 'pre_response', [stored('resp:compaction:agent_mid_run:1')])).toBe('resp:compaction:pre_response:0')
    expect(agentCompactionItemId('resp', 'agent_mid_run', [])).toBe('resp:compaction:agent_mid_run:1')
    expect(agentCompactionItemId('resp', 'agent_mid_run', [stored('resp:compaction:agent_mid_run:1')])).toBe('resp:compaction:agent_mid_run:2')
    // Items from older code were numbered by model turn.
    expect(agentCompactionItemId('resp', 'agent_mid_run', [stored('resp:compaction:agent_mid_run:2')])).toBe('resp:compaction:agent_mid_run:3')
  })

  it('keeps recent user messages within the budget and never retains summaries', async () => {
    const { compact } = setup({
      // limit 40 caps the retained budget at 10 tokens.
      settings: { thresholdTokens: 40 },
      contextTokens: tokenSequence({ tokens: 500, source: 'usage' }, { tokens: 30, source: 'estimate' }),
    })
    const compacted = await compact({
      ...frame,
      phase: 'agent_mid_run',
      messages: [
        user(summaryMessageText('an older summary')),
        user('[Compacted context]\nlegacy handoff'),
        user('short ask'),
        assistant([{ type: 'text', text: 'ok' }]),
        user('z'.repeat(100)),
      ],
    })
    const texts = compacted!.map((message) => (message.content as Array<{ text: string }>)[0]!.text)
    expect(texts).toHaveLength(2)
    expect(texts[0]).toContain('tokens truncated')
    expect(texts[1]!.startsWith(SUMMARY_PREFIX)).toBe(true)
    expect(texts.join('\n')).not.toContain('older summary')
    expect(texts.join('\n')).not.toContain('legacy handoff')
  })

  it('trims the oldest exchanges until the summarizer request fits', async () => {
    const { compact, summarize } = setup({
      // hard limit 950 - 100 summary tokens leaves 850 for the request, including the summary prompt.
      settings: { contextWindow: 1_000, thresholdTokens: 900, summaryMaxTokens: 100 },
      contextTokens: tokenSequence({ tokens: 2_000, source: 'usage' }, { tokens: 300, source: 'estimate' }),
    })
    const messages: AgentMessage[] = [
      user('first'),
      assistant([{ type: 'text', text: 'x'.repeat(3_000) }, toolCall('call-1')]),
      toolResult('call-1', 'y'.repeat(400)),
      user('second'),
      assistant([{ type: 'text', text: 'done' }]),
    ]
    await compact({ ...frame, phase: 'agent_mid_run', messages })
    expect(summarize.mock.calls[0]![0]).toEqual([user('first'), user('second'), assistant([{ type: 'text', text: 'done' }])])
  })

  it('summarizes the most-trimmed history when even that does not fit, leaving the rest to overflow retries', async () => {
    const { compact, summarize, items } = setup({
      settings: { contextWindow: 1_000, thresholdTokens: 900, summaryMaxTokens: 100 },
      contextTokens: tokenSequence({ tokens: 2_000, source: 'usage' }, { tokens: 300, source: 'estimate' }),
    })
    const messages: AgentMessage[] = [
      user('first'),
      assistant([{ type: 'text', text: 'x'.repeat(3_000) }, toolCall('call-1')]),
      toolResult('call-1', 'y'.repeat(400)),
      user('second'),
      assistant([{ type: 'text', text: 'done' }]),
    ]
    // The system prompt alone is over the 850-token summarizer budget.
    await expect(compact({ ...frame, systemPrompt: 's'.repeat(4_000), phase: 'agent_mid_run', messages })).resolves.toBeDefined()
    const sent = summarize.mock.calls[0]![0]
    expect(sent.length).toBeLessThanOrEqual(1)
    expect(sent.every((message) => message.role === 'user')).toBe(true)
    expect(items[0]).toMatchObject({ status: 'completed' })
  })

  it('drops one unit and retries when the summarizer overflows', async () => {
    const attempts: Message[][] = []
    const { compact, updates } = setup({
      contextTokens: tokenSequence({ tokens: 1_500, source: 'usage' }, { tokens: 300, source: 'estimate' }),
      summarize: async (input) => {
        attempts.push(input)
        if (attempts.length === 1) throw new CompactionOverflowError()
        return 'Shorter summary'
      },
    })
    await compact({ ...frame, phase: 'agent_mid_run', messages: history() })
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toEqual([user('Fix the build'), user('Also update the docs'), assistant([{ type: 'text', text: 'Done.' }])])
    expect(updates.at(-1)).toMatchObject({ status: 'completed', summary: 'Shorter summary' })
  })

  it('fails a forced recovery that does not shrink the context, without mentioning tokens', async () => {
    const { compact, updates } = setup({ contextTokens: tokenSequence({ tokens: 1_500, source: 'usage' }, { tokens: 1_500, source: 'estimate' }) })
    const result = compact({ ...frame, phase: 'agent_mid_run', messages: history(), force: true })
    await expect(result).rejects.toBeInstanceOf(CompactionError)
    await expect(result).rejects.toThrow('Context compaction did not shrink the context (1500 to 1500)')
    // Codex disconnects the subscription on errors that mention tokens.
    await expect(result).rejects.not.toThrow(/token/i)
    expect(updates.map((item) => item.status)).toEqual(['in_progress', 'failed'])
    expect(updates.at(-1)).toMatchObject({ duration_ms: 250, error: expect.stringContaining('did not shrink') })
  })

  it('records a failed item and rethrows summarizer errors', async () => {
    const { compact, updates } = setup({
      contextTokens: tokenSequence({ tokens: 1_500, source: 'usage' }),
      summarize: async () => { throw new Error('Context compaction failed: upstream unavailable') },
    })
    await expect(compact({ ...frame, phase: 'agent_mid_run', messages: history() })).rejects.toThrow('upstream unavailable')
    expect(updates.map((item) => item.status)).toEqual(['in_progress', 'failed'])
  })
})

describe('interrupted compaction items', () => {
  it('closes items a crash left in progress and keeps finished ones', () => {
    const item = (id: string, status: CompactionItem['status']): CompactionItem => ({
      id, type: 'pulpo_compaction', phase: 'agent_mid_run', status, model_id: 'model', estimated_tokens: 1,
      threshold_tokens: 1, retained_turns: [], retained_context: [], retained_context_turns: [], summary: '', started_at: new Date(0).toISOString(),
    })
    expect(interruptedCompactionItems([item('a', 'completed'), item('b', 'in_progress'), item('c', 'failed')]))
      .toEqual([{ ...item('b', 'in_progress'), status: 'failed', error: 'Context compaction was interrupted' }])
  })
})

describe('agent summarizer request', () => {
  const tools = [{ name: 'bash', description: 'Run a command', parameters: Type.Object({}) }]

  it('appends the summary prompt to the real history with the same frame', () => {
    const context = agentSummaryContext(llmMessages(history()), { systemPrompt: 'system', tools })
    expect(context.systemPrompt).toBe('system')
    expect(context.tools).toEqual(tools)
    expect(context.messages.slice(0, -1)).toEqual(history())
    expect(context.messages.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'text', text: SUMMARIZATION_PROMPT }] })
  })

  it('forbids tool use when tools are present and ignores tool calls in the reply', async () => {
    const calls: Array<ToolChoice | undefined> = []
    const message = await completeAgentSummary({
      context: { systemPrompt: 'system', messages: [user('hi')], tools },
      contextWindow: 1_000,
      stream: (_context, toolChoice) => {
        calls.push(toolChoice)
        return streamOf(assistant([{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'The summary' }, toolCall('call-9')]))
      },
    })
    expect(agentSummaryText(message)).toBe('The summary')
    await completeAgentSummary({
      context: { systemPrompt: 'system', messages: [user('hi')], tools: [] },
      contextWindow: 1_000,
      stream: (_context, toolChoice) => {
        calls.push(toolChoice)
        return streamOf(assistant([{ type: 'text', text: 'The summary' }]))
      },
    })
    expect(calls).toEqual(['none', undefined])
  })

  it('reports provider context overflows separately from other failures', async () => {
    const failing = (message: AssistantMessage) => completeAgentSummary({
      context: { messages: [user('hi')] }, contextWindow: 1_000, stream: () => streamOf(message),
    })
    await expect(failing(assistant([], { stopReason: 'error', errorMessage: 'prompt is too long: 2000 tokens > 1000 maximum' })))
      .rejects.toBeInstanceOf(CompactionOverflowError)
    await expect(failing(assistant([], { stopReason: 'length', usage: { input: 995, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 995, cost: ZERO_COST } })))
      .rejects.toBeInstanceOf(CompactionOverflowError)
    await expect(failing(assistant([], { stopReason: 'error', errorMessage: 'upstream unavailable' })))
      .rejects.toThrow('Context compaction failed: upstream unavailable')
  })
})

describe('agent summarizer output cap', () => {
  const tools = [{ name: 'bash', description: 'Run a command', parameters: Type.Object({}) }]
  const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const completions: Model<'openai-completions'> = {
    id: 'local', name: 'Local', api: 'openai-completions', provider: 'local', baseUrl: 'http://127.0.0.1:9/v1',
    reasoning: false, input: ['text'], contextWindow: 32_768, maxTokens: 8_192, cost,
  }
  const anthropic: Model<'anthropic-messages'> = {
    id: 'claude', name: 'Claude', api: 'anthropic-messages', provider: 'anthropic', baseUrl: 'http://127.0.0.1:9',
    reasoning: true, input: ['text'], contextWindow: 32_768, maxTokens: 64_000, cost,
  }
  // Mid-run compaction at the 90% limit of a 32k window: the last turn's usage still counts the whole history.
  const summarized = (): Message[] => [
    user('Refactor the parser'),
    assistant([toolCall('call-1')], { usage: { input: 28_000, output: 600, cacheRead: 0, cacheWrite: 0, totalTokens: 28_600, cost: ZERO_COST } }),
    toolResult('call-1', 'x'.repeat(4_000)),
  ]

  /** pi-ai's real streamSimple, stopped once the request body is built. */
  async function payloadOf(model: Model<Api>, context: Context): Promise<Record<string, unknown>> {
    let payload: Record<string, unknown> | undefined
    const api = model.api === 'anthropic-messages' ? anthropicMessagesApi() : openAICompletionsApi()
    const stream = api.streamSimple(model, context, {
      apiKey: 'test', maxTokens: 8_192, reasoning: 'low', toolChoice: 'none',
      onPayload: (body) => {
        payload = body as Record<string, unknown>
        throw new Error('captured')
      },
    })
    await stream.result()
    return payload!
  }

  it('reproduces pi-ai clamping the cap to 1 from the stale usage of the last turn', () => {
    const stale: Context = { systemPrompt: 'system', messages: [...summarized(), user(SUMMARIZATION_PROMPT)], tools }
    expect(clampMaxTokensToContext(completions, stale, 8_192)).toBe(1)
    expect(clampMaxTokensToContext(completions, agentSummaryContext(summarized(), { systemPrompt: 'system', tools }), 8_192)).toBe(8_192)
  })

  it('keeps usage off the summarizer history without changing what is sent', () => {
    const history = summarized()
    const context = agentSummaryContext(history, { systemPrompt: 'system', tools })
    expect(context.messages.flatMap((message) => message.role === 'assistant' ? [message.usage.totalTokens] : [])).toEqual([0])
    expect(context.messages.slice(0, -1).map(({ usage: _usage, ...message }: Message & { usage?: unknown }) => message))
      .toEqual(history.map(({ usage: _usage, ...message }: Message & { usage?: unknown }) => message))
    expect((history[1] as AssistantMessage).usage.totalTokens).toBe(28_600)
  })

  it('sends the full summary cap to chat completions and Anthropic', async () => {
    const context = agentSummaryContext(summarized(), { systemPrompt: 'system', tools })
    const chat = await payloadOf(completions, context)
    expect(chat.max_completion_tokens ?? chat.max_tokens).toBe(8_192)

    const claude = await payloadOf(anthropic, context)
    const thinking = claude.thinking as { type: string; budget_tokens: number }
    expect(thinking.type).toBe('enabled')
    // Anthropic rejects a thinking budget at or above max_tokens.
    expect(claude.max_tokens).toBeGreaterThan(thinking.budget_tokens)
    expect(claude.max_tokens).toBeGreaterThanOrEqual(8_192)
  })
})

const model: Model<'openai-responses'> = {
  id: 'test', name: 'Test', api: 'openai-responses', provider: 'test', baseUrl: 'https://example.invalid',
  reasoning: false, input: ['text'], contextWindow: 100_000, maxTokens: 1_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}

it('continues a real agent run from the retained user messages and the summary', async () => {
  const requests: Context[] = []
  const summaryRequests: Array<{ context: Context; toolChoice?: ToolChoice }> = []
  const items: CompactionItem[] = []
  const tool: AgentTool = {
    name: 'bash', label: 'Bash', description: 'Run a command', parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: 'text', text: 'x'.repeat(4_000) }], details: {} }),
  }
  const compact = createAgentCompactor({
    responseId: 'resp',
    settings: () => ({ enabled: true, modelId: 'model', thresholdTokens: 500, contextWindow: model.contextWindow, retainedUserTokens: 20_000, summaryMaxTokens: 1_000 }),
    items: () => items,
    summarize: async (input, requestFrame) => agentSummaryText(await completeAgentSummary({
      context: agentSummaryContext(input, requestFrame),
      contextWindow: model.contextWindow,
      stream: (context, toolChoice) => {
        summaryRequests.push({ context, toolChoice })
        return streamOf(assistant([{ type: 'text', text: 'Ran bash; the output was long.' }]))
      },
    })),
    updateItem: async (item) => {
      const index = items.findIndex((candidate) => candidate.id === item.id)
      if (index >= 0) items[index] = item
      else items.push(item)
    },
  })
  const agent: Agent = new Agent({
    initialState: { model, systemPrompt: 'system', tools: [tool] },
    prepareNextTurnWithContext: async ({ context }) => {
      const compacted = await compact({
        phase: 'agent_mid_run', systemPrompt: context.systemPrompt, tools: context.tools ?? [], messages: context.messages, beforeAgentTurn: 2,
      })
      if (!compacted) return undefined
      agent.state.messages = compacted
      return { context: { ...context, messages: compacted } }
    },
    streamFn: (_model, context) => {
      requests.push({ ...context, messages: [...context.messages], tools: context.tools?.slice() })
      const first = requests.length === 1
      return streamOf(assistant(first ? [toolCall('call-1')] : [{ type: 'text', text: 'Done.' }], {
        // The provider-reported usage of the first turn anchors the next context count.
        usage: { input: 200, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 210, cost: ZERO_COST },
      }))
    },
  })
  // The runner marks its prompt recorded on the user message_end; compaction never emits another one.
  const recordedUserMessages: unknown[] = []
  agent.subscribe((event) => {
    if (event.type === 'message_end' && event.message.role === 'user') recordedUserMessages.push(agent.state.messages.at(-1))
  })
  await agent.prompt('Inspect my files')

  expect(recordedUserMessages).toMatchObject([{ role: 'user', content: [{ type: 'text', text: 'Inspect my files' }] }])
  expect(requests).toHaveLength(2)
  const summary = summaryRequests[0]!
  expect(summaryRequests).toHaveLength(1)
  expect(summary.toolChoice).toBe('none')
  expect(summary.context.systemPrompt).toBe(requests[0]!.systemPrompt)
  expect(summary.context.tools).toEqual(requests[0]!.tools)
  expect(summary.context.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'toolResult', 'user'])
  expect(summary.context.messages.slice(0, 1)).toEqual(requests[0]!.messages)
  expect(summary.context.messages.at(-1)).toMatchObject({ content: [{ type: 'text', text: SUMMARIZATION_PROMPT }] })

  expect(requests[1]!.messages).toMatchObject([
    { role: 'user', content: [{ type: 'text', text: 'Inspect my files' }] },
    { role: 'user', content: [{ type: 'text', text: summaryMessageText('Ran bash; the output was long.') }] },
  ])
  expect(requests[1]!.tools).toEqual(requests[0]!.tools)
  expect(agent.state.messages.map((message) => message.role)).toEqual(['user', 'user', 'assistant'])
  expect(items).toMatchObject([{ status: 'completed', before_agent_turn: 2, token_source: 'usage' }])
})
