import { createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { ZodError } from 'zod'
import { describe, expect, it } from 'vitest'
import type { ResponseEvent } from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'
import { ResponsesStreamBuilder, responsesUsage, type ResponsesStreamEvent } from '../upstream/responses-builder.js'
import {
  AnthropicStreamProjector,
  anthropicErrorBody,
  anthropicErrorType,
  estimateAnthropicInputTokens,
  isAnthropicApiRequest,
  parseAnthropicMessagesRequest,
  serializeAnthropicMessage,
} from './anthropic-codec.js'

const createdAt = new Date('2026-08-27T12:00:00.000Z')
const RESPONSE_ID = '00000000-0000-4000-8000-000000000001'

function responseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RESPONSE_ID,
    chatId: '00000000-0000-4000-8000-000000000002',
    userId: '00000000-0000-4000-8000-000000000003',
    modelId: 'model-1',
    actualModelId: 'model-1',
    origin: 'api',
    status: 'completed',
    executionMode: 'stream',
    input: [],
    instructions: null,
    parameters: {},
    metadata: {},
    publiclyStored: true,
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello' }] }],
    usage: { inputTokens: 100, cachedInputTokens: 30, cacheWriteTokens: 10, outputTokens: 5, reasoningTokens: 0, totalTokens: 105 },
    error: null,
    incompleteDetails: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  } as never
}

const thinkingRow = () => responseRow({ parameters: { reasoning: { effort: 'high', summary: 'auto' } } })

function base(overrides: Record<string, unknown> = {}) {
  return { model: 'model-1', max_tokens: 1024, messages: [{ role: 'user', content: 'hi' }], ...overrides }
}

