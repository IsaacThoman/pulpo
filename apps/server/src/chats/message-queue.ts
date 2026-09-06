import { and, asc, eq, inArray, isNull, max, ne, sql } from 'drizzle-orm'
import type { CreateQueuedMessageInput, QueuedMessage, ReorderQueuedMessageInput, UpdateQueuedMessageInput } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { applicationSettings, attachments, chats, models, queuedMessages, responses, users } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { publishStateChange } from '../responses/events.js'
import { createResponse, resolveResponseGeneration } from '../responses/service.js'
import { parseAgentSettings } from '../settings/application-settings.js'
import { attachmentsRequireAgentMode } from '../attachments/policy.js'
import { accessibleChatCondition } from './temporary.js'
import { canPromoteQueueHead, nextQueuePosition, reorderQueueIds } from './message-queue-policy.js'

type QueueRow = typeof queuedMessages.$inferSelect

async function bumpQueueRevision(userId: string, chatId: string): Promise<void> {
  const [updated] = await db.update(users)
    .set({ stateRevision: sql`${users.stateRevision} + 1` })
    .where(eq(users.id, userId))
    .returning({ revision: users.stateRevision })
  if (updated) await publishStateChange({ userId, revision: updated.revision, chatId })
}

async function validateQueueInput(userId: string, chatId: string, input: CreateQueuedMessageInput): Promise<void> {
  await assertAccessibleChat(userId, chatId)

  const generation = await resolveResponseGeneration(input.modelId, input.presetSelections)
  const [model] = await db.select({ id: models.id, agentEnabled: models.agentEnabled })
    .from(models).where(and(eq(models.id, generation.effectiveModelId), eq(models.enabled, true))).limit(1)
  if (!model) throw new AppError(400, 'model_not_found', 'The selected model is unavailable')

  const attachmentRows = input.attachmentIds.length
    ? await db.select({ id: attachments.id, mimeType: attachments.mimeType }).from(attachments).where(and(
        eq(attachments.userId, userId),
        eq(attachments.status, 'ready'),
        inArray(attachments.id, input.attachmentIds),
      ))
    : []
  if (attachmentRows.length !== new Set(input.attachmentIds).size) {
    throw new AppError(400, 'attachment_not_ready', 'One or more attachments are unavailable')
  }
  if (!input.agentMode && attachmentsRequireAgentMode(attachmentRows)) {
    throw new AppError(400, 'attachment_requires_agent', 'Non-image attachments require Agent mode')
  }
  if (input.agentMode) {
    if (!model.agentEnabled) throw new AppError(400, 'model_not_agent_capable', 'The selected model is not enabled for agent mode')
    const [agentRow] = await db.select({ value: applicationSettings.value })
      .from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1)
    if (!parseAgentSettings(agentRow?.value).enabled) throw new AppError(503, 'agent_unavailable', 'Agent mode is not enabled')
  }
}

async function assertAccessibleChat(userId: string, chatId: string): Promise<void> {
  const [chat] = await db.select({ id: chats.id }).from(chats).where(and(
    eq(chats.id, chatId),
    eq(chats.userId, userId),
    isNull(chats.deletedAt),
    accessibleChatCondition(),
  )).limit(1)
  if (!chat) throw notFound('Chat')
}

