import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  anthropicMessagesFromEntries,
  anthropicMessagesRequest,
  anthropicSdkBaseUrl,
  anthropicToolId,
  anthropicUsage,
  openAnthropicMessagesStream,
  translateAnthropicStream,
} from './anthropic-messages.js'
import type { NeutralEntry } from './responses-input.js'
import type { ResponsesStreamEvent } from './responses-builder.js'

async function* items(values: unknown[]): AsyncGenerator<unknown> {
  for (const value of values) yield value
}

async function collect(stream: AsyncIterable<ResponsesStreamEvent>): Promise<ResponsesStreamEvent[]> {
  const events: ResponsesStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

function terminal(events: ResponsesStreamEvent[]) {
  return events.at(-1)!.response as { id: string; model: string; status: string; output: Array<Record<string, unknown>>; output_text: string; usage: Record<string, unknown>; incomplete_details: unknown }
}

function anthropicError(status: number, message: string) {
  return Object.assign(new Error(`${status} ${message}`), { status, error: { type: 'error', error: { type: 'invalid_request_error', message } } })
}

const request = (payload: Record<string, unknown>) => anthropicMessagesRequest({ input: 'hi', ...payload }, { stream: false })

describe('helpers', () => {
  it('strips /v1 and trailing slashes from base URLs', () => {
    expect(anthropicSdkBaseUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com')
    expect(anthropicSdkBaseUrl('https://api.anthropic.com/v1///')).toBe('https://api.anthropic.com')
    expect(anthropicSdkBaseUrl('https://proxy.example/anthropic')).toBe('https://proxy.example/anthropic')
  })

  it('sanitizes tool ids', () => {
    expect(anthropicToolId('call_abc-123')).toBe('call_abc-123')
    expect(anthropicToolId('fc.1/2:3')).toBe('fc_1_2_3')
    expect(anthropicToolId('')).toBe('call')
    expect(anthropicToolId('x'.repeat(250))).toHaveLength(200)
  })

  it('reports Anthropic usage with cache reads and writes included in input', () => {
    expect(anthropicUsage({ input: 10, cacheRead: 100, cacheWrite: 20, output: 5 })).toMatchObject({
      input_tokens: 130, input_tokens_details: { cached_tokens: 100, cache_write_tokens: 20 }, output_tokens: 5, total_tokens: 135,
    })
  })
})

describe('anthropicMessagesRequest', () => {
  it('merges system text, adds the JSON instruction, and defaults max_tokens', () => {
    const body = anthropicMessagesRequest({
      model: 'claude-haiku-4-5',
      instructions: 'Rule one.',
      input: [{ role: 'developer', content: 'Rule two.' }, { role: 'user', content: 'hi' }],
      text: { format: { type: 'json_object' } },
      max_output_tokens: 0,
      include: ['x'], store: false, truncation: 'auto',
    }, { stream: true })
    expect(body.system).toEqual([{ type: 'text', text: 'Rule one.\n\nRule two.\n\nRespond with a single valid JSON object and nothing else.' }])
    expect(body.max_tokens).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS)
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
    expect(body.stream).toBe(true)
    for (const key of ['include', 'store', 'truncation', 'input', 'instructions', 'text', 'max_output_tokens']) expect(body).not.toHaveProperty(key)
    expect(request({ model: 'claude-haiku-4-5' })).not.toHaveProperty('system')
  })

  it('uses adaptive thinking with effort on adaptive models', () => {
    const body = request({ model: 'claude-opus-4-6', reasoning: { effort: 'xhigh' }, max_output_tokens: 32_000 })
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(body.output_config).toEqual({ effort: 'high' })
    expect(request({ model: 'claude-opus-4-7', reasoning: { effort: 'xhigh' } }).output_config).toEqual({ effort: 'xhigh' })
  })

  it('keeps thinking on at low effort for always-on models and disables it otherwise', () => {
    const alwaysOn = request({ model: 'claude-opus-5-5', reasoning: { effort: 'none' } })
    expect(alwaysOn.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(alwaysOn.output_config).toEqual({ effort: 'low' })
    const optional = request({ model: 'claude-opus-4-7', reasoning: { effort: 'none' } })
    expect(optional.thinking).toEqual({ type: 'disabled' })
    expect(optional).not.toHaveProperty('output_config')
    expect(request({ model: 'claude-opus-4-7' })).not.toHaveProperty('thinking')
  })

  it('uses budget thinking on older models and drops sampling with it', () => {
    const body = request({ model: 'claude-haiku-4-5', reasoning: { effort: 'medium' }, max_output_tokens: 16_000, temperature: 0.5, top_p: 0.9 })
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8_192 })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
    expect(body).not.toHaveProperty('output_config')
    // Too small a limit for a budget: thinking is skipped, sampling survives.
    const small = request({ model: 'claude-haiku-4-5', reasoning: { effort: 'high' }, max_output_tokens: 1_500, temperature: 0.5 })
    expect(small).not.toHaveProperty('thinking')
    expect(small.temperature).toBe(0.5)
    expect(request({ model: 'claude-haiku-4-5', reasoning: { effort: 'none' } })).not.toHaveProperty('thinking')
  })

  it('clamps temperature, prefers it over top_p, and drops sampling on models that reject it', () => {
    expect(request({ model: 'claude-sonnet-4-5', temperature: 1.7 }).temperature).toBe(1)
    const both = request({ model: 'claude-sonnet-4-5', temperature: 0.3, top_p: 0.5 })
    expect(both.temperature).toBe(0.3)
    expect(both).not.toHaveProperty('top_p')
    expect(request({ model: 'claude-sonnet-4-5', top_p: 0.5 }).top_p).toBe(0.5)
    const modern = request({ model: 'claude-opus-4-7', temperature: 0.3, top_p: 0.5 })
    expect(modern).not.toHaveProperty('temperature')
    expect(modern).not.toHaveProperty('top_p')
  })

  it('maps function tools and tool_choice', () => {
    const tools = [
      { type: 'function', name: 'f', description: 'does f', parameters: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] } },
      { type: 'function', name: 'g' },
      { type: 'web_search' },
    ]
    const body = request({ model: 'claude-sonnet-4-5', tools, tool_choice: 'auto' })
    expect(body.tools).toEqual([
      { name: 'f', description: 'does f', input_schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] } },
      { name: 'g', input_schema: { type: 'object' } },
    ])
    expect(body).not.toHaveProperty('tool_choice')
    expect(request({ model: 'm', tools, tool_choice: 'required' }).tool_choice).toEqual({ type: 'any' })
    expect(request({ model: 'm', tools, tool_choice: { type: 'function', name: 'f' }, parallel_tool_calls: false }).tool_choice)
      .toEqual({ type: 'tool', name: 'f', disable_parallel_tool_use: true })
    expect(request({ model: 'm', tools, tool_choice: 'none' }).tool_choice).toEqual({ type: 'none' })
    expect(request({ model: 'm', tools, parallel_tool_calls: false }).tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true })
    expect(request({ model: 'm', tools, tool_choice: 'required', parallel_tool_calls: false }).tool_choice).toEqual({ type: 'any', disable_parallel_tool_use: true })
    expect(request({ model: 'm', tool_choice: 'required' })).not.toHaveProperty('tool_choice')
  })

  it('maps json_schema output, cache_control, and safety_identifier', () => {
    const body = request({
      model: 'claude-opus-4-6', reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'x', schema: { type: 'object' } } },
      cache_control: { type: 'ephemeral' }, safety_identifier: 'user-1', prompt_cache_key: 'ignored',
    })
    expect(body.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: { type: 'object' } } })
    expect(body.cache_control).toEqual({ type: 'ephemeral' })
    expect(body.metadata).toEqual({ user_id: 'user-1' })
    expect(body).not.toHaveProperty('prompt_cache_key')
  })

  it('passes admin parameters through as defaults that never override translated values', () => {
    const body = request({ model: 'claude-opus-4-6', reasoning: { effort: 'high' }, top_k: 5, thinking: { type: 'disabled' } })
    expect(body.top_k).toBe(5)
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    // An unset field is filled from the admin default.
    expect(request({ model: 'claude-opus-4-6', thinking: { type: 'enabled', budget_tokens: 2_048 } }).thinking).toEqual({ type: 'enabled', budget_tokens: 2_048 })
    // Derived fields are never taken from defaults.
    const derived = request({
      model: 'claude-opus-4-6', max_output_tokens: 1_000, max_tokens: 5, messages: [], system: 'admin', stop_sequences: ['x'], tool_choice: { type: 'any' },
    })
    expect(derived.max_tokens).toBe(1_000)
    expect(derived.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
    expect(derived).not.toHaveProperty('system')
    expect(derived.stop_sequences).toEqual(['x'])
    expect(derived).not.toHaveProperty('tool_choice')
  })

  it('drops temperature whenever thinking is on and keeps it when thinking is disabled', () => {
    expect(request({ model: 'claude-opus-4-6', reasoning: { effort: 'high' }, temperature: 0.5 })).not.toHaveProperty('temperature')
    expect(request({ model: 'claude-haiku-4-5', reasoning: { effort: 'low' }, max_output_tokens: 8_000, temperature: 0.5 })).not.toHaveProperty('temperature')
    const disabled = request({ model: 'claude-opus-4-6', reasoning: { effort: 'none' }, temperature: 0.5 })
    expect(disabled.thinking).toEqual({ type: 'disabled' })
    expect(disabled.temperature).toBe(0.5)
  })
})

