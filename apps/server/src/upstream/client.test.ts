import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const MASTER_KEY = 'a sufficiently long deployment master key for tests'
vi.mock('../config.js', () => ({ getConfig: () => ({ ENCRYPTION_KEY: 'a sufficiently long deployment master key for tests' }) }))

import { encryptSecret } from '../lib/crypto.js'
import { collectResponse, createUpstreamTextClient, providerApiFormat, withoutPulpoReasoning, type UpstreamProvider } from './client.js'
import type { ResponsesStreamEvent } from './responses-builder.js'

type Recorded = { method: string; url: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }

const chatChunks = [
  { id: 'chatcmpl-9', model: 'gpt-up', choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
  { id: 'chatcmpl-9', model: 'gpt-up', choices: [{ index: 0, delta: { reasoning_content: 'hmm' } }] },
  { id: 'chatcmpl-9', model: 'gpt-up', choices: [{ index: 0, delta: { content: 'Hi ' } }] },
  { id: 'chatcmpl-9', model: 'gpt-up', choices: [{ index: 0, delta: { content: 'there' }, finish_reason: 'stop' }] },
  { id: 'chatcmpl-9', model: 'gpt-up', choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 2 } } },
]

const anthropicEvents = [
  { type: 'message_start', message: { id: 'msg_9', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [], stop_reason: null, usage: { input_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 0, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Bonjour' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_x', name: 'lookup', input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"z"}' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 9 } },
  { type: 'message_stop' },
]

let server: Server
let baseUrl: string
const requests: Recorded[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) as Record<string, unknown> : {} })
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        for (const chunk of chatChunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        res.end('data: [DONE]\n\n')
      } else if (req.method === 'POST' && req.url === '/v1/messages') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        for (const event of anthropicEvents) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        res.end()
      } else if (req.method === 'POST' && req.url === '/v1/responses') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 'resp_1', object: 'response', status: 'completed', output: [], usage: null }))
      } else {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end('{"error":{"message":"not found"}}')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  requests.length = 0
})

function provider(apiFormat: UpstreamProvider['apiFormat']): UpstreamProvider {
  return {
    id: 'provider-1', apiFormat, baseUrl, encryptedApiKey: encryptSecret('sk-test-key', MASTER_KEY),
    organizationId: null, projectId: null, requestTimeoutMs: 10_000,
  }
}

async function collect(stream: AsyncIterable<ResponsesStreamEvent>): Promise<ResponsesStreamEvent[]> {
  const events: ResponsesStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

const pulpoReasoning = { type: 'reasoning', id: 'rs_pulpo_1', summary: [], pulpo_format: 'anthropic_messages' }

describe('withoutPulpoReasoning', () => {
  it('drops only reasoning items produced by translated providers', () => {
    const native = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'x' }
    const body = { model: 'm', input: [{ role: 'user', content: 'hi' }, pulpoReasoning, native, null] }
    expect(withoutPulpoReasoning(body).input).toEqual([{ role: 'user', content: 'hi' }, native, null])
    const untouched = { model: 'm', input: [native] }
    expect(withoutPulpoReasoning(untouched)).toBe(untouched)
    const text = { model: 'm', input: 'hi' }
    expect(withoutPulpoReasoning(text)).toBe(text)
  })
})

describe('collectResponse', () => {
  async function* events(values: Array<{ type: string; [key: string]: unknown }>) {
    yield* values
  }

  it('returns the terminal response and throws when the stream has none', async () => {
    const response = { id: 'r', status: 'incomplete' }
    await expect(collectResponse(events([{ type: 'response.created' }, { type: 'response.incomplete', response }]))).resolves.toBe(response)
    await expect(collectResponse(events([{ type: 'response.created' }]))).rejects.toThrow('Provider stream ended without a response')
  })
})

describe('providerApiFormat', () => {
  it('defaults missing or unknown formats to openai_responses', () => {
    expect(providerApiFormat({})).toBe('openai_responses')
    expect(providerApiFormat({ apiFormat: null })).toBe('openai_responses')
    expect(providerApiFormat({ apiFormat: 'gemini' })).toBe('openai_responses')
    expect(providerApiFormat({ apiFormat: 'anthropic_messages' })).toBe('anthropic_messages')
    expect(providerApiFormat({ apiFormat: 'openai_chat_completions' })).toBe('openai_chat_completions')
  })
})

