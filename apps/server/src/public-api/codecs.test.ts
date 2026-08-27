import { describe, expect, it } from 'vitest'
import type { ResponseEvent } from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'
import {
  ChatCompletionStreamProjector,
  LegacyCompletionStreamProjector,
  ResponsesStreamProjector,
  parseChatCompletionRequest,
  parseCompletionRequest,
  parseResponsesRequest,
  serializeChatCompletion,
  serializeCompletion,
  serializePublicResponse,
} from './codecs.js'

const createdAt = new Date('2026-08-27T12:00:00.000Z')

function responseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    chatId: '00000000-0000-4000-8000-000000000002',
    userId: '00000000-0000-4000-8000-000000000003',
    modelId: 'model-1',
    actualModelId: 'model-1',
    origin: 'api',
    pricingVersionId: null,
    openaiResponseId: null,
    previousResponseId: null,
    parentResponseId: null,
    userMessageId: null,
    branchReason: 'message',
    status: 'completed',
    executionMode: 'stream',
    agentMode: false,
    agentCapacityAction: null,
    input: [],
    instructions: null,
    presetSelections: {},
    parameters: {},
    metadata: { trace: 'public' },
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello' }] }],
    usage: { inputTokens: 4, cachedInputTokens: 1, cacheWriteTokens: 2, outputTokens: 3, reasoningTokens: 1, totalTokens: 7 },
    error: null,
    incompleteDetails: null,
    lastSequence: 0,
    upstreamSequence: 0,
    idempotencyKey: null,
    idempotencyScope: 'api:key:chat_completions',
    idempotencyFingerprint: null,
    startedAt: createdAt,
    completedAt: createdAt,
    deletedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  } as never
}

function event(sequence: number, type: string, payload: Record<string, unknown>): ResponseEvent {
  return { responseId: '00000000-0000-4000-8000-000000000001', sequence, type, payload, emittedAt: createdAt.toISOString() }
}

function expectUnsupported(invoke: () => unknown, param: string): void {
  try {
    invoke()
    throw new Error('Expected unsupported parameter error')
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ statusCode: 400, code: 'unsupported_parameter', param })
  }
}

describe('Chat Completions input codec', () => {
  it('converts roles, images, function calls/results, tools, and structured output', () => {
    const parsed = parseChatCompletionRequest({
      model: 'model-1',
      messages: [
        { role: 'developer', content: 'Be concise' },
        { role: 'system', content: 'Follow policy' },
        { role: 'user', content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.png', detail: 'high' } },
        ] },
        { role: 'assistant', content: [{ type: 'text', text: 'I will check.' }] },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"id":1}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: [{ type: 'text', text: '{"name":"octopus"}' }] },
      ],
      tools: [{ type: 'function', function: { name: 'lookup', description: 'Lookup', parameters: { type: 'object' }, strict: true } }],
      tool_choice: { type: 'function', function: { name: 'lookup' } },
      response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: { type: 'object' }, strict: true } },
      max_completion_tokens: 123,
      reasoning_effort: 'high',
      service_tier: 'flex',
      parallel_tool_calls: false,
      stream: true,
      stream_options: { include_usage: true },
    })

    expect(parsed).toMatchObject({
      protocol: 'chat_completions', model: 'model-1', maxOutputTokens: 123,
      stream: true, streamIncludeUsage: true,
      parameters: {
        reasoning: { effort: 'high' }, service_tier: 'flex', parallel_tool_calls: false,
        tool_choice: { type: 'function', name: 'lookup' },
        text: { format: { type: 'json_schema', name: 'answer', strict: true } },
      },
    })
    expect(parsed.rawInput).toEqual([
      { role: 'developer', content: 'Be concise' },
      { role: 'system', content: 'Follow policy' },
      { role: 'user', content: [
        { type: 'input_text', text: 'What is this?' },
        { type: 'input_image', image_url: 'https://example.com/image.png', detail: 'high' },
      ] },
      { role: 'assistant', content: 'I will check.' },
      { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"id":1}' },
      { type: 'function_call_output', call_id: 'call_1', output: '{"name":"octopus"}' },
    ])
  })

  it('accepts the deprecated max_tokens alias but rejects both token limits together', () => {
    expect(parseChatCompletionRequest({ model: 'm', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }).maxOutputTokens).toBe(10)
    expect(() => parseChatCompletionRequest({
      model: 'm', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10, max_completion_tokens: 10,
    })).toThrowError(expect.objectContaining({ code: 'parameter_conflict', param: 'max_completion_tokens' }))
  })

  it('rejects every explicitly unsupported Chat Completions parameter', () => {
    const base = { model: 'm', messages: [{ role: 'user', content: 'hi' }] }
    for (const [param, value] of [
      ['audio', {}], ['functions', []], ['function_call', 'auto'], ['logprobs', true], ['top_logprobs', 1],
      ['stop', ['END']], ['presence_penalty', 1], ['frequency_penalty', 1], ['seed', 1],
      ['prediction', {}], ['modalities', ['audio']],
    ] as const) expectUnsupported(() => parseChatCompletionRequest({ ...base, [param]: value }), param)
    expectUnsupported(() => parseChatCompletionRequest({ ...base, n: 2 }), 'n')
    expectUnsupported(() => parseChatCompletionRequest({ ...base, store: true }), 'store')
    expectUnsupported(() => parseChatCompletionRequest({ ...base, tools: [{ type: 'custom', custom: {} }] }), 'tools.0.type')
    expectUnsupported(() => parseChatCompletionRequest({
      model: 'm', messages: [{ role: 'user', content: [{ type: 'audio', audio: {} }] }],
    }), 'messages.0.content.0.type')
    expectUnsupported(() => parseChatCompletionRequest({
      model: 'm', messages: [{ role: 'user', content: [{ type: 'file', file: {} }] }],
    }), 'messages.0.content.0.type')
  })
})

