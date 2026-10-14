import { describe, expect, it } from 'vitest'
import type { AssistantMessage, Message, ToolResultMessage, Usage, UserMessage } from '@earendil-works/pi-ai'
import {
  FILE_TOKEN_ESTIMATE,
  IMAGE_TOKEN_ESTIMATE,
  estimatePiMessageTokens,
  estimatePiToolsTokens,
  estimateResponsesItemTokens,
  estimateResponsesItemsTokens,
  piContextTokens,
  piFullEstimate,
  piUsageTokens,
  responseUsageAnchor,
} from './tokens.js'

function usage(values: Partial<Usage> = {}): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...values,
  }
}

function user(content: UserMessage['content']): UserMessage {
  return { role: 'user', content, timestamp: 1 }
}

function assistant(content: AssistantMessage['content'], values: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt-test',
    usage: usage(),
    stopReason: 'stop',
    timestamp: 1,
    ...values,
  }
}

function toolResult(content: ToolResultMessage['content'], values: Partial<ToolResultMessage> = {}): ToolResultMessage {
  return { role: 'toolResult', toolCallId: 'call', toolName: 'tool', content, isError: false, timestamp: 1, ...values }
}

const bytes = (length: number) => 'x'.repeat(length)

describe('pi message estimates', () => {
  it('counts user text bytes once per message, with no per-message overhead', () => {
    expect(estimatePiMessageTokens(user(bytes(8)))).toBe(2)
    // 3 + 3 bytes round up once, not per part.
    expect(estimatePiMessageTokens(user([{ type: 'text', text: bytes(3) }, { type: 'text', text: bytes(3) }]))).toBe(2)
    expect(estimatePiMessageTokens(user('😀'))).toBe(1)
  })

  it('charges a flat estimate per image regardless of payload size', () => {
    const small = user([{ type: 'image', data: 'AAAA', mimeType: 'image/png' }])
    const large = user([{ type: 'image', data: 'A'.repeat(500_000), mimeType: 'image/png' }])
    expect(estimatePiMessageTokens(small)).toBe(IMAGE_TOKEN_ESTIMATE)
    expect(estimatePiMessageTokens(large)).toBe(IMAGE_TOKEN_ESTIMATE)
    expect(estimatePiMessageTokens(user([{ type: 'text', text: bytes(4) }, { type: 'image', data: 'A', mimeType: 'image/png' }])))
      .toBe(1 + IMAGE_TOKEN_ESTIMATE)
    expect(estimatePiMessageTokens(toolResult([{ type: 'image', data: 'A'.repeat(100_000), mimeType: 'image/png' }], { toolCallId: '', toolName: '' })))
      .toBe(IMAGE_TOKEN_ESTIMATE)
  })

  it('counts assistant text, thinking text and tool calls', () => {
    expect(estimatePiMessageTokens(assistant([{ type: 'text', text: bytes(8) }]))).toBe(2)
    expect(estimatePiMessageTokens(assistant([{ type: 'thinking', thinking: bytes(8) }]))).toBe(2)
    const call = assistant([{ type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'a' } }])
    expect(estimatePiMessageTokens(call)).toBe(Math.ceil(('read'.length + JSON.stringify({ path: 'a' }).length) / 4))
  })

  it('uses the Codex encrypted-reasoning formula for stored reasoning items', () => {
    const encrypted = (length: number) => assistant([{
      type: 'thinking',
      thinking: bytes(400),
      thinkingSignature: JSON.stringify({ type: 'reasoning', id: 'rs_1', encrypted_content: 'e'.repeat(length) }),
    }])
    // floor(4000 * 3 / 4) - 650 = 2350 bytes.
    expect(estimatePiMessageTokens(encrypted(4_000))).toBe(Math.ceil(2_350 / 4))
    expect(estimatePiMessageTokens(encrypted(100))).toBe(0)
    // A plain signature (Anthropic) counts the thinking text.
    expect(estimatePiMessageTokens(assistant([{ type: 'thinking', thinking: bytes(8), thinkingSignature: 'sig'.repeat(1_000) }]))).toBe(2)
  })

  it('counts redacted thinking as 3/4 of the opaque payload', () => {
    expect(estimatePiMessageTokens(assistant([{ type: 'thinking', thinking: '', thinkingSignature: bytes(400), redacted: true }]))).toBe(75)
  })

  it('counts tool result text, tool name and call id', () => {
    expect(estimatePiMessageTokens(toolResult([{ type: 'text', text: bytes(4) }], { toolName: 'abcd', toolCallId: 'efgh' }))).toBe(3)
  })

  it('ignores ids, metadata, usage, details and text signatures', () => {
    const plainAssistant = assistant([{ type: 'text', text: bytes(40) }])
    const decoratedAssistant = assistant([{ type: 'text', text: bytes(40), textSignature: JSON.stringify({ v: 1, id: 'msg_'.repeat(50) }) }], {
      responseId: 'resp_'.repeat(100),
      usage: usage({ input: 1_000, output: 1_000, totalTokens: 2_000 }),
      model: 'm'.repeat(200),
      errorMessage: undefined,
      timestamp: 99,
    })
    expect(estimatePiMessageTokens(decoratedAssistant)).toBe(estimatePiMessageTokens(plainAssistant))
    const plainResult = toolResult([{ type: 'text', text: bytes(40) }])
    const decoratedResult = toolResult([{ type: 'text', text: bytes(40) }], { details: { blob: bytes(10_000) }, usage: usage({ input: 5 }), isError: true })
    expect(estimatePiMessageTokens(decoratedResult)).toBe(estimatePiMessageTokens(plainResult))
  })

  it('counts unknown roles as zero', () => {
    expect(estimatePiMessageTokens({ role: 'custom', content: bytes(1_000) })).toBe(0)
    expect(estimatePiMessageTokens(null)).toBe(0)
  })

  it('counts tool definitions', () => {
    const parameters = { type: 'object', properties: { path: { type: 'string' } } }
    expect(estimatePiToolsTokens([{ name: 'read', description: 'Read a file', parameters }]))
      .toBe(Math.ceil(('read'.length + 'Read a file'.length + JSON.stringify(parameters).length) / 4))
    expect(estimatePiToolsTokens(undefined)).toBe(0)
  })
})