describe('anthropicMessagesFromEntries', () => {
  const options = { upstreamModel: 'claude-opus-4-6', replayThinking: true }

  it('places tool results first in their user message and merges consecutive roles', () => {
    const entries: NeutralEntry[] = [
      { kind: 'user', parts: [{ type: 'text', text: 'q' }] },
      { kind: 'assistant', text: 'calling' },
      { kind: 'function_call', callId: 'fc.1', name: 'f', arguments: '{"a":1}' },
      { kind: 'function_call', callId: 'fc.2', name: 'g', arguments: 'not json' },
      { kind: 'user', parts: [{ type: 'text', text: 'also this' }] },
      { kind: 'function_output', callId: 'fc.1', output: [{ type: 'text', text: 'r1' }, { type: 'image', url: 'https://img' }, { type: 'file', fileId: 'f' }] },
      { kind: 'function_output', callId: 'fc.2', output: [] },
    ]
    expect(anthropicMessagesFromEntries(entries, options)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: [
        { type: 'text', text: 'calling' },
        { type: 'tool_use', id: 'fc_1', name: 'f', input: { a: 1 } },
        { type: 'tool_use', id: 'fc_2', name: 'g', input: {} },
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'fc_1', content: [
          { type: 'text', text: 'r1' }, { type: 'image', source: { type: 'url', url: 'https://img' } },
          { type: 'text', text: '[Attachment f cannot be read by this model]' },
        ] },
        { type: 'tool_result', tool_use_id: 'fc_2' },
        { type: 'text', text: 'also this' },
      ] },
    ])
  })

  it('forces the first message to be from the user', () => {
    expect(anthropicMessagesFromEntries([{ kind: 'assistant', text: 'hello' }], options)).toEqual([
      { role: 'user', content: [{ type: 'text', text: '(conversation continues)' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ])
  })

  it('replays signed thinking only for the producing model, in its original order', () => {
    const entries: NeutralEntry[] = [
      { kind: 'user', parts: [{ type: 'text', text: 'q' }] },
      { kind: 'assistant', text: 'answer' },
      { kind: 'reasoning', reasoning: { text: 'same', format: 'anthropic_messages', model: 'claude-opus-4-6', signature: 's1' } },
      { kind: 'reasoning', reasoning: { text: 'no model', format: 'anthropic_messages', signature: 's2' } },
      { kind: 'reasoning', reasoning: { text: 'other', format: 'anthropic_messages', model: 'claude-sonnet-4-5', signature: 's3' } },
      { kind: 'reasoning', reasoning: { text: 'unsigned', format: 'anthropic_messages', model: 'claude-opus-4-6' } },
      { kind: 'reasoning', reasoning: { text: 'chat', format: 'openai_chat_completions', signature: 's4' } },
      { kind: 'reasoning', reasoning: { text: '', format: 'anthropic_messages', redactedData: 'opaque', signature: 's5' } },
    ]
    expect(anthropicMessagesFromEntries(entries, options)[1]).toEqual({ role: 'assistant', content: [
      { type: 'text', text: 'answer' },
      { type: 'thinking', thinking: 'same', signature: 's1' },
      { type: 'thinking', thinking: 'no model', signature: 's2' },
      { type: 'redacted_thinking', data: 'opaque' },
    ] })
    expect(anthropicMessagesFromEntries(entries, { ...options, replayThinking: false })[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'answer' }] })
  })

  it('keeps interleaved thinking between text and tool use in order', () => {
    const entries: NeutralEntry[] = [
      { kind: 'user', parts: [{ type: 'text', text: 'q' }] },
      { kind: 'reasoning', reasoning: { text: 't1', format: 'anthropic_messages', model: 'claude-opus-4-6', signature: 's1' } },
      { kind: 'function_call', callId: 'c1', name: 'f', arguments: '{}' },
      { kind: 'function_output', callId: 'c1', output: [{ type: 'text', text: 'r' }] },
      { kind: 'reasoning', reasoning: { text: 't2', format: 'anthropic_messages', model: 'claude-opus-4-6', signature: 's2' } },
      { kind: 'assistant', text: 'between' },
      { kind: 'reasoning', reasoning: { text: 't3', format: 'anthropic_messages', model: 'claude-opus-4-6', signature: 's3' } },
      { kind: 'function_call', callId: 'c2', name: 'g', arguments: '{}' },
    ]
    const messages = anthropicMessagesFromEntries(entries, options)
    expect(messages[1]!.content.map((block) => block.type)).toEqual(['thinking', 'tool_use'])
    expect(messages[3]!.content).toEqual([
      { type: 'thinking', thinking: 't2', signature: 's2' },
      { type: 'text', text: 'between' },
      { type: 'thinking', thinking: 't3', signature: 's3' },
      { type: 'tool_use', id: 'c2', name: 'g', input: {} },
    ])
  })

  it('removes thinking-only assistant turns and remerges the neighbours', () => {
    const entries: NeutralEntry[] = [
      { kind: 'user', parts: [{ type: 'text', text: 'a' }] },
      { kind: 'reasoning', reasoning: { text: 't', format: 'anthropic_messages', signature: 's' } },
      { kind: 'user', parts: [{ type: 'text', text: 'b' }] },
    ]
    expect(anthropicMessagesFromEntries(entries, options)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    ])
  })

  it('maps images, PDFs, text documents, and unreadable files', () => {
    const text = Buffer.from('hello file').toString('base64')
    const [message] = anthropicMessagesFromEntries([{ kind: 'user', parts: [
      { type: 'image', url: 'data:image/png;base64,iVBOR' },
      { type: 'image', url: 'https://example.com/a.png' },
      { type: 'file', filename: 'a.pdf', fileData: 'data:application/pdf;base64,JVBE' },
      { type: 'file', filename: 'notes.md', fileData: `data:text/markdown;base64,${text}` },
      { type: 'file', filename: 'sheet.xlsx', fileData: 'data:application/vnd.ms-excel;base64,AAAA' },
      { type: 'file', fileId: 'file-9' },
      { type: 'text', text: '' },
    ] }], options)
    expect(message!.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
      { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBE' }, title: 'a.pdf' },
      { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'hello file' }, title: 'notes.md' },
      { type: 'text', text: '[Attachment sheet.xlsx (application/vnd.ms-excel) cannot be read by this model]' },
      { type: 'text', text: '[Attachment file-9 cannot be read by this model]' },
    ])
  })
})