describe('createUpstreamTextClient over HTTP', () => {
  const body = {
    model: 'upstream-model',
    instructions: 'Be kind.',
    input: [{ role: 'user', content: 'hello' }, pulpoReasoning],
    max_output_tokens: 256,
    reasoning: { effort: 'low' },
    include: ['reasoning.encrypted_content'],
  }

  it('streams Chat Completions providers as Responses events', async () => {
    const client = createUpstreamTextClient(provider('openai_chat_completions'), { maxRetries: 0 })
    expect(client.format).toBe('openai_chat_completions')
    expect(client.openai).toBeUndefined()
    const events = await collect(await client.responses.create({ ...body, stream: true }, { headers: { 'x-trace': 't1' } }))
    expect(events[0]).toMatchObject({ type: 'response.created', response: { id: 'chatcmpl-9', model: 'gpt-up' } })
    const done = events.at(-1)!
    expect(done.type).toBe('response.completed')
    expect(done.response).toMatchObject({
      output_text: 'Hi there',
      output: [{ type: 'reasoning', summary: [{ text: 'hmm' }] }, { type: 'message' }],
      usage: { input_tokens: 12, output_tokens: 3, input_tokens_details: { cached_tokens: 2 } },
    })
    expect(requests).toHaveLength(1)
    const [recorded] = requests
    expect(recorded).toMatchObject({ method: 'POST', url: '/v1/chat/completions' })
    expect(recorded!.headers.authorization).toBe('Bearer sk-test-key')
    expect(recorded!.headers['x-trace']).toBe('t1')
    expect(recorded!.body).toEqual({
      model: 'upstream-model',
      messages: [{ role: 'system', content: 'Be kind.' }, { role: 'user', content: 'hello' }],
      max_tokens: 256,
      reasoning_effort: 'low',
      stream: true,
      stream_options: { include_usage: true },
    })
  })

  it('collects non-streaming Chat Completions requests', async () => {
    const client = createUpstreamTextClient(provider('openai_chat_completions'), { maxRetries: 0 })
    const response = await client.responses.create({ model: 'upstream-model', input: 'hello' })
    expect(response).toMatchObject({ status: 'completed', output_text: 'Hi there', usage: { total_tokens: 15 } })
    // Non-stream requests still stream upstream so translation stays uniform.
    expect(requests[0]!.body.stream).toBe(true)
  })

  it('streams Anthropic Messages providers as Responses events', async () => {
    const client = createUpstreamTextClient(provider('anthropic_messages'), { maxRetries: 0 })
    expect(client.format).toBe('anthropic_messages')
    const events = await collect(await client.responses.create({ ...body, model: 'claude-sonnet-4-5', stream: true }))
    const done = events.at(-1)!
    expect(done.type).toBe('response.completed')
    expect(done.response).toMatchObject({
      id: 'msg_9',
      output_text: 'Bonjour',
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'Bonjour' }] },
        { type: 'function_call', call_id: 'toolu_x', name: 'lookup', arguments: '{"q":"z"}' },
      ],
      usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 3 }, output_tokens: 9 },
    })
    const [recorded] = requests
    expect(recorded).toMatchObject({ method: 'POST', url: '/v1/messages' })
    expect(recorded!.headers['x-api-key']).toBe('sk-test-key')
    expect(recorded!.headers['anthropic-version']).toBe('2023-06-01')
    expect(recorded!.headers.authorization).toBeUndefined()
    expect(recorded!.body).toEqual({
      model: 'claude-sonnet-4-5',
      max_tokens: 256,
      system: [{ type: 'text', text: 'Be kind.' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      stream: true,
    })
  })

  it('never sends an ANTHROPIC_AUTH_TOKEN from the environment to an admin-configured endpoint', async () => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'env-token')
    try {
      const client = createUpstreamTextClient(provider('anthropic_messages'), { maxRetries: 0 })
      await client.responses.create({ model: 'claude-sonnet-4-5', input: 'hello', stream: false })
      expect(requests[0]!.headers.authorization).toBeUndefined()
      expect(requests[0]!.headers['x-api-key']).toBe('sk-test-key')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('collects non-streaming Anthropic requests', async () => {
    const client = createUpstreamTextClient(provider('anthropic_messages'), { maxRetries: 0 })
    const response = await client.responses.create({ model: 'claude-sonnet-4-5', input: 'hello', stream: false })
    expect(response).toMatchObject({ id: 'msg_9', status: 'completed', output_text: 'Bonjour', usage: { input_tokens: 10, output_tokens: 9 } })
  })

  it('sends Responses providers the original body without Pulpo reasoning items', async () => {
    const client = createUpstreamTextClient(provider('openai_responses'), { maxRetries: 0 })
    expect(client.openai).toBeDefined()
    await client.responses.create({ ...body })
    expect(requests[0]).toMatchObject({ url: '/v1/responses' })
    expect(requests[0]!.body.input).toEqual([{ role: 'user', content: 'hello' }])
    expect(requests[0]!.body.include).toEqual(['reasoning.encrypted_content'])
  })
})
