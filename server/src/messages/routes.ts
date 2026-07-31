import { and, asc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { chats, responses, users } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { newestDescendantId } from './branching.js'
import { publishStateChange } from '../responses/events.js'
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

async function bumpRevision(userId: string, chatId: string): Promise<void> {
  const [updated] = await db.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
    .where(eq(users.id, userId)).returning({ revision: users.stateRevision })
  if (updated) await publishStateChange({ userId, chatId, revision: updated.revision })
}

function editedOutput(content: string): unknown[] {
  return [{
    id: `msg_${newId()}`,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: content, annotations: [] }],
  }]
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
      branchReason: 'regenerate',
      idempotencyKey: request.headers['idempotency-key'] as string | undefined,
      input: {
        input: inputText(original.input), modelId: original.modelId,
        executionMode: original.executionMode, presetSelections: original.presetSelections as Record<string, string>, attachmentIds: [],
      },
    })
    await bumpRevision(user.id, original.chatId)
    reply.code(202)
    return { response: toSnapshot(created) }
  })

  app.patch('/api/messages/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const original = await ownedResponse(user.id, id)
    const { content } = z.object({ content: z.string().trim().min(1).max(1_000_000) }).parse(request.body)
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined
    if (id.endsWith(':input')) {
      const created = await createResponse({
        userId: user.id,
        chatId: original.chatId,
        parentResponseId: original.parentResponseId,
        branchReason: 'user_edit',
        idempotencyKey,
        input: {
          input: content, modelId: original.modelId, executionMode: original.executionMode,
          presetSelections: original.presetSelections as Record<string, string>, attachmentIds: [],
        },
      })
      await bumpRevision(user.id, original.chatId)
      reply.code(202)
      return { response: toSnapshot(created) }
    }
    if (idempotencyKey) {
      const [existing] = await db.select().from(responses).where(and(
        eq(responses.userId, user.id),
        eq(responses.idempotencyKey, idempotencyKey),
      )).limit(1)
      if (existing) {
        reply.code(201)
        return { response: toSnapshot(existing) }
      }
    }
    const createdAt = new Date()
    const createdId = newId()
    const output = editedOutput(content)
    await db.transaction(async (tx) => {
      await tx.insert(responses).values({
        id: createdId,
        chatId: original.chatId,
        userId: user.id,
        modelId: original.modelId,
        pricingVersionId: original.pricingVersionId,
        previousResponseId: original.parentResponseId,
        parentResponseId: original.parentResponseId,
        branchReason: 'assistant_edit',
        status: 'completed',
        executionMode: original.executionMode,
        input: original.input,
        instructions: original.instructions,
        presetSelections: original.presetSelections,
        parameters: original.parameters,
        idempotencyKey,
        output,
        completedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      })
      await tx.update(chats).set({
        activeResponseId: createdId,
        activeBranchLeafId: createdId,
        updatedAt: createdAt,
      }).where(and(eq(chats.id, original.chatId), eq(chats.userId, user.id)))
    })
    await bumpRevision(user.id, original.chatId)
    const [created] = await db.select().from(responses).where(eq(responses.id, createdId)).limit(1)
    if (!created) throw new AppError(500, 'assistant_edit_failed', 'The edited response could not be saved')
    reply.code(201)
    return { response: toSnapshot(created) }
  })

  app.post('/api/messages/:id/activate', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const selected = await ownedResponse(user.id, id)
    const turns = await db.select().from(responses).where(and(
      eq(responses.chatId, selected.chatId),
      eq(responses.userId, user.id),
    )).orderBy(asc(responses.createdAt))
    const leafId = newestDescendantId(turns, selected.id)
    await db.update(chats).set({ activeResponseId: leafId, activeBranchLeafId: leafId, updatedAt: new Date() })
      .where(and(eq(chats.id, selected.chatId), eq(chats.userId, user.id)))
    await bumpRevision(user.id, selected.chatId)
    return { activeBranchLeafId: leafId }
  })
}