function expectAppError(invoke: () => unknown, expected: Record<string, unknown>): void {
  let caught: unknown
  try {
    invoke()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(AppError)
  expect(caught).toMatchObject({ statusCode: 400, ...expected })
}

describe('parseAnthropicMessagesRequest', () => {
  it('requires max_tokens and messages', () => {
    expect(() => parseAnthropicMessagesRequest({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })).toThrow(ZodError)
    expect(() => parseAnthropicMessagesRequest(base({ messages: [] }))).toThrow(ZodError)
    expectAppError(() => parseAnthropicMessagesRequest('nope'), { code: 'validation_error' })
  })

  it('builds the generation request with system instructions', () => {
    const parsed = parseAnthropicMessagesRequest(base({ system: 'Be brief.', stream: true }))
    expect(parsed).toMatchObject({
      protocol: 'anthropic_messages', model: 'model-1', rawInput: [{ role: 'user', content: 'hi' }],
      parameters: { instructions: 'Be brief.' }, maxOutputTokens: 1024, stream: true, background: false, publiclyStored: true,
      ignoredParameters: [],
    })
    expect(parseAnthropicMessagesRequest(base({ system: [{ type: 'text', text: 'A', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'B' }] })).parameters.instructions)
      .toBe('A\n\nB')
    expect(parseAnthropicMessagesRequest(base({ system: '' })).parameters).not.toHaveProperty('instructions')
    expect(parseAnthropicMessagesRequest(base()).stream).toBe(false)
  })

  it('converts content blocks, tool use, tool results, and thinking in order', () => {
    const parsed = parseAnthropicMessagesRequest(base({
      messages: [
        { role: 'user', content: [
          { type: 'text', text: 'Look' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
          { type: 'image', source: { type: 'url', url: 'https://img/x.png' } },
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBE' }, title: 'spec.pdf' },
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBE' } },
          { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'notes' }, title: 'Notes' },
          { type: 'document', source: { type: 'content', content: [{ type: 'text', text: 'c1' }, 'c2'] } },
        ] },
        { role: 'assistant', content: [
          { type: 'thinking', thinking: 'plan', signature: 'SIG' },
          { type: 'redacted_thinking', data: 'OPAQUE' },
          { type: 'text', text: 'Calling ' },
          { type: 'text', text: 'tools.' },
          { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: { q: 'x' } },
          { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: {} },
          { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [] },
          { type: 'tool_use', id: 'toolu_2', name: 'shot' },
        ] },
        { role: 'user', content: [
          { type: 'text', text: 'before' },
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'found' },
          { type: 'tool_result', tool_use_id: 'toolu_2', is_error: true, content: [
            { type: 'text', text: 'partial' },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/' } },
          ] },
          { type: 'text', text: 'after' },
        ] },
      ],
    }))
    expect(parsed.rawInput).toEqual([
      { role: 'user', content: [
        { type: 'input_text', text: 'Look' },
        { type: 'input_image', image_url: 'data:image/png;base64,iVBOR' },
        { type: 'input_image', image_url: 'https://img/x.png' },
        { type: 'input_file', filename: 'spec.pdf', file_data: 'data:application/pdf;base64,JVBE' },
        { type: 'input_file', filename: 'document.pdf', file_data: 'data:application/pdf;base64,JVBE' },
        { type: 'input_text', text: 'Notes\n\nnotes' },
        { type: 'input_text', text: 'c1\nc2' },
      ] },
      { type: 'reasoning', id: 'rs_pulpo_in_1_0', summary: [{ type: 'summary_text', text: 'plan' }], pulpo_format: 'anthropic_messages', pulpo_signature: 'SIG' },
      { type: 'reasoning', id: 'rs_pulpo_in_1_1', summary: [], pulpo_format: 'anthropic_messages', pulpo_redacted_data: 'OPAQUE' },
      { role: 'assistant', content: 'Calling tools.' },
      { type: 'function_call', call_id: 'toolu_1', name: 'lookup', arguments: '{"q":"x"}' },
      { type: 'function_call', call_id: 'toolu_2', name: 'shot', arguments: '{}' },
      { role: 'user', content: [{ type: 'input_text', text: 'before' }] },
      { type: 'function_call_output', call_id: 'toolu_1', output: 'found' },
      { type: 'function_call_output', call_id: 'toolu_2', output: [
        { type: 'input_text', text: 'Error: ' },
        { type: 'input_text', text: 'partial' },
        { type: 'input_image', image_url: 'data:image/jpeg;base64,/9j/' },
      ] },
      { role: 'user', content: [{ type: 'input_text', text: 'after' }] },
    ])
  })

  it('handles tool_result edge cases and string content roles', () => {
    const parsed = parseAnthropicMessagesRequest(base({ messages: [
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'a', is_error: true, content: 'boom' },
        { type: 'tool_result', tool_use_id: 'b' },
        { type: 'tool_result', tool_use_id: 'c', content: [{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }] },
      ] },
      { role: 'assistant', content: 'plain' },
      { role: 'system', content: 'mid-conversation rule' },
    ] }))
    expect(parsed.rawInput).toEqual([
      { type: 'function_call_output', call_id: 'a', output: 'Error: boom' },
      { type: 'function_call_output', call_id: 'b', output: '' },
      { type: 'function_call_output', call_id: 'c', output: 'x\ny' },
      { role: 'assistant', content: 'plain' },
      { role: 'developer', content: 'mid-conversation rule' },
    ])
  })

  it('rejects unsupported blocks, roles, and sources', () => {
    const user = (block: unknown) => base({ messages: [{ role: 'user', content: [block] }] })
    expectAppError(() => parseAnthropicMessagesRequest(user({ type: 'search_result', content: [] })), { code: 'unsupported_parameter', param: 'messages.0.content.0.type' })
    expectAppError(() => parseAnthropicMessagesRequest(base({ messages: [{ role: 'assistant', content: [{ type: 'image', source: {} }] }] })), { code: 'unsupported_parameter', param: 'messages.0.content.0.type' })
    expectAppError(() => parseAnthropicMessagesRequest(base({ messages: [{ role: 'tool', content: 'x' }] })), { code: 'unsupported_parameter', param: 'messages.0.role' })
    expectAppError(() => parseAnthropicMessagesRequest(user({ type: 'image', source: { type: 'file', file_id: 'f' } })), { param: 'messages.0.content.0.source.type' })
    expectAppError(() => parseAnthropicMessagesRequest(user({ type: 'document', source: { type: 'base64', media_type: 'text/csv', data: 'x' } })), { param: 'messages.0.content.0.source.type' })
    expectAppError(() => parseAnthropicMessagesRequest(user({ type: 'tool_result' })), { code: 'validation_error' })
    expectAppError(() => parseAnthropicMessagesRequest(user({ type: 'text' })), { code: 'validation_error', param: 'messages.0.content.0.text' })
    expectAppError(() => parseAnthropicMessagesRequest(base({ messages: [{ role: 'assistant', content: [{ type: 'tool_use', name: 'x' }] }] })), { code: 'validation_error' })
    expectAppError(() => parseAnthropicMessagesRequest(base({ messages: [{ role: 'user', content: 5 }] })), { code: 'validation_error', param: 'messages.0.content' })
  })

  it('converts custom tools and tool_choice, rejecting server tools', () => {
    const tools = [
      { name: 'lookup', description: 'Find', input_schema: { type: 'object', properties: { q: { type: 'string' } } }, strict: true },
      { type: 'custom', name: 'bare' },
    ]
    const parsed = parseAnthropicMessagesRequest(base({ tools, tool_choice: { type: 'any', disable_parallel_tool_use: true } }))
    expect(parsed.parameters).toMatchObject({
      tools: [
        { type: 'function', name: 'lookup', description: 'Find', parameters: { type: 'object', properties: { q: { type: 'string' } } }, strict: true },
        { type: 'function', name: 'bare', parameters: { type: 'object', properties: {} } },
      ],
      tool_choice: 'required',
      parallel_tool_calls: false,
    })
    expect(parseAnthropicMessagesRequest(base({ tools, tool_choice: { type: 'tool', name: 'lookup' } })).parameters.tool_choice).toEqual({ type: 'function', name: 'lookup' })
    expect(parseAnthropicMessagesRequest(base({ tools, tool_choice: { type: 'none' } })).parameters.tool_choice).toBe('none')
    const auto = parseAnthropicMessagesRequest(base({ tools, tool_choice: { type: 'auto' } })).parameters
    expect(auto.tool_choice).toBe('auto')
    expect(auto).not.toHaveProperty('parallel_tool_calls')
    expect(parseAnthropicMessagesRequest(base({ tool_choice: { type: 'any' } })).parameters).not.toHaveProperty('tool_choice')
    expectAppError(() => parseAnthropicMessagesRequest(base({ tools: [{ type: 'web_search_20250305', name: 'web_search' }] })), { code: 'unsupported_parameter', param: 'tools.0.type' })
    expectAppError(() => parseAnthropicMessagesRequest(base({ tools, tool_choice: { type: 'tool' } })), { param: 'tool_choice.name' })
    expectAppError(() => parseAnthropicMessagesRequest(base({ tools, tool_choice: { type: 'other' } })), { param: 'tool_choice.type' })
  })

  it('maps thinking configuration onto reasoning effort', () => {
    const reasoning = (extra: Record<string, unknown>) => parseAnthropicMessagesRequest(base(extra)).parameters.reasoning
    expect(reasoning({ thinking: { type: 'enabled', budget_tokens: 1_024 } })).toEqual({ effort: 'low', summary: 'auto' })
    expect(reasoning({ thinking: { type: 'enabled', budget_tokens: 10_000 } })).toEqual({ effort: 'medium', summary: 'auto' })
    expect(reasoning({ thinking: { type: 'enabled', budget_tokens: 32_000 } })).toEqual({ effort: 'high', summary: 'auto' })
    expect(reasoning({ thinking: { type: 'adaptive' }, output_config: { effort: 'max' } })).toEqual({ effort: 'max', summary: 'auto' })
    expect(reasoning({ thinking: { type: 'adaptive' } })).toEqual({ summary: 'auto' })
    expect(reasoning({ output_config: { effort: 'low' } })).toEqual({ effort: 'low' })
    expect(reasoning({ thinking: { type: 'disabled' } })).toBeUndefined()
    expectAppError(() => parseAnthropicMessagesRequest(base({ thinking: 'yes' })), { param: 'thinking' })
    expect(() => parseAnthropicMessagesRequest(base({ output_config: { effort: 'extreme' } }))).toThrow(ZodError)
  })

  it('maps structured output formats', () => {
    const format = { type: 'json_schema', schema: { type: 'object' } }
    expect(parseAnthropicMessagesRequest(base({ output_config: { format } })).parameters.text)
      .toEqual({ format: { type: 'json_schema', name: 'response', schema: { type: 'object' }, strict: true } })
    expect(parseAnthropicMessagesRequest(base({ output_format: format })).parameters.text).toBeDefined()
    expectAppError(() => parseAnthropicMessagesRequest(base({ output_config: { format: { type: 'regex' } } })), { param: 'output_config.format.type' })
  })

  it('handles sampling, metadata, MCP servers, and ignored parameters', () => {
    const both = parseAnthropicMessagesRequest(base({ temperature: 0.2, top_p: 0.5, top_k: 10, stop_sequences: ['x'], future_flag: 1, cache_control: { type: 'ephemeral' } }))
    expect(both.parameters.temperature).toBe(0.2)
    expect(both.parameters).not.toHaveProperty('top_p')
    expect(both.ignoredParameters).toEqual(['cache_control', 'future_flag', 'stop_sequences', 'top_k', 'top_p'])
    expect(parseAnthropicMessagesRequest(base({ top_p: 0.5 })).parameters.top_p).toBe(0.5)
    expect(() => parseAnthropicMessagesRequest(base({ temperature: 1.5 }))).toThrow(ZodError)
    expect(parseAnthropicMessagesRequest(base({ metadata: { user_id: 'user-1' } })).parameters.safety_identifier).toBe('user-1')
    const long = 'u'.repeat(100)
    const hashed = parseAnthropicMessagesRequest(base({ metadata: { user_id: long } })).parameters.safety_identifier
    expect(hashed).toBe(createHash('sha256').update(long).digest('hex'))
    expect(hashed).toHaveLength(64)
    expectAppError(() => parseAnthropicMessagesRequest(base({ mcp_servers: [{ type: 'url', url: 'https://mcp', name: 'x' }] })), { code: 'unsupported_parameter', param: 'mcp_servers' })
    expect(parseAnthropicMessagesRequest(base({ mcp_servers: [] })).ignoredParameters).toEqual([])
  })
})

