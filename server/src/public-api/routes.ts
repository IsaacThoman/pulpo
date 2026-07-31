import { and, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { db } from '../database/client.js'
import { chats, models, responses } from '../database/schema.js'
import { authenticateApiKey, assertApiKeyModelAllowed } from '../api-keys/routes.js'
import { newId } from '../lib/ids.js'
import { createResponse } from '../responses/service.js'
import { createRedis } from '../redis.js'
import { requestCancellation } from '../responses/events.js'
import { notFound } from '../lib/errors.js'

const publicResponseInput = z.object({
  model: z.string().min(1),
  input: z.union([z.string(), z.array(z.unknown())]),
  stream: z.boolean().default(false),
  background: z.boolean().default(false),
  max_output_tokens: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
})

function publicResponse(row: typeof responses.$inferSelect) {
  const usage = row.usage as {
    inputTokens?: number
    cachedInputTokens?: number
    outputTokens?: number
    reasoningTokens?: number
    totalTokens?: number
  } | null
  return {
    id: row.id,
    object: 'response',
    created_at: Math.floor(row.createdAt.getTime() / 1_000),
    status: row.status,
    model: row.modelId,
    output: row.output,
    error: row.error,
    usage: usage ? {
      input_tokens: usage.inputTokens ?? 0,
      input_tokens_details: { cached_tokens: usage.cachedInputTokens ?? 0 },
      output_tokens: usage.outputTokens ?? 0,
      output_tokens_details: { reasoning_tokens: usage.reasoningTokens ?? 0 },
      total_tokens: usage.totalTokens ?? 0,
    } : null,
    metadata: {},
  }
}

async function streamResponse(reply: FastifyReply, responseId: string): Promise<void> {
  const subscriber = createRedis()
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  })
  await subscriber.subscribe('pulpo:response-events', 'pulpo:response-snapshots')
  const close = async () => {
    await subscriber.quit()
    if (!reply.raw.writableEnded) reply.raw.end()
  }
  reply.raw.on('close', () => void subscriber.quit())
  subscriber.on('message', (channel: string, message: string) => {
    const parsed = JSON.parse(message)
    if (parsed.responseId !== responseId) return
    if (channel === 'pulpo:response-events') {
      reply.raw.write(`data: ${JSON.stringify(parsed.payload)}\n\n`)
    } else if (['completed', 'failed', 'cancelled', 'incomplete'].includes(parsed.status)) {
      reply.raw.write('data: [DONE]\n\n')
      void close()
    }
  })
}

async function waitForTerminal(responseId: string) {
  for (let attempt = 0; attempt < 1_800; attempt += 1) {
    const [row] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (!row) throw notFound('Response')
    if (!['queued', 'in_progress'].includes(row.status)) return row
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Response did not reach a terminal state')
}

export async function registerPublicApiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/models', async (request) => {
    await authenticateApiKey(request, 'models')
    const rows = await db.select().from(models).where(eq(models.enabled, true))
    return { object: 'list', data: rows.map((model) => ({
      id: model.id,
      object: 'model',
      created: Math.floor(model.createdAt.getTime() / 1_000),
      owned_by: 'pulpo',
    })) }
  })

  app.post('/v1/responses', async (request, reply) => {
    const key = await authenticateApiKey(request, 'responses')
    const user = request.user!
    const input = publicResponseInput.parse(request.body)
    await assertApiKeyModelAllowed(key.id, input.model)
    const chatId = newId()
    await db.insert(chats).values({
      id: chatId,
      userId: user.id,
      modelId: input.model,
      title: 'API request',
      temporary: true,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    const created = await createResponse({
      userId: user.id,
      chatId,
      apiKeyId: key.id,
      idempotencyKey: request.headers['idempotency-key'] as string | undefined,
      input: {
        input: typeof input.input === 'string' ? input.input : '[structured input]',
        modelId: input.model,
        executionMode: input.background ? 'background' : 'stream',
        maxOutputTokens: input.max_output_tokens,
        presetSelections: {},
        attachmentIds: [],
      },
      rawInput: input.input,
    })
    if (input.stream) return streamResponse(reply, created.id)
    if (input.background) {
      reply.code(202)
      return publicResponse(created)
    }
    return publicResponse(await waitForTerminal(created.id))
  })

  app.get('/v1/responses/:id', async (request) => {
    const key = await authenticateApiKey(request, 'responses')
    const { id } = request.params as { id: string }
    const [row] = await db.select().from(responses).where(and(eq(responses.id, id), eq(responses.userId, key.userId))).limit(1)
    if (!row) throw notFound('Response')
    return publicResponse(row)
  })

  app.post('/v1/responses/:id/cancel', async (request) => {
    const key = await authenticateApiKey(request, 'responses')
    const { id } = request.params as { id: string }
    const [row] = await db.select().from(responses).where(and(eq(responses.id, id), eq(responses.userId, key.userId))).limit(1)
    if (!row) throw notFound('Response')
    if (['queued', 'in_progress'].includes(row.status)) await requestCancellation(id)
    const [current] = await db.select().from(responses).where(eq(responses.id, id)).limit(1)
    return publicResponse(current!)
  })
}
