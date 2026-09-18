import { canContinueWorkspaceScope } from '../agent/workspace-scope.js'
import { MAX_MESSAGE_ATTACHMENTS } from '@pulpo/contracts'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { ChatPreset, CreateChatResponseInput, ResponseSnapshot } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { agentRuns, applicationSettings, attachments, chats, modelPresetChoices, modelPresets, models, requestLogs, responses, userProviderCredentials } from '../database/schema.js'
import { getActivePricing, releaseBudget, reserveBudget } from '../accounting/service.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { generationQueue } from '../jobs.js'
import { parseAgentSettings, parseAuthSettings, parseLoggingSettings } from '../settings/application-settings.js'
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
import { droppedPublicModelParameters, resolveModelParameters } from './model-parameters.js'
import { publicOutputTokenLimit } from './upstream-request.js'
import { requireCodexEnabled } from '../codex/policy.js'
import { CODEX_PI_PROVIDER_ID, CODEX_PROVIDER_ID } from '../codex/constants.js'
import { detailedPayloadPolicy } from '../logging/detailed-payload-retention.js'

export interface CreateResponseOptions {
  requestReceivedAt?: Date | null
  /** Owner of the chat, response, files, memory document, and conversation context. */
  ownerUserId: string
  /** Account whose billing entitlements fund the generation. Defaults to the owner. */
  billingUserId?: string
  /** Administrator responsible for an impersonated action, when applicable. */
  actorUserId?: string | null
  chatId: string
  apiKeyId?: string | null
  input: CreateChatResponseInput
  rawInput?: unknown
  parameters?: Record<string, unknown>
  metadata?: Record<string, string>
  /** Whether an API response may be retrieved through the public Responses lifecycle. */
  publiclyStored?: boolean
  idempotencyKey?: string | null
  idempotencyScope?: string
  idempotencyFingerprint?: string | null
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
  const idempotencyScope = options.idempotencyScope ?? 'default'
  if (options.idempotencyKey) {
    const [existing] = await db
      .select({ response: responses })
      .from(responses)
      .innerJoin(chats, eq(chats.id, responses.chatId))
      .where(and(
        eq(responses.userId, options.ownerUserId),
        eq(responses.idempotencyScope, idempotencyScope),
        eq(responses.idempotencyKey, options.idempotencyKey),
        isNull(chats.deletedAt),
        accessibleChatCondition(),
      ))
      .limit(1)
    if (existing) {
      if (
        options.idempotencyFingerprint
        && existing.response.idempotencyFingerprint
        && options.idempotencyFingerprint !== existing.response.idempotencyFingerprint
      ) {
        throw new AppError(409, 'idempotency_conflict', 'The idempotency key was already used with a different request', 'invalid_request_error')
      }
      return existing.response
    }
  }
  const now = new Date()
  const [chat] = await db
    .select()
    .from(chats)
    .where(and(
      eq(chats.id, options.chatId),
      eq(chats.userId, options.ownerUserId),
      isNull(chats.deletedAt),
      accessibleChatCondition(now),
    ))
    .limit(1)
  if (!chat) {
    const [owned] = await db.select({ temporary: chats.temporary, expiresAt: chats.expiresAt })
      .from(chats)
      .where(and(eq(chats.id, options.chatId), eq(chats.userId, options.ownerUserId), isNull(chats.deletedAt)))
      .limit(1)
    if (owned && temporaryChatIsExpired(owned, now)) {
      throw new AppError(410, 'temporary_chat_expired', 'This temporary chat has expired and cannot be recovered')
    }
    throw notFound('Chat')
  }
  const resolved = await resolveResponseGeneration(options.input.modelId, options.input.presetSelections)
  const [model] = await db.select().from(models).where(and(eq(models.id, resolved.effectiveModelId), eq(models.enabled, true))).limit(1)
  if (!model) throw new AppError(400, 'model_not_found', 'The selected model is unavailable', 'invalid_request_error', 'model')
  if (model.providerConnectionId === CODEX_PROVIDER_ID) {
    await requireCodexEnabled()
    if (options.apiKeyId) {
      throw new AppError(400, 'codex_ui_only', 'Codex subscription models are only available in Pulpo UI clients', 'invalid_request_error', 'model')
    }
    if (options.actorUserId) {
      throw new AppError(403, 'codex_owner_only', 'Codex subscriptions can only be used directly by the connected account owner', 'permission_error', 'model')
    }
    const [credential] = await db.select({ status: userProviderCredentials.status }).from(userProviderCredentials).where(and(
      eq(userProviderCredentials.userId, options.ownerUserId), eq(userProviderCredentials.providerId, CODEX_PI_PROVIDER_ID),
    )).limit(1)
    if (credential?.status !== 'connected') {
      throw new AppError(401, 'codex_reauthentication_required', 'Connect your Codex subscription in Settings to use this model', 'authentication_error', 'model')
    }
  }
  let admittedParameters = options.parameters
  if (options.apiKeyId && admittedParameters) {
    // OpenAI-compatible clients send tuning options the catalog may not allow
    // for this model. Drop them and use the model defaults rather than failing
    // the whole request; the worker applies the same allowlist when it builds
    // the upstream payload.
    const dropped = droppedPublicModelParameters(model, admittedParameters)
    if (dropped.length) {
      admittedParameters = Object.fromEntries(Object.entries(admittedParameters).filter(([key]) => !dropped.includes(key)))
      console.info(JSON.stringify({
        level: 'info', service: 'pulpo-api', event: 'public_api.parameters_dropped',
        apiKeyId: options.apiKeyId, modelId: model.id, parameters: dropped,
      }))
    }
  }
  if (options.input.agentMode) {
    if (options.apiKeyId) throw new AppError(400, 'agent_web_only', 'Agent mode is only available in Pulpo web chat')
    const [agentRow] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1)
    if (!parseAgentSettings(agentRow?.value).enabled) throw new AppError(503, 'agent_unavailable', 'Agent mode is not enabled')
    if (!model.agentEnabled) throw new AppError(400, 'model_not_agent_capable', 'The selected model is not enabled for agent mode')
  }
  const parameters: Record<string, unknown> = { ...(admittedParameters ?? {}), ...resolved.parameters }
  const maxOutputTokens = publicOutputTokenLimit(model.maxOutputTokens, {
    ...resolveModelParameters(model, parameters, { publicApi: Boolean(options.apiKeyId) }),
    ...(options.input.maxOutputTokens !== undefined ? { max_output_tokens: options.input.maxOutputTokens } : {}),
  }).max_output_tokens
  // Preserve the requested ceiling for every origin and fallback. Each provider
  // call independently reserves an affordable limit beneath this ceiling.
  parameters.max_output_tokens = maxOutputTokens
  const pricing = await getActivePricing(model.id)
  const requestedId = options.input.clientId
  if (requestedId) {
    const [existingById] = await db.select().from(responses).where(eq(responses.id, requestedId)).limit(1)
    if (existingById) {
      if (existingById.userId !== options.ownerUserId || existingById.chatId !== options.chatId) {
        throw new AppError(409, 'response_id_conflict', 'Response id is already in use')
      }
      return existingById
    }
  }
  const id = requestedId ?? newId()
  let previousActiveResponseId = chat.activeBranchLeafId ?? chat.activeResponseId
  let previousWorkspaceScopeId = chat.workspaceScopeId
  const executionMode = options.input.executionMode ?? model.executionMode
  const attachmentIds = [...new Set([
    ...options.input.attachmentIds,
    ...responseAttachmentIds(options.rawInput),
  ])]
  if (attachmentIds.length > MAX_MESSAGE_ATTACHMENTS) throw new AppError(400, 'attachment_count_exceeded', `Messages support up to ${MAX_MESSAGE_ATTACHMENTS} attachments`)
  if (attachmentIds.length) {
    const ownedAttachments = await db.select().from(attachments).where(and(
      eq(attachments.userId, options.ownerUserId),
      eq(attachments.status, 'ready'),
      inArray(attachments.id, attachmentIds),
      or(isNull(attachments.chatId), eq(attachments.chatId, chat.id)),
    ))
    if (ownedAttachments.length !== attachmentIds.length) throw new AppError(400, 'attachment_not_ready', 'One or more attachments are unavailable')
    const [attachmentSettings] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'auth')).limit(1)
    if (!options.input.agentMode && attachmentsRequireAgentMode(ownedAttachments, parseAuthSettings(attachmentSettings?.value).maxInlineImages)) {
      throw new AppError(400, 'attachment_requires_agent', 'These attachments require Agent mode: non-image files, large images, or too many images for a prompt')
    }
    await db.update(attachments).set({ chatId: chat.id, updatedAt: new Date() }).where(and(
      eq(attachments.userId, options.ownerUserId),
      inArray(attachments.id, attachmentIds),
      isNull(attachments.chatId),
      isNull(attachments.shelvedAt),
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
  const acceptedAt = new Date()
  const admission = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(chats).where(and(
      eq(chats.id, chat.id), isNull(chats.deletedAt), isNull(chats.purgeStartedAt), accessibleChatCondition(acceptedAt),
    )).for('update')
    if (!current) throw new AppError(410, 'temporary_chat_expired', 'This temporary chat has expired and cannot be recovered')
    previousActiveResponseId = current.activeBranchLeafId ?? current.activeResponseId
    previousWorkspaceScopeId = current.workspaceScopeId
    const parentResponseId = options.parentResponseId === undefined ? previousActiveResponseId : options.parentResponseId
    const [predecessor] = parentResponseId
      ? await tx.select({ status: responses.status }).from(responses).where(and(eq(responses.id, parentResponseId), eq(responses.chatId, chat.id), isNull(responses.deletedAt))).limit(1)
      : []
    if (parentResponseId && !predecessor) throw notFound('Parent response')
    const [runningPredecessor] = parentResponseId
      ? await tx.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.responseId, parentResponseId), inArray(agentRuns.status, ['queued', 'running']))).limit(1)
      : []
    const workspaceScopeId = !runningPredecessor && canContinueWorkspaceScope({
      branchReason: options.branchReason ?? 'message', parentResponseId,
      activeResponseId: previousActiveResponseId, predecessorStatus: predecessor?.status,
    }) ? current.workspaceScopeId : newId()
    const [inserted] = await tx.insert(responses).values({
      id,
      chatId: chat.id,
      requestReceivedAt: options.requestReceivedAt ?? now,
      timeZone: options.apiKeyId ? null : options.input.timeZone ?? null,
      userId: options.ownerUserId,
      modelId: model.id,
      previousResponseId: parentResponseId,
      parentResponseId,
      workspaceScopeId,
      userMessageId: options.userMessageId ?? newId(),
      branchReason: options.branchReason ?? 'message',
      executionMode,
      agentMode: options.input.agentMode,
      input: storedInput,
      presetSelections: resolved.selections,
      parameters,
      metadata: options.metadata ?? {},
      publiclyStored: options.publiclyStored ?? true,
      idempotencyKey: options.idempotencyKey,
      idempotencyScope,
      idempotencyFingerprint: options.idempotencyFingerprint,
      origin: options.actorUserId ? 'admin_chat' : options.apiKeyId ? 'api' : 'web',
    }).onConflictDoNothing().returning({ id: responses.id })
    if (!inserted) {
      const [existing] = await tx.select().from(responses).where(or(
        eq(responses.id, id),
        ...(options.idempotencyKey ? [and(eq(responses.userId, options.ownerUserId), eq(responses.idempotencyScope, idempotencyScope), eq(responses.idempotencyKey, options.idempotencyKey))] : []),
      )).limit(1)
      if (!existing || existing.userId !== options.ownerUserId || existing.chatId !== chat.id) throw new AppError(409, 'response_id_conflict', 'Response id is already in use')
      if (options.idempotencyFingerprint && existing.idempotencyFingerprint && options.idempotencyFingerprint !== existing.idempotencyFingerprint) throw new AppError(409, 'idempotency_conflict', 'The idempotency key was already used with a different request')
      return { existing }
    }
    const [updatedChat] = await tx.update(chats).set({
      activeResponseId: id, activeBranchLeafId: id, workspaceScopeId,
      updatedAt: acceptedAt, expiresAt: temporaryChatExpiryValue(temporaryChatExpiresAt(acceptedAt)),
    }).where(eq(chats.id, chat.id)).returning({ temporary: chats.temporary, expiresAt: chats.expiresAt })
    return { updatedChat }
  })
  if (admission.existing) return admission.existing
  const updatedChat = admission.updatedChat
  try {
    const requestLogId = newId()
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(1886747744)`)
      const [loggingRow] = await tx.select().from(applicationSettings).where(eq(applicationSettings.key, 'logging')).limit(1)
      const logging = parseLoggingSettings(loggingRow?.value)
      const collectedAt = new Date()
      const policy = detailedPayloadPolicy(logging, collectedAt)
      await tx.insert(requestLogs).values({
        id: requestLogId, responseId: id, userId: options.ownerUserId, actorUserId: options.actorUserId, apiKeyId: options.apiKeyId,
        origin: options.actorUserId ? 'admin_chat' : options.apiKeyId ? 'api' : 'web', requestedModelId: options.input.modelId, currentModelId: model.id,
        ...policy, createdAt: collectedAt, updatedAt: collectedAt,
        requestPayload: null, // Detailed bodies are captured per provider attempt.
      })
    })
    await publishAdminUsage(requestLogId, true)
    await reserveBudget({
      responseId: id,
      userId: options.billingUserId ?? options.ownerUserId,
      apiKeyId: options.apiKeyId,
      requestInput: storedInput,
      maxOutputTokens,
      minimumOutputReservationTokens: model.minimumOutputReservationTokens,
      pricing,
    })
    await generationQueue.add('generate', { responseId: id }, { jobId: id })
    if (updatedChat?.temporary && updatedChat.expiresAt) {
      await scheduleTemporaryChatExpiry({
        chatId: chat.id,
        userId: options.ownerUserId,
        expiresAt: updatedChat.expiresAt,
      })
    }
  } catch (error) {
    await releaseBudget(id)
    await db.transaction(async tx => {
      const [current] = await tx.select().from(chats).where(eq(chats.id, chat.id)).for('update')
      const [child] = await tx.select({ id: responses.id }).from(responses).where(eq(responses.parentResponseId, id)).limit(1)
      if (child) {
        await tx.update(responses).set({ status: 'failed', error: { message: 'Response admission failed' }, completedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, id))
      } else {
        await tx.delete(responses).where(eq(responses.id, id))
      }
      if (current?.activeResponseId === id) {
        await tx.update(chats).set({
          workspaceScopeId: previousWorkspaceScopeId, activeResponseId: previousActiveResponseId,
          activeBranchLeafId: previousActiveResponseId, updatedAt: new Date(),
          expiresAt: temporaryChatExpiryValue(chat.expiresAt),
        }).where(eq(chats.id, chat.id))
      }
    })
    throw error
  }
  const [created] = await db.select().from(responses).where(eq(responses.id, id)).limit(1)
  return created!
}

export function toSnapshot(response: typeof responses.$inferSelect): ResponseSnapshot {
  return {
    responseId: response.id,
    requestReceivedAt: response.requestReceivedAt?.toISOString() ?? null,
    firstReplyTextAt: response.firstReplyTextAt?.toISOString() ?? null,
    status: response.status,
    sequence: response.lastSequence,
    output: sanitizeOutputForClient(response.output as unknown[]),
    usage: response.usage as ResponseSnapshot['usage'],
    error: response.error,
    updatedAt: response.updatedAt.toISOString(),
  }
}
