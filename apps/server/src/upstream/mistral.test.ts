import { describe, expect, it, vi } from 'vitest'
import { streamSimple } from '@earendil-works/pi-ai/api/mistral-conversations'
import type { AssistantMessage, Model } from '@earendil-works/pi-ai'

vi.mock('../config.js', () => ({ getConfig: () => ({ ENCRYPTION_KEY: 'a sufficiently long deployment master key for tests' }) }))

import { chatCompletionsRequest, translateChatStream } from './chat-completions.js'
import { mistralAgentPayload, piModelForProvider } from './pi-model.js'
import type { ResponsesStreamEvent } from './responses-builder.js'

const format = 'mistral_chat_completions' as const
const modelId = 'mistral-large-4'
const thinking = (text: string) => ({ type: 'thinking', thinking: [{ type: 'text', text }] })
const text = (value: string) => ({ type: 'text', text: value })
const delta = (content: unknown, extra = {}) => ({ id: 'cmpl_mistral', model: modelId, choices: [{ index: 0, delta: { content }, ...extra }] })
const usage = { choices: [], usage: { prompt_tokens: 20, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 5 }, completion_tokens_details: { reasoning_tokens: 8 } } }
async function* chunks(values: unknown[]) { yield* values }
async function collect(values: unknown[]) {
  const events: ResponsesStreamEvent[] = []
  for await (const event of translateChatStream(chunks(values), modelId, { format })) events.push(event)
  return events
}
function terminal(events: ResponsesStreamEvent[]) {
  return events.at(-1)!.response as { output: Record<string, unknown>[]; output_text: string; status: string; usage: unknown }
}

it('preserves nested thinking, mixed transition chunks, strings, and resumed thinking in order', async () => {
  const events = await collect([
    delta([thinking('réflé')]), delta([thinking('chir'), text('39')]), delta('1'),
    delta([thinking('verify'), text('!')], { finish_reason: 'stop' }), usage,
  ])
  const result = terminal(events)
  expect(result.output.map(item => item.type)).toEqual(['reasoning', 'message', 'reasoning', 'message'])
  expect(result.output[0]).toMatchObject({ pulpo_format: format, pulpo_model: modelId, summary: [{ text: 'réfléchir' }] })
  expect(result.output_text).toBe('391!')
  expect(result.usage).toMatchObject({ input_tokens: 20, output_tokens: 12, input_tokens_details: { cached_tokens: 5 }, output_tokens_details: { reasoning_tokens: 8 } })
  expect(events.map(event => event.sequence_number)).toEqual(events.map((_, index) => index))
  expect(events.filter(event => event.type === 'response.output_text.delta').map(event => event.delta)).toEqual(['39', '1', '!'])
})

it('replays thinking on ordinary and tool turns, drops foreign reasoning, and pairs imported tool IDs', async () => {
  const events = await collect([delta([thinking('work'), text('391')], { finish_reason: 'stop' }), usage])
  const input = [
    { role: 'user', content: 'q1' }, ...terminal(events).output,
    { role: 'user', content: 'q2' },
    { type: 'reasoning', pulpo_format: format, pulpo_model: 'other', summary: [{ text: 'foreign' }] },
    { type: 'reasoning', pulpo_format: 'openai_chat_completions', pulpo_model: modelId, summary: [{ text: 'wrong dialect' }] },
    { type: 'reasoning', pulpo_format: format, pulpo_model: modelId, summary: [{ text: 'tool plan' }] },
    { type: 'function_call', call_id: 'imported_call_1', name: 'calculate', arguments: '{}' },
    { type: 'function_call_output', call_id: 'imported_call_1', output: '391' },
  ]
  const body = chatCompletionsRequest({ model: modelId, input, reasoning: { effort: 'high' } }, { baseUrl: 'https://api.mistral.ai/v1', stream: true, format })
  const messages = body.messages as Array<{ role: string; content?: unknown; tool_calls?: Array<{ id: string }>; tool_call_id?: string }>
  expect(messages[1]).toEqual({ role: 'assistant', content: [thinking('work'), text('391')] })
  expect(messages[3]).toMatchObject({ role: 'assistant', content: [thinking('tool plan')] })
  expect(messages[3]!.tool_calls![0]!.id).toMatch(/^[a-zA-Z0-9]{9}$/)
  expect(messages[4]!.tool_call_id).toBe(messages[3]!.tool_calls![0]!.id)
  expect(JSON.stringify(messages)).not.toMatch(/foreign|wrong dialect|reasoning_content/)
  expect(body.reasoning_effort).toBe('high')
})

