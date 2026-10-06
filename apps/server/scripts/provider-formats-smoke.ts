/**
 * End-to-end checks for provider API formats and the Anthropic-compatible
 * public endpoint, through the real API, PostgreSQL, Redis, and worker, with
 * local Chat Completions, Anthropic Messages, and Responses fixture providers.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { Worker } from 'bullmq'

if (new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_provider_formats_test'
  || !process.env.REDIS_URL || new URL(process.env.REDIS_URL).pathname !== '/15') {
  throw new Error('Use a migrated disposable database named pulpo_provider_formats_test and a dedicated Redis instance with database /15')
}
process.env.LOG_LEVEL = 'silent'
const { db, queryClient } = await import('../src/database/client.js')
const schema = await import('../src/database/schema.js')
const { processGeneration } = await import('../src/responses/worker.js')
const { buildApp } = await import('../src/app.js')
const { redis } = await import('../src/redis.js')
const { closeDiagnostics } = await import('../src/logging/provider-diagnostics.js')
const queues = await import('../src/jobs.js')
const { eq, desc } = await import('drizzle-orm')

type Json = Record<string, unknown>
const records = (value: unknown): Json[] => Array.isArray(value) ? value as Json[] : []
type ToolFixture = { name: string; args: Json; id?: string }
type Usage = { input: number; output: number; cacheRead?: number; cacheWrite?: number; cost?: number }
type Fixture = {
  text?: string
  reasoning?: string
  signature?: string
  tools?: ToolFixture[]
  finish?: 'stop' | 'length' | 'tool_calls' | 'content_filter'
  usage?: Usage
  errorStatus?: number
  errorBody?: Json
  /** End the stream early, without a finish reason or `message_stop`. */
  truncate?: boolean
  /** Anthropic `error` event after the first text delta. */
  streamError?: Json
}
type Recorded = { path: string; body: Json; headers: IncomingHttpHeaders }

let fixture: (request: Recorded) => Fixture = () => ({ text: 'Hello 🐙' })
const upstreamRequests: Recorded[] = []
const fixtureFailures: unknown[] = []
const halves = (value: string) => [value.slice(0, Math.ceil(value.length / 2)), value.slice(Math.ceil(value.length / 2))]