describe('translateAnthropicStream', () => {
  const stream = [
    { type: 'message_start', message: { id: 'msg_01', model: 'claude-opus-4-6', usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'think.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'REDACTED' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Hello' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'content_block_start', index: 3, content_block: { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: {} } },
    { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '' } },
    { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"q": "x' } },
    { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: 'y"}' } },
    { type: 'content_block_stop', index: 3 },
    { type: 'content_block_start', index: 4, content_block: { type: 'tool_use', id: 'toolu_2', name: 'noop', input: {} } },
    { type: 'content_block_stop', index: 4 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 42 } },
    { type: 'message_stop' },
  ]

  it('translates a full stream with thinking, text, and tool use', async () => {
    const events = await collect(translateAnthropicStream(items(stream), 'claude-opus-4-6'))
    expect(events[0]).toMatchObject({ type: 'response.created', response: { id: 'msg_01', model: 'claude-opus-4-6' } })
    const response = terminal(events)
    expect(events.at(-1)!.type).toBe('response.completed')
    expect(response.output).toEqual([
      expect.objectContaining({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Let me think.' }], pulpo_signature: 'SIG', pulpo_format: 'anthropic_messages', pulpo_model: 'claude-opus-4-6' }),
      expect.objectContaining({ type: 'reasoning', summary: [], pulpo_redacted_data: 'REDACTED' }),
      expect.objectContaining({ type: 'message', content: [{ type: 'output_text', text: 'Hello', annotations: [] }] }),
      expect.objectContaining({ type: 'function_call', call_id: 'toolu_1', name: 'lookup', arguments: '{"q": "xy"}' }),
      expect.objectContaining({ type: 'function_call', call_id: 'toolu_2', name: 'noop', arguments: '{}' }),
    ])
    expect(response.usage).toMatchObject({ input_tokens: 130, input_tokens_details: { cached_tokens: 100, cache_write_tokens: 20 }, output_tokens: 42 })
    // The signature is attached by the time the reasoning item is done.
    const reasoningDone = events.find((event) => event.type === 'response.output_item.done' && (event.item as { type: string }).type === 'reasoning')
    expect(reasoningDone!.item).toMatchObject({ pulpo_signature: 'SIG' })
    expect(events.map((event) => event.sequence_number)).toEqual(events.map((_, index) => index))
  })

  it('uses complete tool input from content_block_start and text from the start block', async () => {
    const events = await collect(translateAnthropicStream(items([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'pre' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't', name: 'n', input: { a: 1 } } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_stop' },
    ]), 'claude-x'))
    expect(terminal(events).output).toMatchObject([{ type: 'message' }, { type: 'function_call', arguments: '{"a":1}' }])
    expect(terminal(events).output_text).toBe('pre')
  })

  it.each([
    ['max_tokens', 'incomplete', { reason: 'max_output_tokens' }],
    ['model_context_window_exceeded', 'incomplete', { reason: 'max_output_tokens' }],
    ['refusal', 'incomplete', { reason: 'content_filter' }],
    ['end_turn', 'completed', null],
    ['tool_use', 'completed', null],
  ])('maps stop_reason %s', async (stopReason, status, details) => {
    const events = await collect(translateAnthropicStream(items([
      { type: 'message_start', message: { id: 'm', model: 'x', usage: { input_tokens: 1 } } },
      { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 2 } },
    ]), 'x'))
    expect(terminal(events)).toMatchObject({ status, incomplete_details: details })
  })

  it('throws stream error events with a status for retryable types', async () => {
    const overloaded = await collect(translateAnthropicStream(items([
      { type: 'message_start', message: { id: 'm' } },
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
    ]), 'x')).catch((error: unknown) => error)
    expect(overloaded).toBeInstanceOf(Error)
    expect(overloaded).toMatchObject({ message: 'Overloaded', type: 'overloaded_error', status: 529 })
    const rateLimited = await collect(translateAnthropicStream(items([{ type: 'error', error: { type: 'rate_limit_error' } }]), 'x')).catch((error: unknown) => error)
    expect(rateLimited).toMatchObject({ message: 'Provider stream failed', status: 429 })
  })

  it('reports partial usage before rethrowing a mid-stream error', async () => {
    const events: ResponsesStreamEvent[] = []
    const error = await (async () => {
      for await (const event of translateAnthropicStream(items([
        { type: 'message_start', message: { id: 'm', usage: { input_tokens: 12, cache_read_input_tokens: 8, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'part' } },
        { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      ]), 'x')) events.push(event)
    })().catch((caught: unknown) => caught)
    expect(error).toMatchObject({ status: 529 })
    expect(events.at(-1)).toMatchObject({
      type: 'response.in_progress',
      response: { status: 'in_progress', output_text: 'part', usage: { input_tokens: 20, input_tokens_details: { cached_tokens: 8 }, output_tokens: 1 } },
    })
  })

  it('fails a stream that ends without message_stop or a stop_reason, after reporting usage', async () => {
    const events: ResponsesStreamEvent[] = []
    const error = await (async () => {
      for await (const event of translateAnthropicStream(items([
        { type: 'message_start', message: { id: 'm', usage: { input_tokens: 30, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'cut' } },
      ]), 'x')) events.push(event)
    })().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ message: 'Provider stream ended before the response finished', status: 502 })
    expect(events.at(-1)).toMatchObject({ type: 'response.in_progress', response: { output_text: 'cut', usage: { input_tokens: 30, output_tokens: 1 } } })
    expect(events.some((event) => event.type === 'response.completed')).toBe(false)
  })

  it('completes on message_stop alone', async () => {
    const events = await collect(translateAnthropicStream(items([
      { type: 'message_start', message: { id: 'm', usage: { input_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'hi' } },
      { type: 'message_stop' },
    ]), 'x'))
    expect(terminal(events)).toMatchObject({ status: 'completed', output_text: 'hi' })
  })
})

describe('openAnthropicMessagesStream', () => {
  function client(create: ReturnType<typeof vi.fn>) {
    return { messages: { create } } as unknown as Anthropic
  }
  const withThinking = {
    model: 'claude-opus-4-6',
    reasoning: { effort: 'high' },
    temperature: 0.5,
    input: [
      { role: 'user', content: 'q' },
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 't' }], pulpo_format: 'anthropic_messages', pulpo_model: 'claude-opus-4-6', pulpo_signature: 'bad' },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'again' },
    ],
  }

  it('strips replayed thinking blocks when their signature is rejected', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const create = vi.fn()
      .mockRejectedValueOnce(anthropicError(400, 'messages.1.content.0: Invalid `signature` in `thinking` block'))
      .mockResolvedValueOnce(items([{ type: 'message_start', message: { id: 'm', model: 'claude-opus-4-6' } }, { type: 'message_stop' }]))
    const events = await collect(await openAnthropicMessagesStream(client(create), withThinking, { headers: { 'x-h': '1' } }))
    expect(terminal(events).status).toBe('completed')
    expect((create.mock.calls[0]![0] as { messages: Array<{ content: unknown[] }> }).messages[1]!.content).toHaveLength(2)
    expect(create.mock.calls[1]![0]).toMatchObject({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'q' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
        { role: 'user', content: [{ type: 'text', text: 'again' }] },
      ],
      thinking: { type: 'adaptive', display: 'summarized' },
    })
    expect(create.mock.calls[1]![0]).not.toHaveProperty('temperature')
    expect(create.mock.calls[1]![1]).toEqual({ signal: undefined, headers: { 'x-h': '1' } })
  })

  it('drops an optional parameter named in a 400', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const create = vi.fn()
      .mockRejectedValueOnce(anthropicError(400, 'temperature: not supported for this model'))
      .mockResolvedValueOnce(items([]))
    await openAnthropicMessagesStream(client(create), { model: 'claude-sonnet-4-5', input: 'hi', temperature: 0.5 }, {})
    expect(create.mock.calls[0]![0]).toHaveProperty('temperature', 0.5)
    expect(create.mock.calls[1]![0]).not.toHaveProperty('temperature')
  })

  it('rethrows other errors', async () => {
    const auth = Object.assign(new Error('401'), { status: 401, error: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } })
    await expect(openAnthropicMessagesStream(client(vi.fn().mockRejectedValue(auth)), withThinking, {})).rejects.toBe(auth)
    const required = anthropicError(400, 'messages: at least one message is required')
    const create = vi.fn().mockRejectedValue(required)
    await expect(openAnthropicMessagesStream(client(create), { model: 'claude-sonnet-4-5', input: 'hi' }, {})).rejects.toBe(required)
    expect(create).toHaveBeenCalledTimes(1)
    // An invalid thinking value is the caller's error: it is neither a signature failure nor unsupported.
    const noBlocks = anthropicError(400, 'thinking budget too large')
    const second = vi.fn().mockRejectedValue(noBlocks)
    await expect(openAnthropicMessagesStream(client(second), { model: 'claude-haiku-4-5', input: 'hi', reasoning: { effort: 'low' } }, {})).rejects.toBe(noBlocks)
    expect(second).toHaveBeenCalledTimes(1)
    // With replayed thinking, a 400 that does not mention signatures leaves the history alone.
    const unrelated = anthropicError(400, 'messages.1.content.0.thinking: field required')
    const third = vi.fn().mockRejectedValue(unrelated)
    await expect(openAnthropicMessagesStream(client(third), withThinking, {})).rejects.toBe(unrelated)
    expect(third).toHaveBeenCalledTimes(1)
  })

  it('drops unsupported thinking named in a 400', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const create = vi.fn()
      .mockRejectedValueOnce(anthropicError(400, 'thinking: Extra inputs are not permitted'))
      .mockResolvedValueOnce(items([]))
    await openAnthropicMessagesStream(client(create), { model: 'claude-haiku-4-5', input: 'hi', reasoning: { effort: 'low' } }, {})
    expect(create.mock.calls[0]![0]).toHaveProperty('thinking')
    expect(create.mock.calls[1]![0]).not.toHaveProperty('thinking')
  })

  it('drops only the output_config field a rejection names', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const payload = {
      model: 'claude-opus-4-6', input: 'hi', reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'x', schema: { type: 'object' } } },
    }
    const create = vi.fn()
      .mockRejectedValueOnce(anthropicError(400, 'output_config.format: Extra inputs are not permitted'))
      .mockResolvedValueOnce(items([]))
    await openAnthropicMessagesStream(client(create), payload, {})
    expect(create.mock.calls[0]![0]).toHaveProperty('output_config', { effort: 'low', format: { type: 'json_schema', schema: { type: 'object' } } })
    expect(create.mock.calls[1]![0]).toHaveProperty('output_config', { effort: 'low' })

    // Without a named sub-field, the whole object goes.
    const whole = vi.fn()
      .mockRejectedValueOnce(anthropicError(400, 'output_config: Extra inputs are not permitted'))
      .mockResolvedValueOnce(items([]))
    await openAnthropicMessagesStream(client(whole), payload, {})
    expect(whole.mock.calls[1]![0]).not.toHaveProperty('output_config')

    // Naming every field also drops the whole object.
    const every = vi.fn()
      .mockRejectedValueOnce(anthropicError(400, 'output_config.effort and output_config.format are not supported'))
      .mockResolvedValueOnce(items([]))
    await openAnthropicMessagesStream(client(every), payload, {})
    expect(every.mock.calls[1]![0]).not.toHaveProperty('output_config')
  })
})

