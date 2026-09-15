import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createChatResponseSchema, questionItems } from '@pulpo/contracts'

const operations = vi.hoisted(() => [] as string[])
vi.mock('./controller.js', () => ({ WorkspaceManager: class {
  leaseId = undefined
  continuedWithoutAgent = false
  async execute(id: string) { operations.push(id.split('|')[0]!); return { output: '/workspace', details: {}, exitCode: 0 } }
} }))

const enabled = process.env.PULPO_QUESTION_RUNNER_TEST === '1'
if (enabled && (new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_questions_test' || process.env.REDIS_URL !== 'redis://127.0.0.1:6399')) throw new Error('Runner test requires the disposable question database and Redis on port 6399')

it.skipIf(!enabled)('checkpoints and resumes the real runner across two questions in a batch, preserving costs, limits and completed tools', async () => {
  const requests: Array<Record<string, unknown>> = []
  const providerServer = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    requests.push(body)
    const hasAnswer = JSON.stringify(body.input).includes('custom ocean answer')
    const call = (id: string, name: string, args: unknown) => ({ type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: JSON.stringify(args), status: 'completed' })
    const output = body.tools?.some((tool: { name: string }) => tool.name === 'request_user_input') && !hasAnswer ? [
      call('before', 'ls', {}),
      call('question1', 'request_user_input', { questions: [{ id: 'theme', prompt: 'What theme?' }] }),
      call('question2', 'request_user_input', { questions: [{ id: 'color', prompt: 'What color?' }] }),
      call('after', 'ls', {}),
    ] : [{ type: 'message', id: `msg_${randomUUID()}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done with your answers.', annotations: [] }] }]
    const response = { id: `resp_${randomUUID()}`, object: 'response', status: 'completed', created_at: Math.floor(Date.now() / 1000), model: body.model, output, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }
    if (!body.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(response)); return }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    let sequence = 0
    const event = (type: string, payload: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...payload as object })}\n\n`)
    event('response.created', { response: { ...response, status: 'in_progress', output: [] } })
    output.forEach((item, index) => {
      event('response.output_item.added', { output_index: index, item: item.type === 'message' ? { ...item, content: [] } : { ...item, arguments: '' } })
      if (item.type === 'message') {
        event('response.content_part.added', { item_id: item.id, output_index: index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } })
        event('response.output_text.delta', { item_id: item.id, output_index: index, content_index: 0, delta: 'Done with your answers.' })
      } else event('response.function_call_arguments.delta', { item_id: item.id, output_index: index, delta: 'arguments' in item ? item.arguments : '' })
      event('response.output_item.done', { output_index: index, item })
    })
    event('response.completed', { response }); res.end()
  })
  await new Promise<void>(resolve => providerServer.listen(0, '127.0.0.1', resolve))
  const { db, queryClient } = await import('../database/client.js')
  const tables = await import('../database/schema.js')
  const { encryptSecret } = await import('../lib/crypto.js')
  const { createResponse } = await import('../responses/service.js')
  const { processAgentGeneration } = await import('./runner.js')
  const { answerAgentQuestions } = await import('./questions.js')
  const { generationQueue, maintenanceQueue, embeddingQueue, codexLoginQueue, payloadRetentionQueue } = await import('../jobs.js')
  const { redis } = await import('../redis.js')
  const owner = randomUUID(), providerId = randomUUID(), chatId = randomUUID(), modelId = `questions-runner-${randomUUID()}`
  try {
    await db.insert(tables.users).values({ id: owner, email: `${owner}@test.invalid`, name: 'Runner QA', username: owner, role: 'user', balanceMicros: 1_000_000_000 })
    await db.insert(tables.userPreferences).values({ userId: owner, values: { memoryEnabled: false } })
    await db.insert(tables.providerConnections).values({ id: providerId, name: 'Question fixture', baseUrl: `http://127.0.0.1:${(providerServer.address() as { port: number }).port}/v1`, encryptedApiKey: encryptSecret('fixture', 'development-only-key-change-me-000000') })
    await db.insert(tables.models).values({ id: modelId, providerConnectionId: providerId, upstreamModelId: modelId, name: 'Question fixture', contextWindow: 32000, maxOutputTokens: 1000, agentEnabled: true, compactionEnabled: false })
    await db.insert(tables.modelPricingVersions).values({ id: randomUUID(), modelId, inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0 })
    await db.insert(tables.applicationSettings).values({ key: 'agent', value: { enabled: true, billWorkspaces: false, maxToolCalls: 4 } }).onConflictDoUpdate({ target: tables.applicationSettings.key, set: { value: { enabled: true, billWorkspaces: false, maxToolCalls: 4 } } })
    await db.insert(tables.chats).values({ id: chatId, userId: owner, modelId, title: 'Question regression' })
    const response = await createResponse({ ownerUserId: owner, chatId, input: createChatResponseSchema.parse({ modelId, input: 'Create a game', agentMode: true }) })
    const id = response.id
    const read = async () => (await db.select().from(tables.responses).where(eq(tables.responses.id, id)))[0]!
    await processAgentGeneration(id, false)
    const first = await read()
    expect(first.status).toBe('in_progress')
    expect(operations).toEqual(['before'])
    const q1 = questionItems(first.output as unknown[]).find(q => q.status === 'pending')!
    expect(q1).toBeDefined()
    await answerAgentQuestions(id, q1.id, owner, { action: 'submit', answers: { theme: { kind: 'text', text: 'custom ocean answer' } } })
    await processAgentGeneration(id, false)
    const second = await read()
    const q2 = questionItems(second.output as unknown[]).find(q => q.status === 'pending')!
    expect(q2.id).not.toBe(q1.id)
    expect(operations).toEqual(['before'])
    await answerAgentQuestions(id, q2.id, owner, { action: 'skip_all' })
    await processAgentGeneration(id, false)
    const completed = await read()
    expect(completed.status).toBe('completed')
    expect(operations).toEqual(['before', 'after'])
    expect(questionItems(completed.output as unknown[]).map(q => q.status)).toEqual(['answered', 'skipped'])
    const [run] = await db.select().from(tables.agentRuns).where(eq(tables.agentRuns.responseId, id))
    expect(run?.toolCalls).toBe(4)
    expect(run?.modelTurns).toBe(2)
    expect(requests.some(body => JSON.stringify(body.input).includes('custom ocean answer'))).toBe(true)
  } finally {
    await db.delete(tables.users).where(eq(tables.users.id, owner)).catch(() => undefined)
    await db.delete(tables.models).where(eq(tables.models.id, modelId)).catch(() => undefined)
    await db.delete(tables.providerConnections).where(eq(tables.providerConnections.id, providerId)).catch(() => undefined)
    await Promise.all([generationQueue, maintenanceQueue, embeddingQueue, codexLoginQueue, payloadRetentionQueue].map(queue => queue.close()))
    await redis.quit(); await queryClient.end(); providerServer.close()
  }
}, 30_000)