function chatStream(res: ServerResponse, body: Json, result: Fixture) {
  const id = `chatcmpl-${randomUUID()}`
  const send = (payload: Json) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: body.model, ...payload })}\n\n`)
  const delta = (value: Json, finish_reason: string | null = null) => send({ choices: [{ index: 0, delta: value, finish_reason }] })
  delta({ role: 'assistant', content: '' })
  for (const part of halves(result.reasoning ?? '')) if (part) delta({ reasoning_content: part })
  for (const part of halves(result.text ?? '')) if (part) delta({ content: part })
  if (result.truncate) return
  const tools = result.tools ?? []
  tools.forEach((tool, index) => delta({ tool_calls: [{ index, id: tool.id ?? `call_${index}_${randomUUID().slice(0, 8)}`, type: 'function', function: { name: tool.name, arguments: '' } }] }))
  // Interleave argument fragments across parallel calls.
  for (let half = 0; half < 2; half++) tools.forEach((tool, index) => delta({ tool_calls: [{ index, function: { arguments: halves(JSON.stringify(tool.args))[half] } }] }))
  delta({}, result.finish ?? (tools.length ? 'tool_calls' : 'stop'))
  const usage = result.usage ?? { input: 100, output: 20, cacheRead: 10 }
  send({ choices: [], usage: {
    prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output,
    prompt_tokens_details: { cached_tokens: usage.cacheRead ?? 0 }, completion_tokens_details: { reasoning_tokens: 5 },
    ...(usage.cost !== undefined ? { cost: usage.cost } : {}),
  } })
  res.write('data: [DONE]\n\n')
}

function anthropicStream(res: ServerResponse, body: Json, result: Fixture) {
  const send = (type: string, payload: Json) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`)
  const usage = result.usage ?? { input: 50, output: 25, cacheRead: 30, cacheWrite: 20 }
  send('message_start', { message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null,
    usage: { input_tokens: usage.input, cache_read_input_tokens: usage.cacheRead ?? 0, cache_creation_input_tokens: usage.cacheWrite ?? 0, output_tokens: 1 } } })
  let index = 0
  if (result.reasoning !== undefined) {
    send('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } })
    for (const part of halves(result.reasoning)) if (part) send('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: part } })
    send('content_block_delta', { index, delta: { type: 'signature_delta', signature: result.signature ?? 'sig-fixture' } })
    send('content_block_stop', { index }); index++
  }
  if (result.text) {
    send('content_block_start', { index, content_block: { type: 'text', text: '' } })
    for (const part of halves(result.text)) {
      send('content_block_delta', { index, delta: { type: 'text_delta', text: part } })
      if (result.streamError) { send('error', { error: result.streamError }); return }
      if (result.truncate) return
    }
    send('content_block_stop', { index }); index++
  }
  for (const tool of result.tools ?? []) {
    send('content_block_start', { index, content_block: { type: 'tool_use', id: tool.id ?? `toolu_${randomUUID().replace(/-/g, '')}`, name: tool.name, input: {} } })
    for (const part of halves(JSON.stringify(tool.args))) send('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: part } })
    send('content_block_stop', { index }); index++
  }
  const stop = result.finish === 'length' ? 'max_tokens' : result.finish === 'content_filter' ? 'refusal' : result.tools?.length ? 'tool_use' : 'end_turn'
  send('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output } })
  send('message_stop', {})
}

function responsesStream(res: ServerResponse, body: Json, result: Fixture) {
  let sequence = 0
  const send = (type: string, payload: Json) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...payload })}\n\n`)
  const response = { id: `resp_${randomUUID()}`, object: 'response', created_at: 1, model: body.model, status: 'in_progress', output: [] as Json[] }
  send('response.created', { response })
  const output: Json[] = []
  if (result.text) output.push({ type: 'message', id: `msg_${randomUUID()}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: result.text, annotations: [] }] })
  for (const tool of result.tools ?? []) output.push({ type: 'function_call', id: `fc_${randomUUID()}`, call_id: tool.id ?? `call_${randomUUID()}`, name: tool.name, arguments: JSON.stringify(tool.args), status: 'completed' })
  output.forEach((item, output_index) => send('response.output_item.added', { output_index, item: { ...item, ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) } }))
  for (let half = 0; half < 2; half++) output.forEach((item, output_index) => {
    if (item.type === 'function_call') send('response.function_call_arguments.delta', { output_index, item_id: item.id, delta: halves(String(item.arguments))[half] })
    else if (half === 0) send('response.output_text.delta', { output_index, item_id: item.id, content_index: 0, delta: result.text })
  })
  output.forEach((item, output_index) => send('response.output_item.done', { output_index, item }))
  send('response.completed', { response: { ...response, status: 'completed', output, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } })
}

const anthropicModelPages = [['claude-a', 'claude-b'], ['claude-c']]
const upstream = createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://fixture').pathname
    if (req.method === 'GET' && path === '/v1/models') {
      const after = new URL(req.url ?? '/', 'http://fixture').searchParams.get('after_id')
      res.writeHead(200, { 'content-type': 'application/json' })
      if (req.headers['x-api-key']) {
        const page = after ? 1 : 0
        const data = anthropicModelPages[page]!.map(id => ({ id, type: 'model' }))
        res.end(JSON.stringify({ data, has_more: page === 0, first_id: data[0]!.id, last_id: data.at(-1)!.id }))
      } else res.end(JSON.stringify({ object: 'list', data: [{ id: 'chat-model', object: 'model' }] }))
      return
    }
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw) as Json
    const recorded = { path, body, headers: req.headers }
    upstreamRequests.push(recorded)
    const result = fixture(recorded)
    if (result.errorStatus) {
      res.writeHead(result.errorStatus, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result.errorBody ?? { error: { message: 'Fixture upstream unavailable', type: 'server_error' } }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    if (path === '/v1/chat/completions') chatStream(res, body, result)
    else if (path === '/v1/messages') anthropicStream(res, body, result)
    else if (path === '/v1/responses') responsesStream(res, body, result)
    else throw new Error(`Unexpected fixture path ${path}`)
    res.end()
  } catch (error) { fixtureFailures.push(error); res.destroy(error as Error) }
})
upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
const upstreamBase = `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`

const app = await buildApp()
const base = await app.listen({ host: '127.0.0.1', port: 0 })
const worker = new Worker('generation', async job => processGeneration(job.data.responseId), { connection: { url: process.env.REDIS_URL! }, concurrency: 4 })
const failures: string[] = []
let passed = 0
const check = async (name: string, run: () => Promise<void>) => {
  upstreamRequests.length = 0
  fixture = () => ({ text: 'Hello 🐙' })
  try { await run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failures.push(name); console.error(`FAIL ${name}:`, error) }
}