describe('serializeAnthropicMessage', () => {
  const output = [
    { type: 'reasoning', summary: [{ type: 'summary_text', text: 'think' }], pulpo_signature: 'SIG' },
    { type: 'reasoning', summary: [], pulpo_redacted_data: 'OPAQUE' },
    { type: 'reasoning', summary: [] },
    { type: 'message', content: [{ type: 'output_text', text: 'Hi' }, { type: 'refusal', refusal: '!' }] },
    { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '{"q":1}' },
    { type: 'function_call', id: 'fc_2', name: 'broken', arguments: '{oops' },
  ]

  it('includes thinking only when requested and parses tool input', () => {
    const message = serializeAnthropicMessage(responseRow({ output, parameters: { reasoning: { summary: 'auto' } } }))
    expect(message).toEqual({
      id: `msg_${RESPONSE_ID}`, type: 'message', role: 'assistant', model: 'model-1',
      content: [
        { type: 'thinking', thinking: 'think', signature: 'SIG' },
        { type: 'redacted_thinking', data: 'OPAQUE' },
        { type: 'text', text: 'Hi!' },
        { type: 'tool_use', id: 'call_1', name: 'lookup', input: { q: 1 } },
        { type: 'tool_use', id: 'fc_2', name: 'broken', input: {} },
      ],
      stop_reason: 'tool_use', stop_sequence: null,
      usage: { input_tokens: 60, cache_creation_input_tokens: 10, cache_read_input_tokens: 30, output_tokens: 5 },
    })
    expect(serializeAnthropicMessage(responseRow({ output })).content.map((block) => block.type)).toEqual(['text', 'tool_use', 'tool_use'])
  })

  it('maps stop reasons', () => {
    expect(serializeAnthropicMessage(responseRow()).stop_reason).toBe('end_turn')
    expect(serializeAnthropicMessage(responseRow({ status: 'incomplete', incompleteDetails: { reason: 'max_output_tokens' } })).stop_reason).toBe('max_tokens')
    expect(serializeAnthropicMessage(responseRow({ status: 'incomplete', incompleteDetails: { reason: 'content_filter' } })).stop_reason).toBe('refusal')
  })

  it('reads Responses-shaped usage too', () => {
    expect(serializeAnthropicMessage(responseRow({ usage: { input_tokens: 50, input_tokens_details: { cached_tokens: 20, cache_write_tokens: 5 }, output_tokens: 3 } })).usage)
      .toEqual({ input_tokens: 25, cache_creation_input_tokens: 5, cache_read_input_tokens: 20, output_tokens: 3 })
    expect(serializeAnthropicMessage(responseRow({ usage: null })).usage).toEqual({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 })
  })

  it('throws Anthropic-typed errors for failed generations', () => {
    const failed = (error: unknown) => {
      try {
        serializeAnthropicMessage(responseRow({ status: 'failed', error }))
      } catch (caught) {
        return caught
      }
      throw new Error('expected failure')
    }
    expect(failed({ message: 'bad input', upstream: { status: 400 } })).toMatchObject({ statusCode: 400, type: 'invalid_request_error', message: 'bad input' })
    expect(failed({ message: 'too big', upstream: { status: 413 } })).toMatchObject({ statusCode: 413, type: 'request_too_large' })
    expect(failed(null)).toMatchObject({ statusCode: 500, type: 'api_error', message: 'Generation failed' })
    expect(failed({ message: 'x', upstream: { status: 503 } })).toBeInstanceOf(AppError)
  })
})

