import { publicOutputTokenLimit } from '../responses/upstream-request.js'
import { diagnosticPayload } from '../logging/diagnostic-sanitizer.js'
import { diagnosticFetch } from '../logging/diagnostic-fetch.js'
import { recordReconstructedDiagnostic } from '../logging/provider-diagnostics.js'
import { createImageGenerationTools } from '../image-generation/tool.js'
import { selectedImageModel, executeImageGeneration, recoverSavedImageGenerations } from '../image-generation/service.js'
import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { mistralConversationsApi } from '@earendil-works/pi-ai/api/mistral-conversations.lazy'
import { anthropicAgentReasoning, chatCompletionsSamplingParameters, explicitReasoningEffort, mistralAgentPayload, piModelForProvider } from '../upstream/pi-model.js'
import type { Api, AssistantMessage, Context, Message, Model, SimpleStreamOptions, ThinkingLevel, ToolChoice } from '@earendil-works/pi-ai'
import { agentCostLimitMicros, findCostLimitItem, findCostLimitItems, toolImagePreviewSchema, type ToolImagePreview, type CompactionItem, type CostLimitItem, type FileChangesItem, type RecallItem, type ResponseSnapshot } from '@pulpo/contracts'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { agentRuns, applicationSettings, attachments, chats, generationAttempts, models, providerConnections, requestLogs, responses, toolExecutions, userPreferences } from '../database/schema.js'
import { decryptSecret } from '../lib/crypto.js'
import { getConfig } from '../config.js'
import { newId } from '../lib/ids.js'
import { parseAgentSettings, parseAuthSettings, parsePersonalizationSettings, parseWebToolsSettings } from '../settings/application-settings.js'
import { composeCustomInstructions } from '../settings/instruction-presets.js'
import { isCancellationRequested, createResponseEventPublisher, publishSnapshot } from '../responses/events.js'
import { toSnapshot } from '../responses/service.js'
import { persistResponseItems } from '../responses/storage.js'
import { extendBudgetReservationFixedCost, getActivePricing, releaseBudget, resizeBudgetReservation, retainBudgetReservation, settleBudget } from '../accounting/service.js'
import { WorkspaceManager } from './controller.js'
import { createWorkspaceTools } from './tools.js'
import { publishAdminUsage } from '../admin/usage-events.js'
import { buildAgentSystemPrompt, buildAgentUserPrompt, buildToolsDisabledSystemPrompt, withoutAgentTools } from './policy.js'
import { runPostResponseTasks, type PostResponseTaskResult } from '../responses/post-tasks.js'
import { calculateCostMicros, workspaceBillableMinutes, workspaceHoldMicros, workspaceUsageMicros } from '../accounting/pricing.js'
import { truncateUtf8 } from './output.js'
import { buildAgentOutput, nextAgentDisplayTurn, type ToolTimelineItem } from './timeline.js'
import { messagesForPersistence } from './context.js'
import { basename } from 'node:path'
import { storeToolImagePreview } from '../attachments/tool-image-preview.js'
import { storeGeneratedAttachment } from '../attachments/generated.js'
import type { AttachmentTimelineItem } from './timeline.js'
import { createWebProviderClients, createWebTools, type WebProviderExecution } from './web-tools.js'
import { createModelImageInterceptor, interceptAgentContextImages } from '../responses/image-ocr.js'
import { agentSummaryContext, agentSummaryText, completeAgentSummary, createAgentCompactor, interruptedCompactionItems, type AgentRequestFrame } from './compaction.js'
import { hardContextLimit, summaryMaxOutputTokens } from '../compaction/policy.js'
import { CompactionError, CompactionOverflowError } from '../compaction/summarize.js'
import { piContextTokens } from '../compaction/tokens.js'
import { isInsufficientBalanceError, trackBilledInternalModelCall } from '../responses/model-calls.js'
import { codexContextFailureMessage, contextOverflowErrorMessage, contextOverflowOutcome, isContextFailure } from './context-budget.js'
import { sanitizeOutputForClient } from '../responses/public-output.js'
import { providerCacheRequestOptions, providerPromptCacheParameters } from '../responses/provider-cache.js'
import { agentSnapshotIsDue } from './snapshot-policy.js'
import { lineageFromLeaf } from '../messages/branching.js'
import { responseUserAttachmentIds } from '../messages/input.js'
import { responseInputText } from '../messages/input.js'
import { createGenerationMemoryTools } from './memory-tools.js'
import { describeFileScope } from '../files/agent/prompt.js'
import { createFilesRelay } from '../files/agent/relay.js'
import { loadChatFileScope } from '../files/agent/scope.js'
import { readEpisodicMemorySettings } from '../episodic-memory/settings.js'
import { generationSystemPrompt, loadGenerationMemory } from '../responses/memory-context.js'
import { withGenerationTimeContext } from '../responses/time-context.js'
import { agentRunDisplayState, messagesFromAgentContext, resolveAgentParentMessages, resumedRunContinues, systemPromptFromAgentContext, withoutMemoryToolMessages } from './history.js'
import { agentSamplingParameters, resolveAgentModelParameters } from './model-parameters.js'
import { redis } from '../redis.js'
import {
  MAX_MODEL_CHAIN_LENGTH,
  classifyGenerationError,
  completionTokensPerSecond,
  isModelSticky,
  isSlowCompletion,
  markModelSticky,
} from '../responses/fallback-policy.js'
import { agentModelAttemptLimit, agentStreamEventHasSubstantiveOutput, assistantMessageHasOutput, canFallbackAgentTurn, nextAgentRetryAttempt, resolveStickyFallbackIndex } from './fallback-policy.js'
import { projectNextAgentResponseEvent, selectAgentResponseCheckpoint } from './streaming-snapshot.js'
import { createFirstTokenTimeout, type FirstTokenTimeout } from './first-token-timeout.js'
import { createProviderCostCapture } from './provider-cost.js'
import { detailedPayloadCaptureIsActive } from '../logging/detailed-payload-retention.js'
import { loadAgentPromptImages } from './prompt-images.js'
import { adaptToolResultImagesForProvider, type ToolResultImageMode } from './tool-result-images.js'
import { boundToolOutputContent, boundToolResultMessages } from './tool-output-budget.js'
import { CODEX_PROVIDER_ID } from '../codex/constants.js'
import { codexErrorRequiresReauthentication, createCodexModels, markCodexReauthenticationRequired, safeCodexErrorMessage } from '../codex/credential-store.js'
import { codexInferenceReferenceCostMicros } from '../codex/reference-cost.js'
import { agentSettlementAmounts } from './settlement.js'
import { costLimitPause, redisCostLimitApproval, waitForCostLimitDecision } from './cost-limit.js'

function toolResultText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content
  return content?.flatMap((part) => part.type === 'text' ? [part.text ?? ''] : []).join('\n') ?? ''
}

function toolResultDetails(result: unknown): Record<string, unknown> {
  const details = (result as { details?: unknown } | undefined)?.details
  return details && typeof details === 'object' ? details as Record<string, unknown> : {}
}

function nonNegativeMicros(value: unknown): number {
  const amount = Number(value ?? 0)
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0
}

async function finalizeUnhandledAgentFailure(responseId: string, error: unknown): Promise<void> {
  const [state] = await db.select({ response: responses, requestLog: requestLogs })
    .from(responses)
    .leftJoin(requestLogs, eq(requestLogs.responseId, responses.id))
    .where(eq(responses.id, responseId))
    .limit(1)
  if (!state || ['completed', 'failed', 'cancelled', 'incomplete'].includes(state.response.status)) return

  const message = error instanceof Error ? error.message : String(error)
  const category = classifyGenerationError(error)
  const completedAt = new Date()
  await db.transaction(async (tx) => {
    await tx.update(responses).set({
      status: 'failed',
      error: { message, category },
      completedAt,
      updatedAt: completedAt,
    }).where(eq(responses.id, responseId))
    await tx.update(agentRuns).set({
      status: 'failed',
      error: message,
      completedAt,
      updatedAt: completedAt,
    }).where(eq(agentRuns.responseId, responseId))
    if (state.requestLog) {
      await tx.update(requestLogs).set({
        status: 'failed',
        errorCategory: category,
        errorMessage: message,
        durationMs: Math.max(0, completedAt.getTime() - (state.requestLog.startedAt ?? state.requestLog.createdAt).getTime()),
        completedAt,
        updatedAt: completedAt,
      }).where(eq(requestLogs.id, state.requestLog.id))
    }
  })
  await releaseBudget(responseId)
  const [terminal] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
  if (terminal) await publishSnapshot(toSnapshot(terminal))
  if (state.requestLog) await publishAdminUsage(state.requestLog.id, true)
}

export async function processAgentGeneration(responseId: string, codexAllowed: boolean): Promise<void> {
  try {
    await runAgentGeneration(responseId, codexAllowed)
  } catch (error) {
    await finalizeUnhandledAgentFailure(responseId, error)
    throw error
  }
}