describe('legacy Completions input codec', () => {
  it('converts the supported request surface', () => {
    expect(parseCompletionRequest({ model: 'm', prompt: 'hello', n: 1, max_tokens: 8, temperature: 0.2, top_p: 0.9, stream: true }))
      .toMatchObject({ protocol: 'completions', rawInput: 'hello', maxOutputTokens: 8, stream: true, parameters: { temperature: 0.2, top_p: 0.9 } })
  })

  it('rejects arrays, multiple choices, and legacy-only behavior', () => {
    expectUnsupported(() => parseCompletionRequest({ model: 'm', prompt: ['one', 'two'] }), 'prompt')
    expectUnsupported(() => parseCompletionRequest({ model: 'm', prompt: [1, 2, 3] }), 'prompt')
    expectUnsupported(() => parseCompletionRequest({ model: 'm', prompt: 'hi', n: 2 }), 'n')
    for (const [param, value] of [
      ['best_of', 2], ['echo', true], ['suffix', 'end'], ['logprobs', 1], ['stop', 'END'],
      ['presence_penalty', 1], ['frequency_penalty', 1], ['seed', 1],
    ] as const) expectUnsupported(() => parseCompletionRequest({ model: 'm', prompt: 'hi', [param]: value }), param)
  })
})

describe('public response serialization', () => {
  it('persists metadata and withholds compaction continuation context', () => {
    const serialized = serializePublicResponse(responseRow({ output: [{
      type: 'pulpo_compaction', summary: 'safe', retained_context: [{ secret: true }], retained_context_turns: [{ secret: true }],
    }] }))
    expect(serialized.metadata).toEqual({ trace: 'public' })
    expect(serialized.output).toEqual([{ type: 'pulpo_compaction', summary: 'safe', retained_context: [], retained_context_turns: [] }])
  })

  it('maps text, tools, usage, and terminal finish reasons', () => {
    const chat = serializeChatCompletion(responseRow({
      parameters: { service_tier: 'flex' },
      output: [{ type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"id":1}' }],
    }))
    expect(chat).toMatchObject({
      object: 'chat.completion', service_tier: 'flex',
      choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'call_1', function: { name: 'lookup' } }] } }],
      usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
    })
    expect(serializeCompletion(responseRow({ status: 'incomplete', incompleteDetails: { reason: 'max_output_tokens' } })))
      .toMatchObject({ object: 'text_completion', choices: [{ text: 'Hello', finish_reason: 'length' }] })
  })
})

