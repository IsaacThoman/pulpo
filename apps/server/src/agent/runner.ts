import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import type { AssistantMessage, Context, Model } from '@earendil-works/pi-ai'
import type { CompactionItem, ResponseSnapshot } from '@pulpo/contracts'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { agentRuns, applicationSettings, attachments, chats, generationAttempts, models, providerConnections, requestLogs, responses, toolExecutions, userPreferences } from '../database/schema.js'
import { decryptSecret } from '../lib/crypto.js'
import { getConfig } from '../config.js'
import { newId } from '../lib/ids.js'
import { parseAgentSettings, parseLoggingSettings, parsePersonalizationSettings, parseWebToolsSettings } from '../settings/application-settings.js'
import { composeCustomInstructions } from '../settings/instruction-presets.js'
import { isCancellationRequested, publishResponseEvent, publishSnapshot } from '../responses/events.js'
import { toSnapshot } from '../responses/service.js'
import { persistResponseItems } from '../responses/storage.js'
import { extendBudgetReservationFixedCost, getActivePricing, releaseBudget, resizeBudgetReservation, settleBudget } from '../accounting/service.js'
import { WorkspaceManager } from './controller.js'
import { createWorkspaceTools } from './tools.js'
import { publishAdminUsage } from '../admin/usage-events.js'
import { buildAgentSystemPrompt, buildAgentUserPrompt } from './policy.js'
import { runPostResponseTasks } from '../responses/post-tasks.js'
import { calculateCostMicros, workspaceHoldMicros, workspaceUsageMicros } from '../accounting/pricing.js'
import { truncateUtf8 } from './output.js'
import { buildAgentOutput, type ToolTimelineItem } from './timeline.js'
import { messagesForPersistence } from './context.js'
import { basename } from 'node:path'
import { storeGeneratedAttachment } from '../attachments/generated.js'
import type { AttachmentTimelineItem } from './timeline.js'
import { KagiClient } from './kagi.js'
import { createWebTools, type WebProviderExecution } from './web-tools.js'
import { FirecrawlClient, firecrawlCloudRequiresApiKey } from './firecrawl.js'
import { createModelImageInterceptor, interceptAgentContextImages } from '../responses/image-ocr.js'
import { retainedEntries } from '../responses/compaction.js'
import {
  agentCompactionItemId,
  agentCompactionPrompt,
  compactedAgentHandoffMessage,
  shouldCompactAgentContext,
  shouldCompactAgentStream,
  splitAgentContext,
} from './compaction.js'
import { isInsufficientBalanceError, trackBilledInternalModelCall } from '../responses/model-calls.js'
import { createCatalogModelClient } from '../responses/catalog-model-runtime.js'
import { effectiveAgentCompactionThreshold, estimateAgentContextTokens, shouldRetryContextOverflow } from './context-budget.js'
import { sanitizeContextForStorage, sanitizeOutputForClient } from '../responses/public-output.js'
import { providerCacheRequestOptions } from '../responses/provider-cache.js'
import { agentSnapshotIsDue } from './snapshot-policy.js'
import { lineageFromLeaf } from '../messages/branching.js'
import { responseUserAttachmentIds } from '../messages/input.js'
import { responseInputText } from '../messages/input.js'
import { selectRelevantMemories } from '../episodic-memory/retrieval.js'
import { messagesFromAgentContext, resolveAgentParentMessages, systemPromptFromAgentContext } from './history.js'
import { resolveAgentModelParameters } from './model-parameters.js'
import { redis } from '../redis.js'
import {
  MAX_MODEL_CHAIN_LENGTH,
  classifyGenerationError,
  completionTokensPerSecond,
  isModelSticky,
  isSlowCompletion,
  markModelSticky,
} from '../responses/fallback-policy.js'
import { assistantMessageHasOutput, canFallbackAgentTurn, nextAgentRetryAttempt, resolveStickyFallbackIndex } from './fallback-policy.js'
import { projectNextAgentResponseEvent, selectAgentResponseCheckpoint } from './streaming-snapshot.js'
import { createFirstTokenTimeout, type FirstTokenTimeout } from './first-token-timeout.js'
import { createProviderCostCapture } from './provider-cost.js'
import { orderedAgentTurnPayloads } from './detailed-payloads.js'
import { loadAgentPromptImages } from './prompt-images.js'

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

export async function processAgentGeneration(responseId: string): Promise<void> {
  try {
    await runAgentGeneration(responseId)
  } catch (error) {
    await finalizeUnhandledAgentFailure(responseId, error)
    throw error
  }
}