type Payload = Record<string, unknown> & { type: string }

function wrap(events: ResponsesStreamEvent[]): ResponseEvent[] {
  return events.map((payload) => ({ responseId: RESPONSE_ID, sequence: payload.sequence_number, type: payload.type, payload, emittedAt: createdAt.toISOString() }))
}

/** Text, thinking with a signature, more text, then two calls whose argument deltas interleave. */
function scriptedEvents(): ResponsesStreamEvent[] {
  const builder = new ResponsesStreamBuilder('anthropic_messages', { id: 'resp_up', model: 'claude-x' })
  const events = [
    ...builder.text('Hello'),
    ...builder.reasoning('r', 'Let me '),
    ...builder.reasoning('r', 'think.'),
  ]
  builder.reasoningSignature('r', 'SIGNATURE')
  events.push(
    ...builder.reasoningDone('r'),
    ...builder.text(' world'),
    ...builder.functionCall('a', { callId: 'call_a', name: 'alpha' }),
    ...builder.functionCall('b', { callId: 'call_b', name: 'beta' }),
    ...builder.functionArguments('a', '{"x":'),
    ...builder.functionArguments('b', '{"y":'),
    ...builder.functionArguments('a', '1}'),
    ...builder.functionArguments('b', '2}'),
    ...builder.functionDone('b'),
    ...builder.functionDone('a'),
    ...builder.finish({ usage: responsesUsage({ inputTokens: 50, cachedInputTokens: 20, cacheWriteTokens: 5, outputTokens: 7 }) }).events,
  )
  return events
}

