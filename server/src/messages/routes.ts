import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { messageFeedback, responseItems, responses } from '../database/schema.js'
import { notFound } from '../lib/errors.js'
import { createResponse, toSnapshot } from '../responses/service.js'

function inputText(input: unknown): string {
  if (!Array.isArray(input)) return ''
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index] as { role?: string; content?: unknown }
    if (item.role !== 'user') continue
    if (typeof item.content === 'string') return item.content
    if (Array.isArray(item.content)) return item.content.map((part) => (part as { text?: string }).text ?? '').join('')
  }
  return ''
}

async function ownedResponse(userId: string, id: string) {
  const responseId = id.endsWith(':input') ? id.slice(0, -6) : id
  const [row] = await db.select().from(responses).where(and(eq(responses.id, responseId), eq(responses.userId, userId))).limit(1)
  if (!row) throw notFound('Message')
  return row
}

export async function registerMessageRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/messages/:id/regenerate', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const original = await ownedResponse(user.id, id)
    const created = await createResponse({
      userId: user.id,
      chatId: original.chatId,
      parentResponseId: original.parentResponseId,
      idempotencyKey: request.headers['idempotency-key'] as string | undefined,
      input: {
        input: inputText(original.input), modelId: original.modelId,
        executionMode: original.executionMode, presetSelections: original.presetSelections as Record<string, string>, attachmentIds: [],
      },
    })
    reply.code(202)
    return { response: toSnapshot(created) }
  })

  app.patch('/api/messages/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const original = await ownedResponse(user.id, id)
    const { content } = z.object({ content: z.string().trim().min(1).max(1_000_000) }).parse(request.body)
    const created = await createResponse({
      userId: user.id,
      chatId: original.chatId,
      parentResponseId: original.parentResponseId,
      idempotencyKey: request.headers['idempotency-key'] as string | undefined,
      input: {
        input: content, modelId: original.modelId, executionMode: original.executionMode,
        presetSelections: original.presetSelections as Record<string, string>, attachmentIds: [],
      },
    })
    reply.code(202)
    return { response: toSnapshot(created) }
  })

  app.put('/api/messages/:id/feedback', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const response = await ownedResponse(user.id, id)
    const { rating, comment } = z.object({
      rating: z.enum(['up', 'down']).nullable(), comment: z.string().max(2_000).nullable().optional(),
    }).parse(request.body)
    const [item] = await db.select({ id: responseItems.id }).from(responseItems)
      .where(and(eq(responseItems.responseId, response.id), eq(responseItems.type, 'message'))).limit(1)
    if (!item) throw notFound('Response item')
    if (rating === null) {
      await db.delete(messageFeedback).where(and(eq(messageFeedback.responseItemId, item.id), eq(messageFeedback.userId, user.id)))
      reply.code(204).send()
      return
    }
    await db.insert(messageFeedback).values({ responseItemId: item.id, userId: user.id, rating, comment })
      .onConflictDoUpdate({
        target: [messageFeedback.responseItemId, messageFeedback.userId],
        set: { rating, comment, createdAt: new Date() },
      })
    return { rating, comment: comment ?? null }
  })
}
