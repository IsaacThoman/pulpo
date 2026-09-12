import OpenAI from 'openai'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import type { Context, Model } from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'
import { agentSamplingParameters } from '../agent/model-parameters.js'
import { providerPromptCacheParameters } from './provider-cache.js'

const baseURL = 'https://openrouter.ai/api/v1'
const model: Model<'openai-responses'> = {
  id: 'anthropic/claude-sonnet-4.6', name: 'Claude', api: 'openai-responses',
  provider: 'openai', baseUrl: baseURL, reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000, maxTokens: 1024,
}

function mockTransport(cachedTokens: number, cacheWriteTokens: number) {
  const payloads: Array<Record<string, unknown>> = []
  const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
    payloads.push(JSON.parse(String(init?.body)))
    const event = {
      type: 'response.completed',
      response: {
        id: 'resp_test', status: 'completed', output: [],
        usage: {
          input_tokens: 5000, output_tokens: 10, total_tokens: 5010,
          input_tokens_details: { cached_tokens: cachedTokens, cache_write_tokens: cacheWriteTokens },
        },
      },
    }
    return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    })
  })
  return { fetch, payloads }
}

describe('OpenRouter cache controls on the wire', () => {
  it.each(['auto', 'enabled', 'disabled'] as const)('sends chat caching mode %s through the OpenAI Responses client', async (mode) => {
    const transport = mockTransport(0, 4800)
    const client = new OpenAI({ apiKey: 'test', baseURL, fetch: transport.fetch })
    const stream = await client.responses.create({
      ...providerPromptCacheParameters(baseURL, model.id, mode, { cache_control: { type: 'ephemeral' } }),
      model: model.id, input: 'Hello', stream: true, store: false,
    })
    for await (const event of stream) {
      expect(event.type).toBe('response.completed')
    }
    expect(transport.payloads[0]?.cache_control).toEqual(mode === 'disabled' ? undefined : { type: 'ephemeral' })
  })

  it.each(['auto', 'enabled', 'disabled'] as const)('preserves agent cache mode %s and usage after a tool result', async (mode) => {
    const read = mode === 'disabled' ? 0 : 4800
    const written = mode === 'disabled' ? 0 : 100
    const transport = mockTransport(read, written)
    const context: Context = {
      systemPrompt: 'Use tools to investigate.',
      messages: [
        { role: 'user', content: 'Inspect the project', timestamp: 1 },
        {
          role: 'assistant', content: [{ type: 'toolCall', id: 'call_test', name: 'read_file', arguments: { path: 'README.md' } }],
          api: model.api, provider: model.provider, model: model.id, stopReason: 'toolUse', timestamp: 2,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        },
        { role: 'toolResult', toolCallId: 'call_test', toolName: 'read_file', content: [{ type: 'text', text: 'Project documentation' }], isError: false, timestamp: 3 },
      ],
    }
    const result = await openAIResponsesApi().streamSimple(model, context, {
      apiKey: 'test', fetch: transport.fetch,
      samplingParams: agentSamplingParameters(baseURL, providerPromptCacheParameters(baseURL, model.id, mode, { cache_control: { type: 'ephemeral' } })),
    }).result()
    expect(transport.payloads[0]?.cache_control).toEqual(mode === 'disabled' ? undefined : { type: 'ephemeral' })
    expect(result.stopReason).toBe('stop')
    expect(result.usage).toMatchObject({ input: 5000 - read - written, cacheRead: read, cacheWrite: written, totalTokens: 5010 })
    expect(transport.payloads[0]).toMatchObject({
      input: expect.arrayContaining([expect.objectContaining({ type: 'function_call_output', output: 'Project documentation' })]),
    })
  })
})
