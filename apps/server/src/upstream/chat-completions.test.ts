import type OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import {
  UpstreamStreamError,
  chatCompletionsRequest,
  chatUsage,
  openChatCompletionsStream,
  prefersMaxCompletionTokens,
  translateChatStream,
} from './chat-completions.js'
import type { ResponsesStreamEvent } from './responses-builder.js'

const OTHER = 'https://openrouter.ai/api/v1'
const OPENAI = 'https://api.openai.com/v1'

async function* chunks(items: unknown[]): AsyncGenerator<unknown> {
  for (const item of items) yield item
}

async function collect(stream: AsyncIterable<ResponsesStreamEvent>): Promise<ResponsesStreamEvent[]> {
  const events: ResponsesStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

function terminal(events: ResponsesStreamEvent[]) {
  return events.at(-1)!.response as { status: string; output: Array<Record<string, unknown>>; output_text: string; usage: Record<string, unknown> | null; incomplete_details: unknown }
}

function delta(value: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id: 'chatcmpl-1', model: 'up-model', choices: [{ index: 0, delta: value, ...extra }] }
}

function apiError(status: number, message: string, param?: string) {
  return Object.assign(new Error(`${status} ${message}`), { status, error: { message, ...(param ? { param } : {}) } })
}

describe('prefersMaxCompletionTokens', () => {
  it('matches OpenAI and Azure hosts only', () => {
    expect(prefersMaxCompletionTokens(OPENAI)).toBe(true)
    expect(prefersMaxCompletionTokens('https://x.openai.azure.com/openai')).toBe(true)
    expect(prefersMaxCompletionTokens('https://x.services.ai.azure.com')).toBe(true)
    expect(prefersMaxCompletionTokens(OTHER)).toBe(false)
    expect(prefersMaxCompletionTokens('not a url')).toBe(false)
  })
})

