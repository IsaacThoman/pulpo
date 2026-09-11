/** Full API/queue/worker compatibility checks against disposable PostgreSQL and Redis. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import OpenAI from 'openai'
import { Worker } from 'bullmq'

if (new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_public_api_test'
  || !process.env.REDIS_URL || new URL(process.env.REDIS_URL).pathname !== '/15') {
  throw new Error('Use a migrated disposable database named pulpo_public_api_test and a dedicated Redis instance with database /15')
}
process.env.LOG_LEVEL = 'silent'
const { db, queryClient } = await import('../src/database/client.js')
const schema = await import('../src/database/schema.js')
const { encryptSecret } = await import('../src/lib/crypto.js')
const { getConfig } = await import('../src/config.js')
const { processGeneration } = await import('../src/responses/worker.js')
const { buildApp } = await import('../src/app.js')
const { redis } = await import('../src/redis.js')
const queues = await import('../src/jobs.js')
const { eq } = await import('drizzle-orm')

type Json = Record<string, unknown>
const records = (value: unknown): Json[] => Array.isArray(value) ? value as Json[] : []
const message = (text: string): Json => ({ type: 'message', id: `msg_${randomUUID()}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] })
const tool = (name: string, args: Json): Json => ({ type: 'function_call', id: `fc_${randomUUID()}`, call_id: `call_${randomUUID()}`, name, arguments: JSON.stringify(args), status: 'completed' })
type Fixture = { output: Json[]; status?: string; errorStatus?: number; delayMs?: number }
let fixture: (body: Json) => Fixture = () => ({ output: [message('Hello 🐙 — 你好')] })
const upstreamRequests: Json[] = []
const fixtureFailures: unknown[] = []
const upstream = createServer(async (req, res) => {
  try {
    if (req.url?.endsWith('/cancel')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: req.url.split('/').at(-2), object: 'response', status: 'cancelled', output: [] }))
      return
    }
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw) as Json
    upstreamRequests.push(body)
    const result = fixture(body)
    if (result.errorStatus) {
      res.writeHead(result.errorStatus, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Fixture upstream unavailable', type: 'server_error', code: 'fixture_error' } }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    let sequence = 0
    const send = (type: string, payload: Json) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...payload })}\n\n`)
    const response = { id: `resp_${randomUUID()}`, object: 'response', created_at: Math.floor(Date.now() / 1000), model: body.model, status: 'in_progress', output: [] }
    send('response.created', { response })
    if (result.delayMs) await new Promise(resolve => setTimeout(resolve, result.delayMs))
    // Start every item before interleaving argument deltas, including non-tool items.
    result.output.forEach((item, output_index) => send('response.output_item.added', {
      output_index, item: { ...item, status: 'in_progress', ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) },
    }))
    for (let half = 0; half < 2; half++) result.output.forEach((item, output_index) => {
      if (item.type !== 'function_call') return
      const args = String(item.arguments), middle = Math.floor(args.length / 2)
      send('response.function_call_arguments.delta', { output_index, item_id: item.id, delta: half ? args.slice(middle) : args.slice(0, middle) })
    })
    result.output.forEach((item, output_index) => {
      if (item.type === 'function_call') send('response.function_call_arguments.done', { output_index, item_id: item.id, arguments: item.arguments })
      for (const [content_index, part] of records(item.content).entries()) {
        send('response.content_part.added', { output_index, item_id: item.id, content_index, part: { ...part, text: '' } })
        const refusal = part.type === 'refusal'
        send(refusal ? 'response.refusal.delta' : 'response.output_text.delta', { output_index, item_id: item.id, content_index, delta: part.text ?? part.refusal })
        send(refusal ? 'response.refusal.done' : 'response.output_text.done', { output_index, item_id: item.id, content_index, ...(refusal ? { refusal: part.refusal } : { text: part.text }) })
        send('response.content_part.done', { output_index, item_id: item.id, content_index, part })
      }
      send('response.output_item.done', { output_index, item })
    })
    const status = result.status ?? 'completed'
    send(`response.${status}`, { response: { ...response, status, output: result.output,
      ...(status === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 10 }, output_tokens_details: { reasoning_tokens: 5 } },
    } })
    res.end()
  } catch (error) { fixtureFailures.push(error); res.destroy(error as Error) }
})
upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
const upstreamPort = (upstream.address() as { port: number }).port
const providerId = randomUUID()
const suffix = randomUUID().slice(0, 8)
const model = `compat-${suffix}`
const fallbackModel = `${model}-fallback`
const retryModel = `${model}-retry`
const tunedModel = `${model}-tuned`
await db.insert(schema.applicationSettings).values({ key: 'auth', value: { apiKeysEnabled: true } })
  .onConflictDoUpdate({ target: schema.applicationSettings.key, set: { value: { apiKeysEnabled: true } } })
await db.insert(schema.providerConnections).values({ id: providerId, name: 'Compatibility fixture', baseUrl: `http://127.0.0.1:${upstreamPort}/v1`, encryptedApiKey: encryptSecret('disposable-fixture-key', getConfig().ENCRYPTION_KEY) })
for (const id of [model, fallbackModel, retryModel, tunedModel]) {
  await db.insert(schema.models).values({ id, providerConnectionId: providerId, upstreamModelId: id, name: id,
    contextWindow: 128000, maxOutputTokens: id === fallbackModel ? 8192 : 16384, compactionEnabled: false, retryDelaySeconds: 0,
    allowedParameters: id === tunedModel ? ['temperature', 'top_p', 'text', 'reasoning', 'max_output_tokens'] : [],
    defaultParameters: id === tunedModel ? { max_output_tokens: 1024 } : {},
    maxRetries: id === retryModel ? 1 : 0, fallbackModelId: id === fallbackModel ? model : null,
  })
  await db.insert(schema.modelPricingVersions).values({ id: randomUUID(), modelId: id, inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0 })
}
const app = await buildApp()
const base = await app.listen({ host: '127.0.0.1', port: 0 })
const worker = new Worker('generation', async job => processGeneration(job.data.responseId), { connection: { url: getConfig().REDIS_URL }, concurrency: 4 })
const failures: string[] = []
let passed = 0
const check = async (name: string, run: () => Promise<void>) => {
  upstreamRequests.length = 0
  fixture = () => ({ output: [message('Hello 🐙 — 你好')] })
  try { await run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failures.push(name); console.error(`FAIL ${name}:`, error) }
}
const credentials = { name: 'Compatibility QA', username: `qa_${suffix}`, email: 'public-api-smoke@example.test', password: 'disposable-public-api-test-password' }
const setup = await fetch(`${base}/api/auth/setup-status`).then(r => r.json()) as { required: boolean }
const login = await fetch(`${base}/api/auth/${setup.required ? 'setup' : 'login'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) })
assert(login.ok, await login.text())
const cookie = login.headers.get('set-cookie')!.split(';')[0]!
async function createKey(scopes = ['responses', 'models'], allowedModels: string[] = []) {
  const result = await fetch(`${base}/api/api-keys`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Compatibility smoke', scopes, allowedModels }) })
  assert.equal(result.status, 201)
  return await result.json() as { id: string; secret: string }
}
const key = await createKey()
const client = new OpenAI({ baseURL: `${base}/v1`, apiKey: key.secret, maxRetries: 0, timeout: 15000 })
const fn = { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }, strict: false }
const chatTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [{ type: 'function', function: fn }]
const responseTools: OpenAI.Responses.Tool[] = [{ type: 'function', ...fn }]
const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: 'user', content: 'Read probe.txt' }]
const textOf = (response: OpenAI.Responses.Response) => response.output.filter(item => item.type === 'message').flatMap(item => item.content).filter(part => part.type === 'output_text').map(part => part.text).join('')

try {
  await check('models discovery and detail', async () => {
    assert((await client.models.list()).data.some(item => item.id === model))
    assert.equal((await client.models.retrieve(model)).id, model)
  })
  for (const stream of [false, true]) {
    await check(`chat Unicode text, system/user history and usage (stream=${stream})`, async () => {
      const requestMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: 'system', content: 'Be concise' }, { role: 'user', content: '你好 🐙' }, { role: 'assistant', content: 'Hi' }, { role: 'user', content: 'Continue' }]
      const result = await client.chat.completions.create({ model, messages: requestMessages, stream, ...(stream ? { stream_options: { include_usage: true } } : {}) })
      let text = '', total = 0
      if (stream && Symbol.asyncIterator in result) for await (const chunk of result) { text += chunk.choices[0]?.delta.content ?? ''; if (chunk.usage) total = chunk.usage.total_tokens }
      else if ('choices' in result) { text = result.choices[0]!.message.content!; total = result.usage!.total_tokens }
      assert.equal(text, 'Hello 🐙 — 你好'); assert.equal(total, 120)
      assert.deepEqual(upstreamRequests[0]!.input, requestMessages)
    })
    await check(`parallel tool calls with interleaved arguments and follow-up (stream=${stream})`, async () => {
      fixture = body => records(body.input).some(item => item.type === 'function_call_output')
        ? { output: [message('Both files received')] }
        : { output: [message('Reading files'), tool(fn.name, { path: 'α.txt' }), tool(fn.name, { path: 'b.txt' })] }
      const result = await client.chat.completions.create({ model, messages, tools: chatTools, tool_choice: 'required', parallel_tool_calls: true, stream })
      const calls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] = []
      let finish = ''
      if (Symbol.asyncIterator in result) for await (const chunk of result) {
        const choice = chunk.choices[0]; if (!choice) continue
        if (choice.finish_reason) finish = choice.finish_reason
        for (const delta of choice.delta.tool_calls ?? []) {
          const call = calls[delta.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } }
          if (delta.id) call.id = delta.id
          call.function.name += delta.function?.name ?? ''; call.function.arguments += delta.function?.arguments ?? ''
        }
      } else { calls.push(...result.choices[0]!.message.tool_calls as typeof calls); finish = result.choices[0]!.finish_reason! }
      assert.equal(finish, 'tool_calls'); assert.equal(calls.length, 2); assert.notEqual(calls[0]!.id, calls[1]!.id)
      assert.deepEqual(calls.map(call => JSON.parse(call.function.arguments)), [{ path: 'α.txt' }, { path: 'b.txt' }])
      const followup = await client.chat.completions.create({ model, tools: chatTools, messages: [...messages, { role: 'assistant', content: null, tool_calls: calls }, ...calls.map(call => ({ role: 'tool' as const, tool_call_id: call.id, content: `Contents of ${call.function.arguments}` }))] })
      assert.equal(followup.choices[0]!.message.content, 'Both files received')
      const received = records(upstreamRequests.at(-1)!.input).filter(item => item.type === 'function_call_output')
      assert.deepEqual(received.map(item => item.call_id), calls.map(call => call.id))
    })
    await check(`Responses named tool, stateless continuation and encrypted reasoning (stream=${stream})`, async () => {
      fixture = body => records(body.input).some(item => item.type === 'function_call_output') ? { output: [message('Result received')] } : { output: [tool(fn.name, { path: 'probe.txt' })] }
      const first = await client.responses.create({ model, input: 'Read probe.txt', tools: responseTools, tool_choice: { type: 'function', name: fn.name }, parallel_tool_calls: false, include: ['reasoning.encrypted_content'], stream })
      let response: OpenAI.Responses.Response | undefined
      if (Symbol.asyncIterator in first) { for await (const event of first) if (event.type === 'response.completed') response = event.response } else response = first
      const call = response!.output.find(item => item.type === 'function_call')!
      assert.equal(call.name, fn.name)
      assert.equal(upstreamRequests[0]!.parallel_tool_calls, false)
      assert.deepEqual(upstreamRequests[0]!.include, ['reasoning.encrypted_content'])
      const reasoning: OpenAI.Responses.ResponseReasoningItem = { type: 'reasoning', id: 'rs_fixture', summary: [], encrypted_content: 'opaque-reasoning-fixture' }
      const final = await client.responses.create({ model, input: [reasoning, call, { type: 'function_call_output', call_id: call.call_id, output: 'File contents' }], tools: responseTools })
      assert.equal(textOf(final), 'Result received')
      assert(records(upstreamRequests.at(-1)!.input).some(item => item.encrypted_content === reasoning.encrypted_content))
    })
    await check(`length finish reason (stream=${stream})`, async () => {
      fixture = () => ({ output: [message('Partial')], status: 'incomplete' })
      const result = await client.chat.completions.create({ model, messages, stream })
      let reason = ''
      if (Symbol.asyncIterator in result) { for await (const chunk of result) if (chunk.choices[0]?.finish_reason) reason = chunk.choices[0].finish_reason } else reason = result.choices[0]!.finish_reason
      assert.equal(reason, 'length')
    })
    await check(`refusal projection (stream=${stream})`, async () => {
      fixture = () => ({ output: [{ ...message(''), content: [{ type: 'refusal', refusal: 'Fixture refusal' }] }] })
      const result = await client.chat.completions.create({ model, messages, stream })
      let refusal = ''
      if (Symbol.asyncIterator in result) { for await (const chunk of result) refusal += chunk.choices[0]?.delta.refusal ?? '' } else refusal = result.choices[0]!.message.refusal!
      assert.equal(refusal, 'Fixture refusal')
    })
  }
  await check('JSON schema output and allowed sampling/reasoning parameters', async () => {
    fixture = () => ({ output: [message('{"ok":true}')] })
    const result = await client.chat.completions.create({ model: tunedModel, messages, temperature: 0.2, top_p: 0.9, reasoning_effort: 'low', response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } } } })
    assert.deepEqual(JSON.parse(result.choices[0]!.message.content!), { ok: true })
    assert.equal(upstreamRequests[0]!.temperature, 0.2)
    assert.deepEqual(upstreamRequests[0]!.reasoning, { effort: 'low' })
    assert.equal((upstreamRequests[0]!.text as { format: { name: string } }).format.name, 'result')
  })
  await check('configured token defaults and explicit overrides', async () => {
    await client.chat.completions.create({ model: tunedModel, messages })
    assert.equal(upstreamRequests.at(-1)!.max_output_tokens, 1024)
    await client.chat.completions.create({ model: tunedModel, messages, max_tokens: 48 })
    assert.equal(upstreamRequests.at(-1)!.max_output_tokens, 48)
  })
  await check('image input reaches the provider with its detail setting', async () => {
    const imageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII='
    await client.chat.completions.create({ model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe this image' }, { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } }] }] })
    const image = records(upstreamRequests.at(-1)!.input).flatMap(item => records(item.content)).find(part => part.type === 'input_image')
    assert(image); assert.equal(image.detail, 'low'); assert.equal(image.image_url, imageUrl)
  })
  await check('requested output token limit and catalog ceiling reach upstream', async () => {
    await client.chat.completions.create({ model, messages, max_tokens: 37 })
    assert.equal(upstreamRequests.at(-1)!.max_output_tokens, 37)
    await client.chat.completions.create({ model, messages, max_completion_tokens: 41 })
    assert.equal(upstreamRequests.at(-1)!.max_output_tokens, 41)
    await client.completions.create({ model, prompt: 'Hi', max_tokens: 49 })
    assert.equal(upstreamRequests.at(-1)!.max_output_tokens, 49)
    await client.responses.create({ model, input: 'Hi', max_output_tokens: 100000 })
    assert.equal(upstreamRequests.at(-1)!.max_output_tokens, 16384)
  })
  await check('idempotent replay and conflicting reuse', async () => {
    const idempotency = randomUUID()
    const opts = { headers: { 'Idempotency-Key': idempotency } }
    const first = await client.chat.completions.create({ model, messages }, opts)
    const second = await client.chat.completions.create({ model, messages }, opts)
    assert.equal(second.id, first.id); assert.equal(upstreamRequests.length, 1)
    await assert.rejects(client.chat.completions.create({ model, messages: [{ role: 'user', content: 'Different' }] }, opts), error => error instanceof OpenAI.APIError && error.status === 409)
  })
  await check('fallback preserves tools without fallback allowlist entries', async () => {
    fixture = body => body.model === fallbackModel ? { errorStatus: 503, output: [] } : { output: [tool(fn.name, { path: 'fallback.txt' })] }
    const result = await client.chat.completions.create({ model: fallbackModel, messages, tools: chatTools, tool_choice: 'required', parallel_tool_calls: false, max_tokens: 100000 })
    assert.equal(result.choices[0]!.finish_reason, 'tool_calls')
    assert(upstreamRequests.some(body => body.model === model && records(body.tools)[0]?.name === fn.name && body.tool_choice === 'required' && body.parallel_tool_calls === false))
    assert(upstreamRequests.every(body => body.max_output_tokens === 8192))
    await db.update(schema.models).set({ maxOutputTokens: 2048 }).where(eq(schema.models.id, model))
    try {
      await client.chat.completions.create({ model: fallbackModel, messages, tools: chatTools, max_tokens: 5000 })
      assert.equal(upstreamRequests.at(-1)!.max_output_tokens, 2048)
    } finally { await db.update(schema.models).set({ maxOutputTokens: 16384 }).where(eq(schema.models.id, model)) }
  })
  await check('retry before output preserves tool request', async () => {
    let attempts = 0
    fixture = () => ++attempts === 1 ? { errorStatus: 503, output: [] } : { output: [tool(fn.name, { path: 'retry.txt' })] }
    const result = await client.chat.completions.create({ model: retryModel, messages, tools: chatTools })
    assert.equal(result.choices[0]!.finish_reason, 'tool_calls'); assert(attempts >= 2)
    assert(upstreamRequests.every(body => records(body.tools)[0]?.name === fn.name))
  })
  await check('upstream failure reaches SDK clients', async () => {
    fixture = () => ({ errorStatus: 503, output: [] })
    await assert.rejects(client.chat.completions.create({ model, messages }), error => error instanceof OpenAI.APIError && error.status === 500)
    const stream = await client.chat.completions.create({ model, messages, stream: true })
    await assert.rejects(async () => { for await (const _chunk of stream) { /* consume errors */ } }, /Fixture upstream unavailable/)
  })
  await check('Responses store/retrieve, metadata and store=false isolation', async () => {
    const saved = await client.responses.create({ model, input: 'Hi', metadata: { test: 'metadata' }, store: true })
    assert.equal((await client.responses.retrieve(saved.id)).metadata!.test, 'metadata')
    const ephemeral = await client.responses.create({ model, input: 'Hi', store: false })
    await assert.rejects(client.responses.retrieve(ephemeral.id), error => error instanceof OpenAI.APIError && error.status === 404)
  })
  await check('background cancellation reaches a terminal state', async () => {
    fixture = () => ({ output: [message('Delayed')], delayMs: 800 })
    const pending = await client.responses.create({ model, input: 'Wait', background: true })
    await client.responses.cancel(pending.id)
    let response = await client.responses.retrieve(pending.id)
    for (let tries = 0; ['queued', 'in_progress'].includes(response.status!) && tries < 50; tries++) {
      await new Promise(resolve => setTimeout(resolve, 100)); response = await client.responses.retrieve(pending.id)
    }
    assert.equal(response.status, 'cancelled')
  })
  await check('model restrictions, key scopes, revoked and missing keys', async () => {
    for (const [scope, allowedModels, status] of [[['models'], [], 403], [['responses', 'models'], [model], 403]] as const) {
      const restricted = await createKey([...scope], [...allowedModels])
      const sdk = new OpenAI({ baseURL: `${base}/v1`, apiKey: restricted.secret, maxRetries: 0 })
      await assert.rejects(sdk.chat.completions.create({ model: tunedModel, messages }), error => error instanceof OpenAI.APIError && error.status === status)
    }
    const revoked = await createKey()
    await fetch(`${base}/api/api-keys/${revoked.id}`, { method: 'DELETE', headers: { cookie } })
    const response = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${revoked.secret}` } })
    assert.equal(response.status, 401)
    assert.equal((await fetch(`${base}/v1/models`)).status, 401)
    assert.equal(upstreamRequests.length, 0)
  })
  await check('harmless client defaults and unknown fields', async () => {
    const response = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${key.secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, tools: [], tool_choice: 'none', parallel_tool_calls: false, stop: [], presence_penalty: 0, frequency_penalty: 0, future_client_option: true }) })
    assert.equal(response.status, 200)
    assert.deepEqual(upstreamRequests[0]!.tools, []); assert.equal(upstreamRequests[0]!.tool_choice, 'none')
    assert(!('future_client_option' in upstreamRequests[0]!))
  })
  await check('unsupported options return actionable 400 errors', async () => {
    for (const extra of [{ service_tier: 'priority' }, { stop: 'END' }, { tools: [{ type: 'web_search' }] }]) {
      const response = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${key.secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, ...extra }) })
      assert.equal(response.status, 400); assert((await response.json() as { error: { param: string } }).error.param)
    }
    assert.equal(upstreamRequests.length, 0)
  })
  await check('concurrent streams keep responses isolated', async () => {
    fixture = body => ({ output: [message(JSON.stringify(body.input))] })
    await Promise.all(Array.from({ length: 6 }, async (_, index) => {
      const content = `parallel-request-${index}`
      const stream = await client.chat.completions.create({ model, messages: [{ role: 'user', content }], stream: true })
      let text = ''; for await (const chunk of stream) text += chunk.choices[0]?.delta.content ?? ''
      assert.equal(text, JSON.stringify([{ role: 'user', content }]))
    }))
  })
  await check('legacy Completions remains usable', async () => {
    assert.equal((await client.completions.create({ model, prompt: 'Hi' })).choices[0]!.text, 'Hello 🐙 — 你好')
  })

  if (process.env.OPENCODE_BIN) await check('OpenCode multi-step write/edit/bash/read workflow', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'pulpo-opencode-smoke-')))
    const filePath = join(directory, 'probe.txt')
    const sequence = [
      { name: 'write', args: { filePath, content: 'before\n' } },
      { name: 'edit', args: { filePath, oldString: 'before', newString: 'after 🐙' } },
      { name: 'bash', args: { command: 'cat probe.txt', description: 'Read the test fixture' } },
      { name: 'read', args: { filePath } },
    ]
    fixture = body => {
      if (!records(body.tools).length) return { output: [message('Compatibility workflow')] }
      const results = records(body.input).filter(item => item.type === 'function_call_output')
      const next = sequence[results.length]
      if (!next) return { output: [message('PULPO_WORKFLOW_COMPLETE')] }
      assert(records(body.tools).some(item => item.name === next.name), `OpenCode did not advertise ${next.name}`)
      return { output: [tool(next.name, next.args)] }
    }
    const configPath = join(directory, 'opencode.json')
    await writeFile(configPath, JSON.stringify({ $schema: 'https://opencode.ai/config.json', permission: { edit: 'allow', bash: { '*': 'deny', 'cat probe.txt': 'allow' }, external_directory: { '*': 'deny', [directory + '/*']: 'allow' } }, enabled_providers: ['pulpo'], model: `pulpo/${model}`, small_model: `pulpo/${model}`, provider: { pulpo: { npm: '@ai-sdk/openai-compatible', options: { baseURL: `${base}/v1`, apiKey: key.secret }, models: { [model]: { name: 'Compatibility model', limit: { context: 128000, output: 16384 } } } } } }), { mode: 0o600 })
    const child = spawn(process.env.OPENCODE_BIN!, ['run', '--pure', '--dir', directory, '--format', 'json', 'Create probe.txt with before, edit it to after 🐙, use bash to verify it, then read it.'], { cwd: directory, env: { ...process.env, OPENCODE_CONFIG: configPath, XDG_CONFIG_HOME: join(directory, 'config'), XDG_DATA_HOME: join(directory, 'data'), XDG_CACHE_HOME: join(directory, 'cache'), XDG_STATE_HOME: join(directory, 'state') }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', errors = ''
    child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { errors += chunk })
    const deadline = setTimeout(() => child.kill('SIGTERM'), 90000)
    try { const [code] = await once(child, 'close'); assert.equal(code, 0, errors) } finally { clearTimeout(deadline) }
    const events = output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line) as { type: string; part?: { text?: string; tool?: string; state?: { status: string } } })
    assert.deepEqual(events.filter(event => event.type === 'tool_use').map(event => [event.part?.tool, event.part?.state?.status]), sequence.map(step => [step.name, 'completed']), errors + JSON.stringify(events.filter(event => event.type === 'tool_use')))
    assert(events.some(event => event.part?.text === 'PULPO_WORKFLOW_COMPLETE'))
    assert.equal(await readFile(filePath, 'utf8'), 'after 🐙\n')
  })
  assert.equal(fixtureFailures.length, 0, 'Upstream fixture assertions failed')
} finally {
  await worker.close()
  await app.close()
  await Promise.all(Object.values(queues).map(queue => queue.close()))
  await redis.quit()
  await queryClient.end()
  upstream.closeAllConnections(); upstream.close()
}
console.log(`\n${passed} passed; ${failures.length} failed${process.env.OPENCODE_BIN ? '' : '; OpenCode not run (set OPENCODE_BIN)'}`)
process.exit(failures.length ? 1 : 0)
