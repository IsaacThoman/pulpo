import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { CreateChatResponseInput, ResponseSnapshot } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { attachments, chats, modelPresetChoices, modelPresets, models, responses } from '../database/schema.js'
import { getActivePricing, reserveBudget } from '../accounting/service.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { generationQueue } from '../jobs.js'

export interface CreateResponseOptions {
  userId: string
  chatId: string
  apiKeyId?: string | null
  input: CreateChatResponseInput
  rawInput?: unknown
  parameters?: Record<string, unknown>
  idempotencyKey?: string | null
  parentResponseId?: string | null
  branchReason?: 'message' | 'regenerate' | 'user_edit'
}

async function resolveModel(modelId: string, selections: Record<string, string>): Promise<typeof models.$inferSelect | undefined> {
  const visited = new Set<string>()
  let currentId = modelId
  while (!visited.has(currentId)) {
    visited.add(currentId)
    const [current] = await db.select().from(models).where(and(eq(models.id, currentId), eq(models.enabled, true))).limit(1)
    if (!current) return undefined
    const presets = await db.select().from(modelPresets).where(eq(modelPresets.modelId, current.id))
    const redirects = new Set<string>()
    for (const preset of presets) {
      const selected = selections[preset.publicId]
      if (!selected) continue
      const [choice] = await db.select().from(modelPresetChoices).where(and(
        eq(modelPresetChoices.presetId, preset.id), eq(modelPresetChoices.publicId, selected),
      )).limit(1)
      if (choice?.actionType === 'redirect') {
        const target = (choice.action as { modelId?: string }).modelId
        if (target) redirects.add(target)
      }
    }
    if (redirects.size === 0) return current
    if (redirects.size > 1) throw new AppError(400, 'conflicting_model_redirects', 'Preset choices redirect to different models')
    currentId = [...redirects][0]!
  }
  throw new AppError(409, 'preset_redirect_cycle', 'Preset redirects contain a cycle')
}

export async function createResponse(options: CreateResponseOptions) {
  if (options.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(responses)
      .where(and(eq(responses.userId, options.userId), eq(responses.idempotencyKey, options.idempotencyKey)))
      .limit(1)
    if (existing) return existing
  }
  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, options.chatId), eq(chats.userId, options.userId), isNull(chats.deletedAt)))
    .limit(1)
  if (!chat) throw notFound('Chat')
  const model = await resolveModel(options.input.modelId, options.input.presetSelections)
  if (!model) throw new AppError(400, 'model_not_found', 'The selected model is unavailable', 'invalid_request_error', 'model')
  const maxOutputTokens = Math.min(options.input.maxOutputTokens ?? model.maxOutputTokens, model.maxOutputTokens)
  const pricing = await getActivePricing(model.id)
  const id = newId()
  const [previous] = chat.activeResponseId
    ? await db.select({ id: responses.id }).from(responses).where(eq(responses.id, chat.activeResponseId)).limit(1)
    : []
  const parentResponseId = options.parentResponseId === undefined ? previous?.id ?? null : options.parentResponseId
  const executionMode = options.input.executionMode ?? model.executionMode
  if (options.input.attachmentIds.length) {
    const ownedAttachments = await db.select().from(attachments).where(and(
      eq(attachments.userId, options.userId), eq(attachments.status, 'ready'), inArray(attachments.id, options.input.attachmentIds),
    ))
    if (ownedAttachments.length !== options.input.attachmentIds.length) throw new AppError(400, 'attachment_not_ready', 'One or more attachments are unavailable')
    await db.update(attachments).set({ chatId: chat.id, updatedAt: new Date() }).where(inArray(attachments.id, options.input.attachmentIds))
  }
  const storedInput = options.rawInput !== undefined
    ? (typeof options.rawInput === 'string' ? [{ role: 'user', content: options.rawInput }] : options.rawInput)
    : [{
    role: 'user',
    content: [
      { type: 'input_text', text: options.input.input },
      ...options.input.attachmentIds.map((attachmentId) => ({ type: 'input_file', attachment_id: attachmentId })),
    ],
  }]
  await db.insert(responses).values({
    id,
    chatId: chat.id,
    userId: options.userId,
    modelId: model.id,
    previousResponseId: parentResponseId,
    parentResponseId,
    branchReason: options.branchReason ?? 'message',
    executionMode,
    input: storedInput,
    presetSelections: options.input.presetSelections,
    parameters: options.parameters ?? {},
    idempotencyKey: options.idempotencyKey,
  })
  try {
    await reserveBudget({
      responseId: id,
      userId: options.userId,
      apiKeyId: options.apiKeyId,
      requestInput: storedInput,
      maxOutputTokens,
      pricing,
    })
    await db.update(chats).set({ activeResponseId: id, activeBranchLeafId: id, updatedAt: new Date() }).where(eq(chats.id, chat.id))
    await generationQueue.add('generate', { responseId: id }, { jobId: id })
  } catch (error) {
    await db.delete(responses).where(eq(responses.id, id))
    throw error
  }
  const [created] = await db.select().from(responses).where(eq(responses.id, id)).limit(1)
  return created!
}

export function toSnapshot(response: typeof responses.$inferSelect): ResponseSnapshot {
  return {
    responseId: response.id,
    status: response.status,
    sequence: response.lastSequence,
    output: response.output as unknown[],
    usage: response.usage as ResponseSnapshot['usage'],
    error: response.error,
    updatedAt: response.updatedAt.toISOString(),
  }
}