describe('chatCompletionsRequest', () => {
  it('hoists instructions and developer/system messages into one leading system message', () => {
    const body = chatCompletionsRequest({
      model: 'm',
      instructions: 'Be brief.',
      input: [
        { role: 'user', content: 'hi' },
        { role: 'developer', content: [{ type: 'input_text', text: 'Dev rule.' }] },
        { type: 'message', role: 'system', content: 'Sys rule.' },
        { role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] },
      ],
    }, { baseUrl: OTHER, stream: false })
    expect(body.messages).toEqual([
      { role: 'system', content: 'Be brief.\n\nDev rule.\n\nSys rule.' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
    expect(body.stream).toBe(false)
    expect(body).not.toHaveProperty('stream_options')
  })

  it('collapses text-only user content and maps images and files', () => {
    const text = Buffer.from('a,b\n1,2').toString('base64')
    const body = chatCompletionsRequest({
      model: 'm',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'one' }, { type: 'input_text', text: 'two' }] },
        { role: 'user', content: [
          { type: 'input_text', text: 'look' },
          { type: 'input_image', image_url: 'https://img/x.png', detail: 'high' },
          { type: 'input_file', filename: 'data.csv', file_data: `data:text/csv;base64,${text}` },
          { type: 'input_file', filename: 'doc.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' },
          { type: 'input_file', file_id: 'file-1' },
        ] },
      ],
    }, { baseUrl: OTHER, stream: false })
    const messages = body.messages as Array<Record<string, unknown>>
    expect(messages[0]).toEqual({ role: 'user', content: 'one\ntwo' })
    expect(messages[1]!.content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'https://img/x.png', detail: 'high' } },
      { type: 'text', text: 'File data.csv:\na,b\n1,2' },
      { type: 'file', file: { filename: 'doc.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' } },
      { type: 'file', file: { file_id: 'file-1' } },
    ])
  })

  it('merges assistant text with following tool calls and maps outputs to tool messages', () => {
    const body = chatCompletionsRequest({
      model: 'm',
      input: [
        { role: 'user', content: 'weather?' },
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'think' }], pulpo_format: 'openai_chat_completions' },
        { role: 'assistant', content: 'Checking.' },
        { type: 'function_call', call_id: 'c1', name: 'weather', arguments: '{"city":"a"}' },
        { type: 'function_call', call_id: 'c2', name: 'snapshot', arguments: '' },
        { type: 'function_call_output', call_id: 'c1', output: 'sunny' },
        { type: 'function_call_output', call_id: 'c2', output: [{ type: 'input_image', image_url: 'data:image/png;base64,AA==' }] },
        { role: 'assistant', content: 'Done.' },
      ],
    }, { baseUrl: OTHER, stream: false })
    expect(body.messages).toEqual([
      { role: 'user', content: 'weather?' },
      { role: 'assistant', content: 'Checking.', tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'weather', arguments: '{"city":"a"}' } },
        { id: 'c2', type: 'function', function: { name: 'snapshot', arguments: '{}' } },
      ] },
      { role: 'tool', tool_call_id: 'c1', content: 'sunny' },
      { role: 'tool', tool_call_id: 'c2', content: '[image output follows]' },
      { role: 'user', content: [
        { type: 'text', text: 'Images returned by the tool calls above:' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
      ] },
      { role: 'assistant', content: 'Done.' },
    ])
  })

  it('starts an assistant message with null content for bare tool calls', () => {
    const body = chatCompletionsRequest({
      model: 'm',
      input: [{ role: 'user', content: 'go' }, { type: 'function_call', call_id: 'c', name: 'f', arguments: { a: 1 } }],
    }, { baseUrl: OTHER, stream: false })
    expect((body.messages as unknown[])[1]).toEqual({ role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }] })
  })

  it('maps tools, tool_choice, and parallel_tool_calls', () => {
    const tools = [
      { type: 'function', name: 'f', description: 'does f', parameters: { type: 'object' }, strict: true },
      { type: 'web_search' },
    ]
    const auto = chatCompletionsRequest({ model: 'm', input: 'x', tools, tool_choice: 'required', parallel_tool_calls: false }, { baseUrl: OTHER, stream: false })
    expect(auto.tools).toEqual([{ type: 'function', function: { name: 'f', description: 'does f', parameters: { type: 'object' }, strict: true } }])
    expect(auto.tool_choice).toBe('required')
    expect(auto.parallel_tool_calls).toBe(false)
    const named = chatCompletionsRequest({ model: 'm', input: 'x', tools, tool_choice: { type: 'function', name: 'f' } }, { baseUrl: OTHER, stream: false })
    expect(named.tool_choice).toEqual({ type: 'function', function: { name: 'f' } })
    const none = chatCompletionsRequest({ model: 'm', input: 'x', tool_choice: 'auto', parallel_tool_calls: true }, { baseUrl: OTHER, stream: false })
    expect(none).not.toHaveProperty('tools')
    expect(none).not.toHaveProperty('tool_choice')
    expect(none).not.toHaveProperty('parallel_tool_calls')
  })

  it('maps structured output formats, reasoning effort, and verbosity', () => {
    const schema = chatCompletionsRequest({
      model: 'm', input: 'x', reasoning: { effort: 'high', summary: 'auto' },
      text: { verbosity: 'low', format: { type: 'json_schema', name: 'out', schema: { type: 'object' }, strict: true, description: 'd' } },
    }, { baseUrl: OTHER, stream: false })
    expect(schema.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'out', schema: { type: 'object' }, description: 'd', strict: true } })
    expect(schema.reasoning_effort).toBe('high')
    expect(schema.verbosity).toBe('low')
    expect(schema).not.toHaveProperty('reasoning')
    expect(schema).not.toHaveProperty('text')
    const object = chatCompletionsRequest({ model: 'm', input: 'x', text: { format: { type: 'json_object' } } }, { baseUrl: OTHER, stream: false })
    expect(object.response_format).toEqual({ type: 'json_object' })
    const plain = chatCompletionsRequest({ model: 'm', input: 'x', text: { format: { type: 'text' } } }, { baseUrl: OTHER, stream: false })
    expect(plain).not.toHaveProperty('response_format')
  })

  it('picks the token limit key by host and streams with usage', () => {
    const openai = chatCompletionsRequest({ model: 'm', input: 'x', max_output_tokens: 100 }, { baseUrl: OPENAI, stream: true })
    expect(openai.max_completion_tokens).toBe(100)
    expect(openai).not.toHaveProperty('max_tokens')
    expect(openai).toMatchObject({ stream: true, stream_options: { include_usage: true } })
    const other = chatCompletionsRequest({ model: 'm', input: 'x', max_output_tokens: 100 }, { baseUrl: OTHER, stream: true })
    expect(other.max_tokens).toBe(100)
    expect(other).not.toHaveProperty('max_completion_tokens')
    expect(other).not.toHaveProperty('max_output_tokens')
  })

  it('passes admin parameters through and drops Responses-only keys', () => {
    const body = chatCompletionsRequest({
      model: 'm', input: 'x', temperature: 0.2, top_p: 0.9, top_k: 40, repetition_penalty: 1.1,
      include: ['reasoning.encrypted_content'], truncation: 'auto', store: false, background: true, prompt_cache_retention: '24h',
      metadata: { a: 'b' }, previous_response_id: 'r', service_tier: 'flex', prompt_cache_key: 'k', safety_identifier: 'u',
      cache_control: { type: 'ephemeral' }, undefined_value: undefined,
    }, { baseUrl: OTHER, stream: false })
    expect(body).toMatchObject({
      model: 'm', temperature: 0.2, top_p: 0.9, top_k: 40, repetition_penalty: 1.1,
      service_tier: 'flex', prompt_cache_key: 'k', safety_identifier: 'u', cache_control: { type: 'ephemeral' },
    })
    for (const key of ['include', 'truncation', 'store', 'background', 'prompt_cache_retention', 'metadata', 'previous_response_id', 'input', 'instructions', 'undefined_value']) {
      expect(body).not.toHaveProperty(key)
    }
  })
})