export async function listQueuedMessages(chatId: string, userId: string): Promise<QueuedMessage[]> {
  const rows = await db.select().from(queuedMessages).where(and(
    eq(queuedMessages.chatId, chatId),
    eq(queuedMessages.userId, userId),
  )).orderBy(asc(queuedMessages.position), asc(queuedMessages.id))
  const attachmentIds = [...new Set(rows.flatMap((row) => row.attachmentIds))]
  const attachmentRows = attachmentIds.length ? await db.select({
    id: attachments.id,
    originalName: attachments.originalName,
    mimeType: attachments.mimeType,
    sizeBytes: attachments.sizeBytes,
  }).from(attachments).where(and(
    eq(attachments.userId, userId),
    eq(attachments.status, 'ready'),
    inArray(attachments.id, attachmentIds),
  )) : []
  const byId = new Map(attachmentRows.map((attachment) => [attachment.id, attachment]))
  return rows.map((row) => ({
    id: row.id,
    chatId: row.chatId,
    content: row.content,
    modelId: row.modelId,
    presetSelections: row.presetSelections,
    agentMode: row.agentMode,
    position: row.position,
    status: row.status as QueuedMessage['status'],
    error: row.error,
    attachments: row.attachmentIds.flatMap((id) => {
      const attachment = byId.get(id)
      return attachment ? [{
        id: attachment.id,
        name: attachment.originalName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
      }] : []
    }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }))
}

export async function createQueuedMessage(
  userId: string,
  chatId: string,
  input: CreateQueuedMessageInput,
  attribution: { billingUserId?: string; actorUserId?: string | null; requestReceivedAt?: Date | null } = {},
): Promise<{ queuedMessage: QueuedMessage | null }> {
  const requestReceivedAt = attribution.requestReceivedAt ?? new Date()
  await validateQueueInput(userId, chatId, input)
  const id = input.clientId ?? newId()
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pulpo-message-queue:${chatId}`}))`)
    const [chat] = await tx.select({ id: chats.id }).from(chats).where(and(
      eq(chats.id, chatId), eq(chats.userId, userId), isNull(chats.deletedAt), accessibleChatCondition(),
    )).limit(1)
    if (!chat) throw notFound('Chat')
    // The queue and its dispatched response share a stable client identity so a
    // retry is safe even after the queue row has been consumed.
    if (input.clientId) {
      const [queued] = await tx.select({ chatId: queuedMessages.chatId, userId: queuedMessages.userId })
        .from(queuedMessages).where(eq(queuedMessages.id, id)).limit(1)
      const [dispatched] = await tx.select({ chatId: responses.chatId, userId: responses.userId })
        .from(responses).where(eq(responses.id, id)).limit(1)
      const existing = queued ?? dispatched
      if (existing) {
        if (existing.chatId !== chatId || existing.userId !== userId) throw new AppError(409, 'submission_conflict', 'Submission ID is already in use')
        return
      }
    }
    const [positionRow] = await tx.select({ value: max(queuedMessages.position) })
      .from(queuedMessages).where(eq(queuedMessages.chatId, chatId))
    await tx.insert(queuedMessages).values({
      id,
      chatId,
      userId,
      billingUserId: attribution.billingUserId,
      actorUserId: attribution.actorUserId,
      content: input.input,
      modelId: input.modelId,
      presetSelections: input.presetSelections,
      agentMode: input.agentMode,
      attachmentIds: [...new Set(input.attachmentIds)],
      position: nextQueuePosition(positionRow?.value),
      dispatchResponseId: input.clientId ?? newId(),
      requestReceivedAt,
    })
  })
  await bumpQueueRevision(userId, chatId)
  await advanceMessageQueue(chatId)
  const queued = (await listQueuedMessages(chatId, userId)).find((item) => item.id === id) ?? null
  return { queuedMessage: queued }
}

