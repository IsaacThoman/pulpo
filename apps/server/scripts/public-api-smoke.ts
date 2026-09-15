import { unusualText, windowsToolOutput } from '../src/database/fixtures/windows-tool-output.js'
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
const { refreshDiagnosticPolicy, flushDiagnostics, closeDiagnostics } = await import('../src/logging/provider-diagnostics.js')
const { reconcileDetailedPayloadRetention } = await import('../src/logging/detailed-payload-retention.js')
const { db, queryClient } = await import('../src/database/client.js')
const schema = await import('../src/database/schema.js')
const { encryptSecret } = await import('../src/lib/crypto.js')
const { getConfig } = await import('../src/config.js')
const { processGeneration } = await import('../src/responses/worker.js')
const { buildApp } = await import('../src/app.js')
const { redis } = await import('../src/redis.js')
const queues = await import('../src/jobs.js')
const { eq, and } = await import('drizzle-orm')

type Json = Record<string, unknown>
const records = (value: unknown): Json[] => Array.isArray(value) ? value as Json[] : []
const message = (text: string): Json => ({ type: 'message', id: `msg_${randomUUID()}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] })
const tool = (name: string, args: Json): Json => ({ type: 'function_call', id: `fc_${randomUUID()}`, call_id: `call_${randomUUID()}`, name, arguments: JSON.stringify(args), status: 'completed' })
type Fixture = { output: Json[]; status?: string; errorStatus?: number; errorBody?: Json; delayMs?: number }
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
      res.end(JSON.stringify({ error: result.errorBody ?? { message: 'Fixture upstream unavailable', type: 'server_error', code: 'fixture_error' } }))
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
      ...(status === 'failed' ? { error: result.errorBody } : {}),
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
  for (const capture of [false, true]) for (const protocol of ['chat/completions', 'responses', 'completions']) for (const stream of [false, true]) {
    await check(`lossless Windows output: ${protocol}, stream=${stream}, logging=${capture}`, async () => {
      await db.insert(schema.applicationSettings).values({ key: 'logging', value: { logDetailedPayloads: capture, payloadRetention: '7d' } })
        .onConflictDoUpdate({ target: schema.applicationSettings.key, set: { value: { logDetailedPayloads: capture, payloadRetention: '7d' } } })
      await db.transaction(tx => reconcileDetailedPayloadRetention(query => tx.execute(query), { logDetailedPayloads: capture, payloadRetention: '7d' }))
      await refreshDiagnosticPolicy()
      fixture = () => ({ output: [message(unusualText)] })
      const body = protocol === 'chat/completions'
        ? { model, stream, messages: [
          { role: 'user', content: 'Inspect partitions' },
          { role: 'assistant', content: null, tool_calls: [{ id: 'call_windows', type: 'function', function: { name: 'bash', arguments: '{}' } }] },
          { role: 'tool', tool_call_id: 'call_windows', content: unusualText },
        ] }
        : protocol === 'responses'
          ? { model, stream, input: unusualText, instructions: unusualText, metadata: { ['key\0']: unusualText } }
          : { model, stream, prompt: unusualText }
      const idempotencyKey = randomUUID()
      const headers = { authorization: `Bearer ${key.secret}`, 'content-type': 'application/json', 'idempotency-key': idempotencyKey }
      const response = await fetch(`${base}/v1/${protocol}`, { method: 'POST', headers, body: JSON.stringify(body) })
      assert.equal(response.status, 200)
      const wire = await response.text()
      const events = stream ? wire.split('\n\n').filter(part => part.startsWith('data: ') && part !== 'data: [DONE]')
        .map(part => JSON.parse(part.slice(6)) as Json) : [JSON.parse(wire) as Json]
      const outputText = protocol === 'responses'
        ? stream ? events.filter(event => event.type === 'response.output_text.delta').map(event => event.delta).join('')
          : textOf(events[0] as unknown as OpenAI.Responses.Response)
        : stream ? events.flatMap(event => records(event.choices)).map(choice => protocol === 'completions' ? choice.text : (choice.delta as Json)?.content ?? '').join('')
          : protocol === 'completions' ? records(events[0]!.choices)[0]!.text : (records(events[0]!.choices)[0]!.message as Json).content
      assert.equal(outputText, unusualText)
      const upstreamInput = upstreamRequests[0]!.input
      if (protocol === 'chat/completions') assert.equal(records(upstreamInput).find(item => item.type === 'function_call_output')!.output, unusualText)
      else assert.deepEqual(upstreamInput, [{ role: 'user', content: unusualText }])
      const [saved] = await db.select().from(schema.responses).where(eq(schema.responses.idempotencyKey, idempotencyKey))
      assert(saved); assert.equal(saved.status, 'completed')
      assert.equal(textOf({ output: saved.output } as OpenAI.Responses.Response), unusualText)
      if (protocol === 'responses') {
        assert.deepEqual(saved.metadata, { ['key\0']: unusualText })
        assert.equal((saved.parameters as Json).instructions, unusualText)
      }
      const [log] = await db.select().from(schema.requestLogs).where(eq(schema.requestLogs.responseId, saved.id))
      assert.equal(log!.captureDetailedPayloads, capture)
      assert.equal(log!.requestPayload, null); assert.equal(log!.responsePayload, null)
      await flushDiagnostics()
      const attempts = await db.select().from(schema.providerDiagnostics).where(eq(schema.providerDiagnostics.requestLogId, log!.id))
      assert.equal(attempts.length, 1)
      const attempt = attempts[0]!
      assert.equal(attempt.captureDetailedPayloads, capture)
      assert.equal(attempt.providerId, providerId)
      assert.equal(attempt.status, 'completed')
      assert.equal((attempt.metadata as Json).httpStatus, 200)
      if (capture) {
        const request = attempt.requestPayload as { fidelity: string; body: Json }
        const response = attempt.responsePayload as { fidelity: string; body: Json[] }
        assert.equal(request.fidelity, 'exact')
        assert.deepEqual(request.body.input, upstreamInput)
        assert.equal(response.fidelity, 'reconstructed')
        const completed = response.body.find(event => event.type === 'response.completed')!.response
        assert.equal(textOf(completed as OpenAI.Responses.Response), unusualText)
      } else { assert.equal(attempt.requestPayload, null); assert.equal(attempt.responsePayload, null) }
      const retrieved = await client.responses.retrieve(saved.id)
      assert.equal(textOf(retrieved), unusualText)
      // Exact retry reuses the stored response and never contacts the provider twice.
      const retry = await fetch(`${base}/v1/${protocol}`, { method: 'POST', headers, body: JSON.stringify(body) })
      assert.equal(retry.status, 200); await retry.text()
      assert.equal(upstreamRequests.length, 1)
      if (!stream && !capture && protocol === 'responses') {
        // Make one fixture discoverable through app search and export.
        await db.update(schema.chats).set({ temporary: false, expiresAt: null }).where(eq(schema.chats.id, saved.chatId))
        const found = await fetch(`${base}/api/chats/search?q=PartitionNumber`, { headers: { cookie } }).then(result => result.json()) as { data: { id: string }[] }
        assert(found.data.some(chat => chat.id === saved.chatId))
        const exported = await fetch(`${base}/api/chats/export`, { headers: { cookie } }).then(result => result.text())
        assert(exported.includes(JSON.stringify(windowsToolOutput).slice(1, -1)))
        const imported = await fetch(`${base}/api/chats/import`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ source: 'pulpo', data: JSON.parse(exported) }) })
        assert.equal(imported.status, 200)
        assert((await imported.json() as { imported: number }).imported >= 1)
        const matching = await db.select().from(schema.responses).where(eq(schema.responses.userId, saved.userId))
        const [source] = await db.select().from(schema.chatImportSources).where(eq(schema.chatImportSources.sourceChatId, saved.chatId))
        const restored = matching.find(row => row.chatId === source?.chatId)
        assert(restored); assert.deepEqual(restored.input, saved.input); assert.deepEqual(restored.output, saved.output)
        assert.deepEqual(restored.parameters, saved.parameters); assert.equal(restored.instructions, saved.instructions)
      }
    })
  }
  await check('unsupported Unicode model identifiers fail before creating records', async () => {
    for (const model of ['bad\0model', 'bad\ud800']) {
      const response = await fetch(`${base}/v1/responses`, { method: 'POST', headers: { authorization: `Bearer ${key.secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, input: 'Hi' }) })
      assert.equal(response.status, 400)
      assert.equal((await response.json() as { error: { param: string } }).error.param, 'model')
    }
    assert.equal(upstreamRequests.length, 0)
  })
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
  await check('budget-derived output caps reach the provider and settle actual usage', async () => {
    const [keyRow] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, key.id))
    await db.update(schema.users).set({ balanceMicros: 100_000 }).where(eq(schema.users.id, keyRow!.userId))
    await db.update(schema.apiKeys).set({ monthlyBudgetMicros: 10_000 }).where(eq(schema.apiKeys.id, key.id))
    await db.update(schema.modelPricingVersions).set({ outputPriceMicros: 1_000_000 }).where(eq(schema.modelPricingVersions.modelId, model))
    try {
      const result = await client.responses.create({ model, input: 'Hi' })
      assert.equal(result.status, 'completed')
      assert.equal(upstreamRequests.at(-1)!.max_output_tokens, 10_000)
      const [hold] = await db.select().from(schema.budgetReservations).where(eq(schema.budgetReservations.responseId, result.id))
      assert.equal(hold!.status, 'settled'); assert.equal(hold!.settledAmountMicros, 20)
      await client.chat.completions.create({ model, messages, max_tokens: 37 })
      assert.equal(upstreamRequests.at(-1)!.max_output_tokens, 37)
      await db.update(schema.apiKeys).set({ monthlyBudgetMicros: 7_999 }).where(eq(schema.apiKeys.id, key.id))
      const calls = upstreamRequests.length
      await assert.rejects(client.responses.create({ model, input: 'Hi' }), error => error instanceof OpenAI.APIError && error.status === 402)
      assert.equal(upstreamRequests.length, calls)
    } finally {
      await db.update(schema.apiKeys).set({ monthlyBudgetMicros: null }).where(eq(schema.apiKeys.id, key.id))
      await db.update(schema.modelPricingVersions).set({ outputPriceMicros: 0 }).where(eq(schema.modelPricingVersions.modelId, model))
    }
  })
  await check('admin model allocation settings persist, validate, and control admission', async () => {
    const edit = (id: string, body: Json) => fetch(`${base}/api/admin/models/${id}`, {
      method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const modelId = `${model}-allocation`
    const created = await fetch(`${base}/api/admin/models`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ id: modelId, providerConnectionId: providerId, upstreamModelId: modelId, name: 'Allocation fixture',
        contextWindow: 128000, maxOutputTokens: 16384, minimumOutputReservationTokens: 1500,
        inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0 }),
    })
    assert.equal(created.status, 201, await created.text())
    assert.equal((await edit(modelId, { name: 'Renamed fixture' })).status, 200)
    const listed = await fetch(`${base}/api/admin/models`, { headers: { cookie } }).then(response => response.json()) as { data: Json[] }
    assert.equal(listed.data.find(row => row.id === modelId)?.minimumOutputReservationTokens, 1500)
    for (const minimumOutputReservationTokens of [0, -1, 1.5, null, '1000', 2147483648]) {
      assert.equal((await edit(modelId, { minimumOutputReservationTokens })).status, 400)
    }
    const [keyRow] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, key.id))
    await db.update(schema.users).set({ balanceMicros: 3000 }).where(eq(schema.users.id, keyRow!.userId))
    await db.update(schema.modelPricingVersions).set({ outputPriceMicros: 1_000_000 }).where(eq(schema.modelPricingVersions.modelId, model))
    try {
      assert.equal((await edit(model, { minimumOutputReservationTokens: 12000 })).status, 200)
      const calls = upstreamRequests.length
      await assert.rejects(client.responses.create({ model, input: 'Hi' }), error => error instanceof OpenAI.APIError && error.status === 402)
      assert.equal(upstreamRequests.length, calls)
      assert.equal((await edit(model, { minimumOutputReservationTokens: 1500 })).status, 200)
      assert.equal((await client.responses.create({ model, input: 'Hi' })).status, 'completed')
      assert.equal(upstreamRequests.at(-1)!.max_output_tokens, 3000)
    } finally {
      await edit(model, { minimumOutputReservationTokens: 8000 })
      await db.update(schema.modelPricingVersions).set({ outputPriceMicros: 0 }).where(eq(schema.modelPricingVersions.modelId, model))
    }
  })
  await check('fallback recalculates its affordable cap with the fallback price', async () => {
    const [keyRow] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, key.id))
    await db.update(schema.users).set({ balanceMicros: 16_000 }).where(eq(schema.users.id, keyRow!.userId))
    await db.update(schema.modelPricingVersions).set({ outputPriceMicros: 1_000_000 }).where(eq(schema.modelPricingVersions.modelId, fallbackModel))
    await db.update(schema.modelPricingVersions).set({ outputPriceMicros: 2_000_000 }).where(eq(schema.modelPricingVersions.modelId, model))
    fixture = body => body.model === fallbackModel ? { errorStatus: 503, output: [] } : { output: [message('Fallback answer')] }
    try {
      const result = await client.responses.create({ model: fallbackModel, input: 'Hi' })
      assert.equal(result.status, 'completed')
      assert.equal(upstreamRequests[0]!.max_output_tokens, 8_192)
      assert.equal(upstreamRequests.at(-1)!.max_output_tokens, 8_000)
      await db.update(schema.users).set({ balanceMicros: 4_000 }).where(eq(schema.users.id, keyRow!.userId))
      await db.update(schema.models).set({ minimumOutputReservationTokens: 1_000 }).where(eq(schema.models.id, fallbackModel))
      await db.update(schema.models).set({ minimumOutputReservationTokens: 2_000 }).where(eq(schema.models.id, model))
      assert.equal((await client.responses.create({ model: fallbackModel, input: 'Hi' })).status, 'completed')
      assert.equal(upstreamRequests.at(-2)!.max_output_tokens, 4_000)
      assert.equal(upstreamRequests.at(-1)!.max_output_tokens, 2_000)
    } finally {
      for (const id of [model, fallbackModel]) await db.update(schema.models).set({ minimumOutputReservationTokens: 8_000 }).where(eq(schema.models.id, id))
      for (const id of [model, fallbackModel]) await db.update(schema.modelPricingVersions).set({ outputPriceMicros: 0 }).where(eq(schema.modelPricingVersions.modelId, id))
    }
  })
  await check('billed failed attempts reduce retry capacity and remain charged if the floor is exhausted', async () => {
    const [keyRow] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, key.id))
    await db.update(schema.modelPricingVersions).set({ outputPriceMicros: 1_000_000 }).where(eq(schema.modelPricingVersions.modelId, retryModel))
    try {
      for (const balanceMicros of [10_000, 8_000]) {
        await db.update(schema.users).set({ balanceMicros }).where(eq(schema.users.id, keyRow!.userId))
        let calls = 0
        fixture = body => {
          calls++
          assert.equal(body.max_output_tokens, balanceMicros - (calls > 1 ? 20 : 0))
          return calls === 1
            ? { output: [], status: 'failed', errorBody: { message: '503 provider unavailable after processing input' } }
            : { output: [message('Retry succeeded')] }
        }
        if (balanceMicros === 10_000) {
          const result = await client.responses.create({ model: retryModel, input: 'Hi' })
          assert.equal(result.status, 'completed'); assert.equal(calls, 2)
        } else {
          const result = await client.responses.create({ model: retryModel, input: 'Hi' })
          assert.equal(result.status, 'failed'); assert.equal(calls, 1)
        }
        const deadline = Date.now() + 5_000
        let remaining: number | undefined
        do {
          const [user] = await db.select().from(schema.users).where(eq(schema.users.id, keyRow!.userId))
          remaining = user?.balanceMicros
          if (remaining === balanceMicros - calls * 20) break
          await new Promise(resolve => setTimeout(resolve, 25))
        } while (Date.now() < deadline)
        assert.equal(remaining, balanceMicros - calls * 20)
      }
    } finally {
      await db.update(schema.modelPricingVersions).set({ outputPriceMicros: 0 }).where(eq(schema.modelPricingVersions.modelId, retryModel))
    }
  })
  await check('browser chat and agent turns send funded limits and report truncation', async () => {
    const { createResponse } = await import('../src/responses/service.js')
    const { createChatResponseSchema } = await import('@pulpo/contracts')
    const [keyRow] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, key.id))
    const userId = keyRow!.userId
    await db.insert(schema.applicationSettings).values({ key: 'agent', value: { enabled: true } })
      .onConflictDoUpdate({ target: schema.applicationSettings.key, set: { value: { enabled: true } } })
    await db.update(schema.models).set({ agentEnabled: true, minimumOutputReservationTokens: 1_000 }).where(eq(schema.models.id, model))
    await db.update(schema.modelPricingVersions).set({ outputPriceMicros: 1_000_000 }).where(eq(schema.modelPricingVersions.modelId, model))
    try {
      for (const agentMode of [false, true]) {
        await db.update(schema.users).set({ balanceMicros: 3_000 }).where(eq(schema.users.id, userId))
        const chatId = randomUUID()
        await db.insert(schema.chats).values({ id: chatId, userId, modelId: model, title: 'Budget test' })
        let calls = 0
        fixture = body => {
          calls++
          assert.equal(body.max_output_tokens, agentMode && calls > 1 ? 2_980 : 3_000)
          return agentMode && calls === 1
            ? { output: [tool('unknown_fixture_tool', {})] }
            : { output: [message('Budget-limited answer')], status: 'incomplete' }
        }
        const created = await createResponse({ ownerUserId: userId, chatId, input: createChatResponseSchema.parse({ modelId: model, input: 'Hi', agentMode }) })
        const deadline = Date.now() + 15_000
        let terminal: typeof schema.responses.$inferSelect | undefined
        while (Date.now() < deadline) {
          const [row] = await db.select().from(schema.responses).where(eq(schema.responses.id, created.id))
          if (row && ['completed', 'incomplete', 'failed', 'cancelled'].includes(row.status)) { terminal = row; break }
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        assert.equal(terminal?.status, 'incomplete', JSON.stringify(terminal?.error))
        assert.deepEqual(terminal?.incompleteDetails, { reason: 'max_output_tokens' })
        assert.equal(calls, agentMode ? 2 : 1)
        // Wait for terminal accounting after the response snapshot is published.
        while (Date.now() < deadline) {
          const [hold] = await db.select().from(schema.budgetReservations).where(and(eq(schema.budgetReservations.responseId, created.id), eq(schema.budgetReservations.status, 'settled')))
          if (hold) { assert.equal(hold.settledAmountMicros, agentMode ? 40 : 20); break }
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        assert(Date.now() < deadline, 'Terminal accounting did not complete')
      }
    } finally {
      await db.update(schema.models).set({ minimumOutputReservationTokens: 8_000 }).where(eq(schema.models.id, model))
      await db.update(schema.modelPricingVersions).set({ outputPriceMicros: 0 }).where(eq(schema.modelPricingVersions.modelId, model))
    }
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
  await check('unrepresentable options return actionable 400 errors', async () => {
    for (const extra of [{ n: 2 }, { tools: [{ type: 'web_search' }] }, { modalities: ['text', 'audio'] }]) {
      const response = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${key.secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, ...extra }) })
      assert.equal(response.status, 400); assert((await response.json() as { error: { param: string } }).error.param)
    }
    assert.equal(upstreamRequests.length, 0)
  })
  await check('default client tuning succeeds on an unallowlisted model and admin-gated options are dropped', async () => {
    // OpenCode-style defaults: sampling knobs, reasoning effort, and options with no Responses equivalent.
    const result = await client.chat.completions.create({ model, messages, temperature: 0.4, top_p: 0.8, reasoning_effort: 'high', service_tier: 'priority', stop: ['END'], seed: 7, presence_penalty: 0.3, response_format: { type: 'text' } })
    assert.equal(result.choices[0]!.message.content, 'Hello 🐙 — 你好')
    const sent = upstreamRequests[0]!
    assert.equal(sent.temperature, 0.4); assert.equal(sent.top_p, 0.8); assert.deepEqual(sent.reasoning, { effort: 'high' })
    assert.deepEqual(sent.text, { format: { type: 'text' } })
    for (const dropped of ['service_tier', 'stop', 'seed', 'presence_penalty']) assert(!(dropped in sent), `${dropped} reached upstream`)
  })
  await check('legacy functions protocol maps onto tools', async () => {
    fixture = () => ({ output: [tool(fn.name, { path: 'legacy.txt' })] })
    const result = await client.chat.completions.create({ model, messages, functions: [fn], function_call: 'auto' })
    const call = result.choices[0]!.message.tool_calls![0]!
    assert(call.type === 'function' && call.function.name === fn.name)
    assert.equal(records(upstreamRequests[0]!.tools)[0]?.name, fn.name)
  })
  await check('provider parameter rejections are retried without the parameter', async () => {
    fixture = body => 'temperature' in body
      ? { errorStatus: 400, errorBody: { message: "Unsupported parameter: 'temperature' is not supported with this model.", type: 'invalid_request_error', code: 'unsupported_parameter', param: 'temperature' }, output: [] }
      : { output: [message('stripped')] }
    const result = await client.chat.completions.create({ model, messages, temperature: 0.1 })
    assert.equal(result.choices[0]!.message.content, 'stripped')
    assert.equal(upstreamRequests.length, 2); assert('temperature' in upstreamRequests[0]!); assert(!('temperature' in upstreamRequests[1]!))
  })
  await check('provider request rejections reach clients as 400 without retries or fallback', async () => {
    fixture = () => ({ errorStatus: 400, errorBody: { message: 'Invalid schema for response_format', type: 'invalid_request_error', code: 'invalid_json_schema', param: 'text.format.schema' }, output: [] })
    await assert.rejects(client.chat.completions.create({ model: retryModel, messages }), (error: unknown) => error instanceof OpenAI.APIError && error.status === 400 && error.code === 'invalid_json_schema' && error.param === 'text.format.schema')
    assert.equal(upstreamRequests.length, 1, 'a deterministic 400 must not be retried')
    await assert.rejects(client.chat.completions.create({ model: fallbackModel, messages }), (error: unknown) => error instanceof OpenAI.APIError && error.status === 400)
    assert.equal(upstreamRequests.length, 2, 'a deterministic 400 must not fall back to another model')
    const stream = await client.chat.completions.create({ model, messages, stream: true })
    await assert.rejects(async () => { for await (const _chunk of stream) { /* consume errors */ } }, /Invalid schema for response_format/)
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
  await closeDiagnostics(); await queryClient.end()
  upstream.closeAllConnections(); upstream.close()
}
console.log(`\n${passed} passed; ${failures.length} failed${process.env.OPENCODE_BIN ? '' : '; OpenCode not run (set OPENCODE_BIN)'}`)
process.exit(failures.length ? 1 : 0)