await db.insert(schema.applicationSettings).values({ key: 'auth', value: { apiKeysEnabled: true } })
  .onConflictDoUpdate({ target: schema.applicationSettings.key, set: { value: { apiKeysEnabled: true } } })
const suffix = randomUUID().slice(0, 8)
const credentials = { name: 'Provider formats QA', username: `formats_${suffix}`, email: 'provider-formats-smoke@example.test', password: 'disposable-provider-formats-password' }
const setup = await fetch(`${base}/api/auth/setup-status`).then(r => r.json()) as { required: boolean }
const login = await fetch(`${base}/api/auth/${setup.required ? 'setup' : 'login'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) })
assert(login.ok, await login.text())
const cookie = login.headers.get('set-cookie')!.split(';')[0]!
const adminJson = async (path: string, method: string, body?: unknown) => {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  assert(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`)
  return await response.json() as Json
}

const providers: Record<string, string> = {}
for (const apiFormat of ['openai_chat_completions', 'anthropic_messages', 'openai_responses'] as const) {
  const created = await adminJson('/api/admin/providers', 'POST', { name: `${apiFormat} fixture`, apiFormat, baseUrl: upstreamBase, apiKey: `fixture-key-${apiFormat}`, cacheAffinityMode: 'none' })
  providers[apiFormat] = String(created.id)
}
const chatModel = `chat-${suffix}`
const claudeModel = `claude-${suffix}`
const responsesModel = `resp-${suffix}`
const claudeUpstream = 'claude-opus-4-8'
for (const [id, providerConnectionId, upstreamModelId] of [
  [chatModel, providers.openai_chat_completions!, 'chat-upstream-model'],
  [claudeModel, providers.anthropic_messages!, claudeUpstream],
  [responsesModel, providers.openai_responses!, 'responses-upstream-model'],
] as const) {
  await db.insert(schema.models).values({ id, providerConnectionId, upstreamModelId, name: id, contextWindow: 128000, maxOutputTokens: 4096,
    compactionEnabled: false, retryDelaySeconds: 0, maxRetries: 0, allowedParameters: ['temperature', 'reasoning'], defaultParameters: {},
    systemPrompt: 'You are the fixture model.' })
  await db.insert(schema.modelPricingVersions).values({ id: randomUUID(), modelId: id, inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0 })
}
const keyResponse = await fetch(`${base}/api/api-keys`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Formats smoke', scopes: ['responses', 'models'], allowedModels: [] }) })
assert.equal(keyResponse.status, 201)
const key = await keyResponse.json() as { id: string; secret: string }
const openai = new OpenAI({ baseURL: `${base}/v1`, apiKey: key.secret, maxRetries: 0, timeout: 20000 })
const anthropic = new Anthropic({ baseURL: base, apiKey: key.secret, maxRetries: 0, timeout: 20000 })
const readTool = { name: 'read_file', description: 'Read a file', input_schema: { type: 'object' as const, properties: { path: { type: 'string' } }, required: ['path'] } }
const lastRequest = () => upstreamRequests.at(-1)!
// Browser turns also make post-response requests (chat titles), so locate the generation itself.
const requestContaining = (text: string) => {
  const found = upstreamRequests.findLast(request => JSON.stringify(request.body).includes(text) && !JSON.stringify(request.body).includes('title'))
  assert(found, `No upstream request contained ${text}`)
  return found
}
const [keyRow] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, key.id))
const userId = keyRow!.userId

async function browserTurn(modelId: string, input: string, parentResponseId?: string, chatId = randomUUID(), agentMode = false) {
  const { createResponse } = await import('../src/responses/service.js')
  const { createChatResponseSchema } = await import('@pulpo/contracts')
  if (!parentResponseId) await db.insert(schema.chats).values({ id: chatId, userId, modelId, title: 'Formats smoke' })
  const created = await createResponse({ ownerUserId: userId, chatId, input: createChatResponseSchema.parse({ modelId, input, agentMode }) })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const [row] = await db.select().from(schema.responses).where(eq(schema.responses.id, created.id))
    if (row && ['completed', 'incomplete', 'failed', 'cancelled'].includes(row.status)) return { row, chatId }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('Browser turn did not finish')
}