describe('chatUsage', () => {
  it('returns null without usage and reads OpenAI, OpenRouter, and DeepSeek details', () => {
    expect(chatUsage(undefined)).toBeNull()
    expect(chatUsage({
      prompt_tokens: 100, completion_tokens: 20, cost: 0.5,
      prompt_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 5 },
    })).toEqual({
      input_tokens: 100, input_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 },
      output_tokens: 20, output_tokens_details: { reasoning_tokens: 5 }, total_tokens: 120, cost: 0.5,
    })
    expect(chatUsage({ prompt_tokens: 50, completion_tokens: 1, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 10 }))
      .toMatchObject({ input_tokens: 50, input_tokens_details: { cached_tokens: 40 } })
  })
})

describe('translateChatStream', () => {
  it('translates text deltas and a usage chunk into a completed response', async () => {
    const events = await collect(translateChatStream(chunks([
      delta({ role: 'assistant', content: '' }),
      delta({ content: 'Hel' }),
      delta({ content: 'lo' }, { finish_reason: 'stop' }),
      { id: 'chatcmpl-1', choices: [], usage: { prompt_tokens: 9, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } } },
    ]), 'pulpo-model'))
    expect(events[0]).toMatchObject({ type: 'response.created', response: { id: 'chatcmpl-1', model: 'up-model' } })
    expect(events.filter((event) => event.type === 'response.output_text.delta').map((event) => event.delta)).toEqual(['Hel', 'lo'])
    expect(events.filter((event) => event.type === 'response.created')).toHaveLength(1)
    const response = terminal(events)
    expect(events.at(-1)!.type).toBe('response.completed')
    expect(response.output_text).toBe('Hello')
    expect(response.usage).toMatchObject({ input_tokens: 9, output_tokens: 2, input_tokens_details: { cached_tokens: 4 } })
    expect(events.map((event) => event.sequence_number)).toEqual(events.map((_, index) => index))
  })

  it('turns reasoning_content and reasoning deltas into reasoning items, splitting when reasoning resumes after text', async () => {
    const events = await collect(translateChatStream(chunks([
      delta({ reasoning_content: 'first ' }),
      delta({ reasoning: 'thought' }),
      delta({ content: 'answer' }),
      delta({ reasoning_content: 'second' }),
      delta({ content: ' more' }),
    ]), 'm'))
    const response = terminal(events)
    expect(response.output.map((item) => item.type)).toEqual(['reasoning', 'message', 'reasoning', 'message'])
    expect(response.output[0]).toMatchObject({ summary: [{ type: 'summary_text', text: 'first thought' }], pulpo_format: 'openai_chat_completions', pulpo_model: 'm' })
    expect(response.output[2]).toMatchObject({ summary: [{ type: 'summary_text', text: 'second' }] })
    expect(response.output_text).toBe('answer more')
    // The first reasoning item is done before the first text delta.
    const firstDone = events.findIndex((event) => event.type === 'response.output_item.done' && (event.item as { type: string }).type === 'reasoning')
    const firstText = events.findIndex((event) => event.type === 'response.output_text.delta')
    expect(firstDone).toBeLessThan(firstText)
  })

  it('assembles parallel tool calls whose deltas are split across chunks', async () => {
    const events = await collect(translateChatStream(chunks([
      delta({ reasoning_content: 'plan' }),
      delta({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'alpha', arguments: '' } }] }),
      delta({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'beta', arguments: '{"y"' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '{"x":' } }] }),
      delta({ tool_calls: [{ index: 1, function: { arguments: ':2}' } }, { index: 0, function: { arguments: '1}' } }] }, { finish_reason: 'tool_calls' }),
    ]), 'm'))
    const response = terminal(events)
    expect(response.status).toBe('completed')
    expect(response.output).toMatchObject([
      { type: 'reasoning' },
      { type: 'function_call', call_id: 'call_a', name: 'alpha', arguments: '{"x":1}', status: 'completed' },
      { type: 'function_call', call_id: 'call_b', name: 'beta', arguments: '{"y":2}', status: 'completed' },
    ])
    const argumentDone = events.filter((event) => event.type === 'response.function_call_arguments.done')
    expect(argumentDone.map((event) => event.arguments)).toEqual(['{"x":1}', '{"y":2}'])
  })

  it('reports OpenRouter cost and reasoning tokens', async () => {
    const events = await collect(translateChatStream(chunks([
      delta({ content: 'x' }),
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 8, cost: 0.0012, completion_tokens_details: { reasoning_tokens: 6 } } },
    ]), 'm'))
    expect(terminal(events).usage).toMatchObject({ cost: 0.0012, output_tokens_details: { reasoning_tokens: 6 }, total_tokens: 18 })
  })

  it('maps length and content_filter finish reasons to incomplete responses', async () => {
    const length = await collect(translateChatStream(chunks([delta({ content: 'cut' }, { finish_reason: 'length' })]), 'm'))
    expect(length.at(-1)!.type).toBe('response.incomplete')
    expect(terminal(length)).toMatchObject({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })
    const filtered = await collect(translateChatStream(chunks([delta({}, { finish_reason: 'content_filter' })]), 'm'))
    expect(terminal(filtered)).toMatchObject({ status: 'incomplete', incomplete_details: { reason: 'content_filter' } })
  })

  it('streams refusals and ignores choices other than index 0', async () => {
    const events = await collect(translateChatStream(chunks([
      { choices: [{ index: 1, delta: { content: 'ignored' } }, { index: 0, delta: { refusal: 'no' } }] },
    ]), 'm'))
    expect(terminal(events).output).toMatchObject([{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }])
    expect(terminal(events).output_text).toBe('')
  })

  it('throws chunk errors as UpstreamStreamError', async () => {
    const stream = translateChatStream(chunks([delta({ content: 'x' }), { error: { message: 'overloaded', code: 502, type: 'server_error' } }]), 'm')
    const error = await collect(stream).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(UpstreamStreamError)
    expect(error).toMatchObject({ message: 'overloaded', status: 502, type: 'server_error' })
    const coded = await collect(translateChatStream(chunks([{ error: { code: 'bad', status: 400 } }]), 'm')).catch((caught: unknown) => caught)
    expect(coded).toMatchObject({ message: 'Provider stream failed', status: 400, code: 'bad' })
  })
})