function project(row: never, events: ResponsesStreamEvent[]): { projector: AnthropicStreamProjector; payloads: Payload[] } {
  const projector = new AnthropicStreamProjector(row)
  const payloads = wrap(events).flatMap((event) => projector.project(event)) as Payload[]
  return { projector, payloads }
}

/** Structural checks every Anthropic SSE client relies on. */
function assertValidAnthropicStream(payloads: Payload[]): void {
  expect(payloads[0]!.type).toBe('message_start')
  expect(payloads.at(-1)!.type).toBe('message_stop')
  expect(payloads.filter((payload) => payload.type === 'message_start')).toHaveLength(1)
  expect(payloads.at(-2)!.type).toBe('message_delta')
  let open: number | undefined
  let next = 0
  for (const payload of payloads) {
    if (payload.type === 'content_block_start') {
      expect(open).toBeUndefined()
      expect(payload.index).toBe(next)
      open = next
      next += 1
    } else if (payload.type === 'content_block_delta') {
      expect(payload.index).toBe(open)
    } else if (payload.type === 'content_block_stop') {
      expect(payload.index).toBe(open)
      open = undefined
    }
  }
  expect(open).toBeUndefined()
}

describe('AnthropicStreamProjector', () => {
  it('projects a Responses stream onto a valid Anthropic event sequence', () => {
    const { projector, payloads } = project(thinkingRow(), scriptedEvents())
    assertValidAnthropicStream(payloads)
    expect(projector.sendsDoneSentinel).toBe(false)
    expect(payloads[0]).toMatchObject({ message: { id: `msg_${RESPONSE_ID}`, model: 'model-1', role: 'assistant', content: [], stop_reason: null } })
    const starts = payloads.filter((payload) => payload.type === 'content_block_start').map((payload) => payload.content_block)
    expect(starts).toEqual([
      { type: 'text', text: '' },
      { type: 'thinking', thinking: '', signature: '' },
      { type: 'text', text: '' },
      { type: 'tool_use', id: 'call_b', name: 'beta', input: {} },
      { type: 'tool_use', id: 'call_a', name: 'alpha', input: {} },
    ])
    const thinkingIndex = payloads.findIndex((payload) => payload.type === 'content_block_delta' && (payload.delta as Payload).type === 'signature_delta')
    expect(payloads[thinkingIndex]).toEqual({ type: 'content_block_delta', index: 1, delta: { type: 'signature_delta', signature: 'SIGNATURE' } })
    expect(payloads[thinkingIndex + 1]).toEqual({ type: 'content_block_stop', index: 1 })
    const json = payloads.filter((payload) => (payload.delta as Payload | undefined)?.type === 'input_json_delta')
    expect(json).toEqual([
      { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"y":2}' } },
      { type: 'content_block_delta', index: 4, delta: { type: 'input_json_delta', partial_json: '{"x":1}' } },
    ])
    expect(payloads.at(-2)).toEqual({
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { input_tokens: 25, cache_creation_input_tokens: 5, cache_read_input_tokens: 20, output_tokens: 7 },
    })
    expect(projector.project(wrap(scriptedEvents())[0]!)).toEqual([])
    expect(projector.finish(thinkingRow())).toEqual([])
  })

  it('omits thinking when the client did not ask for it', () => {
    const { payloads } = project(responseRow(), scriptedEvents())
    assertValidAnthropicStream(payloads)
    expect(payloads.filter((payload) => payload.type === 'content_block_start').map((payload) => (payload.content_block as Payload).type))
      .toEqual(['text', 'text', 'tool_use', 'tool_use'])
  })

  it('accumulates into the expected final message with the Anthropic SDK', async () => {
    const { projector, payloads } = project(thinkingRow(), scriptedEvents())
    const sse = payloads.map((payload) => projector.encode(payload)).join('')
    const fetch = async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const client = new Anthropic({ apiKey: 'x', baseURL: 'http://test', fetch, maxRetries: 0 })
    const message = await client.messages.stream({ model: 'model-1', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }).finalMessage()
    expect(message.stop_reason).toBe('tool_use')
    expect(message.content).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'thinking', thinking: 'Let me think.', signature: 'SIGNATURE' },
      { type: 'text', text: ' world' },
      { type: 'tool_use', id: 'call_b', name: 'beta', input: { y: 2 } },
      { type: 'tool_use', id: 'call_a', name: 'alpha', input: { x: 1 } },
    ])
    expect(message.usage).toMatchObject({ input_tokens: 25, output_tokens: 7, cache_read_input_tokens: 20 })
  })

  it('frames events as named SSE events', () => {
    const projector = new AnthropicStreamProjector(responseRow())
    expect(projector.encode({ type: 'message_stop' })).toBe('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    expect(projector.encode([1])).toBe('event: message\ndata: [1]\n\n')
  })

  it('emits tool calls missing output_item.done from the final output and maps incomplete stops', () => {
    const projector = new AnthropicStreamProjector(responseRow())
    const payloads = projector.project({
      responseId: RESPONSE_ID, sequence: 0, type: 'response.incomplete', emittedAt: createdAt.toISOString(),
      payload: { response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'function_call', id: 'fc', call_id: 'c', name: 'n', arguments: '' }], usage: null } },
    }) as Payload[]
    assertValidAnthropicStream(payloads)
    expect(payloads[2]).toEqual({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } })
    expect(payloads.at(-2)).toMatchObject({ delta: { stop_reason: 'max_tokens' } })
  })

  it('finishes from the stored row or with an error event', () => {
    const completed = new AnthropicStreamProjector(responseRow())
    const payloads = completed.finish(responseRow()) as Payload[]
    expect(payloads.map((payload) => payload.type)).toEqual(['message_start', 'message_delta', 'message_stop'])
    expect(completed.finish(responseRow())).toEqual([])

    const failed = new AnthropicStreamProjector(responseRow())
    failed.project(wrap(scriptedEvents())[0]!)
    expect(failed.finish(responseRow({ status: 'failed', error: { message: 'upstream broke', upstream: { status: 400 } } })))
      .toEqual([{ type: 'error', error: { type: 'invalid_request_error', message: 'upstream broke' } }])
    expect(failed.finish(responseRow())).toEqual([])
    expect(failed.project(wrap(scriptedEvents()).at(-1)!)).toEqual([])
    expect(new AnthropicStreamProjector(responseRow()).finish(responseRow({ status: 'cancelled' })))
      .toEqual([{ type: 'error', error: { type: 'api_error', message: 'Generation cancelled' } }])
  })

  // DOUBT: the non-stream serializer returns redacted_thinking (and signed thinking
  // with empty text), but the streaming projector only opens thinking blocks on
  // summary text deltas, so streaming clients never receive these blocks to replay.
  it('streams redacted thinking like the non-stream serializer', () => {
    const builder = new ResponsesStreamBuilder('anthropic_messages', { model: 'claude-x' })
    const events = [...builder.redactedReasoning('r', 'OPAQUE'), ...builder.reasoningDone('r'), ...builder.text('ok'), ...builder.finish({ usage: null }).events]
    const { payloads } = project(thinkingRow(), events)
    expect(payloads.some((payload) => (payload.content_block as Payload | undefined)?.type === 'redacted_thinking')).toBe(true)
  })
})

