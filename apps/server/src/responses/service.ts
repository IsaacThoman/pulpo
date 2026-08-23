import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { ChatPreset, CreateChatResponseInput, ResponseSnapshot } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { applicationSettings, attachments, chats, modelPresetChoices, modelPresets, models, requestLogs, responses } from '../database/schema.js'
import { getActivePricing, releaseBudget, reserveBudget } from '../accounting/service.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { generationQueue } from '../jobs.js'
import { parseAgentSettings, parseLoggingSettings } from '../settings/application-settings.js'
import { publishAdminUsage } from '../admin/usage-events.js'
import { PresetResolutionError, resolvePresetActions, type PresetResolutionModel } from './presets.js'
import { attachmentsRequireAgentMode } from '../attachments/policy.js'
import {
  accessibleChatCondition,
  scheduleTemporaryChatExpiry,
  temporaryChatExpiryValue,
  temporaryChatExpiresAt,
  temporaryChatIsExpired,
} from '../chats/temporary.js'
import { sanitizeOutputForClient } from './public-output.js'
import { responseAttachmentIds } from '../messages/input.js'

export interface CreateResponseOptions {
  userId: string
  chatId: string
  apiKeyId?: string | null
  input: CreateChatResponseInput
  rawInput?: unknown
  parameters?: Record<string, unknown>
  idempotencyKey?: string | null
  parentResponseId?: string | null
  userMessageId?: string
  branchReason?: 'message' | 'regenerate' | 'user_edit'
}

async function loadPresetModel(modelId: string): Promise<PresetResolutionModel | undefined> {
  const [model] = await db.select().from(models).where(eq(models.id, modelId)).limit(1)
  if (!model) return undefined
  const presetRows = await db.select().from(modelPresets).where(eq(modelPresets.modelId, model.id)).orderBy(modelPresets.sortOrder)
  const presets: ChatPreset[] = await Promise.all(presetRows.map(async (preset) => ({
    id: preset.publicId,
    name: preset.name,
    icon: preset.icon as ChatPreset['icon'],
    defaultChoiceId: preset.defaultChoiceId
      ? (await db.select({ publicId: modelPresetChoices.publicId }).from(modelPresetChoices).where(eq(modelPresetChoices.id, preset.defaultChoiceId)).limit(1))[0]?.publicId ?? null
      : null,
    choices: (await db.select().from(modelPresetChoices).where(eq(modelPresetChoices.presetId, preset.id)).orderBy(modelPresetChoices.sortOrder)).map((choice) => ({
      id: choice.publicId,
      displayName: choice.displayName,
      icon: choice.icon as ChatPreset['icon'] | null,
      action: { type: choice.actionType, ...(choice.action as Record<string, unknown>) } as ChatPreset['choices'][number]['action'],
    })),
  })))
  return { id: model.id, enabled: model.enabled, allowedParameters: model.allowedParameters as string[], presets }
}

export async function resolveResponseGeneration(modelId: string, presetSelections: Record<string, string>) {
  try {
    return await resolvePresetActions(modelId, presetSelections, loadPresetModel)
  } catch (error) {
    if (!(error instanceof PresetResolutionError)) throw error
    if (error.code === 'conflicting_redirects') throw new AppError(400, 'conflicting_model_redirects', error.message)
    if (error.code === 'redirect_cycle') throw new AppError(409, 'preset_redirect_cycle', error.message)
    throw new AppError(400, 'model_not_found', error.message, 'invalid_request_error', 'model')
  }
}