it('handles off, null content, tool-only turns, and fragmented parallel tool arguments', async () => {
  const events = await collect([
    delta(null),
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call00001', function: { name: 'a', arguments: '{"x":' } }, { index: 1, id: 'call00002', function: { name: 'b', arguments: '{}' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] }, finish_reason: 'tool_calls' }] }, usage,
  ])
  expect(terminal(events).output).toMatchObject([{ type: 'function_call', call_id: 'call00001', arguments: '{"x":1}' }, { type: 'function_call', call_id: 'call00002', arguments: '{}' }])
  expect(terminal(await collect([delta('391', { finish_reason: 'stop' }), usage])).output_text).toBe('391')
})

it('fails explicitly on unsupported content while reporting usage, and rejects unfinished streams', async () => {
  const events: ResponsesStreamEvent[] = []
  await expect((async () => {
    for await (const event of translateChatStream(chunks([usage, delta([{ type: 'unexpected', secret: 'private content' }])]), modelId, { format })) events.push(event)
  })()).rejects.toThrow('Unsupported Mistral content chunk')
  expect(JSON.stringify(events)).not.toContain('private content')
  expect(events.at(-1)).toMatchObject({ type: 'response.in_progress', response: { usage: { output_tokens: 12 } } })
  await expect(collect([delta([thinking('partial')])])).rejects.toThrow('before the response finished')
})

describe('native Pi agent Mistral adapter', () => {
  const pi = piModelForProvider({ upstreamModelId: modelId, name: 'Mistral Large 4', contextWindow: 1_000_000, maxOutputTokens: 131072 }, { apiFormat: format, baseUrl: 'https://api.mistral.ai/v1/' }) as Model<'mistral-conversations'>
  it('selects the native adapter and serializes only the configured effort', () => {
    expect(pi).toMatchObject({ api: 'mistral-conversations', provider: 'mistral', baseUrl: 'https://api.mistral.ai' })
    expect(mistralAgentPayload({ maxTokens: 100 }, { reasoning: { effort: 'none' }, temperature: 0.3 })).toEqual({ maxTokens: 100, reasoningEffort: 'none', temperature: 0.3 })
    expect(() => mistralAgentPayload({}, { reasoning: { effort: 'medium' } })).toThrow('none or high')
  })
  it('streams split UTF-8 SSE and replays thinking, text, and a tool result in native shape', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetchMock: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init!.body)) })
      const values = requests.length === 1 ? [
        delta([thinking('réfléchir'), text('Checking.')]),
        { id: 'cmpl_mistral', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call00001', function: { name: 'calculate', arguments: '{"x":' } }] } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] }, finish_reason: 'tool_calls' }] }, usage,
      ] : [delta([thinking('done'), text('391')], { finish_reason: 'stop' }), usage]
      const bytes = new TextEncoder().encode(values.map(value => `data: ${JSON.stringify(value)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n')
      return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close() } }), { headers: { 'content-type': 'text/event-stream' } })
    }
    const options = { apiKey: 'fixture-key', fetch: fetchMock, maxTokens: 100, cacheRetention: 'none' as const, onPayload: (payload: unknown) => mistralAgentPayload(payload, { reasoning: { effort: 'high' } }) }
    const context = { messages: [{ role: 'user' as const, content: 'calculate', timestamp: 1 }], tools: [{ name: 'calculate', description: 'calculate', parameters: { type: 'object', properties: { x: { type: 'number' } } } }] }
    const first = await streamSimple(pi, context, options).result()
    expect(first.stopReason).toBe('toolUse')
    expect(first.content).toMatchObject([{ type: 'thinking', thinking: 'réfléchir' }, { type: 'text', text: 'Checking.' }, { type: 'toolCall', name: 'calculate', arguments: { x: 1 } }])
    const second = await streamSimple(pi, { ...context, messages: [...context.messages, first as AssistantMessage, { role: 'toolResult', toolCallId: 'call00001', toolName: 'calculate', content: [{ type: 'text', text: '391' }], isError: false, timestamp: 2 }] }, options).result()
    expect(second.stopReason).toBe('stop')
    expect(second.content).toMatchObject([{ type: 'thinking', thinking: 'done' }, { type: 'text', text: '391' }])
    expect(requests[0]!.url).toBe('https://api.mistral.ai/v1/chat/completions')
    expect(requests[0]!.body).toMatchObject({ reasoning_effort: 'high', max_tokens: 100 })
    expect(requests[0]!.body).not.toHaveProperty('prompt_cache_key')
    expect(requests[1]!.body.messages).toMatchObject([
      { role: 'user' }, { role: 'assistant', content: [thinking('réfléchir'), text('Checking.')], tool_calls: [{ id: 'call00001' }] }, { role: 'tool', tool_call_id: 'call00001' },
    ])
  })
})
