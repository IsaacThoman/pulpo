import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { idSchema } from '@pulpo/contracts'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { chats, requestLogs, responses, users } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { cascadeDeletionIds, newestDescendantId } from './branching.js'
import { publishStateChange, requestCancellation } from '../responses/events.js'
import { createResponse, toSnapshot } from '../responses/service.js'
import { replaceResponseInputText, responseAttachmentIds, responseInputText } from './input.js'
import { accessibleChatCondition, temporaryChatIsExpired } from '../chats/temporary.js'

async function ownedResponse(userId: string, id: string) {
  const responseId = id.endsWith(':input') ? id.slice(0, -6) : id
  const now = new Date()
  const [row] = await db.select({ response: responses }).from(responses)
    .innerJoin(chats, eq(chats.id, responses.chatId))
    .where(and(
      eq(responses.id, responseId),
      eq(responses.userId, userId),
      isNull(responses.deletedAt),
      isNull(chats.deletedAt),
      accessibleChatCondition(now),
    )).limit(1)
  if (row) return row.response
  const [owned] = await db.select({ temporary: chats.temporary, expiresAt: chats.expiresAt })
    .from(responses)
    .innerJoin(chats, eq(chats.id, responses.chatId))
    .where(and(eq(responses.id, responseId), eq(responses.userId, userId), isNull(chats.deletedAt)))
    .limit(1)
  if (owned && temporaryChatIsExpired(owned, now)) {
    throw new AppError(410, 'temporary_chat_expired', 'This temporary chat has expired and cannot be recovered')
  }
  throw notFound('Message')
}

async function bumpRevision(userId: string, chatId: string): Promise<void> {
  const [permanent] = await db.select({ id: chats.id }).from(chats).where(and(
    eq(chats.id, chatId),
    eq(chats.userId, userId),
    eq(chats.temporary, false),
    isNull(chats.deletedAt),
  )).limit(1)
  if (!permanent) return
  const [updated] = await db.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
    .where(eq(users.id, userId)).returning({ revision: users.stateRevision })
  if (updated) await publishStateChange({ userId, chatId, revision: updated.revision })
}