async function runAgentGeneration(responseId: string, codexAllowed: boolean): Promise<void> {
  const startedAt = Date.now()
  const config = getConfig()
  const [record] = await db.select({ response: responses, model: models, provider: providerConnections })
    .from(responses).innerJoin(models, eq(responses.modelId, models.id)).innerJoin(providerConnections, eq(models.providerConnectionId, providerConnections.id))
    .where(eq(responses.id, responseId)).limit(1)
  if (!record || !record.response.agentMode || ['completed', 'cancelled'].includes(record.response.status)) return
  const [settingsRow, webToolsRow, personalizationRow, preferencesRow, episodicMemorySettings, attachmentSettingsRow] = await Promise.all([
    db.select().from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1).then((rows) => rows[0]),
    db.select().from(applicationSettings).where(eq(applicationSettings.key, 'webTools')).limit(1).then((rows) => rows[0]),
    db.select().from(applicationSettings).where(eq(applicationSettings.key, 'personalization')).limit(1).then((rows) => rows[0]),
    db.select({ values: userPreferences.values }).from(userPreferences)
      .where(eq(userPreferences.userId, record.response.userId)).limit(1).then((rows) => rows[0]),
    readEpisodicMemorySettings(),
    db.select().from(applicationSettings).where(eq(applicationSettings.key, 'auth')).limit(1).then((rows) => rows[0]),
  ])
  const settings = parseAgentSettings(settingsRow?.value)
  const webToolsSettings = parseWebToolsSettings(webToolsRow?.value)
  const preferenceValues = (preferencesRow?.values ?? {}) as Record<string, unknown>
  const costLimitMicros = agentCostLimitMicros(preferenceValues)
  const customInstructions = composeCustomInstructions(
    parsePersonalizationSettings(personalizationRow?.value),
    preferenceValues,
  )
  const [chatState] = await db.select({ temporary: chats.temporary, fileScopeIds: chats.fileScopeIds }).from(chats)
    .where(eq(chats.id, record.response.chatId)).limit(1)
  // Files attached to the chat, reached only through `pulpo files` in bash and only while Files is
  // on. Turns sent through admin chat access never reach the owner's Files; temporary chats have none.
  const filesAllowed = parseAuthSettings(attachmentSettingsRow?.value).filesEnabled && record.response.origin !== 'admin_chat' && !chatState?.temporary
  const fileScope = filesAllowed ? await loadChatFileScope(record.response.userId, record.response.chatId) : null
  const fileScopeContext = fileScope?.roots.length ? describeFileScope(fileScope) : ''
  const memory = await loadGenerationMemory({
    chat: chatState,
    memoryEnabled: preferenceValues.memoryEnabled,
    responseId,
    userId: record.response.userId,
    currentChatId: record.response.chatId,
    query: responseInputText(record.response.input),
    output: record.response.output,
  })
  const { memoryContext, recallContext, recallItem } = memory
  let toolsDisabled = record.response.agentCapacityAction === 'continue_without_agent'
  const toolsDisabledSystemPrompt = () => withGenerationTimeContext(
    [buildToolsDisabledSystemPrompt(record.model.systemPrompt, customInstructions, memoryContext), recallContext].filter(Boolean).join('\n\n'),
    record.response, Date.now(),
  )
  const baseAgentSystemPrompt = buildAgentSystemPrompt(
    record.model.systemPrompt,
    record.model.agentInstructions,
    customInstructions,
    memoryContext,
  )
  const currentAgentSystemPrompt = [baseAgentSystemPrompt, fileScopeContext, recallContext].filter(Boolean).join('\n\n')
  if (!settings.enabled || !record.model.agentEnabled) throw new Error('Agent mode is no longer available')
  const allHistory = await db.select().from(responses).where(and(
    eq(responses.chatId, record.response.chatId),
    isNull(responses.deletedAt),
  )).orderBy(asc(responses.createdAt), asc(responses.id))
  const lineage = lineageFromLeaf(allHistory, record.response.parentResponseId)
  const lineageIds = lineage.map((response) => response.id)
  const runContexts = lineageIds.length
    ? await db.select({ responseId: agentRuns.responseId, context: agentRuns.context })
      .from(agentRuns).where(inArray(agentRuns.responseId, lineageIds))
    : []
  const historyAttachmentIds = [...new Set(lineage.flatMap((response) => responseUserAttachmentIds(response.input)))]
  const historyAttachments = historyAttachmentIds.length
    ? await db.select({ id: attachments.id, originalName: attachments.originalName, mimeType: attachments.mimeType, sizeBytes: attachments.sizeBytes })
      .from(attachments).where(and(eq(attachments.userId, record.response.userId), inArray(attachments.id, historyAttachmentIds), eq(attachments.status, 'ready')))
    : []
  const parentMessages = resolveAgentParentMessages(
    lineage,
    new Map(runContexts.map((run) => [run.responseId, run.context])),
    new Map(historyAttachments.map((attachment) => [attachment.id, attachment])),
  )
  const [existingRun] = await db.select().from(agentRuns).where(eq(agentRuns.responseId, responseId)).limit(1)
  const runId = existingRun?.id ?? newId()
  let agentSystemPrompt = toolsDisabled ? toolsDisabledSystemPrompt() : withGenerationTimeContext(
    generationSystemPrompt(memory.enabled, currentAgentSystemPrompt, systemPromptFromAgentContext(existingRun?.context)),
    record.response, startedAt,
  )
  let resumedMessages = boundToolResultMessages(existingRun ? messagesFromAgentContext(existingRun.context) : parentMessages)
  if (!memory.enabled) resumedMessages = withoutMemoryToolMessages(resumedMessages)
  await db.insert(agentRuns).values({ id: runId, responseId, status: 'running', context: { systemPrompt: agentSystemPrompt, messages: resumedMessages, displayStart: resumedMessages.length, archivedMessages: [] }, startedAt: new Date() }).onConflictDoUpdate({ target: agentRuns.responseId, set: { status: 'running', updatedAt: new Date() } })
  const [requestLog] = await db.select().from(requestLogs).where(eq(requestLogs.responseId, responseId)).limit(1)
  if (!requestLog) throw new Error('Request log is missing')
  const detailedPayloadsEnabled = detailedPayloadCaptureIsActive(requestLog)
  let sidecarCostMicros = 0
  const imageInterceptor = await createModelImageInterceptor(requestLog.id, {
    allowCache: !chatState?.temporary,
    responseId,
    onBilledCost: (costMicros) => { sidecarCostMicros += costMicros },
  })
  const attachmentIds = (Array.isArray(record.response.input) ? record.response.input : []).flatMap((item) => {
    const content = (item as { content?: unknown }).content
    return Array.isArray(content) ? content.flatMap((part) => {
      const id = (part as { attachment_id?: unknown }).attachment_id
      return typeof id === 'string' ? [id] : []
    }) : []
  })
  const attachmentRows = attachmentIds.length
    ? await db.select({
      id: attachments.id,
      originalName: attachments.originalName,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      objectKey: attachments.objectKey,
      checksum: attachments.checksum,
    })
      .from(attachments).where(and(eq(attachments.userId, record.response.userId), inArray(attachments.id, attachmentIds), eq(attachments.status, 'ready')))
    : []
  const attachmentsById = new Map(attachmentRows.map((attachment) => [attachment.id, attachment]))
  const attachedFiles = attachmentIds.flatMap((id) => {
    const attachment = attachmentsById.get(id)
    return attachment ? [attachment] : []
  })
  const codexModels = createCodexModels(record.response.userId)
  type RuntimeModel = { model: typeof models.$inferSelect; provider: typeof providerConnections.$inferSelect; apiKey?: string; piModel: Model<Api>; codex: boolean }
  const runtime = (model: typeof models.$inferSelect, provider: typeof providerConnections.$inferSelect): RuntimeModel => {
    if (provider.id === CODEX_PROVIDER_ID) {
      const piModel = codexModels.getModel('openai-codex', model.upstreamModelId)
      if (!piModel) throw new Error('The pinned Pi Codex catalog no longer contains this model')
      return { model, provider, piModel, codex: true }
    }
    return {
      model, provider, codex: false,
      apiKey: decryptSecret(provider.encryptedApiKey, config.ENCRYPTION_KEY),
      piModel: piModelForProvider(model, provider),
    }
  }
  const runtimes = [runtime(record.model, record.provider)]
  const visited = new Set([record.model.id]); let fallbackId = record.model.fallbackModelId
  while (fallbackId && runtimes.length < MAX_MODEL_CHAIN_LENGTH && !visited.has(fallbackId)) {
    const [next] = await db.select({ model: models, provider: providerConnections }).from(models).innerJoin(providerConnections, eq(models.providerConnectionId, providerConnections.id)).where(and(eq(models.id, fallbackId), eq(models.enabled, true))).limit(1)
    if (!next || !codexAllowed && next.provider.id === CODEX_PROVIDER_ID) break
    visited.add(next.model.id); runtimes.push(runtime(next.model, next.provider)); fallbackId = next.model.fallbackModelId
  }
  const resolveStickyRuntimeIndex = async (startingIndex: number): Promise<{ index: number; stickyUsed: boolean }> => {
    return resolveStickyFallbackIndex(
      runtimes.map((candidate) => candidate.model.id),
      startingIndex,
      (modelId) => isModelSticky(redis, modelId),
    )
  }
  const initialRuntime = await resolveStickyRuntimeIndex(0)
  let activeIndex = initialRuntime.index; let active = runtimes[activeIndex]!
  if (initialRuntime.stickyUsed) {
    const pricing = await getActivePricing(active.model.id)
    await db.update(responses).set({ actualModelId: active.model.id, pricingVersionId: pricing.id }).where(eq(responses.id, responseId))
    await db.update(requestLogs).set({ stickyFallbackUsed: true, fallbackUsed: true, currentModelId: active.model.id, updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
    await publishAdminUsage(requestLog.id, true)
  }
  const providerStreams = { 'openai-responses': openAIResponsesApi(), 'openai-completions': openAICompletionsApi(), 'anthropic-messages': anthropicMessagesApi(), 'mistral-conversations': mistralConversationsApi() }
  const emptyUsage = { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 }
  const persistedUsage = record.response.usage as typeof emptyUsage | null
  const publishResponseEvent = createResponseEventPublisher(record.response)
  let streamProjection: ResponseSnapshot = toSnapshot(record.response)
  let modelTurns = existingRun?.modelTurns ?? 0; let toolCalls = existingRun?.toolCalls ?? 0
  let usage = persistedUsage ?? emptyUsage
  await recoverSavedImageGenerations(responseId, runId)
  const [[previousModelCost], [previousToolCost], previousModelTurns] = await Promise.all([
    db.select({ total: sql<number>`coalesce(sum(${generationAttempts.costMicros}), 0)::bigint` })
      .from(generationAttempts).where(and(eq(generationAttempts.requestLogId, requestLog.id), eq(generationAttempts.source, 'agent'))),
    db.select({ total: sql<number>`coalesce(sum(${toolExecutions.billedCostMicros}), 0)::bigint` })
      .from(toolExecutions).where(eq(toolExecutions.agentRunId, runId)),
    db.select({
      modelId: generationAttempts.modelId,
      inputTokens: generationAttempts.inputTokens,
      cachedInputTokens: generationAttempts.cachedInputTokens,
      cacheWriteTokens: generationAttempts.cacheWriteTokens,
      outputTokens: generationAttempts.outputTokens,
      reasoningTokens: generationAttempts.reasoningTokens,
    }).from(generationAttempts).where(and(
      eq(generationAttempts.requestLogId, requestLog.id),
      eq(generationAttempts.source, 'agent'),
    )),
  ])
  let accruedCostMicros = Number(previousModelCost?.total ?? 0)
  let accruedToolCostMicros = Number(previousToolCost?.total ?? 0)
  let inferenceReferenceCostMicros = previousModelTurns.reduce((total, turn) => {
    const turnModel = runtimes.find((candidate) => candidate.model.id === turn.modelId)
    if (!turnModel?.codex) return total
    return total + codexInferenceReferenceCostMicros(turnModel.piModel, {
      ...turn,
      totalTokens: turn.inputTokens + turn.outputTokens,
    })
  }, 0)
  const [previousSidecarCost] = await db.select({ total: sql<number>`coalesce(sum(${generationAttempts.costMicros}), 0)::bigint` })
    .from(generationAttempts).where(and(eq(generationAttempts.requestLogId, requestLog.id), eq(generationAttempts.source, 'tool')))
  sidecarCostMicros += Number(previousSidecarCost?.total ?? 0)
  const billingTurns: Array<Record<string, unknown>> = []
  const modelTurnStartedAt = new Map<number, number>()
  const turnDurationsMs = new Map<number, number>()
  const turnRuntime = new Map<number, { runtime: RuntimeModel; index: number }>()
  const turnAttemptIds = new Map<number, string>()
  const turnOutputStarted = new Set<number>()
  type ActivePricing = Awaited<ReturnType<typeof getActivePricing>>
  const turnPricing = new Map<number, ActivePricing>()
  const turnProviderCosts = new Map<number, () => Promise<number | undefined>>()
  const turnRequestPayloads = new Map<number, unknown>()
  const turnFirstTokenMs = new Map<number, number>()
  const turnRetryAttempts = new Map<number, number>()
  let currentRetryAttempt = 1
  // Context recovery is allowed again only after a model turn succeeds.
  let successfulModelTurns = 0
  let lastResponder: { runtime: RuntimeModel; pricing: ActivePricing } | undefined
  const toolItems = new Map<string, ToolTimelineItem>((record.response.output as unknown[]).flatMap((raw) => {
    const item = raw as ToolTimelineItem | null
    return item?.type === 'pulpo_tool' && typeof item.id === 'string' ? [[item.id, { ...item }]] : []
  }))
  const generatedAttachmentRows = await db.select().from(attachments).where(and(
    eq(attachments.sourceResponseId, responseId), inArray(attachments.origin, ['assistant', 'tool_preview']), eq(attachments.status, 'ready'),
  ))
  const attachmentItems = new Map<string, AttachmentTimelineItem>(generatedAttachmentRows.flatMap((attachment) => (
    attachment.origin === 'assistant' && attachment.sourceToolCallId ? [[attachment.sourceToolCallId, {
      type: 'pulpo_attachment' as const, attachment_id: attachment.id, name: attachment.originalName,
      mime_type: attachment.mimeType, size_bytes: attachment.sizeBytes, status: 'completed' as const,
    }] as const] : []
  )))
  const imagePreviews = new Map<string, ToolImagePreview>(generatedAttachmentRows.flatMap((attachment) => (
    attachment.origin === 'tool_preview' && attachment.sourceToolCallId ? [[attachment.sourceToolCallId, {
      attachmentId: attachment.id, name: attachment.originalName, mimeType: 'image/webp' as const, sizeBytes: attachment.sizeBytes,
    }]] : []
  )))
  for (const [id, imagePreview] of imagePreviews) {
    const item = toolItems.get(id)
    if (item?.tool === 'view_image') item.imagePreview = imagePreview
  }
  for (const attachment of generatedAttachmentRows) {
    const item = attachment.sourceToolCallId ? toolItems.get(attachment.sourceToolCallId) : undefined
    if (attachment.origin !== 'assistant' || item?.tool !== 'generate_image') continue
    item.imagePreview = toolImagePreviewSchema.safeParse({
      attachmentId: attachment.id, name: attachment.originalName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes,
    }).data
  }
  const compactionItems: CompactionItem[] = (record.response.output as unknown[]).filter((raw): raw is CompactionItem => (
    (raw as { type?: string }).type === 'pulpo_compaction'
  ))
  const recallItems: RecallItem[] = recallItem ? [recallItem] : []
  const costLimitItems = findCostLimitItems(record.response.output as unknown[])
  let fileChangesItem = (record.response.output as unknown[]).find((raw): raw is FileChangesItem => (
    (raw as { type?: string } | null)?.type === 'pulpo_file_changes'
  ))
  let workspaceItem: Record<string, unknown> | undefined
  let workspaceStartedAtMs: number | undefined
  let workspaceReadyAtMs: number | undefined
  let workspaceHoldMicrosAmount = 0
  let workspaceCostMicros = 0
  // Leading agent.state.messages that are not this run's output, and this run's messages compaction removed.
  const resumedDisplay = existingRun ? agentRunDisplayState(existingRun.context) : undefined
  let skipMessageCount = existingRun ? resumedDisplay?.displayStart ?? parentMessages.length : resumedMessages.length
  const archivedDisplayMessages: AgentMessage[] = [...resumedDisplay?.archivedMessages ?? []]
  // Whether agent.state.messages holds this run's prompt; a resumed run then continues instead of prompting again.
  let promptRecorded = resumedDisplay?.promptRecorded ?? false
  let lastSnapshotAt = 0
  let emissionQueue = Promise.resolve()
  const emit = (type: string, payload: Record<string, unknown>): Promise<void> => {
    const emission = emissionQueue.then(async () => {
      const next = projectNextAgentResponseEvent(streamProjection, {
        type,
        payload,
        emittedAt: new Date().toISOString(),
      })
      await publishResponseEvent(next.event)
      streamProjection = next.projection
    })
    emissionQueue = emission
    return emission
  }
  if (recallItem && !memory.reusedRecall) {
    await emit('pulpo.recall.completed', recallItem)
    await db.update(responses).set({
      status: 'in_progress',
      output: streamProjection.output,
      lastSequence: streamProjection.sequence,
      startedAt: record.response.startedAt ?? new Date(),
      updatedAt: new Date(),
    }).where(eq(responses.id, responseId))
  }
  let agent!: Agent
  const activateFallbackRuntime = async (fromIndex: number): Promise<boolean> => {
    if (fromIndex + 1 >= runtimes.length) return false
    const resolved = await resolveStickyRuntimeIndex(fromIndex + 1)
    activeIndex = resolved.index
    active = runtimes[activeIndex]!
    currentRetryAttempt = 1
    if (agent) agent.state.model = active.piModel
    const pricing = await getActivePricing(active.model.id)
    await db.update(responses).set({ actualModelId: active.model.id, pricingVersionId: pricing.id }).where(eq(responses.id, responseId))
    await db.update(requestLogs).set({
      fallbackUsed: true,
      stickyFallbackUsed: resolved.stickyUsed ? true : undefined,
      currentModelId: active.model.id,
      updatedAt: new Date(),
    }).where(eq(requestLogs.id, requestLog.id))
    await publishAdminUsage(requestLog.id, true)
    return true
  }
  const snapshot = async (terminal?: 'completed' | 'incomplete' | 'failed' | 'cancelled', errorMessage?: string) => {
    let checkpoint = selectAgentResponseCheckpoint(streamProjection)
    if (terminal) {
      const state = agent?.state
      const streamingMessage = state?.streamingMessage
      const stateMessages = [
        ...(state?.messages ?? resumedMessages),
        ...(streamingMessage?.role === 'assistant' ? [streamingMessage as AgentMessage] : []),
      ]
      const terminalOutput = buildAgentOutput({
        messages: [...archivedDisplayMessages, ...stateMessages.slice(skipMessageCount)],
        skipMessageCount: 0,
        toolItems,
        attachmentItems,
        workspaceItem,
        compactionItems,
        recallItems,
        costLimitItems,
        fileChangesItem,
        turnDurationsMs,
        streaming: false,
        terminal: true,
      })
      checkpoint = selectAgentResponseCheckpoint(streamProjection, { terminal: true, output: terminalOutput })
    }
    await db.update(responses).set({ status: terminal ?? 'in_progress', incompleteDetails: terminal === 'incomplete' ? { reason: 'max_output_tokens' } : null, output: checkpoint.output, usage, error: errorMessage ? { message: errorMessage } : undefined, lastSequence: checkpoint.sequence, completedAt: terminal ? new Date() : undefined, updatedAt: new Date() }).where(eq(responses.id, responseId))
    const [updated] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (updated) await publishSnapshot(toSnapshot(updated))
    lastSnapshotAt = Date.now()
  }
  const snapshotIfDue = async () => {
    if (agentSnapshotIsDue(lastSnapshotAt, Date.now(), config.RESPONSE_SNAPSHOT_INTERVAL_MS)) await snapshot()
  }
  const currentCostMicros = () => accruedCostMicros + accruedToolCostMicros + sidecarCostMicros + (
    workspaceReadyAtMs !== undefined && settings.billWorkspaces
      ? workspaceUsageMicros(Date.now() - workspaceReadyAtMs, settings.workspacePricePerMinuteMicros)
      : 0
  )
  /** Holds the loop at the user's cost limit until they continue; false when the run was stopped instead. */
  const waitAtCostLimit = async (signal?: AbortSignal): Promise<boolean> => {
    const paused = costLimitPause({ responseId, thresholdMicros: costLimitMicros, costMicros: currentCostMicros(), current: findCostLimitItem(costLimitItems), agentTurn: modelTurns })
    if (!paused) return true
    const setCostLimitItem = (item: CostLimitItem) => {
      const index = costLimitItems.findIndex((candidate) => candidate.id === item.id)
      if (index >= 0) costLimitItems[index] = item
      else costLimitItems.push(item)
    }
    setCostLimitItem(paused)
    await emit('pulpo.agent.cost_limit', paused)
    await snapshot()
    const decision = await waitForCostLimitDecision({ limitMicros: paused.limit_micros, approval: redisCostLimitApproval(responseId), signal })
    if (decision === 'stopped') return false
    const continued: CostLimitItem = { ...paused, status: 'continued' }
    setCostLimitItem(continued)
    await emit('pulpo.agent.cost_limit', continued)
    await snapshot()
    return true
  }
  const updateCompaction = async (item: CompactionItem) => {
    const index = compactionItems.findIndex((candidate) => candidate.id === item.id)
    if (index >= 0) compactionItems[index] = item
    else compactionItems.push(item)
    const publicItem = sanitizeOutputForClient([item])[0] as Record<string, unknown>
    await emit('pulpo.compaction.updated', publicItem)
    await snapshotIfDue()
  }
  /** Everything streamFn changes in a provider request without bookkeeping; the summarizer shares it so its prefix is identical. */
  const prepareProviderContext = async (context: Context): Promise<Context> => {
    if (!toolsDisabled) context = { ...context, systemPrompt: [context.systemPrompt, await manager.contextNotice()].filter(Boolean).join('\n\n') }
    let preparedContext = await interceptAgentContextImages(context, active.model, imageInterceptor, active.provider)
    preparedContext = adaptToolResultImagesForProvider(
      preparedContext,
      active.provider.toolResultImageMode as ToolResultImageMode,
    )
    if (preparedContext.tools?.some(tool => tool.name === 'generate_image') && !await selectedImageModel(record.response.userId)) {
      preparedContext = { ...preparedContext, tools: preparedContext.tools.filter(tool => tool.name !== 'generate_image') }
    }
    return preparedContext
  }
  type ProviderRequest = {
    parameters: Record<string, unknown>
    reasoning: ThinkingLevel
    maxTokens: number
    signal?: AbortSignal
    fetch: typeof fetch
    onPayload?: SimpleStreamOptions['onPayload']
    toolChoice?: ToolChoice
    /** Options pi-agent-core passes to streamFn. */
    loopOptions?: SimpleStreamOptions
  }
  /** Streams to the active provider with the options every model call shares: key, cache affinity, session ids and transport. */
  const streamActiveProvider = (context: Context, request: ProviderRequest) => {
    const cacheOptions = providerCacheRequestOptions(active.provider, {
      userId: record.response.userId,
      chatId: record.response.chatId,
      runId,
    })
    const streamOptions = {
      ...request.loopOptions,
      reasoning: request.reasoning,
      samplingParams: agentSamplingParameters(active.provider.baseUrl, providerPromptCacheParameters(active.model.promptCachingEnabled, {
        ...request.loopOptions?.samplingParams,
        ...request.parameters,
        max_output_tokens: request.maxTokens,
      })),
      maxTokens: request.maxTokens,
      timeoutMs: active.provider.requestTimeoutMs,
      maxRetries: 0,
      signal: request.signal,
      sessionId: cacheOptions.sessionId,
      headers: cacheOptions.headers,
      fetch: request.fetch,
      onPayload: request.onPayload,
      ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
    }
    if (active.codex) {
      return codexModels.streamSimple(active.piModel, context, {
        ...streamOptions,
        samplingParams: undefined,
        transport: 'auto',
        sessionId: `pulpo:${record.response.userId}:${record.response.chatId}`,
      })
    }
    if (active.piModel.api === 'openai-completions') {
      return providerStreams['openai-completions'].streamSimple(active.piModel, context, {
        ...streamOptions,
        reasoning: explicitReasoningEffort(request.parameters) ? request.reasoning : undefined,
        samplingParams: chatCompletionsSamplingParameters(providerPromptCacheParameters(active.model.promptCachingEnabled, request.parameters), active.provider.baseUrl),
        apiKey: active.apiKey,
      })
    }
    if (active.piModel.api === 'mistral-conversations') {
      return providerStreams['mistral-conversations'].streamSimple(active.piModel, context, {
        ...streamOptions,
        reasoning: undefined,
        samplingParams: undefined,
        cacheRetention: active.model.promptCachingEnabled ? 'short' : 'none',
        apiKey: active.apiKey,
        onPayload: async (payload, model) => {
          const body = mistralAgentPayload(payload, request.parameters)
          return await streamOptions.onPayload?.(body, model) ?? body
        },
      })
    }
    if (active.piModel.api === 'anthropic-messages') {
      return providerStreams['anthropic-messages'].streamSimple(active.piModel, context, {
        ...streamOptions,
        reasoning: anthropicAgentReasoning(active.piModel, request.parameters, request.reasoning),
        samplingParams: undefined,
        // Pi marks Anthropic cache breakpoints itself; follow the model's caching switch.
        cacheRetention: active.model.promptCachingEnabled ? 'short' : 'none',
        apiKey: active.apiKey,
      })
    }
    return providerStreams['openai-responses'].streamSimple(active.piModel as Model<'openai-responses'>, context, {
      ...streamOptions,
      apiKey: active.apiKey,
    })
  }
  const summaryMaxTokens = () => summaryMaxOutputTokens(active.model.maxOutputTokens)
  /** One billed summarizer attempt: the real history sent like a normal turn, with low reasoning and no tool use. */
  const summarizeAgentHistory = async (history: Message[], frame: AgentRequestFrame): Promise<string> => {
    const maxTokens = summaryMaxTokens()
    const request = await prepareProviderContext(agentSummaryContext(history, frame))
    const { parameters } = resolveAgentModelParameters(active.model, record.response.parameters)
    const billed = await trackBilledInternalModelCall({
      responseId,
      requestLogId: requestLog.id,
      modelId: active.model.id,
      upstreamModelId: active.model.upstreamModelId,
      purpose: 'compaction',
      requestInput: request,
      maxOutputTokens: maxTokens,
      required: true,
      invoke: async () => {
        const message = await completeAgentSummary({
          context: request,
          contextWindow: active.model.contextWindow,
          stream: (context, toolChoice) => streamActiveProvider(context, {
            parameters, reasoning: 'low', maxTokens, signal: frame.signal, fetch: diagnosticFetch(), toolChoice,
          }),
        }).catch(async (error: unknown) => {
          if (!active.codex || error instanceof CompactionOverflowError) throw error
          // The run's catch skips the reauthentication check for compaction failures, so an expired login is caught here, as in the worker.
          if (codexErrorRequiresReauthentication(error)) await markCodexReauthenticationRequired(record.response.userId, 'Your Codex connection needs to be renewed.')
          throw new CompactionError(`Context compaction failed: ${safeCodexErrorMessage(error)}`)
        })
        return {
          id: message.responseId,
          usage: {
            inputTokens: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite,
            cachedInputTokens: message.usage.cacheRead, cacheWriteTokens: message.usage.cacheWrite,
            outputTokens: message.usage.output, reasoningTokens: message.usage.reasoning ?? 0, totalTokens: message.usage.totalTokens,
          },
          output_text: agentSummaryText(message),
        }
      },
    })
    if ('skipped' in billed) throw new CompactionError('Insufficient balance for conversation compaction')
    sidecarCostMicros += billed.costMicros
    return billed.result.output_text
  }
  const compactAgentContext = createAgentCompactor({
    responseId,
    settings: () => ({
      enabled: active.model.compactionEnabled,
      modelId: active.model.id,
      thresholdTokens: active.model.compactionThresholdTokens,
      contextWindow: active.model.contextWindow,
      retainedUserTokens: active.model.compactionRetainedUserTokens,
      summaryMaxTokens: summaryMaxTokens(),
    }),
    items: () => compactionItems,
    summarize: summarizeAgentHistory,
    updateItem: updateCompaction,
  })
  /** Archive this run's display messages before swapping in the compacted history, so the output keeps them. */
  const adoptCompactedContext = (compacted: AgentMessage[]) => {
    archivedDisplayMessages.push(...agent.state.messages.slice(skipMessageCount))
    agent.state.messages = compacted
    skipMessageCount = compacted.length
    // Mid-run and recovery compaction follow the prompt, which survives only as retained text.
    promptRecorded = true
  }
  const nextDisplayTurn = () => nextAgentDisplayTurn([...archivedDisplayMessages, ...agent.state.messages.slice(skipMessageCount)])
  let manager!: WorkspaceManager
  const disableAgentTools = () => {
    toolsDisabled = true
    agentSystemPrompt = toolsDisabledSystemPrompt()
    agent.state.systemPrompt = agentSystemPrompt
    agent.state.tools = []
  }
  manager = new WorkspaceManager(responseId, record.response.chatId, record.response.userId, async (state, details = {}) => {
    if ((state === 'waiting' || state === 'provisioning') && workspaceStartedAtMs === undefined) {
      workspaceStartedAtMs = Date.now()
    }
    if (state === 'ready' && settings.billWorkspaces && workspaceReadyAtMs === undefined) {
      const hold = workspaceHoldMicros(settings.responseTimeoutSeconds, settings.workspacePricePerMinuteMicros)
      if (hold > 0) {
        try {
          await extendBudgetReservationFixedCost(responseId, hold)
          workspaceHoldMicrosAmount = hold
          workspaceReadyAtMs = Date.now()
        } catch (error) {
          if (!isInsufficientBalanceError(error)) throw error
          manager.disableTools()
        }
      } else {
        workspaceReadyAtMs = Date.now()
      }
    }
    const durationMs = workspaceStartedAtMs !== undefined
      && (state === 'ready' || state === 'expired' || state === 'unavailable' || state === 'continuing_without_agent')
      ? Math.max(0, Date.now() - workspaceStartedAtMs)
      : workspaceItem && typeof workspaceItem.durationMs === 'number'
        ? workspaceItem.durationMs as number
        : undefined
    workspaceItem = {
      id: `workspace-${runId}`,
      type: 'pulpo_workspace',
      state,
      ...(workspaceStartedAtMs !== undefined ? { startedAt: new Date(workspaceStartedAtMs).toISOString() } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...details,
    }
    await emit(`pulpo.agent.workspace.${state}`, workspaceItem)
    await snapshotIfDue()
  })
  const markToolStarted = async (operationId: string) => {
    const item = toolItems.get(operationId)
    if (!item || item.startedAt) return
    const startedAt = new Date()
    Object.assign(item, { status: 'running', startedAt: startedAt.toISOString() })
    await db.update(toolExecutions).set({ workspaceLeaseId: manager.leaseId, status: 'running', startedAt, updatedAt: startedAt }).where(and(eq(toolExecutions.agentRunId, runId), eq(toolExecutions.operationId, operationId)))
    await emit('pulpo.agent.tool.started', item)
    await snapshotIfDue()
  }
  const webProviderExecutions = new Map<string, WebProviderExecution>()
  const configuredWebTools = createWebTools({
    clients: createWebProviderClients(webToolsSettings, config.ENCRYPTION_KEY),
    settings: webToolsSettings,
    maxOutputBytes: settings.maxToolOutputBytes,
    onOperationStarted: markToolStarted,
    onProviderAttempts: (operationId, execution) => { webProviderExecutions.set(operationId, execution) },
    reserveBillableCost: (amountMicros) => extendBudgetReservationFixedCost(responseId, amountMicros),
  })
  const imageTools = createImageGenerationTools({
    model: (await selectedImageModel(record.response.userId))?.model ?? null,
    onStarted: markToolStarted,
    execute: (operationId, args, signal) => executeImageGeneration({
      requestLogId: requestLog.id,
      operationId, args, signal, userId: record.response.userId, chatId: record.response.chatId,
      responseId, runId, manager, reserveCost: micros => micros > 0 ? extendBudgetReservationFixedCost(responseId, micros) : Promise.resolve(),
    }),
  })
  const readToolCost = async () => {
    await recoverSavedImageGenerations(responseId, runId, manager)
    const [row] = await db.select({ total: sql<number>`coalesce(sum(${toolExecutions.billedCostMicros}), 0)::bigint` })
      .from(toolExecutions).where(eq(toolExecutions.agentRunId, runId))
    return Number(row?.total ?? 0)
  }
  const memoryTools = createGenerationMemoryTools({
    memoryEnabled: memory.enabled,
    episodicMemoryEnabled: episodicMemorySettings.enabled,
    userId: record.response.userId,
    responseId,
    currentChatId: record.response.chatId,
    maxOutputBytes: settings.maxToolOutputBytes,
    onOperationStarted: markToolStarted,
  })
  const attachFile = async (operationId: string, path: string, name: string | undefined, signal?: AbortSignal) => {
    const [existing] = await db.select().from(attachments).where(and(
      eq(attachments.sourceResponseId, responseId), eq(attachments.sourceToolCallId, operationId), eq(attachments.status, 'ready'),
    )).limit(1)
    const stored = existing
      ? { id: existing.id, name: existing.originalName, mimeType: existing.mimeType, sizeBytes: existing.sizeBytes }
      : await manager.exportFile(path, signal, () => markToolStarted(operationId)).then((file) => storeGeneratedAttachment({
        responseId, toolCallId: operationId, userId: record.response.userId, chatId: record.response.chatId,
        path, requestedName: name ?? basename(path), data: file.data,
      }))
    const item: AttachmentTimelineItem = {
      type: 'pulpo_attachment', attachment_id: stored.id, name: stored.name,
      mime_type: stored.mimeType, size_bytes: stored.sizeBytes, status: 'completed',
    }
    attachmentItems.set(operationId, item)
    await emit('pulpo.agent.attachment.created', item)
    await snapshotIfDue()
    return stored
  }
  // `pulpo files` commands from bash, answered with the chat's scope as it is when each arrives.
  const filesRelay = filesAllowed ? createFilesRelay({
    userId: record.response.userId,
    chatId: record.response.chatId,
    responseId,
    workspace: manager,
    maxOutputBytes: settings.maxToolOutputBytes,
    onChanged: async (count) => {
      // Changes folded into other replies' suggestions leave this reply nothing to list.
      if (!count && !fileChangesItem) return
      fileChangesItem = { type: 'pulpo_file_changes', id: 'file-changes', count }
      await emit('pulpo.agent.files.changed', { ...fileChangesItem })
      await snapshotIfDue()
    },
  }) : undefined
  let agentAbortReason: 'response_timeout' | 'cancellation' | 'turn_limit' | undefined
  const abortTimer = setTimeout(() => {
    agentAbortReason ??= 'response_timeout'
    agent.abort()
  }, settings.responseTimeoutSeconds * 1000)
  const cancellationTimer = setInterval(() => void isCancellationRequested(responseId).then((cancelled) => {
    if (!cancelled) return
    agentAbortReason ??= 'cancellation'
    agent.abort()
  }), 500)
  const initialParameters = resolveAgentModelParameters(active.model, record.response.parameters)
  let firstTokenTimeout: FirstTokenTimeout | undefined
  agent = new Agent({
    initialState: {
      systemPrompt: agentSystemPrompt,
      model: active.piModel,
      tools: toolsDisabled ? [] : [
        ...createWorkspaceTools(manager, settings.commandTimeoutSeconds * 1000, markToolStarted, attachFile, async (toolCallId, path, data) => {
          const existing = imagePreviews.get(toolCallId)
          if (existing) return existing
          const preview = await storeToolImagePreview({
            responseId, toolCallId, userId: record.response.userId, chatId: record.response.chatId, path, data,
          })
          imagePreviews.set(toolCallId, preview)
          return preview
        }, filesRelay),
        ...configuredWebTools,
        ...imageTools,
        ...memoryTools,
      ],
      messages: resumedMessages,
      thinkingLevel: initialParameters.reasoning,
    },
    prepareNextTurnWithContext: async ({ context }, signal) => {
      if (!await waitAtCostLimit(signal)) return undefined
      if (manager.continuedWithoutAgent) disableAgentTools()
      if (toolsDisabled) context = withoutAgentTools(context, agentSystemPrompt)
      // pi-agent-core calls this only when another model turn is about to run.
      const compacted = await compactAgentContext({
        phase: 'agent_mid_run',
        systemPrompt: context.systemPrompt,
        tools: context.tools ?? [],
        messages: context.messages,
        beforeAgentTurn: nextDisplayTurn(),
        signal,
      })
      if (compacted) {
        adoptCompactedContext(compacted)
        return { context: { ...context, messages: compacted } }
      }
      // Return the updated snapshot even when no compaction was needed.
      return toolsDisabled ? { context } : undefined
    },
    streamFn: async (_model, context, options) => {
      const preparedContext = await prepareProviderContext(context)
      // An oversized request fails like a provider overflow, so the run compacts and continues instead of failing.
      const contextTokens = piContextTokens(preparedContext).tokens
      const contextLimit = hardContextLimit(active.model.contextWindow)
      if (contextTokens > contextLimit) throw new Error(contextOverflowErrorMessage(contextTokens, contextLimit))
      const resolvedParameters = resolveAgentModelParameters(active.model, record.response.parameters, options?.reasoning)
      const pricing = await getActivePricing(active.model.id)
      const reservation = await resizeBudgetReservation({
        responseId,
        accruedCostMicros: accruedCostMicros + accruedToolCostMicros + sidecarCostMicros + workspaceHoldMicrosAmount,
        accruedExtraCostMicros: accruedToolCostMicros + sidecarCostMicros + workspaceHoldMicrosAmount,
        requestInput: preparedContext,
        maxOutputTokens: publicOutputTokenLimit(active.model.maxOutputTokens, {
          ...resolvedParameters.parameters,
          ...record.response.parameters as Record<string, unknown>,
        }).max_output_tokens,
        minimumOutputReservationTokens: active.model.minimumOutputReservationTokens,
        pricing,
      })
      turnPricing.set(modelTurns, pricing)
      modelTurnStartedAt.set(modelTurns, Date.now())
      firstTokenTimeout?.clear()
      firstTokenTimeout = createFirstTokenTimeout(
        active.model.firstTokenTimeoutEnabled,
        active.model.firstTokenTimeoutSeconds,
        options?.signal,
      )
      const providerCostCapture = active.model.useProviderCost ? createProviderCostCapture() : undefined
      if (providerCostCapture) turnProviderCosts.set(modelTurns, providerCostCapture.costMicros)
      return streamActiveProvider(preparedContext, {
        loopOptions: options,
        parameters: resolvedParameters.parameters,
        reasoning: resolvedParameters.reasoning,
        maxTokens: reservation.maxOutputTokens,
        signal: firstTokenTimeout.signal,
        fetch: diagnosticFetch({ purpose: 'generation', userId: record.response.userId, requestLogId: requestLog.id, modelCallId: turnAttemptIds.get(modelTurns), modelId: active.model.id, upstreamModelId: active.model.upstreamModelId, providerId: active.provider.id, metadata: { turnNumber: modelTurns, retryAttempt: currentRetryAttempt } }, providerCostCapture?.fetch),
        onPayload: detailedPayloadsEnabled && active.codex
          ? async (payload: unknown, model: Model<Api>) => {
              const transformed = await options?.onPayload?.(payload, model)
              turnRequestPayloads.set(modelTurns, diagnosticPayload(transformed ?? payload, 'reconstructed').body)
              return transformed
            }
          : options?.onPayload,
      })
    },
    toolExecution: 'sequential',
    beforeToolCall: async (_context, signal) => {
      if (toolsDisabled || manager.continuedWithoutAgent) return { block: true, reason: 'Agent tools were disabled at the user’s request' }
      if (toolCalls >= settings.maxToolCalls) return { block: true, reason: `Tool call limit (${settings.maxToolCalls}) reached` }
      return await waitAtCostLimit(signal) ? undefined : { block: true, reason: 'Stopped at the cost limit' }
    },
    afterToolCall: async ({ toolCall, result }) => {
      const content = boundToolOutputContent(toolCall.name, result.content, result.details)
      return content ? { content } : undefined
    },
  })
  let lastRunPersistAt = 0
  // Display state lets a resumed run render the same output; only assistant messages are displayed.
  const runContext = () => ({
    systemPrompt: agentSystemPrompt,
    messages: messagesForPersistence(agent.state.messages),
    displayStart: skipMessageCount,
    archivedMessages: messagesForPersistence(archivedDisplayMessages.filter((message) => message.role === 'assistant')),
    promptRecorded,
    billingTurns,
  })
  const persistRunContext = async (force = false) => {
    if (!force && Date.now() - lastRunPersistAt < 500) return
    lastRunPersistAt = Date.now()
    await db.update(agentRuns).set({
      workspaceLeaseId: manager.leaseId,
      context: runContext(),
      modelTurns,
      toolCalls,
      updatedAt: new Date(),
    }).where(eq(agentRuns.id, runId))
  }
  agent.subscribe(async (event) => {
    // The only user message pi-agent-core records during a run is the prompt; it is in agent.state.messages by now.
    if (event.type === 'message_end' && event.message.role === 'user') promptRecorded = true
    if (event.type === 'turn_start') {
      modelTurns += 1
      if (modelTurns > settings.maxModelTurns) {
        agentAbortReason ??= 'turn_limit'
        agent.abort()
      }
    } else if (event.type === 'message_start' && event.message.role === 'assistant') {
      if (!modelTurnStartedAt.has(modelTurns)) modelTurnStartedAt.set(modelTurns, Date.now())
      const attemptId = newId()
      const pricing = turnPricing.get(modelTurns) ?? await getActivePricing(active.model.id)
      turnRuntime.set(modelTurns, { runtime: active, index: activeIndex })
      turnAttemptIds.set(modelTurns, attemptId)
      turnPricing.set(modelTurns, pricing)
      turnRetryAttempts.set(modelTurns, currentRetryAttempt)
      await db.insert(generationAttempts).values({ id: attemptId, requestLogId: requestLog.id, modelId: active.model.id, upstreamModelId: active.model.upstreamModelId, source: 'agent', purpose: 'generation', fallbackFromModelId: activeIndex ? runtimes[activeIndex - 1]!.model.id : null, retryAttempt: currentRetryAttempt, turnNumber: modelTurns, status: 'in_progress' })
      await db.update(responses).set({ actualModelId: active.model.id, pricingVersionId: pricing.id }).where(eq(responses.id, responseId))
      await db.update(requestLogs).set({ status: 'in_progress', currentModelId: active.model.id, currentRetryAttempt, currentTurnNumber: modelTurns, fallbackUsed: activeIndex > 0, updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
    } else if (event.type === 'message_update') {
      const update = event.assistantMessageEvent
      const substantiveOutput = agentStreamEventHasSubstantiveOutput(update)
      if (substantiveOutput) {
        firstTokenTimeout?.clear()
        if (!turnOutputStarted.has(modelTurns)) turnFirstTokenMs.set(modelTurns, Date.now() - (modelTurnStartedAt.get(modelTurns) ?? Date.now()))
        turnOutputStarted.add(modelTurns)
      }
      if (update.type === 'text_delta') await emit('response.output_text.delta', {
        delta: update.delta,
        item_id: `agent:${modelTurns}:${update.contentIndex}:message`,
        agent_turn: modelTurns,
        content_index: update.contentIndex,
      })
      if (update.type === 'thinking_delta') await emit('response.reasoning_summary_text.delta', {
        delta: update.delta,
        item_id: `agent:${modelTurns}:${update.contentIndex}:reasoning`,
        agent_turn: modelTurns,
        content_index: update.contentIndex,
      })
      if (
        (update.type === 'text_delta' || update.type === 'thinking_delta')
        && Date.now() - lastSnapshotAt >= config.RESPONSE_SNAPSHOT_INTERVAL_MS
      ) await snapshot()
    } else if (event.type === 'message_end' && event.message.role === 'assistant') {
      firstTokenTimeout?.clear()
      const message = event.message as AssistantMessage
      const completedTurnNumber = modelTurns
      if (active.codex) await recordReconstructedDiagnostic({ requestLogId: requestLog.id, modelCallId: turnAttemptIds.get(modelTurns), purpose: 'generation', providerId: active.provider.id, modelId: active.model.id, upstreamModelId: active.model.upstreamModelId }, turnRequestPayloads.get(modelTurns), message, { turnNumber: modelTurns, firstTokenMs: turnFirstTokenMs.get(modelTurns) }, message.stopReason === 'error' ? 'failed' : 'completed')
      turnRequestPayloads.delete(completedTurnNumber)
      const completedRuntime = turnRuntime.get(completedTurnNumber) ?? { runtime: active, index: activeIndex }
      const turnUsage = { inputTokens: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite, cachedInputTokens: message.usage.cacheRead, cacheWriteTokens: message.usage.cacheWrite, outputTokens: message.usage.output, reasoningTokens: message.usage.reasoning ?? 0, totalTokens: message.usage.totalTokens }
      usage = { inputTokens: usage.inputTokens + turnUsage.inputTokens, cachedInputTokens: usage.cachedInputTokens + turnUsage.cachedInputTokens, cacheWriteTokens: usage.cacheWriteTokens + turnUsage.cacheWriteTokens, outputTokens: usage.outputTokens + turnUsage.outputTokens, reasoningTokens: usage.reasoningTokens + turnUsage.reasoningTokens, totalTokens: usage.totalTokens + turnUsage.totalTokens }
      const pricing = turnPricing.get(completedTurnNumber) ?? await getActivePricing(completedRuntime.runtime.model.id)
      const configuredTurnCost = calculateCostMicros(turnUsage, pricing)
      const providerTurnCost = completedRuntime.runtime.model.useProviderCost
        ? await turnProviderCosts.get(completedTurnNumber)?.()
        : undefined
      const turnCost = providerTurnCost ?? configuredTurnCost
      accruedCostMicros += turnCost
      await retainBudgetReservation(responseId, accruedCostMicros + accruedToolCostMicros + sidecarCostMicros + workspaceHoldMicrosAmount,
        accruedToolCostMicros + sidecarCostMicros + workspaceHoldMicrosAmount)
      if (completedRuntime.runtime.codex) {
        inferenceReferenceCostMicros += codexInferenceReferenceCostMicros(completedRuntime.runtime.piModel, turnUsage)
      }
      billingTurns.push({ modelId: completedRuntime.runtime.model.id, pricingVersionId: pricing.id, usage: turnUsage, costMicros: turnCost })
      const turnDurationMs = Date.now() - (modelTurnStartedAt.get(completedTurnNumber) ?? Date.now())
      turnDurationsMs.set(completedTurnNumber, turnDurationMs)
      const outputStarted = turnOutputStarted.has(completedTurnNumber) || assistantMessageHasOutput(message)
      if (outputStarted) turnOutputStarted.add(completedTurnNumber)
      const failed = message.stopReason === 'error' || message.stopReason === 'aborted'
      if (!failed) {
        currentRetryAttempt = 1
        successfulModelTurns += 1
      }
      if (!failed || outputStarted) lastResponder = { runtime: completedRuntime.runtime, pricing }
      const cancellationRequested = message.stopReason === 'aborted'
        && (agentAbortReason === 'cancellation' || await isCancellationRequested(responseId))
      const errorCategory = failed
        ? cancellationRequested ? 'cancellation' : classifyGenerationError(new Error(message.errorMessage || 'Agent model turn failed'))
        : undefined
      await db.update(generationAttempts).set({
        status: failed ? 'failed' : 'completed', upstreamResponseId: message.responseId, errorCategory, errorMessage: message.errorMessage,
        inputTokens: turnUsage.inputTokens, cachedInputTokens: turnUsage.cachedInputTokens, cacheWriteTokens: turnUsage.cacheWriteTokens, outputTokens: turnUsage.outputTokens,
        reasoningTokens: turnUsage.reasoningTokens, costMicros: turnCost,
        durationMs: turnDurationMs, completedAt: new Date(),
      }).where(eq(generationAttempts.id, turnAttemptIds.get(completedTurnNumber)!))
      await db.update(requestLogs).set({
        actualModelId: lastResponder?.runtime.model.id,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
        costMicros: accruedCostMicros + accruedToolCostMicros,
        eventCount: sql`${requestLogs.eventCount} + 1`,
        updatedAt: new Date(),
      }).where(eq(requestLogs.id, requestLog.id))
      const reasoningContentIndex = Array.isArray(message.content)
        ? message.content.findIndex((part) => {
            const candidate = part as { type?: string; thinking?: string }
            return candidate.type === 'thinking' && Boolean(candidate.thinking?.trim())
          })
        : -1
      if (reasoningContentIndex >= 0) {
        await emit('pulpo.agent.reasoning.completed', {
          id: `agent:${completedTurnNumber}:${reasoningContentIndex}:reasoning`,
          agent_turn: completedTurnNumber,
          agent_content_index: reasoningContentIndex,
          durationMs: turnDurationMs,
        })
      }
      if (!failed && isSlowCompletion(completedRuntime.runtime.model, turnDurationMs, turnUsage.outputTokens)) {
        await markModelSticky(redis, completedRuntime.runtime.model, 'slow_completion')
        if (completedRuntime.index === activeIndex) await activateFallbackRuntime(completedRuntime.index)
      }
      await snapshotIfDue()
    } else if (event.type === 'tool_execution_start') {
      toolCalls += 1
      const item: ToolTimelineItem = {
        id: event.toolCallId,
        type: 'pulpo_tool',
        tool: event.toolName,
        arguments: event.args,
        status: 'queued',
        output: '',
      }
      toolItems.set(event.toolCallId, item)
      await db.insert(toolExecutions).values({ id: newId(), agentRunId: runId, operationId: event.toolCallId, toolName: event.toolName, arguments: {}, status: 'queued' }).onConflictDoNothing()
      await emit('pulpo.agent.tool.queued', item)
      await snapshotIfDue()
    } else if (event.type === 'tool_execution_update') {
      const item = toolItems.get(event.toolCallId); const delta = truncateUtf8(toolResultText(event.partialResult), settings.maxToolOutputBytes)
      if (item) item.output = delta
      await emit('pulpo.agent.tool.delta', { id: event.toolCallId, delta })
      await snapshotIfDue()
    } else if (event.type === 'tool_execution_end') {
      const output = truncateUtf8(toolResultText(event.result), settings.maxToolOutputBytes)
      const details = toolResultDetails(event.result)
      const imagePreview = event.toolName === 'view_image' && !event.isError
        ? toolImagePreviewSchema.safeParse(details.imagePreview).data
        : undefined
      const providerExecution = webProviderExecutions.get(event.toolCallId)
      const providerCostMicros = nonNegativeMicros(details.providerCostMicros ?? providerExecution?.providerCostMicros)
      const billedCostMicros = event.isError ? 0 : nonNegativeMicros(details.billedCostMicros)
      const item = toolItems.get(event.toolCallId)
      if (item) {
        const durationMs = item.startedAt ? Math.max(0, Date.now() - Date.parse(item.startedAt)) : undefined
        Object.assign(item, { ...(imagePreview ? { imagePreview } : {}), output, status: event.isError ? 'failed' : 'completed', isError: event.isError, ...(durationMs !== undefined ? { durationMs } : {}) })
      }
      await recordReconstructedDiagnostic({ requestLogId: requestLog.id, operationId: event.toolCallId, purpose: 'tool', metadata: { toolName: event.toolName } }, item?.arguments, { output }, { durationMs: item?.durationMs, ...(event.isError ? { failureStage: 'tool' } : {}) }, event.isError ? 'failed' : 'completed')
      await db.update(toolExecutions).set({
        workspaceLeaseId: manager.leaseId,
        status: event.isError ? 'failed' : 'completed',
        output: null,
        ...(event.toolName === 'generate_image' ? {} : { provider: typeof details.provider === 'string' ? details.provider : providerExecution?.provider }),
        ...(event.toolName === 'generate_image' ? {} : { providerAttempts: Array.isArray(details.providerAttempts) ? details.providerAttempts : providerExecution?.attempts ?? [] }),
        providerCostMicros,
        ...(event.toolName === 'generate_image' ? {} : { billedCostMicros }),
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(toolExecutions.agentRunId, runId), eq(toolExecutions.operationId, event.toolCallId)))
      accruedToolCostMicros = await readToolCost()
      webProviderExecutions.delete(event.toolCallId)
      await emit('pulpo.agent.tool.completed', { id: event.toolCallId, output, isError: event.isError, durationMs: item?.durationMs, ...(imagePreview ? { imagePreview } : {}) })
      if (manager.continuedWithoutAgent) disableAgentTools()
      await snapshotIfDue()
    }
    await persistRunContext(event.type !== 'message_update' && event.type !== 'tool_execution_update')
  })
  await db.update(responses).set({ status: 'in_progress', startedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, responseId))
  try {
    await resizeBudgetReservation({
      responseId, accruedCostMicros: accruedCostMicros + accruedToolCostMicros + sidecarCostMicros,
      accruedExtraCostMicros: accruedToolCostMicros + sidecarCostMicros,
      requestInput: record.response.input,
      maxOutputTokens: Math.min(active.model.minimumOutputReservationTokens, publicOutputTokenLimit(active.model.maxOutputTokens, record.response.parameters as Record<string, unknown>).max_output_tokens),
      minimumOutputReservationTokens: active.model.minimumOutputReservationTokens,
      pricing: await getActivePricing(active.model.id),
    })
    await emit('pulpo.agent.started', { runId })
    // A compaction cut short by a crash never finishes; close it before the run goes on.
    for (const item of interruptedCompactionItems(compactionItems)) await updateCompaction(item)
    const initialPrompt = buildAgentUserPrompt(record.response.input, attachedFiles) || 'How can I help?'
    const promptImages = await loadAgentPromptImages(attachedFiles, undefined, parseAuthSettings(attachmentSettingsRow?.value).maxInlineImages)
    const initialMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: initialPrompt }, ...promptImages],
      timestamp: Date.now(),
    }
    if (!existingRun) {
      // The history is summarized; agent.prompt appends the incoming prompt after the summary.
      resumedMessages = await compactAgentContext({
        phase: 'pre_response',
        systemPrompt: agent.state.systemPrompt,
        tools: agent.state.tools,
        messages: resumedMessages,
        pending: [initialMessage],
      }) ?? resumedMessages
      agent.state.messages = resumedMessages
      agent.state.model = active.piModel
      skipMessageCount = resumedMessages.length
    }
    if (existingRun && resumedRunContinues({ promptRecorded }, resumedMessages.length, skipMessageCount)) await agent.continue()
    else await agent.prompt(initialMessage)
    let last = agent.state.messages.at(-1)
    // Any context recovery disables ordinary retries and fallback for the rest of the run.
    let contextRecovered = false
    let successfulTurnsAtRecovery: number | undefined
    const refreshTimeContext = () => {
      agentSystemPrompt = withGenerationTimeContext(agentSystemPrompt, record.response, Date.now())
      agent.state.systemPrompt = agentSystemPrompt
    }
    while (last?.role === 'assistant' && (last.stopReason === 'error' || last.stopReason === 'aborted')) {
      const failedTurnNumber = modelTurns
      const failedRuntime = turnRuntime.get(failedTurnNumber) ?? { runtime: active, index: activeIndex }
      const outputStarted = turnOutputStarted.has(failedTurnNumber) || assistantMessageHasOutput(last)
      // Recovering twice without a successful turn in between would loop on a context that cannot shrink.
      const recoveryAllowed = active.model.compactionEnabled
        && (successfulTurnsAtRecovery === undefined || successfulModelTurns > successfulTurnsAtRecovery)
      const overflow = contextOverflowOutcome(last, { contextWindow: active.model.contextWindow, outputStarted, recoveryAllowed })
      // Resending or rerouting an oversized request cannot help, so an overflow that cannot be recovered fails the run.
      if (overflow === 'stop') break
      if (overflow === 'recover') {
        const failedMessage = last
        const originalMessages = agent.state.messages.slice(0, -1)
        agent.state.messages = originalMessages
        const compactedMessages = await compactAgentContext({
          phase: 'agent_mid_run',
          systemPrompt: agent.state.systemPrompt,
          tools: agent.state.tools,
          messages: originalMessages,
          force: true,
          beforeAgentTurn: nextDisplayTurn(),
        })
        if (!compactedMessages) {
          agent.state.messages = [...originalMessages, failedMessage]
          break
        }
        adoptCompactedContext(compactedMessages)
        contextRecovered = true
        successfulTurnsAtRecovery = successfulModelTurns
        refreshTimeContext()
        await agent.continue()
        last = agent.state.messages.at(-1)
        continue
      }
      const cancellationRequested = await isCancellationRequested(responseId) || agentAbortReason !== undefined
      const retryAttempt = nextAgentRetryAttempt({
        message: last,
        currentAttempt: turnRetryAttempts.get(failedTurnNumber) ?? 1,
        maxAttempts: agentModelAttemptLimit(runtimes.map((candidate) => candidate.model), failedRuntime.index),
        outputStarted,
        cancellationRequested,
      })
      if (retryAttempt !== undefined && !contextRecovered) {
        const retryPolicy = failedRuntime.index > 0 ? runtimes[failedRuntime.index - 1]!.model : failedRuntime.runtime.model
        if (retryPolicy.retryDelaySeconds > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryPolicy.retryDelaySeconds * 1_000))
        }
        if (await isCancellationRequested(responseId) || agentAbortReason !== undefined) break
        currentRetryAttempt = retryAttempt
        agent.state.messages = agent.state.messages.slice(0, -1)
        await db.update(requestLogs).set({ retryCount: sql`${requestLogs.retryCount} + 1`, updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
        refreshTimeContext()
        await agent.continue()
        last = agent.state.messages.at(-1)
        continue
      }
      if (!canFallbackAgentTurn({ message: last, outputStarted, cancellationRequested, contextRetryAttempted: contextRecovered })) break
      if (failedRuntime.index !== activeIndex || activeIndex + 1 >= runtimes.length) break
      await markModelSticky(redis, failedRuntime.runtime.model, classifyGenerationError(new Error(last.errorMessage || 'Agent model turn failed')))
      agent.state.messages = agent.state.messages.slice(0, -1)
      if (!await activateFallbackRuntime(failedRuntime.index)) break
      refreshTimeContext()
      await agent.continue()
      last = agent.state.messages.at(-1)
    }
    if (last?.role === 'assistant' && (last.stopReason === 'error' || last.stopReason === 'aborted')) throw new Error(last.errorMessage || 'Agent model turn failed')
    const cancelled = await isCancellationRequested(responseId)
    if (cancelled) throw new Error('Generation cancelled')
    const terminalStatus = last?.role === 'assistant' && last.stopReason === 'length' ? 'incomplete' : 'completed'
    await snapshot(terminalStatus)
    const [completed] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (completed) await persistResponseItems(responseId, completed.output as unknown[])
    await db.update(agentRuns).set({ status: 'completed', context: runContext(), modelTurns, toolCalls, completedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, runId))
    const finalResponder = lastResponder ?? { runtime: active, pricing: await getActivePricing(active.model.id) }
    await db.update(responses).set({ actualModelId: finalResponder.runtime.model.id, pricingVersionId: finalResponder.pricing.id }).where(eq(responses.id, responseId))
    const postTasks: PostResponseTaskResult = terminalStatus === 'completed'
      ? await runPostResponseTasks(record, finalResponder.runtime, completed?.output as unknown[] ?? [], requestLog.id)
      : { costMicros: 0 }
    if (postTasks.error) {
      const error = postTasks.error
      if (finalResponder.runtime.codex && codexErrorRequiresReauthentication(error)) {
        await markCodexReauthenticationRequired(record.response.userId, 'Your Codex connection needs to be renewed.')
      }
      console.warn(JSON.stringify({
        level: 'warn', service: 'pulpo-worker', event: 'post_response_tasks.failed', responseId,
        error: finalResponder.runtime.codex ? safeCodexErrorMessage(error) : error instanceof Error ? error.message : String(error),
      }))
    }
    const postTaskCostMicros = postTasks.costMicros
    const workspaceElapsedMs = workspaceReadyAtMs !== undefined && settings.billWorkspaces ? Date.now() - workspaceReadyAtMs : 0
    workspaceCostMicros = workspaceUsageMicros(workspaceElapsedMs, settings.workspacePricePerMinuteMicros)
    accruedToolCostMicros = await readToolCost()
    const settlement = agentSettlementAmounts({
      totalTokens: usage.totalTokens,
      generationCostMicros: accruedCostMicros,
      toolCostMicros: accruedToolCostMicros,
      sidecarCostMicros,
      postTaskCostMicros,
      workspaceCostMicros,
    })
    const cost = settlement.shouldSettle
      ? await settleBudget({
        responseId,
        usage,
        latencyMs: Date.now() - startedAt,
        costMicrosOverride: settlement.costMicrosOverride,
        additionalCostMicros: settlement.additionalCostMicros,
        inferenceReferenceCostMicros,
        workspace: { minutes: workspaceBillableMinutes(workspaceElapsedMs), costMicros: workspaceCostMicros },
      })
      : (await releaseBudget(responseId), 0)
    const totalDurationMs = Date.now() - startedAt
    await db.update(requestLogs).set({ status: terminalStatus, actualModelId: finalResponder.runtime.model.id, inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, cacheWriteTokens: usage.cacheWriteTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, costMicros: cost, durationMs: totalDurationMs, tokensPerSecond: totalDurationMs > 0 ? completionTokensPerSecond(totalDurationMs, usage.outputTokens) : null, completedAt: new Date(), updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
    await publishAdminUsage(requestLog.id, true)
  } catch (error) {
    // Compaction and overflow texts may mention tokens, which the Codex reauthentication check would misread.
    const contextFailure = isContextFailure(error)
    const errorMessage = active.codex
      ? contextFailure ? codexContextFailureMessage(error) : safeCodexErrorMessage(error)
      : error instanceof Error ? error.message : String(error)
    if (active.codex) {
      agent.state.messages = agent.state.messages.map((message) => (
        message.role === 'assistant' && message.errorMessage ? { ...message, errorMessage } : message
      ))
    }
    if (active.codex && !contextFailure && codexErrorRequiresReauthentication(error)) {
      await markCodexReauthenticationRequired(record.response.userId, 'Your Codex connection needs to be renewed.')
    }
    const cancelled = await isCancellationRequested(responseId)
    const status = cancelled ? 'cancelled' : 'failed'
    await snapshot(status, errorMessage)
    await db.update(agentRuns).set({ status, error: errorMessage, context: runContext(), completedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, runId))
    const finalResponder = lastResponder ?? { runtime: active, pricing: await getActivePricing(active.model.id) }
    await db.update(responses).set({ actualModelId: finalResponder.runtime.model.id, pricingVersionId: finalResponder.pricing.id }).where(eq(responses.id, responseId))
    const workspaceElapsedMs = workspaceReadyAtMs !== undefined && settings.billWorkspaces ? Date.now() - workspaceReadyAtMs : 0
    workspaceCostMicros = workspaceUsageMicros(workspaceElapsedMs, settings.workspacePricePerMinuteMicros)
    accruedToolCostMicros = await readToolCost()
    const settlement = agentSettlementAmounts({
      totalTokens: usage.totalTokens,
      generationCostMicros: accruedCostMicros,
      toolCostMicros: accruedToolCostMicros,
      sidecarCostMicros,
      workspaceCostMicros,
    })
    const cost = settlement.shouldSettle
      ? await settleBudget({
        responseId,
        usage,
        latencyMs: Date.now() - startedAt,
        costMicrosOverride: settlement.costMicrosOverride,
        additionalCostMicros: settlement.additionalCostMicros,
        inferenceReferenceCostMicros,
        workspace: { minutes: workspaceBillableMinutes(workspaceElapsedMs), costMicros: workspaceCostMicros },
      })
      : (await releaseBudget(responseId), 0)
    const totalDurationMs = Date.now() - startedAt
    await db.update(requestLogs).set({ status, actualModelId: finalResponder.runtime.model.id, inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, cacheWriteTokens: usage.cacheWriteTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, costMicros: cost, errorCategory: cancelled ? 'cancellation' : classifyGenerationError(error), errorMessage, durationMs: totalDurationMs, tokensPerSecond: totalDurationMs > 0 ? completionTokensPerSecond(totalDurationMs, usage.outputTokens) : null, completedAt: new Date(), updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
    await publishAdminUsage(requestLog.id, true)
    if (!cancelled) throw active.codex ? new Error(errorMessage) : error
  } finally {
    firstTokenTimeout?.clear()
    clearTimeout(abortTimer); clearInterval(cancellationTimer)
  }
}