describe('estimate memoization', () => {
  /** A text part that counts how often the estimator reads it. */
  function countedText(value: string) {
    const reads = { count: 0 }
    const part = { type: 'text' as const, text: '' }
    Object.defineProperty(part, 'text', { enumerable: true, get: () => { reads.count += 1; return value } })
    return { part, reads }
  }

  it('estimates each pi message once per object', () => {
    const { part, reads } = countedText(bytes(40))
    const message = user([part])
    expect(estimatePiMessageTokens(message)).toBe(10)
    expect(piFullEstimate({ messages: [message, message] })).toBe(20)
    expect(piContextTokens({ messages: [message] }).tokens).toBe(10)
    expect(reads.count).toBe(1)
    // A copy with the same content is a different message and is estimated on its own.
    expect(estimatePiMessageTokens({ ...message, content: [{ type: 'text', text: bytes(8) }] })).toBe(2)
  })

  it('estimates each Responses item once per object and keeps the two caches apart', () => {
    const { part, reads } = countedText(bytes(40))
    const item = { role: 'user', content: [part] }
    expect(estimateResponsesItemTokens(item)).toBe(10)
    expect(estimateResponsesItemsTokens([item, item])).toBe(20)
    expect(reads.count).toBe(1)
    // The same object read as a pi message has its own estimate.
    const shared = { role: 'user', content: [{ type: 'input_text', text: bytes(40) }] }
    expect(estimateResponsesItemTokens(shared)).toBe(10)
    expect(estimatePiMessageTokens(shared)).toBe(0)
    expect(estimateResponsesItemTokens(shared)).toBe(10)
  })
})

describe('pi context tokens', () => {
  it('sums input, cache and output usage of assistant messages', () => {
    expect(piUsageTokens(assistant([], { usage: usage({ input: 10, cacheRead: 20, cacheWrite: 30, output: 40, totalTokens: 1 }) }))).toBe(100)
    expect(piUsageTokens(user('hi'))).toBe(0)
    expect(piUsageTokens({ role: 'assistant' })).toBe(0)
  })

  it('anchors on the last usage and estimates only what came after it', () => {
    const messages: Message[] = [
      user(bytes(4_000)),
      assistant([{ type: 'toolCall', id: 'c', name: 'read', arguments: {} }], { usage: usage({ input: 900, cacheRead: 50, output: 50 }), stopReason: 'toolUse' }),
      toolResult([{ type: 'text', text: bytes(35) }], { toolName: 'read', toolCallId: 'c' }),
    ]
    expect(piContextTokens({ systemPrompt: bytes(4_000), messages, tools: [{ name: 'read', description: 'x', parameters: {} }] }))
      .toEqual({ tokens: 1_000 + 10, source: 'usage' })
  })

  it('skips error, aborted and zero-usage assistant messages as anchors', () => {
    const anchored = assistant([{ type: 'text', text: bytes(4) }], { usage: usage({ input: 500, output: 20 }) })
    const after = [
      user(bytes(8)),
      assistant([{ type: 'text', text: bytes(4) }], { stopReason: 'error', usage: usage({ input: 9_999 }) }),
      assistant([{ type: 'text', text: bytes(4) }], { stopReason: 'aborted', usage: usage({ input: 9_999 }) }),
      assistant([{ type: 'text', text: bytes(4) }]),
    ]
    expect(piContextTokens({ messages: [user('hi'), anchored, ...after] }))
      .toEqual({ tokens: 520 + sum(after.map(estimatePiMessageTokens)), source: 'usage' })
  })

  it('falls back to a full estimate without a usage anchor', () => {
    const tools = [{ name: 'read', description: 'Read', parameters: {} }]
    const messages = [user(bytes(40)), assistant([{ type: 'text', text: bytes(40) }])]
    const context = { systemPrompt: bytes(400), messages, tools }
    expect(piFullEstimate(context)).toBe(100 + estimatePiToolsTokens(tools) + 10 + 10)
    expect(piContextTokens(context)).toEqual({ tokens: piFullEstimate(context), source: 'estimate' })
    expect(piContextTokens({ messages: [] })).toEqual({ tokens: 0, source: 'estimate' })
  })
})