export async function updateQueuedMessage(
  userId: string,
  chatId: string,
  id: string,
  input: UpdateQueuedMessageInput,
  attribution: { billingUserId?: string; actorUserId?: string | null } = {},
): Promise<QueuedMessage | null> {
  await assertAccessibleChat(userId, chatId)
  if (input.action === 'save_edit') {
    await validateQueueInput(userId, chatId, {
      input: input.input,
      modelId: input.modelId,
      presetSelections: input.presetSelections,
      attachmentIds: input.attachmentIds,
      agentMode: input.agentMode,
    })
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pulpo-message-queue:${chatId}`}))`)
    const [chat] = await tx.select({ id: chats.id }).from(chats).where(and(
      eq(chats.id, chatId), eq(chats.userId, userId), isNull(chats.deletedAt), accessibleChatCondition(),
    )).limit(1)
    if (!chat) throw notFound('Chat')
    const [current] = await tx.select().from(queuedMessages).where(and(
      eq(queuedMessages.id, id), eq(queuedMessages.chatId, chatId), eq(queuedMessages.userId, userId),
    )).limit(1)
    if (!current) throw notFound('Queued message')
    if (current.status === 'dispatching') throw new AppError(409, 'queued_message_dispatching', 'This message is already being sent')
    if (input.action === 'begin_edit') {
      const [other] = await tx.select({ id: queuedMessages.id }).from(queuedMessages).where(and(
        eq(queuedMessages.chatId, chatId),
        eq(queuedMessages.status, 'editing'),
        ne(queuedMessages.id, id),
      )).limit(1)
      if (other) throw new AppError(409, 'queued_message_editing', 'Another queued message is already being edited')
      await tx.update(queuedMessages).set({ status: 'editing', error: null, updatedAt: new Date() })
        .where(eq(queuedMessages.id, id))
    } else if (input.action === 'cancel_edit') {
      await tx.update(queuedMessages).set({ status: 'pending', error: null, updatedAt: new Date() })
        .where(eq(queuedMessages.id, id))
    } else {
      await tx.update(queuedMessages).set({
        content: input.input,
        modelId: input.modelId,
        presetSelections: input.presetSelections,
        agentMode: input.agentMode,
        attachmentIds: [...new Set(input.attachmentIds)],
        billingUserId: attribution.billingUserId ?? userId,
        actorUserId: attribution.actorUserId ?? null,
        status: 'pending',
        error: null,
        updatedAt: new Date(),
      }).where(eq(queuedMessages.id, id))
    }
  })
  await bumpQueueRevision(userId, chatId)
  if (input.action !== 'begin_edit') await advanceMessageQueue(chatId)
  return (await listQueuedMessages(chatId, userId)).find((item) => item.id === id) ?? null
}

export async function deleteQueuedMessage(userId: string, chatId: string, id: string): Promise<void> {
  await assertAccessibleChat(userId, chatId)
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pulpo-message-queue:${chatId}`}))`)
    const [chat] = await tx.select({ id: chats.id }).from(chats).where(and(
      eq(chats.id, chatId), eq(chats.userId, userId), isNull(chats.deletedAt), accessibleChatCondition(),
    )).limit(1)
    if (!chat) throw notFound('Chat')
    const [current] = await tx.select({ status: queuedMessages.status }).from(queuedMessages).where(and(
      eq(queuedMessages.id, id), eq(queuedMessages.chatId, chatId), eq(queuedMessages.userId, userId),
    )).limit(1)
    if (!current) throw notFound('Queued message')
    if (current.status === 'dispatching') throw new AppError(409, 'queued_message_dispatching', 'This message is already being sent')
    await tx.delete(queuedMessages).where(eq(queuedMessages.id, id))
  })
  await bumpQueueRevision(userId, chatId)
  await advanceMessageQueue(chatId)
}

export async function reorderQueuedMessage(
  userId: string,
  chatId: string,
  id: string,
  input: ReorderQueuedMessageInput,
): Promise<QueuedMessage[]> {
  await assertAccessibleChat(userId, chatId)
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pulpo-message-queue:${chatId}`}))`)
    const rows = await tx.select({ id: queuedMessages.id, status: queuedMessages.status })
      .from(queuedMessages).where(and(
        eq(queuedMessages.chatId, chatId), eq(queuedMessages.userId, userId),
      )).orderBy(asc(queuedMessages.position), asc(queuedMessages.id))
    const moving = rows.find((row) => row.id === id)
    const target = rows.find((row) => row.id === input.targetMessageId)
    if (!moving || !target) throw notFound('Queued message')
    if (moving.status === 'dispatching' || target.status === 'dispatching') {
      throw new AppError(409, 'queued_message_dispatching', 'A message that is already being sent cannot be reordered')
    }
    const currentIds = rows.map((row) => row.id)
    const reorderedIds = reorderQueueIds(currentIds, id, input.targetMessageId, input.edge)
    if (reorderedIds === currentIds) return

    // Use unique temporary positions while reassigning the queue's persisted order.
    for (const [index, messageId] of reorderedIds.entries()) {
      await tx.update(queuedMessages).set({ position: -(index + 1) }).where(eq(queuedMessages.id, messageId))
    }
    for (const [position, messageId] of reorderedIds.entries()) {
      await tx.update(queuedMessages).set({ position }).where(eq(queuedMessages.id, messageId))
    }
  })
  await bumpQueueRevision(userId, chatId)
  return listQueuedMessages(chatId, userId)
}