async function runAgentGeneration(responseId: string): Promise<void> {
  const startedAt = Date.now()
  const config = getConfig()
  const [record] = await db.select({ response: responses, model: models, provider: providerConnections })
    .from(responses).innerJoin(models, eq(responses.modelId, models.id)).innerJoin(providerConnections, eq(models.providerConnectionId, providerConnections.id))
    .where(eq(responses.id, responseId)).limit(1)
  if (!record || !record.response.agentMode || ['completed', 'cancelled'].includes(record.response.status)) return
  const [settingsRow, webToolsRow, personalizationRow, loggingRow, preferencesRow] = await Promise.all([
    db.select().from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1).then((rows) => rows[0]),
    db.select().from(applicationSettings).where(eq(applicationSettings.key, 'webTools')).limit(1).then((rows) => rows[0]),
    db.select().from(applicationSettings).where(eq(applicationSettings.key, 'personalization')).limit(1).then((rows) => rows[0]),
    db.select().from(applicationSettings).where(eq(applicationSettings.key, 'logging')).limit(1).then((rows) => rows[0]),
    db.select({ values: userPreferences.values }).from(userPreferences)
      .where(eq(userPreferences.userId, record.response.userId)).limit(1).then((rows) => rows[0]),
  ])
  const settings = parseAgentSettings(settingsRow?.value)
  const webToolsSettings = parseWebToolsSettings(webToolsRow?.value)
  const detailedPayloadsEnabled = parseLoggingSettings(loggingRow?.value).logDetailedPayloads
  const preferenceValues = (preferencesRow?.values ?? {}) as Record<string, unknown>
  const customInstructions = composeCustomInstructions(
    parsePersonalizationSettings(personalizationRow?.value),
    preferenceValues,
  )
  const enabledMemories = preferenceValues.memoryEnabled
    ? await selectRelevantMemories(record.response.userId, responseInputText(record.response.input))
    : []
  const currentAgentSystemPrompt = buildAgentSystemPrompt(
    record.model.systemPrompt,
    record.model.agentInstructions,
    customInstructions,
    enabledMemories,
  )
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
  const agentSystemPrompt = systemPromptFromAgentContext(existingRun?.context) ?? currentAgentSystemPrompt
  let resumedMessages = existingRun ? messagesFromAgentContext(existingRun.context) : parentMessages
  await db.insert(agentRuns).values({ id: runId, responseId, status: 'running', context: { systemPrompt: agentSystemPrompt, messages: resumedMessages }, startedAt: new Date() }).onConflictDoUpdate({ target: agentRuns.responseId, set: { status: 'running', updatedAt: new Date() } })
  const [requestLog] = await db.select().from(requestLogs).where(eq(requestLogs.responseId, responseId)).limit(1)
  if (!requestLog) throw new Error('Request log is missing')
  const [chatState] = await db.select({ temporary: chats.temporary }).from(chats)
    .where(eq(chats.id, record.response.chatId)).limit(1)
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
  type RuntimeModel = { model: typeof models.$inferSelect; provider: typeof providerConnections.$inferSelect; apiKey: string; piModel: Model<'openai-responses'> }
  const runtime = (model: typeof models.$inferSelect, provider: typeof providerConnections.$inferSelect): RuntimeModel => ({
    model, provider,
    apiKey: decryptSecret(provider.encryptedApiKey, config.ENCRYPTION_KEY),
    piModel: { id: model.upstreamModelId, name: model.name, api: 'openai-responses', provider: 'openai', baseUrl: provider.baseUrl, reasoning: true, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: model.contextWindow, maxTokens: model.maxOutputTokens },
  })
  const runtimes = [runtime(record.model, record.provider)]
  const visited = new Set([record.model.id]); let fallbackId = record.model.fallbackModelId
  while (fallbackId && runtimes.length < MAX_MODEL_CHAIN_LENGTH && !visited.has(fallbackId)) {
    const [next] = await db.select({ model: models, provider: providerConnections }).from(models).innerJoin(providerConnections, eq(models.providerConnectionId, providerConnections.id)).where(and(eq(models.id, fallbackId), eq(models.enabled, true))).limit(1)
    if (!next) break
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
  const streams = openAIResponsesApi()
  const emptyUsage = { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 }
  const persistedUsage = record.response.usage as typeof emptyUsage | null
  let streamProjection: ResponseSnapshot = toSnapshot(record.response)
  let modelTurns = existingRun?.modelTurns ?? 0; let toolCalls = existingRun?.toolCalls ?? 0
  let usage = persistedUsage ?? emptyUsage
  const [[previousModelCost], [previousWebToolCost]] = await Promise.all([
    db.select({ total: sql<number>`coalesce(sum(${generationAttempts.costMicros}), 0)::bigint` })
      .from(generationAttempts).where(and(eq(generationAttempts.requestLogId, requestLog.id), eq(generationAttempts.source, 'agent'))),
    db.select({ total: sql<number>`coalesce(sum(${toolExecutions.billedCostMicros}), 0)::bigint` })
      .from(toolExecutions).where(and(eq(toolExecutions.agentRunId, runId), eq(toolExecutions.status, 'completed'))),
  ])
  let accruedCostMicros = Number(previousModelCost?.total ?? 0)
  let accruedWebToolCostMicros = Number(previousWebToolCost?.total ?? 0)
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
  const turnResponsePayloads = new Map<number, unknown>()
  const turnRetryAttempts = new Map<number, number>()
  let currentRetryAttempt = 1
  let lastResponder: { runtime: RuntimeModel; pricing: ActivePricing } | undefined
  const toolItems = new Map<string, ToolTimelineItem>()
  const generatedAttachmentRows = await db.select().from(attachments).where(and(
    eq(attachments.sourceResponseId, responseId), eq(attachments.origin, 'assistant'), eq(attachments.status, 'ready'),
  ))
  const attachmentItems = new Map<string, AttachmentTimelineItem>(generatedAttachmentRows.flatMap((attachment) => (
    attachment.sourceToolCallId ? [[attachment.sourceToolCallId, {
      type: 'pulpo_attachment' as const, attachment_id: attachment.id, name: attachment.originalName,
      mime_type: attachment.mimeType, size_bytes: attachment.sizeBytes, status: 'completed' as const,
    }] as const] : []
  )))
  const compactionItems: CompactionItem[] = (record.response.output as unknown[]).filter((raw): raw is CompactionItem => (
    (raw as { type?: string }).type === 'pulpo_compaction'
  ))
  let workspaceItem: Record<string, unknown> | undefined
  let workspaceStartedAtMs: number | undefined
  let workspaceReadyAtMs: number | undefined
  let workspaceHoldMicrosAmount = 0
  let workspaceCostMicros = 0
  let skipMessageCount = parentMessages.length
  const archivedDisplayMessages: AgentMessage[] = []
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
  const snapshot = async (terminal?: 'completed' | 'failed' | 'cancelled', errorMessage?: string) => {
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
        turnDurationsMs,
        streaming: false,
        terminal: true,
      })
      checkpoint = selectAgentResponseCheckpoint(streamProjection, { terminal: true, output: terminalOutput })
    }
    await db.update(responses).set({ status: terminal ?? 'in_progress', output: checkpoint.output, usage, error: errorMessage ? { message: errorMessage } : undefined, lastSequence: checkpoint.sequence, completedAt: terminal ? new Date() : undefined, updatedAt: new Date() }).where(eq(responses.id, responseId))
    const [updated] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (updated) await publishSnapshot(toSnapshot(updated))
    lastSnapshotAt = Date.now()
  }
  const snapshotIfDue = async () => {
    if (agentSnapshotIsDue(lastSnapshotAt, Date.now(), config.RESPONSE_SNAPSHOT_INTERVAL_MS)) await snapshot()
  }
  const updateCompaction = async (item: CompactionItem) => {
    const index = compactionItems.findIndex((candidate) => candidate.id === item.id)
    if (index >= 0) compactionItems[index] = item
    else compactionItems.push(item)
    const publicItem = sanitizeOutputForClient([item])[0] as Record<string, unknown>
    await emit('pulpo.compaction.updated', publicItem)
    await snapshotIfDue()
  }
  const compactionThreshold = () => effectiveAgentCompactionThreshold(
    active.model.compactionThresholdTokens,
    active.model.contextWindow,
  )
  const estimateCompactionTokens = (messages: AgentMessage[], extraMessages: AgentMessage[] = []) => estimateAgentContextTokens({
    systemPrompt: agentSystemPrompt,
    messages: [...messages, ...extraMessages],
    tools: agent?.state.tools,
  } as Context)
  const compactAgentContext = async (
    messages: AgentMessage[],
    thresholdTokens: number,
    phase: CompactionItem['phase'],
    beforeAgentTurn?: number,
    extraMessages: AgentMessage[] = [],
    options: { force?: boolean; retainedTurns?: number; estimatedTokens?: number } = {},
  ): Promise<AgentMessage[]> => {
    const estimatedTokens = options.estimatedTokens ?? estimateCompactionTokens(messages, extraMessages)
    const retainedTurnCount = options.retainedTurns ?? active.model.compactionRetainedTurns
    const split = splitAgentContext(messages, retainedTurnCount)
    if (!shouldCompactAgentContext({
      enabled: active.model.compactionEnabled,
      force: options.force,
      estimatedTokens,
      thresholdTokens,
      cycleCount: split.cycles.length,
      retainedTurns: retainedTurnCount,
    })) return messages
    const { retained, older, retainedCycles } = split
    const storedRetained = sanitizeContextForStorage(retained)
    const storedRetainedTurns = sanitizeContextForStorage(retainedCycles) as unknown[][]
    const id = agentCompactionItemId(responseId, phase, beforeAgentTurn)
    const existing = compactionItems.find((item) => item.id === id && item.status === 'completed' && item.model_id === active.model.id)
    if (existing && !options.force) {
      return [compactedAgentHandoffMessage(existing.summary, phase), ...retained]
    }
    const started = Date.now()
    const base: CompactionItem = {
      id,
      type: 'pulpo_compaction',
      phase,
      status: 'in_progress',
      model_id: active.model.id,
      estimated_tokens: estimatedTokens,
      threshold_tokens: thresholdTokens,
      retained_turns: retainedEntries(retained),
      retained_context: storedRetained,
      retained_context_turns: storedRetainedTurns,
      summary: '',
      started_at: new Date(started).toISOString(),
      ...(beforeAgentTurn ? { before_agent_turn: beforeAgentTurn } : {}),
    }
    await updateCompaction(base)
    try {
      const client = createCatalogModelClient(active)
      const compactionInput = [{ role: 'user' as const, content: `${agentCompactionPrompt(phase)}\n\n${JSON.stringify(older)}` }]
      const maxOutputTokens = Math.min(2_000, active.model.maxOutputTokens)
      const billed = await trackBilledInternalModelCall({
        responseId,
        requestLogId: requestLog.id,
        modelId: active.model.id,
        upstreamModelId: active.model.upstreamModelId,
        purpose: 'compaction',
        requestInput: compactionInput,
        maxOutputTokens,
        required: true,
        invoke: () => client.responses.create({
          model: active.model.upstreamModelId,
          input: compactionInput,
          store: false,
          max_output_tokens: maxOutputTokens,
        }),
      })
      if ('skipped' in billed) throw new Error('Insufficient balance for conversation compaction')
      sidecarCostMicros += billed.costMicros
      const item: CompactionItem = { ...base, status: 'completed', summary: billed.result.output_text, duration_ms: Date.now() - started }
      await updateCompaction(item)
      return [compactedAgentHandoffMessage(billed.result.output_text, phase), ...retained]
    } catch (error) {
      await updateCompaction({ ...base, status: 'failed', duration_ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }
  const adoptCompactedContext = (originalMessages: AgentMessage[], compactedMessages: AgentMessage[]) => {
    if (compactedMessages === originalMessages) return false
    archivedDisplayMessages.push(...agent.state.messages.slice(skipMessageCount))
    agent.state.messages = compactedMessages
    skipMessageCount = compactedMessages.length
    return true
  }
  let manager!: WorkspaceManager
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
  const firecrawlApiKey = webToolsSettings.encryptedFirecrawlApiKey
    ? decryptSecret(webToolsSettings.encryptedFirecrawlApiKey, config.ENCRYPTION_KEY)
    : undefined
  const configuredWebTools = createWebTools({
    clients: {
      ...(webToolsSettings.encryptedKagiApiKey ? {
        kagi: new KagiClient(decryptSecret(webToolsSettings.encryptedKagiApiKey, config.ENCRYPTION_KEY)),
      } : {}),
      ...((firecrawlApiKey || !firecrawlCloudRequiresApiKey(webToolsSettings.firecrawl.baseUrl)) ? {
        firecrawl: new FirecrawlClient(webToolsSettings.firecrawl.baseUrl, firecrawlApiKey),
      } : {}),
    },
    settings: webToolsSettings,
    maxOutputBytes: settings.maxToolOutputBytes,
    onOperationStarted: markToolStarted,
    onProviderAttempts: (operationId, execution) => { webProviderExecutions.set(operationId, execution) },
    reserveBillableCost: (amountMicros) => extendBudgetReservationFixedCost(responseId, amountMicros),
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
  const abortTimer = setTimeout(() => agent.abort(), settings.responseTimeoutSeconds * 1000)
  const cancellationTimer = setInterval(() => void isCancellationRequested(responseId).then((cancelled) => { if (cancelled) agent.abort() }), 500)
  const initialParameters = resolveAgentModelParameters(active.model, record.response.parameters)
  let firstTokenTimeout: FirstTokenTimeout | undefined
  agent = new Agent({
    initialState: {
      systemPrompt: agentSystemPrompt,
      model: active.piModel,
      tools: [...createWorkspaceTools(manager, settings.commandTimeoutSeconds * 1000, markToolStarted, attachFile), ...configuredWebTools],
      messages: resumedMessages,
      thinkingLevel: initialParameters.reasoning,
    },
    streamFn: async (_model, context, options) => {
      const cacheOptions = providerCacheRequestOptions(active.provider, {
        userId: record.response.userId,
        chatId: record.response.chatId,
        runId,
      })
      const thresholdTokens = compactionThreshold()
      let preparedContext = await interceptAgentContextImages(context, active.model, imageInterceptor)
      const estimatedTokens = estimateAgentContextTokens(preparedContext as Context)
      if (estimatedTokens > thresholdTokens && shouldCompactAgentStream(modelTurns)) {
        const originalMessages = context.messages as AgentMessage[]
        const compactedMessages = await compactAgentContext(
          originalMessages,
          thresholdTokens,
          'agent_mid_run',
          modelTurns || undefined,
          [],
          { force: true, estimatedTokens },
        )
        if (adoptCompactedContext(originalMessages, compactedMessages)) {
          context = { ...context, messages: compactedMessages as typeof context.messages }
          preparedContext = await interceptAgentContextImages(context, active.model, imageInterceptor)
        }
      }
      const hardContextLimit = effectiveAgentCompactionThreshold(Number.MAX_SAFE_INTEGER, active.model.contextWindow)
      if (estimateAgentContextTokens(preparedContext as Context) > hardContextLimit) {
        throw new Error('Agent context remains above the model context window after compaction')
      }
      const resolvedParameters = resolveAgentModelParameters(active.model, record.response.parameters, options?.reasoning)
      modelTurnStartedAt.set(modelTurns, Date.now())
      firstTokenTimeout?.clear()
      firstTokenTimeout = createFirstTokenTimeout(
        active.model.firstTokenTimeoutEnabled,
        active.model.firstTokenTimeoutSeconds,
        options?.signal,
      )
      const providerCostCapture = active.model.useProviderCost ? createProviderCostCapture() : undefined
      if (providerCostCapture) turnProviderCosts.set(modelTurns, providerCostCapture.costMicros)
      return streams.streamSimple(
        active.piModel,
        preparedContext,
        {
          ...options,
          apiKey: active.apiKey,
          reasoning: resolvedParameters.reasoning,
          samplingParams: { ...options?.samplingParams, ...resolvedParameters.parameters },
          maxTokens: active.model.maxOutputTokens,
          timeoutMs: active.provider.requestTimeoutMs,
          maxRetries: 0,
          signal: firstTokenTimeout.signal,
          sessionId: cacheOptions.sessionId,
          headers: cacheOptions.headers,
          fetch: providerCostCapture?.fetch,
          onPayload: detailedPayloadsEnabled
            ? async (payload, model) => {
                const transformed = await options?.onPayload?.(payload, model)
                turnRequestPayloads.set(modelTurns, transformed ?? payload)
                return transformed
              }
            : options?.onPayload,
        },
      )
    },
    toolExecution: 'sequential',
    beforeToolCall: async () => {
      if (manager.continuedWithoutAgent) return { block: true, reason: 'Agent tools were disabled at the user’s request' }
      return toolCalls >= settings.maxToolCalls ? { block: true, reason: `Tool call limit (${settings.maxToolCalls}) reached` } : undefined
    },
  })
  let lastRunPersistAt = 0
  const persistRunContext = async (force = false) => {
    if (!force && Date.now() - lastRunPersistAt < 500) return
    lastRunPersistAt = Date.now()
    await db.update(agentRuns).set({
      workspaceLeaseId: manager.leaseId,
      context: { systemPrompt: agentSystemPrompt, messages: messagesForPersistence(agent.state.messages), billingTurns },
      modelTurns,
      toolCalls,
      updatedAt: new Date(),
    }).where(eq(agentRuns.id, runId))
  }
  agent.subscribe(async (event) => {
    if (event.type === 'turn_start') {
      modelTurns += 1
      if (modelTurns > settings.maxModelTurns) agent.abort()
      if (modelTurns > 1) await resizeBudgetReservation({
        responseId,
        accruedCostMicros: accruedCostMicros + accruedWebToolCostMicros + sidecarCostMicros + workspaceHoldMicrosAmount,
        requestInput: agent.state.messages,
        maxOutputTokens: active.model.maxOutputTokens,
        pricing: await getActivePricing(active.model.id),
      })
    } else if (event.type === 'message_start' && event.message.role === 'assistant') {
      if (!modelTurnStartedAt.has(modelTurns)) modelTurnStartedAt.set(modelTurns, Date.now())
      const attemptId = newId()
      const pricing = await getActivePricing(active.model.id)
      turnRuntime.set(modelTurns, { runtime: active, index: activeIndex })
      turnAttemptIds.set(modelTurns, attemptId)
      turnPricing.set(modelTurns, pricing)
      turnRetryAttempts.set(modelTurns, currentRetryAttempt)
      await db.insert(generationAttempts).values({ id: attemptId, requestLogId: requestLog.id, modelId: active.model.id, upstreamModelId: active.model.upstreamModelId, source: 'agent', purpose: 'generation', fallbackFromModelId: activeIndex ? runtimes[activeIndex - 1]!.model.id : null, retryAttempt: currentRetryAttempt, turnNumber: modelTurns, status: 'in_progress' })
      await db.update(responses).set({ actualModelId: active.model.id, pricingVersionId: pricing.id }).where(eq(responses.id, responseId))
      await db.update(requestLogs).set({ status: 'in_progress', currentModelId: active.model.id, currentRetryAttempt, currentTurnNumber: modelTurns, fallbackUsed: activeIndex > 0, updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
    } else if (event.type === 'message_update') {
      const update = event.assistantMessageEvent
      if (update.type === 'text_delta' || update.type === 'thinking_delta' || update.type === 'toolcall_delta') {
        firstTokenTimeout?.clear()
      }
      if (update.type === 'text_delta' || update.type === 'thinking_delta' || update.type === 'toolcall_delta') turnOutputStarted.add(modelTurns)
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
      if (detailedPayloadsEnabled) turnResponsePayloads.set(completedTurnNumber, message)
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
      billingTurns.push({ modelId: completedRuntime.runtime.model.id, pricingVersionId: pricing.id, usage: turnUsage, costMicros: turnCost })
      const turnDurationMs = Date.now() - (modelTurnStartedAt.get(completedTurnNumber) ?? Date.now())
      turnDurationsMs.set(completedTurnNumber, turnDurationMs)
      const outputStarted = turnOutputStarted.has(completedTurnNumber) || assistantMessageHasOutput(message)
      if (outputStarted) turnOutputStarted.add(completedTurnNumber)
      const failed = message.stopReason === 'error' || message.stopReason === 'aborted'
      if (!failed) currentRetryAttempt = 1
      if (!failed || outputStarted) lastResponder = { runtime: completedRuntime.runtime, pricing }
      const errorCategory = failed
        ? message.stopReason === 'aborted' ? 'cancellation' : classifyGenerationError(new Error(message.errorMessage || 'Agent model turn failed'))
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
        costMicros: accruedCostMicros + accruedWebToolCostMicros,
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
      await db.insert(toolExecutions).values({ id: newId(), agentRunId: runId, operationId: event.toolCallId, toolName: event.toolName, arguments: event.args, status: 'queued' }).onConflictDoNothing()
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
      const providerExecution = webProviderExecutions.get(event.toolCallId)
      const providerCostMicros = nonNegativeMicros(details.providerCostMicros ?? providerExecution?.providerCostMicros)
      const billedCostMicros = event.isError ? 0 : nonNegativeMicros(details.billedCostMicros)
      accruedWebToolCostMicros += billedCostMicros
      const item = toolItems.get(event.toolCallId)
      if (item) {
        const durationMs = item.startedAt ? Math.max(0, Date.now() - Date.parse(item.startedAt)) : undefined
        Object.assign(item, { output, status: event.isError ? 'failed' : 'completed', isError: event.isError, ...(durationMs !== undefined ? { durationMs } : {}) })
      }
      await db.update(toolExecutions).set({
        workspaceLeaseId: manager.leaseId,
        status: event.isError ? 'failed' : 'completed',
        output,
        provider: typeof details.provider === 'string' ? details.provider : providerExecution?.provider,
        providerAttempts: Array.isArray(details.providerAttempts) ? details.providerAttempts : providerExecution?.attempts ?? [],
        providerCostMicros,
        billedCostMicros,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(toolExecutions.agentRunId, runId), eq(toolExecutions.operationId, event.toolCallId)))
      webProviderExecutions.delete(event.toolCallId)
      await emit('pulpo.agent.tool.completed', { id: event.toolCallId, output, isError: event.isError, durationMs: item?.durationMs })
      if (manager.continuedWithoutAgent) agent.state.tools = []
      await snapshotIfDue()
    }
    await persistRunContext(event.type !== 'message_update' && event.type !== 'tool_execution_update')
  })
  await db.update(responses).set({ status: 'in_progress', startedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, responseId))
  try {
    await emit('pulpo.agent.started', { runId })
    const initialPrompt = buildAgentUserPrompt(record.response.input, attachedFiles) || 'How can I help?'
    const promptImages = await loadAgentPromptImages(attachedFiles)
    const initialMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: initialPrompt }, ...promptImages],
      timestamp: Date.now(),
    }
    if (!existingRun) {
      resumedMessages = await compactAgentContext(
        resumedMessages,
        compactionThreshold(),
        'pre_response',
        undefined,
        [initialMessage],
        { estimatedTokens: estimateCompactionTokens(resumedMessages, [initialMessage]) },
      )
      agent.state.messages = resumedMessages
      agent.state.model = active.piModel
      skipMessageCount = resumedMessages.length
    }
    if (existingRun && resumedMessages.length > parentMessages.length) await agent.continue()
    else await agent.prompt(initialMessage)
    let last = agent.state.messages.at(-1)
    let overflowRetried = false
    while (last?.role === 'assistant' && last.stopReason === 'error') {
      const failedTurnNumber = modelTurns
      const failedRuntime = turnRuntime.get(failedTurnNumber) ?? { runtime: active, index: activeIndex }
      const outputStarted = turnOutputStarted.has(failedTurnNumber) || assistantMessageHasOutput(last)
      if (!outputStarted && shouldRetryContextOverflow(last, active.model.contextWindow, overflowRetried)) {
        const failedMessage = last
        const originalMessages = agent.state.messages.slice(0, -1)
        agent.state.messages = originalMessages
        const estimatedTokens = estimateAgentContextTokens({
          systemPrompt: agent.state.systemPrompt,
          messages: originalMessages,
          tools: agent.state.tools,
        } as Context)
        const compactedMessages = await compactAgentContext(
          originalMessages,
          compactionThreshold(),
          'agent_mid_run',
          modelTurns,
          [],
          { force: true, retainedTurns: 1, estimatedTokens },
        )
        if (!adoptCompactedContext(originalMessages, compactedMessages)) {
          agent.state.messages = [...originalMessages, failedMessage]
          break
        }
        overflowRetried = true
        await agent.continue()
        last = agent.state.messages.at(-1)
        continue
      }
      const cancellationRequested = await isCancellationRequested(responseId)
      const retryAttempt = nextAgentRetryAttempt({
        message: last,
        currentAttempt: turnRetryAttempts.get(failedTurnNumber) ?? 1,
        maxRetries: failedRuntime.runtime.model.maxRetries,
        outputStarted,
        cancellationRequested,
      })
      if (retryAttempt !== undefined && !overflowRetried) {
        if (failedRuntime.runtime.model.retryDelaySeconds > 0) {
          await new Promise((resolve) => setTimeout(resolve, failedRuntime.runtime.model.retryDelaySeconds * 1_000))
        }
        if (await isCancellationRequested(responseId)) break
        currentRetryAttempt = retryAttempt
        agent.state.messages = agent.state.messages.slice(0, -1)
        await db.update(requestLogs).set({ retryCount: sql`${requestLogs.retryCount} + 1`, updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
        await agent.continue()
        last = agent.state.messages.at(-1)
        continue
      }
      if (!canFallbackAgentTurn({ message: last, outputStarted, cancellationRequested, contextRetryAttempted: overflowRetried })) break
      if (failedRuntime.index !== activeIndex || activeIndex + 1 >= runtimes.length) break
      await markModelSticky(redis, failedRuntime.runtime.model, classifyGenerationError(new Error(last.errorMessage || 'Agent model turn failed')))
      agent.state.messages = agent.state.messages.slice(0, -1)
      if (!await activateFallbackRuntime(failedRuntime.index)) break
      await agent.continue()
      last = agent.state.messages.at(-1)
    }
    if (last?.role === 'assistant' && (last.stopReason === 'error' || last.stopReason === 'aborted')) throw new Error(last.errorMessage || 'Agent model turn failed')
    const cancelled = await isCancellationRequested(responseId)
    if (cancelled) throw new Error('Generation cancelled')
    await snapshot('completed')
    const [completed] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (completed) await persistResponseItems(responseId, completed.output as unknown[])
    await db.update(agentRuns).set({ status: 'completed', context: { systemPrompt: agentSystemPrompt, messages: messagesForPersistence(agent.state.messages), billingTurns }, modelTurns, toolCalls, completedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, runId))
    const finalResponder = lastResponder ?? { runtime: active, pricing: await getActivePricing(active.model.id) }
    await db.update(responses).set({ actualModelId: finalResponder.runtime.model.id, pricingVersionId: finalResponder.pricing.id }).where(eq(responses.id, responseId))
    const postTaskCostMicros = await runPostResponseTasks(record, finalResponder.runtime, completed?.output as unknown[] ?? [], requestLog.id).catch((error) => {
      console.warn(JSON.stringify({ level: 'warn', service: 'pulpo-worker', event: 'post_response_tasks.failed', responseId, error: error instanceof Error ? error.message : String(error) }))
      return 0
    })
    workspaceCostMicros = workspaceReadyAtMs !== undefined && settings.billWorkspaces
      ? workspaceUsageMicros(Date.now() - workspaceReadyAtMs, settings.workspacePricePerMinuteMicros)
      : 0
    const additionalCostMicros = sidecarCostMicros + postTaskCostMicros + workspaceCostMicros
    const cost = usage.totalTokens || additionalCostMicros > 0
      ? await settleBudget({
        responseId,
        usage,
        latencyMs: Date.now() - startedAt,
        costMicrosOverride: usage.totalTokens ? accruedCostMicros + accruedWebToolCostMicros : 0,
        additionalCostMicros,
      })
      : (await releaseBudget(responseId), 0)
    const totalDurationMs = Date.now() - startedAt
    await db.update(requestLogs).set({ status: 'completed', actualModelId: finalResponder.runtime.model.id, inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, cacheWriteTokens: usage.cacheWriteTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, costMicros: cost, durationMs: totalDurationMs, tokensPerSecond: totalDurationMs > 0 ? completionTokensPerSecond(totalDurationMs, usage.outputTokens) : null, requestPayload: detailedPayloadsEnabled ? orderedAgentTurnPayloads(turnRequestPayloads) : undefined, responsePayload: detailedPayloadsEnabled ? orderedAgentTurnPayloads(turnResponsePayloads) : undefined, completedAt: new Date(), updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
    await publishAdminUsage(requestLog.id, true)
  } catch (error) {
    const cancelled = await isCancellationRequested(responseId)
    const status = cancelled ? 'cancelled' : 'failed'
    await snapshot(status, error instanceof Error ? error.message : String(error))
    await db.update(agentRuns).set({ status, error: error instanceof Error ? error.message : String(error), context: { systemPrompt: agentSystemPrompt, messages: messagesForPersistence(agent.state.messages), billingTurns }, completedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, runId))
    const finalResponder = lastResponder ?? { runtime: active, pricing: await getActivePricing(active.model.id) }
    await db.update(responses).set({ actualModelId: finalResponder.runtime.model.id, pricingVersionId: finalResponder.pricing.id }).where(eq(responses.id, responseId))
    workspaceCostMicros = workspaceReadyAtMs !== undefined && settings.billWorkspaces
      ? workspaceUsageMicros(Date.now() - workspaceReadyAtMs, settings.workspacePricePerMinuteMicros)
      : 0
    const additionalCostMicros = sidecarCostMicros + workspaceCostMicros
    const cost = usage.totalTokens || additionalCostMicros > 0
      ? await settleBudget({
        responseId,
        usage,
        latencyMs: Date.now() - startedAt,
        costMicrosOverride: usage.totalTokens ? accruedCostMicros + accruedWebToolCostMicros : 0,
        additionalCostMicros,
      })
      : (await releaseBudget(responseId), 0)
    const totalDurationMs = Date.now() - startedAt
    await db.update(requestLogs).set({ status, actualModelId: finalResponder.runtime.model.id, inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, cacheWriteTokens: usage.cacheWriteTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, costMicros: cost, errorCategory: cancelled ? 'cancellation' : classifyGenerationError(error), errorMessage: error instanceof Error ? error.message : String(error), durationMs: totalDurationMs, tokensPerSecond: totalDurationMs > 0 ? completionTokensPerSecond(totalDurationMs, usage.outputTokens) : null, requestPayload: detailedPayloadsEnabled ? orderedAgentTurnPayloads(turnRequestPayloads) : undefined, responsePayload: detailedPayloadsEnabled ? orderedAgentTurnPayloads(turnResponsePayloads) : undefined, completedAt: new Date(), updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
    await publishAdminUsage(requestLog.id, true)
    if (!cancelled) throw error
  } finally {
    firstTokenTimeout?.clear()
    clearTimeout(abortTimer); clearInterval(cancellationTimer)
  }
}
