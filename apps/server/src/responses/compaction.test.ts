import { describe, expect, it, vi } from 'vitest'
import type { Message } from '@earendil-works/pi-ai'
import type { CompactionItem } from '@pulpo/contracts'
import { hardContextLimit } from '../compaction/policy.js'
import { SUMMARIZATION_PROMPT, SUMMARY_PREFIX, summaryMessageText } from '../compaction/prompt.js'
import { responsesUserText } from '../compaction/responses-history.js'
import { CompactionError, CompactionOverflowError } from '../compaction/summarize.js'
import { estimatePiMessageTokens, estimateResponsesItemsTokens } from '../compaction/tokens.js'
import { approxTokenCount } from '../compaction/truncate.js'
import { classifyGenerationError, GenerationAttemptError } from './fallback-policy.js'
import {
  canRetryOverflowWithCompaction,
  codexConversation,
  compactCodexConversation,
  compactResponsesConversation,
  preResponseCompactionItem,
  responsesConversation,
  summaryRequestParameters,
  type CodexHistoryResponse,
  type CompactionModel,
  type HistoryResponse,
} from './compaction.js'

const RESPONSE_ID = '00000000-0000-4000-8000-000000000001'

const model: CompactionModel = {
  id: 'model',
  contextWindow: 100_000,
  maxOutputTokens: 16_384,
  compactionEnabled: true,
  compactionThresholdTokens: 2_000,
  compactionRetainedUserTokens: 20_000,
}

const userItem = (text: string) => ({ role: 'user', content: [{ type: 'input_text', text }] })
const assistantItem = (text: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })

function row(id: string, text = id, values: Partial<HistoryResponse> = {}): HistoryResponse {
  return {
    id,
    status: 'completed',
    agentMode: false,
    usage: null,
    input: [userItem(`user ${text}`)],
    output: [assistantItem(`assistant ${text}`)],
    ...values,
  }
}

function codexRow(id: string, text = id, values: Partial<CodexHistoryResponse> = {}): CodexHistoryResponse {
  return {
    ...row(id, text),
    modelId: 'model',
    actualModelId: null,
    createdAt: new Date(1_000),
    updatedAt: new Date(2_000),
    completedAt: new Date(3_000),
    ...values,
  }
}

function checkpoint(values: Partial<CompactionItem> = {}): CompactionItem {
  return {
    id: 'checkpoint',
    type: 'pulpo_compaction',
    phase: 'pre_response',
    status: 'completed',
    strategy: 'user_messages',
    model_id: 'model',
    estimated_tokens: 100,
    threshold_tokens: 50,
    retained_turns: [{ role: 'user', content: 'kept one' }, { role: 'user', content: 'kept two' }],
    retained_context: [],
    retained_context_turns: [],
    summary: 'old summary',
    started_at: new Date(0).toISOString(),
    ...values,
  }
}

/** Short questions with answers of about `tokens` tokens each. */
function longConversation(turns: number, tokens: number): unknown[] {
  return Array.from({ length: turns }, (_, index) => [
    userItem(`question ${index}`),
    assistantItem(`answer ${index} ${'a'.repeat(tokens * 4)}`),
  ]).flat()
}

/** Truncated text keeps both ends of an oversized message around the marker. */
const TRUNCATED_HUGE = /^start h+…\d+ tokens truncated…h+ end$/
const hugeText = () => `start ${'h'.repeat(30_000 * 4)} end`
const summaryPromptTokens = approxTokenCount(SUMMARIZATION_PROMPT)

function updatesRecorder() {
  const updates: CompactionItem[] = []
  return { updates, onUpdate: async (item: CompactionItem) => { updates.push(item) } }
}