export async function advanceMessageQueue(chatId: string): Promise<void> {
  const claim = await db.transaction(async (tx): Promise<QueueRow | null> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pulpo-message-queue:${chatId}`}))`)
    const [chat] = await tx.select().from(chats).where(and(
      eq(chats.id, chatId), isNull(chats.deletedAt), accessibleChatCondition(),
    )).limit(1)
    if (!chat) return null
    const [active] = await tx.select({ id: responses.id }).from(responses).where(and(
      eq(responses.chatId, chatId),
      inArray(responses.status, ['queued', 'in_progress']),
      isNull(responses.deletedAt),
    )).limit(1)
    if (active) return null
    const [head] = await tx.select().from(queuedMessages)
      .where(eq(queuedMessages.chatId, chatId))
      .orderBy(asc(queuedMessages.position), asc(queuedMessages.id)).limit(1)
    if (!head) return null
    if (!canPromoteQueueHead(head.status as QueuedMessage['status'])) return null
    const [claimed] = await tx.update(queuedMessages).set({
      status: 'dispatching', error: null, updatedAt: new Date(),
    }).where(eq(queuedMessages.id, head.id)).returning()
    return claimed ?? null
  })
  if (!claim) return

  try {
    const [existing] = await db.select().from(responses).where(eq(responses.id, claim.dispatchResponseId)).limit(1)
    if (!existing) {
      const [chat] = await db.select({ activeBranchLeafId: chats.activeBranchLeafId, activeResponseId: chats.activeResponseId })
        .from(chats).where(eq(chats.id, chatId)).limit(1)
      await createResponse({
        requestReceivedAt: claim.requestReceivedAt ?? claim.createdAt,
        ownerUserId: claim.userId,
        billingUserId: claim.billingUserId ?? claim.userId,
        actorUserId: claim.actorUserId,
        chatId,
        parentResponseId: chat?.activeBranchLeafId ?? chat?.activeResponseId ?? null,
        input: {
          clientId: claim.dispatchResponseId,
          input: claim.content,
          modelId: claim.modelId,
          presetSelections: claim.presetSelections,
          attachmentIds: claim.attachmentIds,
          agentMode: claim.agentMode,
        },
      })
    }
    await db.delete(queuedMessages).where(eq(queuedMessages.id, claim.id))
  } catch (error) {
    await db.update(queuedMessages).set({
      status: 'failed',
      error: error instanceof AppError ? error.message : 'Unable to start this queued message',
      updatedAt: new Date(),
    }).where(eq(queuedMessages.id, claim.id))
  }
  await bumpQueueRevision(claim.userId, chatId)
}

export async function recoverMessageQueues(): Promise<void> {
  const rows = await db.selectDistinct({ chatId: queuedMessages.chatId, userId: queuedMessages.userId }).from(queuedMessages)
  for (const row of rows) {
    const cleaned = await db.transaction(async (tx): Promise<boolean> => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pulpo-message-queue:${row.chatId}`}))`)
      const [head] = await tx.select().from(queuedMessages).where(eq(queuedMessages.chatId, row.chatId))
        .orderBy(asc(queuedMessages.position), asc(queuedMessages.id)).limit(1)
      if (head?.status !== 'dispatching') return false
      const [existing] = await tx.select({ id: responses.id }).from(responses)
        .where(eq(responses.id, head.dispatchResponseId)).limit(1)
      if (existing) await tx.delete(queuedMessages).where(eq(queuedMessages.id, head.id))
      else await tx.update(queuedMessages).set({ status: 'pending', updatedAt: new Date() }).where(eq(queuedMessages.id, head.id))
      return true
    })
    if (cleaned) await bumpQueueRevision(row.userId, row.chatId)
    await advanceMessageQueue(row.chatId)
  }
}