describe('openChatCompletionsStream', () => {
  function client(create: ReturnType<typeof vi.fn>) {
    return { chat: { completions: { create } } } as unknown as OpenAI
  }
  const payload = { model: 'm', input: 'hi', max_output_tokens: 50, reasoning: { effort: 'low' } }

  it('swaps max_tokens for max_completion_tokens when the server rejects it', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const create = vi.fn()
      .mockRejectedValueOnce(apiError(400, "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", 'max_tokens'))
      .mockResolvedValueOnce(chunks([delta({ content: 'ok' })]))
    const signal = new AbortController().signal
    const events = await collect(await openChatCompletionsStream(client(create), payload, { baseUrl: OTHER, signal, headers: { 'x-a': '1' } }))
    expect(terminal(events).output_text).toBe('ok')
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[0]![0]).toMatchObject({ max_tokens: 50, stream: true })
    expect(create.mock.calls[1]![0]).toMatchObject({ max_completion_tokens: 50 })
    expect(create.mock.calls[1]![0]).not.toHaveProperty('max_tokens')
    expect(create.mock.calls[1]![1]).toEqual({ signal, headers: { 'x-a': '1' } })
  })

  it('drops an optional parameter named in a 400 message', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const create = vi.fn()
      .mockRejectedValueOnce(apiError(400, 'Unrecognized request argument supplied: reasoning_effort'))
      .mockResolvedValueOnce(chunks([]))
    await openChatCompletionsStream(client(create), payload, { baseUrl: OTHER })
    expect(create.mock.calls[0]![0]).toHaveProperty('reasoning_effort', 'low')
    expect(create.mock.calls[1]![0]).not.toHaveProperty('reasoning_effort')
    expect(create.mock.calls[1]![0]).toHaveProperty('max_tokens', 50)
  })

  it('rethrows non-400 errors and 400s about required parameters', async () => {
    const serverError = apiError(500, 'reasoning_effort exploded')
    await expect(openChatCompletionsStream(client(vi.fn().mockRejectedValue(serverError)), payload, { baseUrl: OTHER })).rejects.toBe(serverError)
    const required = apiError(400, "Invalid value for 'messages'", 'messages')
    const create = vi.fn().mockRejectedValue(required)
    await expect(openChatCompletionsStream(client(create), payload, { baseUrl: OTHER })).rejects.toBe(required)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('gives up after the retry limit', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const create = vi.fn()
      .mockRejectedValueOnce(apiError(400, 'temperature unsupported'))
      .mockRejectedValueOnce(apiError(400, 'top_p unsupported'))
      .mockRejectedValueOnce(apiError(400, 'reasoning_effort unsupported'))
      .mockRejectedValueOnce(apiError(400, 'stream_options unsupported'))
      .mockRejectedValueOnce(apiError(400, 'max_tokens unsupported'))
    await expect(openChatCompletionsStream(client(create), { ...payload, temperature: 1, top_p: 1 }, { baseUrl: OTHER }))
      .rejects.toThrow('max_tokens unsupported')
    expect(create).toHaveBeenCalledTimes(5)
  })
})