describe('Anthropic request constraints', () => {
  const base = { model: 'claude-opus-4-6', input: 'q', tools: [{ type: 'function', name: 'read', parameters: { type: 'object' } }] }

  it('only forces tool use when thinking is off and the model allows it', () => {
    expect(anthropicMessagesRequest({ ...base, tool_choice: 'required' }, { stream: true }).tool_choice).toEqual({ type: 'any' })
    expect(anthropicMessagesRequest({ ...base, tool_choice: 'required' }, { stream: true })).not.toHaveProperty('thinking')
    expect(anthropicMessagesRequest({ ...base, tool_choice: 'required', reasoning: { effort: 'high' } }, { stream: true })).not.toHaveProperty('tool_choice')
    expect(anthropicMessagesRequest({ ...base, model: 'claude-opus-5-5', tool_choice: { type: 'function', name: 'read' }, parallel_tool_calls: false }, { stream: true }).tool_choice)
      .toEqual({ type: 'auto', disable_parallel_tool_use: true })
  })

  it('disables default thinking to force tools on models that think by default', () => {
    for (const model of ['claude-opus-5', 'claude-sonnet-5']) {
      const required = anthropicMessagesRequest({ ...base, model, tool_choice: 'required' }, { stream: true })
      expect(required.thinking).toEqual({ type: 'disabled' })
      expect(required.tool_choice).toEqual({ type: 'any' })
      const named = anthropicMessagesRequest({ ...base, model, tool_choice: { type: 'function', name: 'read' } }, { stream: true })
      expect(named.thinking).toEqual({ type: 'disabled' })
      expect(named.tool_choice).toEqual({ type: 'tool', name: 'read' })
    }
    // Explicit thinking wins over forcing.
    const thinking = anthropicMessagesRequest({ ...base, model: 'claude-opus-5', tool_choice: 'required', reasoning: { effort: 'high' } }, { stream: true })
    expect(thinking.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(thinking).not.toHaveProperty('tool_choice')
    // Auto tool choice leaves default thinking alone.
    expect(anthropicMessagesRequest({ ...base, model: 'claude-opus-5', tool_choice: 'auto' }, { stream: true })).not.toHaveProperty('thinking')
    // Forcing without tools changes nothing.
    expect(anthropicMessagesRequest({ model: 'claude-opus-5', input: 'q', tool_choice: 'required' }, { stream: true })).not.toHaveProperty('thinking')
  })

  it('downgrades forced tool use to auto on always-thinking models without disabling thinking', () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-1']) {
      const body = anthropicMessagesRequest({ ...base, model, tool_choice: 'required' }, { stream: true })
      expect(body).not.toHaveProperty('thinking')
      expect(body).not.toHaveProperty('tool_choice')
    }
  })

  it('drops custom sampling whenever thinking is on', () => {
    const body = anthropicMessagesRequest({ model: 'claude-sonnet-4-6', input: 'q', temperature: 0.3, reasoning: { effort: 'low' } }, { stream: true })
    expect(body).not.toHaveProperty('temperature')
    expect(anthropicMessagesRequest({ model: 'claude-sonnet-4-6', input: 'q', temperature: 0.3 }, { stream: true }).temperature).toBe(0.3)
  })
})