describe('responsesConversation', () => {
  it('replays the full lineage without Pulpo items, failed outputs, or agent tool protocol', () => {
    const conversation = responsesConversation([
      row('a', 'a', { output: [{ type: 'pulpo_recall', sources: [] }, { type: 'pulpo_attachment', name: 'x' }, assistantItem('assistant a')] }),
      row('b', 'b', { status: 'failed' }),
      row('c', 'c', {
        agentMode: true,
        output: [
          { type: 'pulpo_tool', tool: 'bash', output: 'secret' },
          { type: 'reasoning', summary: [{ type: 'summary_text', text: 'private' }] },
          assistantItem('Agent answer.'),
        ],
      }),
    ])
    expect(conversation).toEqual([
      userItem('user a'), assistantItem('assistant a'),
      userItem('user b'),
      userItem('user c'), { role: 'assistant', content: 'Agent answer.' },
    ])
  })

  it('starts a user_messages checkpoint with retained user messages and the summary, then the checkpoint response onward', () => {
    const conversation = responsesConversation([
      row('a'),
      row('b', 'b', { output: [checkpoint(), assistantItem('assistant b')] }),
      row('c'),
    ])
    expect(conversation).toEqual([
      userItem('kept one'),
      userItem('kept two'),
      userItem(summaryMessageText('old summary')),
      userItem('user b'), assistantItem('assistant b'),
      userItem('user c'), assistantItem('assistant c'),
    ])
  })

  it('keeps the legacy developer summary and retained turns for checkpoints without a strategy', () => {
    const legacy = checkpoint({
      strategy: undefined,
      retained_context: [{ role: 'user', content: 'flat kept' }],
      retained_context_turns: [[{ role: 'user', content: 'kept turn' }]],
    })
    expect(responsesConversation([row('a'), row('b', 'b', { output: [legacy] })])).toEqual([
      { role: 'developer', content: 'Summary of earlier conversation:\nold summary' },
      { role: 'user', content: 'kept turn' },
      userItem('user b'),
    ])
    const flat = { ...legacy, retained_context_turns: [] }
    expect(responsesConversation([row('b', 'b', { output: [flat] })])[1]).toEqual({ role: 'user', content: 'flat kept' })
  })

  it('ignores checkpoints on failed and agent responses', () => {
    const failed = responsesConversation([row('a'), row('b', 'b', { status: 'failed', output: [checkpoint()] })])
    expect(failed[0]).toEqual(userItem('user a'))
    const agent = responsesConversation([row('a'), row('b', 'b', { agentMode: true, output: [checkpoint()] })])
    expect(agent[0]).toEqual(userItem('user a'))
  })
})

describe('codexConversation', () => {
  it('replays text exchanges with zero usage', () => {
    const [user, assistant] = codexConversation([codexRow('a', 'a', { actualModelId: 'fallback' })])
    expect(user).toEqual({ role: 'user', content: 'user a', timestamp: 1_000 })
    expect(assistant).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'assistant a' }], model: 'fallback', stopReason: 'stop', timestamp: 3_000 })
    expect((assistant as { usage: { totalTokens: number } }).usage.totalTokens).toBe(0)
  })

  it('starts a user_messages checkpoint with retained user messages and the summary, then the checkpoint response onward', () => {
    const messages = codexConversation([codexRow('a'), codexRow('b', 'b', { output: [checkpoint(), assistantItem('assistant b')] }), codexRow('c')])
    expect(messages.map((message) => message.role)).toEqual(['user', 'user', 'user', 'user', 'assistant', 'user', 'assistant'])
    expect(messages.slice(0, 3).map((message) => (message.content as Array<{ text: string }>)[0]!.text))
      .toEqual(['kept one', 'kept two', summaryMessageText('old summary')])
    expect(messages[3]).toMatchObject({ content: 'user b' })
  })

  it('resumes a legacy checkpoint after the response it covered', () => {
    const legacy = checkpoint({ strategy: undefined, covered_through_response_id: 'a' })
    const messages = codexConversation([codexRow('a'), codexRow('b'), codexRow('c', 'c', { output: [legacy] })])
    expect(messages[0]).toEqual({ role: 'user', content: 'Earlier conversation summary:\nold summary', timestamp: 1_000 })
    expect(messages.slice(1).map((message) => message.content)).toEqual(['user b', [{ type: 'text', text: 'assistant b' }], 'user c'])
    const uncovered = codexConversation([codexRow('a'), codexRow('c', 'c', { output: [{ ...legacy, covered_through_response_id: 'gone' }] })])
    expect(uncovered[0]).toMatchObject({ content: 'user a' })
  })

  it('ignores agent checkpoints', () => {
    const messages = codexConversation([codexRow('a'), codexRow('b', 'b', { agentMode: true, output: [checkpoint(), assistantItem('agent b')] })])
    expect(messages[0]).toMatchObject({ content: 'user a' })
    expect(JSON.stringify(messages)).not.toContain('old summary')
  })
})