try {
  await check('admin routes store the format, page Anthropic models, and check health', async () => {
    const listed = await adminJson('/api/admin/providers', 'GET')
    const formats = Object.fromEntries(records(listed.data).map(row => [row.id, row.apiFormat]))
    assert.equal(formats[providers.anthropic_messages!], 'anthropic_messages')
    assert.equal(formats[providers.openai_chat_completions!], 'openai_chat_completions')
    const refreshed = await adminJson(`/api/admin/providers/${providers.anthropic_messages}/models/refresh`, 'POST')
    assert.deepEqual(refreshed.data, ['claude-a', 'claude-b', 'claude-c'])
    const health = await adminJson(`/api/admin/providers/${providers.anthropic_messages}/health`, 'POST')
    assert.equal(health.success, true)
    const chatModels = await adminJson(`/api/admin/providers/${providers.openai_chat_completions}/models/refresh`, 'POST')
    assert.deepEqual(chatModels.data, ['chat-model'])
    const patched = await adminJson(`/api/admin/providers/${providers.openai_responses}`, 'PATCH', { apiFormat: 'openai_chat_completions' })
    assert.equal(patched.apiFormat, 'openai_chat_completions')
    await adminJson(`/api/admin/providers/${providers.openai_responses}`, 'PATCH', { apiFormat: 'openai_responses' })
    const invalid = await fetch(`${base}/api/admin/providers/${providers.openai_responses}`, { method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ apiFormat: 'gemini' }) })
    assert.equal(invalid.status, 400)
  })

  for (const stream of [false, true]) {
    await check(`chat-format provider serves OpenAI Chat Completions clients (stream=${stream})`, async () => {
      const params = { model: chatModel, messages: [{ role: 'system' as const, content: 'Be brief.' }, { role: 'user' as const, content: 'Hi' }], max_tokens: 300, temperature: 0.4 }
      let text = ''
      let usage: OpenAI.CompletionUsage | undefined
      if (stream) {
        for await (const chunk of await openai.chat.completions.create({ ...params, stream: true, stream_options: { include_usage: true } })) {
          text += chunk.choices[0]?.delta.content ?? ''
          usage = chunk.usage ?? usage
        }
      } else {
        const result = await openai.chat.completions.create(params)
        text = result.choices[0]!.message.content ?? ''
        usage = result.usage
      }
      assert.equal(text, 'Hello 🐙')
      assert.equal(usage?.prompt_tokens, 100); assert.equal(usage?.prompt_tokens_details?.cached_tokens, 10)
      const sent = lastRequest()
      assert.equal(sent.path, '/v1/chat/completions')
      assert.equal(sent.headers.authorization, 'Bearer fixture-key-openai_chat_completions')
      const messages = records(sent.body.messages)
      assert.deepEqual(messages.map(m => m.role), ['system', 'user'])
      assert.match(String(messages[0]!.content), /fixture model[\s\S]*Be brief\./)
      assert.equal(sent.body.max_tokens, 300); assert.equal(sent.body.temperature, 0.4); assert.equal(sent.body.stream, true)
      assert.deepEqual(sent.body.stream_options, { include_usage: true })
      for (const key of ['input', 'store', 'include', 'max_output_tokens', 'background']) assert(!(key in sent.body), `${key} leaked upstream`)
    })
  }

  await check('chat-format reasoning, parallel tool calls, and tool results round trip through Responses', async () => {
    fixture = () => ({ reasoning: 'Thinking about files', tools: [{ name: 'read_file', args: { path: 'a.txt' }, id: 'call_a' }, { name: 'read_file', args: { path: 'b.txt' }, id: 'call_b' }] })
    const tools = [{ type: 'function' as const, name: readTool.name, description: readTool.description, parameters: readTool.input_schema, strict: false }]
    const events: OpenAI.Responses.ResponseStreamEvent[] = []
    for await (const event of await openai.responses.create({ model: chatModel, input: 'Read both', tools, stream: true, reasoning: { effort: 'low' } })) events.push(event)
    const completed = events.find(event => event.type === 'response.completed') as OpenAI.Responses.ResponseCompletedEvent
    const calls = completed.response.output.filter(item => item.type === 'function_call')
    assert.deepEqual(calls.map(call => [call.call_id, JSON.parse(call.arguments)]), [['call_a', { path: 'a.txt' }], ['call_b', { path: 'b.txt' }]])
    assert(events.some(event => event.type === 'response.reasoning_summary_text.delta'))
    assert.equal(lastRequest().body.reasoning_effort, 'low')
    assert.equal(records(lastRequest().body.tools)[0]!.type, 'function')
    fixture = () => ({ text: 'Both read' })
    const followUp = await openai.responses.create({ model: chatModel, tools, input: [
      { role: 'user', content: 'Read both' },
      ...calls.map(call => ({ type: 'function_call' as const, call_id: call.call_id, name: call.name, arguments: call.arguments })),
      { type: 'function_call_output', call_id: 'call_a', output: 'A contents' },
      { type: 'function_call_output', call_id: 'call_b', output: 'B contents' },
    ] })
    assert.equal(followUp.output_text, 'Both read')
    const messages = records(lastRequest().body.messages)
    assert.deepEqual(messages.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'tool'])
    assert.deepEqual(records(messages[2]!.tool_calls).map(call => call.id), ['call_a', 'call_b'])
    assert.deepEqual(messages.slice(3).map(m => [m.tool_call_id, m.content]), [['call_a', 'A contents'], ['call_b', 'B contents']])
  })

  await check('chat-format truncation, token-limit field swap, and provider cost', async () => {
    let calls = 0
    fixture = request => {
      calls++
      if ('max_tokens' in request.body) return { errorStatus: 400, errorBody: { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", type: 'invalid_request_error', param: 'max_tokens' } } }
      return { text: 'Cut', finish: 'length' }
    }
    const result = await openai.chat.completions.create({ model: chatModel, messages: [{ role: 'user', content: 'Long' }], max_tokens: 50 })
    assert.equal(result.choices[0]!.finish_reason, 'length')
    assert.equal(calls, 2)
    assert.equal(lastRequest().body.max_completion_tokens, 50)
  })

  for (const stream of [false, true]) {
    await check(`Anthropic-format provider serves OpenAI Chat Completions clients (stream=${stream})`, async () => {
      const params = { model: claudeModel, messages: [{ role: 'system' as const, content: 'Be brief.' }, { role: 'user' as const, content: 'Hi' }], max_tokens: 300, temperature: 1.5 }
      let text = ''
      let usage: OpenAI.CompletionUsage | undefined
      if (stream) {
        for await (const chunk of await openai.chat.completions.create({ ...params, stream: true, stream_options: { include_usage: true } })) {
          text += chunk.choices[0]?.delta.content ?? ''
          usage = chunk.usage ?? usage
        }
      } else {
        const result = await openai.chat.completions.create(params)
        text = result.choices[0]!.message.content ?? ''
        usage = result.usage
      }
      assert.equal(text, 'Hello 🐙')
      // 50 uncached + 30 cache reads + 20 cache writes.
      assert.equal(usage?.prompt_tokens, 100); assert.equal(usage?.prompt_tokens_details?.cached_tokens, 30)
      const sent = lastRequest()
      assert.equal(sent.path, '/v1/messages')
      assert.equal(sent.headers['x-api-key'], 'fixture-key-anthropic_messages')
      assert(sent.headers['anthropic-version'])
      assert.match(JSON.stringify(sent.body.system), /fixture model[\s\S]*Be brief\./)
      assert.deepEqual(records(sent.body.messages).map(m => m.role), ['user'])
      assert.equal(sent.body.max_tokens, 300)
      // Claude Opus 4.8 rejects custom sampling, so the translated request omits it.
      assert(!('temperature' in sent.body))
    })
  }

  await check('Anthropic-format thinking, tool use, and tool results round trip through Responses', async () => {
    fixture = () => ({ reasoning: 'Considering', signature: 'sig-1', tools: [{ name: 'read_file', args: { path: 'c.txt' }, id: 'toolu_1' }] })
    const tools = [{ type: 'function' as const, name: readTool.name, parameters: readTool.input_schema, strict: false }]
    const first = await openai.responses.create({ model: claudeModel, input: 'Read c', tools, reasoning: { effort: 'high' } })
    const sent = lastRequest().body
    assert.deepEqual(sent.thinking, { type: 'adaptive', display: 'summarized' })
    assert.deepEqual(sent.output_config, { effort: 'high' })
    assert.equal(records(sent.tools)[0]!.name, 'read_file')
    const reasoning = first.output.find(item => item.type === 'reasoning') as unknown as Json
    assert.equal(reasoning.pulpo_signature, 'sig-1')
    const call = first.output.find(item => item.type === 'function_call')!
    assert(call.type === 'function_call')
    assert.deepEqual(JSON.parse(call.arguments), { path: 'c.txt' })
    fixture = () => ({ text: 'Done' })
    const followUp = await openai.responses.create({ model: claudeModel, tools, reasoning: { effort: 'high' }, input: [
      { role: 'user', content: 'Read c' },
      ...first.output as never[],
      { type: 'function_call_output', call_id: call.call_id, output: 'C contents' },
    ] })
    assert.equal(followUp.output_text, 'Done')
    const messages = records(lastRequest().body.messages)
    assert.deepEqual(messages.map(m => m.role), ['user', 'assistant', 'user'])
    const assistant = records(messages[1]!.content)
    assert.deepEqual(assistant.map(block => block.type), ['thinking', 'tool_use'])
    assert.equal(assistant[0]!.signature, 'sig-1')
    assert.deepEqual(records(messages[2]!.content)[0], { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'C contents' }] })
  })

  await check('Anthropic-format optional parameter and signature rejections are retried', async () => {
    let calls = 0
    fixture = request => {
      calls++
      if (records(request.body.messages).some(m => records(m.content).some(block => block.type === 'thinking'))) {
        return { errorStatus: 400, errorBody: { type: 'error', error: { type: 'invalid_request_error', message: 'messages.1.content.0: Invalid `signature` in `thinking` block.' } } }
      }
      return { text: 'Recovered' }
    }
    const result = await openai.responses.create({ model: claudeModel, input: [
      { role: 'user', content: 'Hi' },
      { type: 'reasoning', id: 'rs_x', summary: [], pulpo_format: 'anthropic_messages', pulpo_signature: 'stale' } as never,
      { role: 'assistant', content: 'Earlier' },
      { role: 'user', content: 'Again' },
    ] })
    assert.equal(result.output_text, 'Recovered')
    assert.equal(calls, 2)
    fixture = () => ({ errorStatus: 400, errorBody: { type: 'error', error: { type: 'invalid_request_error', message: 'messages: roles must alternate' } } })
    await assert.rejects(openai.chat.completions.create({ model: claudeModel, messages: [{ role: 'user', content: 'Hi' }] }), (error: unknown) => error instanceof OpenAI.APIError && error.status === 400 && /alternate/.test(error.message))
  })

  await check('Anthropic-format truncation and refusals map to finish reasons', async () => {
    fixture = () => ({ text: 'Partial', finish: 'length' })
    const truncated = await openai.chat.completions.create({ model: claudeModel, messages: [{ role: 'user', content: 'Long' }] })
    assert.equal(truncated.choices[0]!.finish_reason, 'length')
    fixture = () => ({ text: 'No', finish: 'content_filter' })
    const refused = await openai.chat.completions.create({ model: claudeModel, messages: [{ role: 'user', content: 'Bad' }] })
    assert.equal(refused.choices[0]!.finish_reason, 'content_filter')
  })

  for (const [label, modelId] of [['chat', chatModel], ['Anthropic', claudeModel]] as const) {
    await check(`browser chats replay history through the ${label} format`, async () => {
      fixture = () => ({ reasoning: 'Plan', signature: 'sig-browser', text: 'First answer' })
      const first = await browserTurn(modelId, 'First question')
      assert.equal(first.row.status, 'completed', JSON.stringify(first.row.error))
      fixture = () => ({ text: 'Second answer' })
      const second = await browserTurn(modelId, 'Second question', first.row.id, first.chatId)
      assert.equal(second.row.status, 'completed', JSON.stringify(second.row.error))
      const sent = requestContaining('Second question').body
      if (modelId === chatModel) {
        const messages = records(sent.messages)
        assert.equal(messages.filter(m => m.role === 'system').length, 1)
        assert.equal(messages[0]!.role, 'system')
        assert.deepEqual(messages.slice(1).map(m => [m.role, m.content]), [['user', 'First question'], ['assistant', 'First answer'], ['user', 'Second question']])
      } else {
        const messages = records(sent.messages)
        assert.deepEqual(messages.map(m => m.role), ['user', 'assistant', 'user'])
        const assistant = records(messages[1]!.content)
        assert.deepEqual(assistant.map(block => block.type), ['thinking', 'text'])
        assert.equal(assistant[0]!.signature, 'sig-browser')
      }
    })
  }

  await check('Agent mode streams through Pi with each provider format', async () => {
    await db.insert(schema.applicationSettings).values({ key: 'agent', value: { enabled: true } })
      .onConflictDoUpdate({ target: schema.applicationSettings.key, set: { value: { enabled: true } } })
    await db.update(schema.models).set({ agentEnabled: true })
    for (const modelId of [chatModel, claudeModel]) {
      upstreamRequests.length = 0
      fixture = () => ({ text: 'Agent answer' })
      const { row } = await browserTurn(modelId, 'Agent question', undefined, randomUUID(), true)
      assert.equal(row.status, 'completed', JSON.stringify(row.error))
      const sent = upstreamRequests.find(request => records(request.body.tools).length > 0)
      assert(sent, 'The agent turn did not advertise tools upstream')
      if (modelId === chatModel) {
        assert.equal(sent.path, '/v1/chat/completions')
        assert(records(sent.body.tools).length > 0)
        assert(!('max_output_tokens' in sent.body) && !('include' in sent.body))
      } else {
        assert.equal(sent.path, '/v1/messages')
        assert.equal(sent.headers['x-api-key'], 'fixture-key-anthropic_messages')
        assert(records(sent.body.tools).every(tool => record(tool.input_schema)))
      }
    }
  })

  for (const [label, modelId] of [['chat', chatModel], ['Anthropic', claudeModel], ['Responses', responsesModel]] as const) {
    await check(`Anthropic SDK clients use /v1/messages against the ${label} format`, async () => {
      fixture = () => ({ text: 'Hello from messages' })
      const message = await anthropic.messages.create({ model: modelId, max_tokens: 200, system: 'Be brief.', messages: [{ role: 'user', content: 'Hi' }] })
      assert.equal(message.type, 'message'); assert.equal(message.role, 'assistant')
      assert.deepEqual(message.content, [{ type: 'text', text: 'Hello from messages' }])
      assert.equal(message.stop_reason, 'end_turn')
      assert(message.usage.output_tokens > 0)
      const streamed = await anthropic.messages.stream({ model: modelId, max_tokens: 200, messages: [{ role: 'user', content: 'Hi' }] }).finalMessage()
      assert.equal(streamed.content.map(block => block.type === 'text' ? block.text : '').join(''), 'Hello from messages')
      assert.equal(streamed.stop_reason, 'end_turn')
      assert.equal(streamed.id, `msg_${streamed.id.slice(4)}`)
    })
  }

  await check('Anthropic SDK tool use streams and round trips, including interleaved parallel calls', async () => {
    for (const modelId of [responsesModel, claudeModel, chatModel]) {
      fixture = () => ({ tools: [{ name: 'read_file', args: { path: 'x.txt' }, id: 'toolu_x' }, { name: 'read_file', args: { path: 'y.txt' }, id: 'toolu_y' }] })
      const streamed = await anthropic.messages.stream({ model: modelId, max_tokens: 300, tools: [readTool], messages: [{ role: 'user', content: 'Read x and y' }] }).finalMessage()
      const uses = streamed.content.filter(block => block.type === 'tool_use')
      assert.deepEqual(uses.map(block => block.type === 'tool_use' ? [block.id, block.input] : []), [['toolu_x', { path: 'x.txt' }], ['toolu_y', { path: 'y.txt' }]], modelId)
      assert.equal(streamed.stop_reason, 'tool_use')
      fixture = () => ({ text: 'Read both files' })
      const answer = await anthropic.messages.create({ model: modelId, max_tokens: 300, tools: [readTool], messages: [
        { role: 'user', content: 'Read x and y' },
        { role: 'assistant', content: streamed.content },
        { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'toolu_x', content: 'X data' },
          { type: 'tool_result', tool_use_id: 'toolu_y', content: [{ type: 'text', text: 'Y data' }], is_error: true },
        ] },
      ] })
      assert.equal(answer.content[0]?.type === 'text' && answer.content[0].text, 'Read both files')
      const serialized = JSON.stringify(lastRequest().body)
      assert(serialized.includes('X data') && serialized.includes('Error: Y data'), serialized)
    }
  })

  await check('Anthropic SDK thinking blocks carry signatures and replay to the same Claude model', async () => {
    fixture = () => ({ reasoning: 'Deep thought', signature: 'sig-sdk', text: 'Answer' })
    const streamed = await anthropic.messages.stream({ model: claudeModel, max_tokens: 2000, thinking: { type: 'adaptive' }, messages: [{ role: 'user', content: 'Think' }] }).finalMessage()
    const thinking = streamed.content.find(block => block.type === 'thinking')
    assert(thinking?.type === 'thinking')
    assert.equal(thinking.thinking, 'Deep thought'); assert.equal(thinking.signature, 'sig-sdk')
    const plain = await anthropic.messages.create({ model: claudeModel, max_tokens: 2000, messages: [{ role: 'user', content: 'Think' }] })
    assert(!plain.content.some(block => block.type === 'thinking'), 'thinking shown without being requested')
    fixture = () => ({ text: 'Next' })
    await anthropic.messages.create({ model: claudeModel, max_tokens: 2000, thinking: { type: 'adaptive' }, messages: [
      { role: 'user', content: 'Think' }, { role: 'assistant', content: streamed.content }, { role: 'user', content: 'More' },
    ] })
    const assistant = records(records(lastRequest().body.messages)[1]!.content)
    assert.deepEqual(assistant[0], { type: 'thinking', thinking: 'Deep thought', signature: 'sig-sdk' })
  })

  await check('Anthropic SDK errors, models, and token counting', async () => {
    await assert.rejects(anthropic.messages.create({ model: claudeModel, messages: [{ role: 'user', content: 'Hi' }] } as never), (error: unknown) => error instanceof Anthropic.BadRequestError && /max_tokens/.test(error.message))
    const badKey = new Anthropic({ baseURL: base, apiKey: 'sk-pulpo-invalid.secret', maxRetries: 0 })
    await assert.rejects(badKey.messages.create({ model: claudeModel, max_tokens: 10, messages: [{ role: 'user', content: 'Hi' }] }), (error: unknown) => error instanceof Anthropic.AuthenticationError)
    await assert.rejects(anthropic.messages.create({ model: 'missing-model', max_tokens: 10, messages: [{ role: 'user', content: 'Hi' }] }), (error: unknown) => error instanceof Anthropic.BadRequestError && /unavailable/.test(error.message))
    fixture = () => ({ errorStatus: 400, errorBody: { error: { message: 'Context too long', type: 'invalid_request_error' } } })
    await assert.rejects(anthropic.messages.create({ model: chatModel, max_tokens: 10, messages: [{ role: 'user', content: 'Hi' }] }), (error: unknown) => error instanceof Anthropic.BadRequestError && /Context too long/.test(error.message))
    const models = await anthropic.models.list()
    assert(models.data.some(model => model.id === claudeModel && model.type === 'model'))
    const counted = await anthropic.messages.countTokens({ model: claudeModel, messages: [{ role: 'user', content: 'Count these tokens please' }] })
    assert(counted.input_tokens > 0 && counted.input_tokens < 100)
  })

  await check('truncated provider streams fail instead of completing, and consumed tokens are billed', async () => {
    for (const modelId of [chatModel, claudeModel]) {
      fixture = () => ({ text: 'Partial answer that never finish', truncate: true })
      await assert.rejects(openai.chat.completions.create({ model: modelId, messages: [{ role: 'user', content: 'Hi' }] }), (error: unknown) => error instanceof OpenAI.APIError && error.status === 500, modelId)
    }
    fixture = () => ({ text: 'Overloaded halfway', streamError: { type: 'overloaded_error', message: 'Overloaded' } })
    await assert.rejects(anthropic.messages.create({ model: claudeModel, max_tokens: 50, messages: [{ role: 'user', content: 'Hi' }] }),
      (error: unknown) => error instanceof Anthropic.APIError && error.status === 529 && JSON.stringify(error.error).includes('overloaded_error'))
    const [attempt] = await db.select().from(schema.generationAttempts).orderBy(desc(schema.generationAttempts.startedAt)).limit(1)
    assert(attempt && attempt.status === 'failed' && attempt.inputTokens > 0, JSON.stringify(attempt))
  })

  await check('Claude Code style requests: server tools, cached system blocks, large bodies, and max_tokens 0', async () => {
    fixture = () => ({ text: 'Large ok' })
    const big = 'x'.repeat(5 * 1024 * 1024)
    const response = await fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'x-api-key': key.secret, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'interleaved-thinking-2025-05-14', 'content-type': 'application/json' }, body: JSON.stringify({
      model: chatModel, max_tokens: 0, stream: true, metadata: { user_id: `user_${'a'.repeat(80)}` },
      system: [{ type: 'text', text: 'You are Claude Code.', cache_control: { type: 'ephemeral' } }],
      tools: [readTool, { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: [{ role: 'user', content: [{ type: 'text', text: big, cache_control: { type: 'ephemeral' } }] }],
    }) })
    assert.equal(response.status, 200, await response.clone().text())
    const wire = await response.text()
    const deltas = [...wire.matchAll(/"text_delta","text":"([^"]*)"/g)].map(match => match[1]).join('')
    assert(wire.includes('event: message_stop') && deltas === 'Large ok', wire.slice(0, 3000))
    const sent = lastRequest().body
    assert.deepEqual(records(sent.tools).map(tool => record(tool.function)?.name), ['read_file'])
    assert.equal(sent.max_tokens, 1)
  })

  assert.equal(fixtureFailures.length, 0, `Upstream fixture failures: ${fixtureFailures.map(String).join('; ')}`)
} finally {
  await worker.close()
  await app.close()
  await Promise.all(Object.values(queues).map(queue => queue.close()))
  await redis.quit()
  await closeDiagnostics(); await queryClient.end()
  upstream.closeAllConnections(); upstream.close()
}

function record(value: unknown): Json | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined
}

console.log(`\n${passed} passed; ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