export async function createResponse(options: CreateResponseOptions) {
  if (options.idempotencyKey) {
    const [existing] = await db
      .select({ response: responses })
      .from(responses)
      .innerJoin(chats, eq(chats.id, responses.chatId))
      .where(and(
        eq(responses.userId, options.userId),
        eq(responses.idempotencyKey, options.idempotencyKey),
        isNull(chats.deletedAt),
        accessibleChatCondition(),
      ))
      .limit(1)
    if (existing) return existing.response
  }
  const now = new Date()
  const [chat] = await db
    .select()
    .from(chats)
    .where(and(
      eq(chats.id, options.chatId),
      eq(chats.userId, options.userId),
      isNull(chats.deletedAt),
      accessibleChatCondition(now),
    ))
    .limit(1)
  if (!chat) {
    const [owned] = await db.select({ temporary: chats.temporary, expiresAt: chats.expiresAt })
      .from(chats)
      .where(and(eq(chats.id, options.chatId), eq(chats.userId, options.userId), isNull(chats.deletedAt)))
      .limit(1)
    if (owned && temporaryChatIsExpired(owned, now)) {
      throw new AppError(410, 'temporary_chat_expired', 'This temporary chat has expired and cannot be recovered')
    }
    throw notFound('Chat')
  }
  const resolved = await resolveResponseGeneration(options.input.modelId, options.input.presetSelections)
  const [model] = await db.select().from(models).where(and(eq(models.id, resolved.effectiveModelId), eq(models.enabled, true))).limit(1)
  if (!model) throw new AppError(400, 'model_not_found', 'The selected model is unavailable', 'invalid_request_error', 'model')
  if (options.input.agentMode) {
    if (options.apiKeyId) throw new AppError(400, 'agent_web_only', 'Agent mode is only available in Pulpo web chat')
    const [agentRow] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1)
    if (!parseAgentSettings(agentRow?.value).enabled) throw new AppError(503, 'agent_unavailable', 'Agent mode is not enabled')
    if (!model.agentEnabled) throw new AppError(400, 'model_not_agent_capable', 'The selected model is not enabled for agent mode')
  }
  const maxOutputTokens = Math.min(options.input.maxOutputTokens ?? model.maxOutputTokens, model.maxOutputTokens)
  let pricing = await getActivePricing(model.id)
  let fallbackId = model.fallbackModelId
  const pricedModels = new Set([model.id])
  for (let depth = 0; fallbackId && depth < 8 && !pricedModels.has(fallbackId); depth += 1) {
    pricedModels.add(fallbackId)
    const [fallback] = await db.select().from(models).where(and(eq(models.id, fallbackId), eq(models.enabled, true))).limit(1)
    if (!fallback) break
    const candidate = await getActivePricing(fallback.id)
    const score = (value: typeof candidate) => Math.max(value.inputPriceMicros, value.cacheWritePriceMicros) * model.contextWindow + value.outputPriceMicros * maxOutputTokens + value.perRequestPriceMicros * 1_000_000
    if (score(candidate) > score(pricing)) pricing = candidate
    fallbackId = fallback.fallbackModelId
  }
  const requestedId = options.input.clientId
  if (requestedId) {
    const [existingById] = await db.select().from(responses).where(eq(responses.id, requestedId)).limit(1)
    if (existingById) {
      if (existingById.userId !== options.userId || existingById.chatId !== options.chatId) {
        throw new AppError(409, 'response_id_conflict', 'Response id is already in use')
      }
      return existingById
    }
  }
  const id = requestedId ?? newId()
  const [previous] = chat.activeResponseId
    ? await db.select({ id: responses.id }).from(responses).where(eq(responses.id, chat.activeResponseId)).limit(1)
    : []
  const parentResponseId = options.parentResponseId === undefined ? previous?.id ?? null : options.parentResponseId
  const previousActiveResponseId = previous?.id ?? null
  const executionMode = options.input.executionMode ?? model.executionMode
  const attachmentIds = [...new Set([
    ...options.input.attachmentIds,
    ...responseAttachmentIds(options.rawInput),
  ])]
  if (attachmentIds.length) {
    const ownedAttachments = await db.select().from(attachments).where(and(
      eq(attachments.userId, options.userId),
      eq(attachments.status, 'ready'),
      inArray(attachments.id, attachmentIds),
      or(isNull(attachments.chatId), eq(attachments.chatId, chat.id)),
    ))
    if (ownedAttachments.length !== attachmentIds.length) throw new AppError(400, 'attachment_not_ready', 'One or more attachments are unavailable')
    if (!options.input.agentMode && attachmentsRequireAgentMode(ownedAttachments)) {
      throw new AppError(400, 'attachment_requires_agent', 'Non-image attachments require Agent mode')
    }
    await db.update(attachments).set({ chatId: chat.id, updatedAt: new Date() }).where(and(
      eq(attachments.userId, options.userId),
      inArray(attachments.id, attachmentIds),
      isNull(attachments.chatId),
    ))
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
    userMessageId: options.userMessageId ?? newId(),
    branchReason: options.branchReason ?? 'message',
    executionMode,
    agentMode: options.input.agentMode,
    input: storedInput,
    presetSelections: resolved.selections,
    parameters: { ...(options.parameters ?? {}), ...resolved.parameters },
    idempotencyKey: options.idempotencyKey,
    origin: options.apiKeyId ? 'api' : 'web',
  })
  const requestLogId = newId()
  const [loggingRow] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'logging')).limit(1)
  const logging = parseLoggingSettings(loggingRow?.value)
  const retentionMs: Record<string, number | null> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000, '90d': 7_776_000_000, indefinite: null }
  const ttl = retentionMs[logging.payloadRetention] ?? 604_800_000
  await db.insert(requestLogs).values({
    id: requestLogId, responseId: id, userId: options.userId, apiKeyId: options.apiKeyId,
    origin: options.apiKeyId ? 'api' : 'web', requestedModelId: options.input.modelId, currentModelId: model.id,
    requestPayload: logging.logDetailedPayloads ? { input: storedInput, parameters: { ...(options.parameters ?? {}), ...resolved.parameters }, presetSelections: resolved.selections } : null,
    payloadExpiresAt: logging.logDetailedPayloads && ttl !== null ? new Date(Date.now() + ttl) : null,
  })
  await publishAdminUsage(requestLogId, true)
  try {
    await reserveBudget({
      responseId: id,
      userId: options.userId,
      apiKeyId: options.apiKeyId,
      requestInput: storedInput,
      maxOutputTokens,
      pricing,
    })
    const acceptedAt = new Date()
    const nextExpiresAt = temporaryChatExpiresAt(acceptedAt)
    const [updatedChat] = await db.update(chats).set({
      activeResponseId: id,
      activeBranchLeafId: id,
      updatedAt: acceptedAt,
      expiresAt: temporaryChatExpiryValue(nextExpiresAt),
    }).where(and(
      eq(chats.id, chat.id),
      isNull(chats.deletedAt),
      isNull(chats.purgeStartedAt),
      accessibleChatCondition(acceptedAt),
    )).returning({
      temporary: chats.temporary,
      expiresAt: chats.expiresAt,
    })
    if (!updatedChat) {
      throw new AppError(410, 'temporary_chat_expired', 'This temporary chat has expired and cannot be recovered')
    }
    await generationQueue.add('generate', { responseId: id }, { jobId: id })
    if (updatedChat?.temporary && updatedChat.expiresAt) {
      await scheduleTemporaryChatExpiry({
        chatId: chat.id,
        userId: options.userId,
        expiresAt: updatedChat.expiresAt,
      })
    }
  } catch (error) {
    await releaseBudget(id)
    await db.delete(responses).where(eq(responses.id, id))
    await db.update(chats).set({
      activeResponseId: previousActiveResponseId,
      activeBranchLeafId: previousActiveResponseId,
      updatedAt: new Date(),
      expiresAt: temporaryChatExpiryValue(chat.expiresAt),
    }).where(and(eq(chats.id, chat.id), eq(chats.activeResponseId, id)))
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
    output: sanitizeOutputForClient(response.output as unknown[]),
    usage: response.usage as ResponseSnapshot['usage'],
    error: response.error,
    updatedAt: response.updatedAt.toISOString(),
  }
}