describe('Anthropic helpers', () => {
  it('estimates input tokens counting media per item rather than per byte', () => {
    const image = 'A'.repeat(1_000_000)
    const parsed = parseAnthropicMessagesRequest(base({ system: 'sys', messages: [{ role: 'user', content: [
      { type: 'text', text: 'describe' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
    ] }] }))
    const estimate = estimateAnthropicInputTokens(parsed)
    expect(estimate).toBeGreaterThanOrEqual(1_600)
    expect(estimate).toBeLessThan(1_700)
    const pdf = parseAnthropicMessagesRequest(base({ messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'A'.repeat(40_000) } },
    ] }] }))
    // ~40 KB of data URL ~ 30 KB of PDF ~ 11 pages at 1,500 tokens each, plus a little JSON.
    expect(estimateAnthropicInputTokens(pdf)).toBeGreaterThanOrEqual(16_500)
    expect(estimateAnthropicInputTokens(pdf)).toBeLessThan(16_600)
    expect(estimateAnthropicInputTokens(parseAnthropicMessagesRequest(base({ messages: [{ role: 'user', content: 'x' }] })))).toBeGreaterThan(0)
  })

  it('maps HTTP statuses to Anthropic error types and bodies', () => {
    expect([400, 401, 402, 403, 404, 413, 422, 429, 500, 503, 529].map(anthropicErrorType)).toEqual([
      'invalid_request_error', 'authentication_error', 'billing_error', 'permission_error', 'not_found_error',
      'request_too_large', 'invalid_request_error', 'rate_limit_error', 'api_error', 'api_error', 'overloaded_error',
    ])
    expect(anthropicErrorBody(429, 'slow down')).toEqual({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } })
  })

  it('recognises Anthropic API paths', () => {
    expect(isAnthropicApiRequest('/v1/messages')).toBe(true)
    expect(isAnthropicApiRequest('/v1/messages?beta=true')).toBe(true)
    expect(isAnthropicApiRequest('/v1/messages/count_tokens')).toBe(true)
    expect(isAnthropicApiRequest('/v1/messagesx')).toBe(false)
    expect(isAnthropicApiRequest('/v1/chat/completions')).toBe(false)
  })
})