describe('completion streaming projections', () => {
  it('projects Responses events with Pulpo identity and a single terminal event', () => {
    const projector = new ResponsesStreamProjector(responseRow())
    expect(projector.project(event(1, 'response.created', {
      type: 'response.created', response: { id: 'provider-id', model: 'provider-model', status: 'in_progress', output: [] },
    }))).toMatchObject([{ response: { id: '00000000-0000-4000-8000-000000000001', model: 'model-1', metadata: { trace: 'public' } } }])
    expect(projector.project(event(2, 'response.completed', {
      type: 'response.completed', response: { id: 'provider-id', model: 'provider-model', status: 'completed', output: [] },
    }))).toHaveLength(1)
    expect(projector.finish(responseRow())).toEqual([])
  })

  it('projects role, text, tool argument deltas, finish reason, usage, and only one terminal sequence', () => {
    const projector = new ChatCompletionStreamProjector(responseRow(), true)
    const projected = [
      ...projector.project(event(1, 'response.output_text.delta', { delta: 'Hi' })),
      ...projector.project(event(2, 'response.output_item.added', { output_index: 1, item: { id: 'item_1', call_id: 'call_1', type: 'function_call', name: 'lookup' } })),
      ...projector.project(event(3, 'response.function_call_arguments.delta', { output_index: 1, item_id: 'item_1', delta: '{"id":1}' })),
      ...projector.project(event(4, 'response.completed', { response: { status: 'completed', usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 } } })),
    ] as Array<Record<string, unknown>>
    expect(projected).toHaveLength(6)
    expect(projected[0]).toMatchObject({ choices: [{ delta: { role: 'assistant', content: '' } }] })
    expect(projected[1]).toMatchObject({ choices: [{ delta: { content: 'Hi' } }] })
    expect(projected[2]).toMatchObject({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'lookup' } }] } }] })
    expect(projected[3]).toMatchObject({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"id":1}' } }] } }] })
    expect(projected[4]).toMatchObject({ choices: [{ finish_reason: 'tool_calls' }] })
    expect(projected[5]).toMatchObject({ choices: [], usage: { total_tokens: 7 } })
    expect(projector.finish(responseRow())).toEqual([])
  })

  it('projects terminal errors and legacy text completion chunks', () => {
    const chat = new ChatCompletionStreamProjector(responseRow(), false)
    expect(chat.project(event(1, 'response.failed', { response: { error: { message: 'upstream failed', code: 'provider_error' } } })))
      .toEqual([])
    expect(chat.finish(responseRow({ status: 'failed', error: { message: 'all fallbacks failed', code: 'provider_error' } })))
      .toEqual([{ error: { message: 'all fallbacks failed', type: 'server_error', code: 'provider_error', param: null } }])
    const legacy = new LegacyCompletionStreamProjector(responseRow())
    expect(legacy.project(event(1, 'response.output_text.delta', { delta: 'Hi' })))
      .toMatchObject([{ object: 'text_completion', choices: [{ text: 'Hi', finish_reason: null }] }])
    expect(legacy.finish(responseRow({ status: 'incomplete', incompleteDetails: { reason: 'max_output_tokens' } })))
      .toMatchObject([{ choices: [{ text: '', finish_reason: 'length' }] }])
    expect(legacy.finish(responseRow())).toEqual([])
  })
})

describe('Responses request codec', () => {
  it('retains metadata and supported parameters', () => {
    expect(parseResponsesRequest({ model: 'm', input: 'hi', metadata: { trace: '1' }, instructions: 'Be brief', parallel_tool_calls: false }))
      .toMatchObject({ protocol: 'responses', metadata: { trace: '1' }, parameters: { instructions: 'Be brief', parallel_tool_calls: false } })
  })

  it('rejects custom tools and deferred audio/file input parts', () => {
    expectUnsupported(() => parseResponsesRequest({ model: 'm', input: 'hi', tools: [{ type: 'custom', name: 'shell' }] }), 'tools.0.type')
    expectUnsupported(() => parseResponsesRequest({
      model: 'm', input: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: '...' } }] }],
    }), 'input.0.content.0.type')
    expectUnsupported(() => parseResponsesRequest({
      model: 'm', input: [{ role: 'user', content: [{ type: 'input_file', file_id: 'file_1' }] }],
    }), 'input.0.content.0.type')
  })
})