async function requestedModelId(responseId: string, fallbackModelId: string): Promise<string> {
  const [log] = await db.select({ modelId: requestLogs.requestedModelId })
    .from(requestLogs).where(eq(requestLogs.responseId, responseId)).limit(1)
  return log?.modelId ?? fallbackModelId
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

const generationSelectionSchema = z.object({
  clientId: idSchema.optional(),
  modelId: z.string().trim().min(1).optional(),
  presetSelections: z.record(z.string(), z.string()).optional(),
})

export async function registerMessageRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/messages/:id/regenerate', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const original = await ownedResponse(user.id, id)
    const selection = generationSelectionSchema.parse(request.body ?? {})
    const modelId = selection.modelId ?? await requestedModelId(original.id, original.modelId)
    const attachmentIds = responseAttachmentIds(original.input)
    const created = await createResponse({
      userId: user.id,
      chatId: original.chatId,
      rawInput: original.input,
      parentResponseId: original.parentResponseId,
      userMessageId: original.userMessageId ?? undefined,
      branchReason: 'regenerate',
      idempotencyKey: request.headers['idempotency-key'] as string | undefined,
      input: {
        clientId: selection.clientId,
        input: responseInputText(original.input), modelId,
        executionMode: selection.modelId ? undefined : original.executionMode,
        presetSelections: selection.modelId
          ? selection.presetSelections ?? {}
          : original.presetSelections as Record<string, string>,
        attachmentIds,
        agentMode: original.agentMode,
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
    const { clientId, content, modelId: selectedModelId, presetSelections } = generationSelectionSchema.extend({
      content: z.string().trim().max(1_000_000),
    }).parse(request.body)
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined
    if (id.endsWith(':input')) {
      const modelId = selectedModelId ?? await requestedModelId(original.id, original.modelId)
      const attachmentIds = responseAttachmentIds(original.input)
      if (!content && attachmentIds.length === 0) {
        throw new AppError(400, 'empty_message', 'Message must include text or attachments')
      }
      const created = await createResponse({
        userId: user.id,
        chatId: original.chatId,
        rawInput: replaceResponseInputText(original.input, content),
        parentResponseId: original.parentResponseId,
        branchReason: 'user_edit',
        idempotencyKey,
        input: {
          clientId,
          input: content, modelId,
          executionMode: selectedModelId ? undefined : original.executionMode,
          presetSelections: selectedModelId
            ? presetSelections ?? {}
            : original.presetSelections as Record<string, string>,
          attachmentIds,
          agentMode: original.agentMode,
        },
      })
      await bumpRevision(user.id, original.chatId)
      reply.code(202)
      return { response: toSnapshot(created) }
    }
    if (!content) {
      throw new AppError(400, 'empty_message', 'Message must include text')
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
    const createdId = clientId ?? newId()
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
        userMessageId: original.userMessageId,
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
      const [updatedChat] = await tx.update(chats).set({
        activeResponseId: createdId,
        activeBranchLeafId: createdId,
        updatedAt: createdAt,
      }).where(and(
        eq(chats.id, original.chatId),
        eq(chats.userId, user.id),
        isNull(chats.deletedAt),
        accessibleChatCondition(createdAt),
      )).returning({ id: chats.id })
      if (!updatedChat) {
        throw new AppError(410, 'temporary_chat_expired', 'This temporary chat has expired and cannot be recovered')
      }
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
      isNull(responses.deletedAt),
    )).orderBy(asc(responses.createdAt), asc(responses.id))
    const leafId = newestDescendantId(turns, selected.id)
    const now = new Date()
    const [updatedChat] = await db.update(chats).set({ activeResponseId: leafId, activeBranchLeafId: leafId, updatedAt: now })
      .where(and(
        eq(chats.id, selected.chatId),
        eq(chats.userId, user.id),
        isNull(chats.deletedAt),
        accessibleChatCondition(now),
      )).returning({ id: chats.id })
    if (!updatedChat) {
      throw new AppError(410, 'temporary_chat_expired', 'This temporary chat has expired and cannot be recovered')
    }
    await bumpRevision(user.id, selected.chatId)
    return { activeBranchLeafId: leafId }
  })

  app.delete('/api/messages/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const original = await ownedResponse(user.id, id)
    const [chat] = await db.select().from(chats).where(and(eq(chats.id, original.chatId), eq(chats.userId, user.id))).limit(1)
    const turns = await db.select().from(responses).where(and(eq(responses.chatId, original.chatId), eq(responses.userId, user.id), isNull(responses.deletedAt))).orderBy(asc(responses.createdAt), asc(responses.id))
    const deleting = cascadeDeletionIds(turns, original, id.endsWith(':input'))
    const now = new Date()
    if (deleting.size) {
      await Promise.all(turns.filter((turn) => deleting.has(turn.id) && ['queued', 'in_progress'].includes(turn.status)).map((turn) => requestCancellation(turn.id)))
      await db.update(responses).set({ deletedAt: now, updatedAt: now }).where(inArray(responses.id, [...deleting]))
    }
    const remaining = turns.filter((turn) => !deleting.has(turn.id))
    const currentLeaf = chat?.activeBranchLeafId ?? chat?.activeResponseId ?? null
    const leafId = currentLeaf && !deleting.has(currentLeaf) ? currentLeaf : remaining.at(-1)?.id ?? null
    await db.update(chats).set({ activeResponseId: leafId, activeBranchLeafId: leafId, updatedAt: now }).where(and(
      eq(chats.id, original.chatId),
      eq(chats.userId, user.id),
      isNull(chats.deletedAt),
      accessibleChatCondition(now),
    ))
    await bumpRevision(user.id, original.chatId)
    reply.code(204).send()
  })
}