describe('compactResponsesConversation', () => {
  function run(options: Partial<Parameters<typeof compactResponsesConversation>[0]> = {}) {
    const recorder = updatesRecorder()
    const summarize = vi.fn(async (_history: unknown[]) => 'fresh summary')
    const promise = compactResponsesConversation({
      responseId: RESPONSE_ID,
      model,
      conversation: longConversation(4, 600),
      fixedContext: [{ role: 'developer', content: 'system' }],
      summarize,
      onUpdate: recorder.onUpdate,
      ...options,
    })
    return { promise, summarize, updates: recorder.updates }
  }

  it('leaves a conversation below the limit untouched', async () => {
    const conversation = longConversation(1, 10)
    const { promise, summarize, updates } = run({ conversation })
    expect(await promise).toEqual({ conversation })
    expect(summarize).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it('summarizes the real history and replaces it with retained user messages and the summary', async () => {
    const parent = row('00000000-0000-4000-8000-000000000002')
    const conversation = longConversation(4, 600)
    const { promise, summarize, updates } = run({ conversation, parent })
    const result = await promise

    expect(summarize).toHaveBeenCalledTimes(1)
    expect(summarize.mock.calls[0]![0]).toEqual(conversation)
    expect(result.conversation.at(-1)).toEqual(userItem(summaryMessageText('fresh summary')))
    expect(result.conversation.slice(0, -1)).toEqual(conversation.filter((item) => (item as { role: string }).role === 'user'))
    expect(JSON.stringify(result.conversation)).not.toContain('answer 0')
    const estimated = estimateResponsesItemsTokens([{ role: 'developer', content: 'system' }, ...conversation])
    expect(result.item).toMatchObject({
      id: `${RESPONSE_ID}:compaction:pre_response`,
      type: 'pulpo_compaction',
      phase: 'pre_response',
      status: 'completed',
      strategy: 'user_messages',
      model_id: 'model',
      estimated_tokens: estimated,
      token_source: 'estimate',
      threshold_tokens: 2_000,
      summary: 'fresh summary',
      retained_context: [],
      retained_context_turns: [],
      covered_through_response_id: parent.id,
    })
    expect(result.item?.retained_turns).toEqual(conversation
      .filter((item) => (item as { role: string }).role === 'user')
      .map((item) => ({ role: 'user', content: (item as { content: Array<{ text: string }> }).content[0]!.text })))
    expect(result.item?.tokens_after).toBeLessThan(estimated)
    expect(updates.map((item) => item.status)).toEqual(['in_progress', 'completed'])
    expect(updates[0]).toMatchObject({ retained_turns: [], summary: '', strategy: 'user_messages' })
  })

  it('anchors on the parent usage alone, without the current input or hidden reasoning', async () => {
    const conversation = longConversation(1, 10)
    // Reasoning is not replayed, so 1,500 + 500 - 300 stays under the limit.
    const below = row('p', 'p', { usage: { inputTokens: 1_500, outputTokens: 500, reasoningTokens: 300 } })
    expect((await run({ conversation, parent: below }).promise).item).toBeUndefined()
    const parent = row('p', 'p', { usage: { inputTokens: 1_800, outputTokens: 500, reasoningTokens: 300 } })
    const { promise } = run({ conversation, parent })
    const result = await promise
    // Like Codex, only the context before this turn counts toward the trigger.
    expect(result.item).toMatchObject({ token_source: 'usage', estimated_tokens: 2_000 })

    const failedParent = { ...parent, status: 'failed' }
    expect((await run({ conversation, parent: failedParent }).promise).item).toBeUndefined()
    const agentParent = { ...parent, agentMode: true }
    expect((await run({ conversation, parent: agentParent }).promise).item).toBeUndefined()
  })

  it('compacts at 90% of the context window when the threshold is higher', async () => {
    const { promise } = run({ model: { ...model, contextWindow: 3_000, compactionThresholdTokens: 1_000_000 }, conversation: longConversation(4, 700) })
    expect((await promise).item?.threshold_tokens).toBe(2_700)
  })

  it('never compacts when disabled or without history, even when forced', async () => {
    const disabled = run({ model: { ...model, compactionEnabled: false }, force: true })
    expect((await disabled.promise).item).toBeUndefined()
    expect(disabled.summarize).not.toHaveBeenCalled()
    const empty = run({ conversation: [], force: true })
    expect((await empty.promise).item).toBeUndefined()
    expect(empty.summarize).not.toHaveBeenCalled()
  })

  it('compacts below the limit when forced', async () => {
    const { promise, summarize } = run({ conversation: longConversation(1, 10), force: true })
    expect((await promise).item?.status).toBe('completed')
    expect(summarize).toHaveBeenCalledTimes(1)
  })

  it('reuses its own completed checkpoint for the same model instead of summarizing again', async () => {
    const existingItem = checkpoint({ id: `${RESPONSE_ID}:compaction:pre_response` })
    const reused = run({ existingItem })
    const result = await reused.promise
    expect(reused.summarize).not.toHaveBeenCalled()
    expect(reused.updates).toEqual([])
    expect(result.item).toBe(existingItem)
    expect(result.conversation).toEqual([userItem('kept one'), userItem('kept two'), userItem(summaryMessageText('old summary'))])

    for (const stale of [checkpoint({ model_id: 'other' }), checkpoint({ strategy: undefined }), checkpoint({ status: 'failed' })]) {
      const rerun = run({ existingItem: stale })
      await rerun.promise
      expect(rerun.summarize).toHaveBeenCalledTimes(1)
    }
  })

  it('drops the oldest unit and retries when the summarizer overflows', async () => {
    const conversation = longConversation(4, 600)
    const summarize = vi.fn(async (_history: unknown[]) => {
      if (summarize.mock.calls.length === 1) throw new CompactionOverflowError()
      return 'after retry'
    })
    const result = await run({ conversation, summarize }).promise
    expect(summarize).toHaveBeenCalledTimes(2)
    expect(summarize.mock.calls[1]![0]).toHaveLength(conversation.length - 1)
    expect(result.item?.summary).toBe('after retry')
    // Retained user messages still come from the full history.
    expect(result.item?.retained_turns).toHaveLength(4)
  })

  it('trims history that cannot fit the context window before summarizing', async () => {
    const conversation = longConversation(10, 2_000)
    const { promise, summarize } = run({ model: { ...model, contextWindow: 20_000 }, conversation })
    const result = await promise
    const sent = summarize.mock.calls[0]![0]
    expect(sent.length).toBeLessThan(conversation.length)
    expect(sent.at(-1)).toEqual(conversation.at(-1))
    expect(result.item?.status).toBe('completed')
  })

  it('reserves the requested summary output, not the 8,192 cap, when trimming for a small window', async () => {
    // 8k window and 4k max output leave 7,782 - 4,096 = 3,686 request tokens.
    const small = { ...model, contextWindow: 8_192, maxOutputTokens: 4_096 }
    const fixedContext = [{ role: 'developer', content: 'system' }]
    const conversation = longConversation(20, 200)
    const { promise, summarize } = run({ model: small, fixedContext, conversation })
    expect((await promise).item?.status).toBe('completed')
    const sent = summarize.mock.calls[0]![0]
    const request = estimateResponsesItemsTokens([...fixedContext, ...sent]) + summaryPromptTokens
    expect(request).toBeLessThanOrEqual(hardContextLimit(8_192) - 4_096)
    // Within one answer of the budget, not trimmed away by the fixed cap.
    expect(request).toBeGreaterThan(hardContextLimit(8_192) - 4_096 - 250)
    expect(sent.at(-1)).toEqual(conversation.at(-1))
  })

  it('sends the most-trimmed history when even that cannot fit by estimate', async () => {
    // The fixed context alone is over the summary budget; the provider's overflow response decides.
    const fixedContext = [{ role: 'developer', content: 'x'.repeat(90_000 * 4) }]
    const { promise, summarize } = run({ fixedContext, conversation: longConversation(4, 600) })
    expect((await promise).item?.status).toBe('completed')
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(summarize.mock.calls[0]![0]).toEqual([])
  })

  it('compacts a chat whose first message alone exceeds the context window', async () => {
    const small = { ...model, contextWindow: 20_000, maxOutputTokens: 4_096 }
    const fixedContext = [{ role: 'developer', content: 'system' }]
    // The first request overflowed and failed, so only its input is replayed.
    const failed = row('r1', 'r1', { status: 'failed', input: [userItem(hugeText())], output: [] })
    const conversation = responsesConversation([failed])
    // A provider that rejects summary requests whose input and output exceed the window.
    const summarize = vi.fn(async (history: unknown[]) => {
      if (estimateResponsesItemsTokens([...fixedContext, ...history]) + summaryPromptTokens + 4_096 > 20_000) throw new CompactionOverflowError()
      return 'nothing to summarize'
    })
    const result = await run({ model: small, fixedContext, conversation, parent: failed, summarize }).promise
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(summarize.mock.calls[0]![0]).toEqual([])
    const [retained, summary] = result.conversation
    expect(responsesUserText(retained)).toMatch(TRUNCATED_HUGE)
    expect(summary).toEqual(userItem(summaryMessageText('nothing to summarize')))
    expect(result.item?.tokens_after).toBeLessThan(small.compactionThresholdTokens)

    // The next turn starts from the checkpoint instead of the oversized message.
    const next = responsesConversation([failed, row('r2', 'r2', { output: [result.item!, assistantItem('answer')] })])
    expect(next.slice(0, 2)).toEqual(result.conversation)
    expect(estimateResponsesItemsTokens([...fixedContext, ...next])).toBeLessThan(small.compactionThresholdTokens)
  })

  it('keeps recent user messages within a budget capped at a quarter of the limit', async () => {
    const conversation = [userItem(`old ${'x'.repeat(4_000)}`), assistantItem('a'), userItem('recent'), assistantItem('b')]
    const result = await run({ conversation, force: true }).promise
    const [old, recent] = result.item!.retained_turns
    // Limit 2,000 caps the 20,000-token setting at 500 tokens.
    expect(recent).toEqual({ role: 'user', content: 'recent' })
    expect(old!.content).toContain('tokens truncated')
    expect(old!.content.length).toBeLessThan(2_100)
  })

  it('never retains earlier summaries as user messages', async () => {
    const conversation = [userItem(summaryMessageText('older summary')), userItem('real question'), assistantItem('a')]
    const result = await run({ conversation, force: true }).promise
    expect(result.item?.retained_turns).toEqual([{ role: 'user', content: 'real question' }])
    expect(result.conversation).toHaveLength(2)
  })

  it('records a failed item and throws a compaction error', async () => {
    const { promise, updates } = run({ summarize: async () => { throw new Error('boom') } })
    const error = await promise.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CompactionError)
    expect((error as Error).message).toBe('Compaction failed: boom')
    expect(classifyGenerationError(error)).toBe('worker')
    expect(updates.map((item) => item.status)).toEqual(['in_progress', 'failed'])
    expect(updates[1]).toMatchObject({ error: 'boom', strategy: 'user_messages' })
  })

  it('rejects an empty summary', async () => {
    const { promise, updates } = run({ summarize: async () => '   ' })
    await expect(promise).rejects.toThrow('Compaction produced an empty summary')
    expect(updates.at(-1)?.status).toBe('failed')
  })

  it('counts request tools and instructions in the full estimate', async () => {
    const conversation = longConversation(1, 10)
    const tools = [{ type: 'function', name: 'lookup', description: 'd'.repeat(8_000), parameters: { type: 'object' } }]
    expect((await run({ conversation }).promise).item).toBeUndefined()
    expect((await run({ conversation, tools }).promise).item?.status).toBe('completed')
    expect((await run({ conversation, instructions: 'i'.repeat(8_000) }).promise).item?.status).toBe('completed')
  })
})

describe('compactCodexConversation', () => {
  const text = (message: Message) => typeof message.content === 'string' ? message.content : (message.content as Array<{ text?: string }>).map((part) => part.text ?? '').join('')

  function conversation(turns: number, tokens: number): Message[] {
    return codexConversation(Array.from({ length: turns }, (_, index) => codexRow(`r${index}`, String(index), {
      output: [assistantItem(`answer ${index} ${'w'.repeat(tokens * 4)}`)],
    })))
  }

  function run(options: Partial<Parameters<typeof compactCodexConversation>[0]> = {}) {
    const recorder = updatesRecorder()
    const summarize = vi.fn(async (_history: Message[]) => 'codex summary')
    const promise = compactCodexConversation({
      responseId: RESPONSE_ID,
      model,
      conversation: conversation(4, 600),
      systemPrompt: 'system',
      summarize,
      onUpdate: recorder.onUpdate,
      ...options,
    })
    return { promise, summarize, updates: recorder.updates }
  }

  it('summarizes pi messages and keeps user messages plus a summary message', async () => {
    const history = conversation(4, 600)
    const { promise, summarize, updates } = run({ conversation: history, parent: codexRow('00000000-0000-4000-8000-000000000003') })
    const result = await promise
    expect(summarize.mock.calls[0]![0]).toEqual(history)
    expect(result.conversation.every((message) => message.role === 'user')).toBe(true)
    expect(result.conversation.map(text)).toEqual([
      ...history.filter((message) => message.role === 'user').map(text),
      `${SUMMARY_PREFIX}\ncodex summary`,
    ])
    expect(result.item).toMatchObject({
      id: `${RESPONSE_ID}:compaction:pre_response`,
      strategy: 'user_messages',
      token_source: 'estimate',
      covered_through_response_id: '00000000-0000-4000-8000-000000000003',
    })
    expect(updates.map((item) => item.status)).toEqual(['in_progress', 'completed'])
  })

  it('excludes reasoning from the usage anchor because Codex does not replay it', async () => {
    const small = conversation(1, 10)
    const parent = codexRow('p', 'p', { usage: { inputTokens: 1_500, outputTokens: 500, reasoningTokens: 300 } })
    expect((await run({ conversation: small, parent }).promise).item).toBeUndefined()
    const heavier = { ...parent, usage: { inputTokens: 1_900, outputTokens: 500, reasoningTokens: 300 } }
    expect((await run({ conversation: small, parent: heavier }).promise).item).toMatchObject({
      token_source: 'usage',
      estimated_tokens: 2_100,
    })
  })

  it('drops the oldest exchange and retries when the summarizer overflows', async () => {
    const history = conversation(4, 600)
    const summarize = vi.fn(async (_history: Message[]) => {
      if (summarize.mock.calls.length === 1) throw new CompactionOverflowError()
      return 'after retry'
    })
    await run({ conversation: history, summarize }).promise
    expect(summarize.mock.calls[1]![0]).toHaveLength(history.length - 1)
    expect(summarize.mock.calls[1]![0][0]).toEqual(history[0])
  })

  it('compacts a chat whose first message alone exceeds the context window', async () => {
    const small = { ...model, contextWindow: 20_000, maxOutputTokens: 4_096 }
    const failed = codexRow('r1', 'r1', { status: 'failed', input: [userItem(hugeText())], output: [] })
    const history = codexConversation([failed])
    expect(history).toHaveLength(1)
    const summarize = vi.fn(async (messages: Message[]) => {
      const request = approxTokenCount('system') + messages.reduce((total, message) => total + estimatePiMessageTokens(message), 0) + summaryPromptTokens
      if (request + 4_096 > 20_000) throw new CompactionOverflowError()
      return 'nothing to summarize'
    })
    const result = await run({ model: small, conversation: history, parent: failed, summarize }).promise
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(summarize.mock.calls[0]![0]).toEqual([])
    expect(result.conversation.map(text)[0]).toMatch(TRUNCATED_HUGE)
    expect(result.conversation.map(text)[1]).toBe(`${SUMMARY_PREFIX}\nnothing to summarize`)
    expect(result.item?.tokens_after).toBeLessThan(small.compactionThresholdTokens)
  })

  it('restores pi messages from a reused checkpoint', async () => {
    const { promise, summarize } = run({ existingItem: checkpoint() })
    const result = await promise
    expect(summarize).not.toHaveBeenCalled()
    expect(result.conversation.map(text)).toEqual(['kept one', 'kept two', summaryMessageText('old summary')])
  })
})

describe('summaryRequestParameters', () => {
  it('keeps the cache identity, instructions and tools, with tool use disabled', () => {
    const tools = [{ type: 'function', name: 'lookup' }]
    expect(summaryRequestParameters({
      cache_control: { type: 'ephemeral' },
      prompt_cache_key: 'chat:1',
      prompt_cache_retention: '24h',
      instructions: 'Be brief.',
      tools,
      tool_choice: 'required',
      parallel_tool_calls: false,
      reasoning: { effort: 'high' },
      text: { format: { type: 'json_object' } },
      temperature: 0.2,
      max_output_tokens: 10,
    })).toEqual({
      cache_control: { type: 'ephemeral' },
      prompt_cache_key: 'chat:1',
      prompt_cache_retention: '24h',
      instructions: 'Be brief.',
      tools,
      tool_choice: 'none',
    })
  })

  it('sends no tool choice without tools', () => {
    expect(summaryRequestParameters({ tools: [], tool_choice: 'auto' })).toEqual({})
  })
})

describe('preResponseCompactionItem', () => {
  it('finds the pre_response item among the output', () => {
    const item = checkpoint({ status: 'in_progress' })
    expect(preResponseCompactionItem([{ type: 'pulpo_recall' }, item])).toBe(item)
    expect(preResponseCompactionItem([checkpoint({ phase: 'agent_mid_run' })])).toBeUndefined()
    expect(preResponseCompactionItem(null)).toBeUndefined()
  })
})

describe('canRetryOverflowWithCompaction', () => {
  const overflow = new GenerationAttemptError('400 overflow', false, new Error('Your input exceeds the context window of this model.'))
  const base = { error: overflow, enabled: true, hasHistory: true, modelId: 'model', output: [] }

  it('retries a context overflow before any output once compaction can help', () => {
    expect(canRetryOverflowWithCompaction(base)).toBe(true)
    expect(canRetryOverflowWithCompaction({ ...base, output: [checkpoint({ model_id: 'other' })] })).toBe(true)
    expect(canRetryOverflowWithCompaction({ ...base, output: [checkpoint({ status: 'failed' })] })).toBe(true)
  })

  it('does not retry otherwise', () => {
    expect(canRetryOverflowWithCompaction({ ...base, error: new Error('Internal server error') })).toBe(false)
    expect(canRetryOverflowWithCompaction({ ...base, error: new GenerationAttemptError('x', true, overflow.upstreamError) })).toBe(false)
    expect(canRetryOverflowWithCompaction({ ...base, enabled: false })).toBe(false)
    expect(canRetryOverflowWithCompaction({ ...base, hasHistory: false })).toBe(false)
    expect(canRetryOverflowWithCompaction({ ...base, output: [checkpoint()] })).toBe(false)
    expect(canRetryOverflowWithCompaction({ ...base, output: [assistantItem('partial')] })).toBe(false)
  })

  it('does not treat a summarizer that ran out of history as a provider overflow', async () => {
    const error = await compactResponsesConversation({
      responseId: RESPONSE_ID,
      model,
      conversation: [userItem('only question'), assistantItem('answer')],
      fixedContext: [],
      force: true,
      summarize: async () => { throw new CompactionOverflowError() },
      onUpdate: async () => undefined,
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CompactionError)
    expect(canRetryOverflowWithCompaction({ ...base, error })).toBe(false)
    expect(canRetryOverflowWithCompaction({ ...base, error: new GenerationAttemptError((error as Error).message, false, error) })).toBe(false)
  })
})