describe('responses item estimates', () => {
  it('counts message text parts of any role', () => {
    expect(estimateResponsesItemTokens({ role: 'developer', content: bytes(8) })).toBe(2)
    expect(estimateResponsesItemTokens({ role: 'user', content: [{ type: 'input_text', text: bytes(4) }, { type: 'input_text', text: bytes(4) }] })).toBe(2)
    expect(estimateResponsesItemTokens({
      type: 'message',
      role: 'assistant',
      id: 'msg_'.repeat(100),
      status: 'completed',
      content: [{ type: 'output_text', text: bytes(8), annotations: [] }, { type: 'refusal', refusal: bytes(4) }],
    })).toBe(3)
  })

  it('charges flat estimates for images and files regardless of payload size', () => {
    const image = (url: string) => ({ role: 'user', content: [{ type: 'input_image', image_url: url }] })
    expect(estimateResponsesItemTokens(image('data:image/png;base64,AAAA'))).toBe(IMAGE_TOKEN_ESTIMATE)
    expect(estimateResponsesItemTokens(image(`data:image/png;base64,${'A'.repeat(500_000)}`))).toBe(IMAGE_TOKEN_ESTIMATE)
    expect(estimateResponsesItemTokens({ role: 'user', content: [{ type: 'input_file', file_data: 'A'.repeat(100_000) }] })).toBe(FILE_TOKEN_ESTIMATE)
  })

  it('counts reasoning summaries plus encrypted content', () => {
    expect(estimateResponsesItemTokens({
      type: 'reasoning',
      id: 'rs_1',
      summary: [{ type: 'summary_text', text: bytes(50) }],
      encrypted_content: 'e'.repeat(4_000),
    })).toBe(Math.ceil((50 + 2_350) / 4))
    expect(estimateResponsesItemTokens({ type: 'reasoning', summary: [] })).toBe(0)
  })

  it('counts function calls and outputs without ids', () => {
    expect(estimateResponsesItemTokens({ type: 'function_call', id: 'fc_'.repeat(50), call_id: 'call_'.repeat(50), name: 'read', arguments: '{"a":1}' })).toBe(3)
    expect(estimateResponsesItemTokens({ type: 'function_call_output', call_id: 'call_'.repeat(50), output: bytes(8) })).toBe(2)
    expect(estimateResponsesItemTokens({ type: 'function_call_output', call_id: 'c', output: [{ type: 'input_text', text: bytes(4) }, { type: 'input_image', image_url: 'x' }] }))
      .toBe(1 + IMAGE_TOKEN_ESTIMATE)
  })

  it('ignores Pulpo items and counts unknown items conservatively', () => {
    expect(estimateResponsesItemTokens({ type: 'pulpo_compaction', summary: bytes(10_000) })).toBe(0)
    expect(estimateResponsesItemTokens({ type: 'pulpo_recall', sources: [bytes(10_000)] })).toBe(0)
    const unknown = { type: 'web_search_call', action: { query: bytes(20) } }
    expect(estimateResponsesItemTokens(unknown)).toBe(Math.ceil(JSON.stringify(unknown).length / 4))
  })

  it('sums item estimates', () => {
    expect(estimateResponsesItemsTokens([{ role: 'user', content: bytes(4) }, { role: 'assistant', content: bytes(8) }])).toBe(3)
  })
})

describe('responseUsageAnchor', () => {
  const completed = { status: 'completed', agentMode: false }
  const responseUsage = { inputTokens: 1_000, cachedInputTokens: 800, cacheWriteTokens: 100, outputTokens: 200, reasoningTokens: 50, totalTokens: 1_200 }

  it('uses input plus output without adding cache tokens again', () => {
    expect(responseUsageAnchor({ ...completed, usage: responseUsage })).toBe(1_200)
  })

  it('can exclude reasoning tokens that are not replayed', () => {
    expect(responseUsageAnchor({ ...completed, usage: responseUsage }, { excludeReasoning: true })).toBe(1_150)
  })

  it('ignores agent-mode, unfinished and usage-less responses', () => {
    expect(responseUsageAnchor({ ...completed, agentMode: true, usage: responseUsage })).toBeUndefined()
    expect(responseUsageAnchor({ status: 'failed', agentMode: false, usage: responseUsage })).toBeUndefined()
    expect(responseUsageAnchor({ status: 'incomplete', agentMode: false, usage: responseUsage })).toBeUndefined()
    expect(responseUsageAnchor({ ...completed, usage: null })).toBeUndefined()
    expect(responseUsageAnchor({ ...completed, usage: { ...responseUsage, inputTokens: 0, outputTokens: 0 } })).toBeUndefined()
    expect(responseUsageAnchor(undefined)).toBeUndefined()
  })
})

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
