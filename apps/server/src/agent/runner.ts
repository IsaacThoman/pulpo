import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import type { AssistantMessage, Context, Model } from '@earendil-works/pi-ai'
import type { CompactionItem } from '@pulpo/contracts'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { agentRuns, applicationSettings, attachments, chats, generationAttempts, models, providerConnections, requestLogs, responses, toolExecutions } from '../database/schema.js'
import { decryptSecret } from '../lib/crypto.js'
import { getConfig } from '../config.js'
import { newId } from '../lib/ids.js'
import { parseAgentSettings, parseWebToolsSettings } from '../settings/application-settings.js'
import { isCancellationRequested, publishResponseEvent, publishSnapshot } from '../responses/events.js'
import { toSnapshot } from '../responses/service.js'
import { persistResponseItems } from '../responses/storage.js'
import { extendBudgetReservationFixedCost, getActivePricing, releaseBudget, resizeBudgetReservation, settleBudget } from '../accounting/service.js'
import { WorkspaceManager } from './controller.js'
import { createWorkspaceTools } from './tools.js'
import { publishAdminUsage } from '../admin/usage-events.js'
import { buildAgentSystemPrompt, buildAgentUserPrompt } from './policy.js'
import { runPostResponseTasks } from '../responses/post-tasks.js'
import { calculateCostMicros } from '../accounting/pricing.js'
import { truncateUtf8 } from './output.js'
import { buildAgentOutput, type ToolTimelineItem } from './timeline.js'
import { messagesForPersistence } from './context.js'
import { basename } from 'node:path'
import { storeGeneratedAttachment } from '../attachments/generated.js'
import type { AttachmentTimelineItem } from './timeline.js'
import { KagiClient } from './kagi.js'
import { createWebTools } from './web-tools.js'
import { createModelImageInterceptor, interceptAgentContextImages } from '../responses/image-ocr.js'
import { estimateInputTokens } from '../accounting/pricing.js'
import { COMPACTION_PROMPT, retainedEntries } from '../responses/compaction.js'
import { trackInternalModelCall } from '../responses/model-calls.js'
import { createCatalogModelClient } from '../responses/catalog-model-runtime.js'
import { effectiveAgentCompactionThreshold, estimateAgentContextTokens, shouldRetryContextOverflow } from './context-budget.js'
import { sanitizeContextForStorage } from '../responses/public-output.js'

function assistantText(message: AssistantMessage): string {
  return message.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('')
}

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

function initialMessages(context: unknown): AgentMessage[] {
  if (!context || typeof context !== 'object') return []
  const messages = (context as { messages?: unknown }).messages
  return Array.isArray(messages) ? messages as AgentMessage[] : []
}

export async function processAgentGeneration(responseId: string): Promise<void> {
  const startedAt = Date.now()
  const config = getConfig()
  const [record] = await db.select({ response: responses, model: models, provider: providerConnections })
    .from(responses).innerJoin(models, eq(responses.modelId, models.id)).innerJoin(providerConnections, eq(models.providerConnectionId, providerConnections.id))
    .where(eq(responses.id, responseId)).limit(1)
  if (!record || !record.response.agentMode || ['completed', 'cancelled'].includes(record.response.status)) return
  const [settingsRow, webToolsRow] = await Promise.all([
    db.select().from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1).then((rows) => rows[0]),
    db.select().from(applicationSettings).where(eq(applicationSettings.key, 'webTools')).limit(1).then((rows) => rows[0]),
  ])
  const settings = parseAgentSettings(settingsRow?.value)
  const webToolsSettings = parseWebToolsSettings(webToolsRow?.value)
  if (!settings.enabled || !record.model.agentEnabled) throw new Error('Agent mode is no longer available')
  const [parentRun] = record.response.parentResponseId
    ? await db.select({ context: agentRuns.context }).from(agentRuns).innerJoin(responses, eq(agentRuns.responseId, responses.id)).where(eq(responses.id, record.response.parentResponseId)).limit(1)
    : []
  const [existingRun] = await db.select().from(agentRuns).where(eq(agentRuns.responseId, responseId)).limit(1)
  const runId = existingRun?.id ?? newId()
  let resumedMessages = initialMessages(existingRun?.context ?? parentRun?.context)
  await db.insert(agentRuns).values({ id: runId, responseId, status: 'running', context: { messages: resumedMessages }, startedAt: new Date() }).onConflictDoUpdate({ target: agentRuns.responseId, set: { status: 'running', updatedAt: new Date() } })
  const [requestLog] = await db.select().from(requestLogs).where(eq(requestLogs.responseId, responseId)).limit(1)
  if (!requestLog) throw new Error('Request log is missing')
  const [chatState] = await db.select({ temporary: chats.temporary }).from(chats)
    .where(eq(chats.id, record.response.chatId)).limit(1)
  const imageInterceptor = await createModelImageInterceptor(requestLog.id, {
    allowCache: !chatState?.temporary,
  })
  const attachmentIds = (Array.isArray(record.response.input) ? record.response.input : []).flatMap((item) => {
    const content = (item as { content?: unknown }).content
    return Array.isArray(content) ? content.flatMap((part) => {
      const id = (part as { attachment_id?: unknown }).attachment_id
      return typeof id === 'string' ? [id] : []
    }) : []
  })
  const attachmentRows = attachmentIds.length
    ? await db.select({ id: attachments.id, originalName: attachments.originalName, mimeType: attachments.mimeType, sizeBytes: attachments.sizeBytes })
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
  while (fallbackId && runtimes.length < 8 && !visited.has(fallbackId)) {
    const [next] = await db.select({ model: models, provider: providerConnections }).from(models).innerJoin(providerConnections, eq(models.providerConnectionId, providerConnections.id)).where(and(eq(models.id, fallbackId), eq(models.enabled, true))).limit(1)
    if (!next) break
    visited.add(next.model.id); runtimes.push(runtime(next.model, next.provider)); fallbackId = next.model.fallbackModelId
  }
  let activeIndex = 0; let active = runtimes[0]!
  const streams = openAIResponsesApi()
  const emptyUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 }
  const persistedUsage = record.response.usage as typeof emptyUsage | null
  let sequence = record.response.lastSequence; let modelTurns = existingRun?.modelTurns ?? 0; let toolCalls = existingRun?.toolCalls ?? 0
  let usage = persistedUsage ?? emptyUsage
  const [[previousModelCost], [previousWebToolCost]] = await Promise.all([
    db.select({ total: sql<number>`coalesce(sum(${generationAttempts.costMicros}), 0)::bigint` })
      .from(generationAttempts).where(and(eq(generationAttempts.requestLogId, requestLog.id), eq(generationAttempts.source, 'agent'))),
    db.select({ total: sql<number>`coalesce(sum(${toolExecutions.billedCostMicros}), 0)::bigint` })
      .from(toolExecutions).where(and(eq(toolExecutions.agentRunId, runId), eq(toolExecutions.status, 'completed'))),
  ])
  let accruedCostMicros = Number(previousModelCost?.total ?? 0)
  let accruedWebToolCostMicros = Number(previousWebToolCost?.total ?? 0)
  const billingTurns: Array<Record<string, unknown>> = []
  const modelTurnStartedAt = new Map<number, number>()
  const turnDurationsMs = new Map<number, number>()
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
  let skipMessageCount = initialMessages(parentRun?.context).length
  const archivedDisplayMessages: AgentMessage[] = []
  let lastSnapshotAt = 0
  const emit = async (type: string, payload: Record<string, unknown>) => {
    sequence += 1
    await publishResponseEvent({ responseId, sequence, type, payload, emittedAt: new Date().toISOString() })
  }
  let agent!: Agent
  const snapshot = async (terminal?: 'completed' | 'failed' | 'cancelled', errorMessage?: string) => {
    const state = agent?.state
    const streamingMessage = state?.streamingMessage
    const hasStreaming = Boolean(streamingMessage && streamingMessage.role === 'assistant')
    const stateMessages = [
      ...(state?.messages ?? resumedMessages),
      ...(hasStreaming ? [streamingMessage as AgentMessage] : []),
    ]
    const messages = [...archivedDisplayMessages, ...stateMessages.slice(skipMessageCount)]
    const output = buildAgentOutput({
      messages,
      skipMessageCount: 0,
      toolItems,
      attachmentItems,
      workspaceItem,
      compactionItems,
      turnDurationsMs,
      streaming: hasStreaming && !terminal,
      terminal: Boolean(terminal),
    })
    await db.update(responses).set({ status: terminal ?? 'in_progress', output, usage, error: errorMessage ? { message: errorMessage } : undefined, lastSequence: sequence, completedAt: terminal ? new Date() : undefined, updatedAt: new Date() }).where(eq(responses.id, responseId))
    const [updated] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (updated) await publishSnapshot(toSnapshot(updated))
    lastSnapshotAt = Date.now()
  }
  const updateCompaction = async (item: CompactionItem) => {
    const index = compactionItems.findIndex((candidate) => candidate.id === item.id)
    if (index >= 0) compactionItems[index] = item
    else compactionItems.push(item)
    await emit('pulpo.compaction.updated', item as unknown as Record<string, unknown>)
    await snapshot()
  }
  const agentCycles = (messages: AgentMessage[]): AgentMessage[][] => {
    const cycles: AgentMessage[][] = []
    let current: AgentMessage[] = []
    for (const message of messages) {
      if (message.role === 'assistant' && current.length) {
        cycles.push(current)
        current = []
      }
      current.push(message)
    }
    if (current.length) cycles.push(current)
    return cycles
  }
  const compactAgentContext = async (
    messages: AgentMessage[],
    thresholdTokens: number,
    phase: CompactionItem['phase'],
    beforeAgentTurn?: number,
    extraContext: unknown[] = [],
    options: { force?: boolean; retainedTurns?: number; estimatedTokens?: number } = {},
  ): Promise<AgentMessage[]> => {
    const estimatedTokens = options.estimatedTokens ?? estimateInputTokens([
      buildAgentSystemPrompt(active.model.systemPrompt, active.model.agentInstructions),
      ...messages,
      ...extraContext,
    ])
    const cycles = agentCycles(messages)
    const retainedTurnCount = options.retainedTurns ?? active.model.compactionRetainedTurns
    if (!active.model.compactionEnabled || (!options.force && estimatedTokens <= thresholdTokens) || cycles.length <= retainedTurnCount) return messages
    const retained = cycles.slice(-retainedTurnCount).flat()
    const older = cycles.slice(0, -retainedTurnCount).flat()
    const storedRetained = sanitizeContextForStorage(retained)
    const storedRetainedTurns = sanitizeContextForStorage(cycles.slice(-retainedTurnCount)) as unknown[][]
    const id = `${responseId}:compaction:${phase}:${beforeAgentTurn ?? 0}`
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
      const result = await trackInternalModelCall({
        requestLogId: requestLog.id,
        modelId: active.model.id,
        upstreamModelId: active.model.upstreamModelId,
        purpose: 'compaction',
        invoke: () => client.responses.create({
          model: active.model.upstreamModelId,
          input: [{ role: 'user', content: `${COMPACTION_PROMPT}\n\n${JSON.stringify(older)}` }],
          store: false,
          max_output_tokens: Math.min(2_000, active.model.maxOutputTokens),
        }),
      })
      const item: CompactionItem = { ...base, status: 'completed', summary: result.output_text, duration_ms: Date.now() - started }
      await updateCompaction(item)
      return [{
        role: 'user',
        content: [{ type: 'text', text: `[Compacted context]\n${result.output_text}` }],
        timestamp: Date.now(),
      } as AgentMessage, ...retained]
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
  const manager = new WorkspaceManager(responseId, record.response.chatId, record.response.userId, async (state, details = {}) => {
    if ((state === 'waiting' || state === 'provisioning') && workspaceStartedAtMs === undefined) {
      workspaceStartedAtMs = Date.now()
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
    await snapshot()
  })
  const markToolStarted = async (operationId: string) => {
    const item = toolItems.get(operationId)
    if (!item || item.startedAt) return
    const startedAt = new Date()
    Object.assign(item, { status: 'running', startedAt: startedAt.toISOString() })
    await db.update(toolExecutions).set({ workspaceLeaseId: manager.leaseId, status: 'running', startedAt, updatedAt: startedAt }).where(and(eq(toolExecutions.agentRunId, runId), eq(toolExecutions.operationId, operationId)))
    await emit('pulpo.agent.tool.started', item)
    await snapshot()
  }
  const configuredWebTools = webToolsSettings.encryptedApiKey && (webToolsSettings.searchEnabled || webToolsSettings.extractEnabled)
    ? createWebTools({
      client: new KagiClient(decryptSecret(webToolsSettings.encryptedApiKey, config.ENCRYPTION_KEY)),
      settings: webToolsSettings,
      maxOutputBytes: settings.maxToolOutputBytes,
      onOperationStarted: markToolStarted,
      reserveBillableCost: (amountMicros) => extendBudgetReservationFixedCost(responseId, amountMicros),
    })
    : []
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
    await snapshot()
    return stored
  }
  const abortTimer = setTimeout(() => agent.abort(), settings.responseTimeoutSeconds * 1000)
  const cancellationTimer = setInterval(() => void isCancellationRequested(responseId).then((cancelled) => { if (cancelled) agent.abort() }), 500)
  agent = new Agent({
    initialState: {
      systemPrompt: buildAgentSystemPrompt(record.model.systemPrompt, record.model.agentInstructions),
      model: active.piModel,
      tools: [...createWorkspaceTools(manager, settings.commandTimeoutSeconds * 1000, markToolStarted, attachFile), ...configuredWebTools],
      messages: resumedMessages,
      thinkingLevel: 'medium',
    },
    streamFn: async (model, context, options) => {
      const thresholdTokens = effectiveAgentCompactionThreshold(
        active.model.agentCompactionThresholdTokens,
        active.model.contextWindow,
      )
      let preparedContext = await interceptAgentContextImages(context, active.model, imageInterceptor)
      const estimatedTokens = estimateAgentContextTokens(preparedContext as Context)
      if (estimatedTokens > thresholdTokens) {
        const originalMessages = context.messages as AgentMessage[]
        const compactedMessages = await compactAgentContext(
          originalMessages,
          thresholdTokens,
          modelTurns > 1 ? 'agent_mid_run' : 'pre_response',
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
      return streams.streamSimple(
        model as Model<'openai-responses'>,
        preparedContext,
        { ...options, apiKey: active.apiKey, maxTokens: active.model.maxOutputTokens, timeoutMs: active.provider.requestTimeoutMs, maxRetries: active.model.maxRetries },
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
      context: { messages: messagesForPersistence(agent.state.messages), billingTurns },
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
        accruedCostMicros: accruedCostMicros + accruedWebToolCostMicros,
        requestInput: agent.state.messages,
        maxOutputTokens: active.model.maxOutputTokens,
        pricing: await getActivePricing(active.model.id),
      })
    } else if (event.type === 'message_start' && event.message.role === 'assistant') {
      modelTurnStartedAt.set(modelTurns, Date.now())
      await db.insert(generationAttempts).values({ id: newId(), requestLogId: requestLog.id, modelId: active.model.id, upstreamModelId: active.model.upstreamModelId, source: 'agent', purpose: 'generation', fallbackFromModelId: activeIndex ? runtimes[activeIndex - 1]!.model.id : null, retryAttempt: 1, turnNumber: modelTurns, status: 'in_progress' })
      await db.update(responses).set({ actualModelId: active.model.id }).where(eq(responses.id, responseId))
      await db.update(requestLogs).set({ status: 'in_progress', currentModelId: active.model.id, currentRetryAttempt: 1, currentTurnNumber: modelTurns, fallbackUsed: activeIndex > 0, updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
    } else if (event.type === 'message_update') {
      const update = event.assistantMessageEvent
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
      const message = event.message as AssistantMessage
      const turnUsage = { inputTokens: message.usage.input, cachedInputTokens: message.usage.cacheRead, outputTokens: message.usage.output, reasoningTokens: message.usage.reasoning ?? 0, totalTokens: message.usage.totalTokens }
      usage = { inputTokens: usage.inputTokens + turnUsage.inputTokens, cachedInputTokens: usage.cachedInputTokens + turnUsage.cachedInputTokens, outputTokens: usage.outputTokens + turnUsage.outputTokens, reasoningTokens: usage.reasoningTokens + turnUsage.reasoningTokens, totalTokens: usage.totalTokens + turnUsage.totalTokens }
      const pricing = await getActivePricing(active.model.id); const turnCost = calculateCostMicros(turnUsage, pricing)
      accruedCostMicros += turnCost; billingTurns.push({ modelId: active.model.id, pricingVersionId: pricing.id, usage: turnUsage, costMicros: turnCost })
      const turnDurationMs = Date.now() - (modelTurnStartedAt.get(modelTurns) ?? Date.now())
      turnDurationsMs.set(modelTurns, turnDurationMs)
      await db.update(generationAttempts).set({
        status: message.stopReason === 'error' ? 'failed' : 'completed', upstreamResponseId: message.responseId, errorMessage: message.errorMessage,
        inputTokens: turnUsage.inputTokens, cachedInputTokens: turnUsage.cachedInputTokens, outputTokens: turnUsage.outputTokens,
        reasoningTokens: turnUsage.reasoningTokens, costMicros: turnCost,
        durationMs: turnDurationMs, completedAt: new Date(),
      }).where(and(eq(generationAttempts.requestLogId, requestLog.id), eq(generationAttempts.turnNumber, modelTurns), eq(generationAttempts.source, 'agent')))
      await db.update(requestLogs).set({ inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, eventCount: sql`${requestLogs.eventCount} + 1`, updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
      await snapshot()
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
      await snapshot()
    } else if (event.type === 'tool_execution_update') {
      const item = toolItems.get(event.toolCallId); const delta = truncateUtf8(toolResultText(event.partialResult), settings.maxToolOutputBytes)
      if (item) item.output = delta
      await emit('pulpo.agent.tool.delta', { id: event.toolCallId, delta })
      await snapshot()
    } else if (event.type === 'tool_execution_end') {
      const output = truncateUtf8(toolResultText(event.result), settings.maxToolOutputBytes)
      const details = toolResultDetails(event.result)
      const providerCostMicros = event.isError ? 0 : nonNegativeMicros(details.providerCostMicros)
      const billedCostMicros = event.isError ? 0 : nonNegativeMicros(details.billedCostMicros)
      accruedWebToolCostMicros += billedCostMicros
      const item = toolItems.get(event.toolCallId)
      if (item) {
        const durationMs = item.startedAt ? Math.max(0, Date.now() - Date.parse(item.startedAt)) : undefined
        Object.assign(item, { output, status: event.isError ? 'failed' : 'completed', isError: event.isError, ...(durationMs !== undefined ? { durationMs } : {}) })
      }
      await db.update(toolExecutions).set({ workspaceLeaseId: manager.leaseId, status: event.isError ? 'failed' : 'completed', output, providerCostMicros, billedCostMicros, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(toolExecutions.agentRunId, runId), eq(toolExecutions.operationId, event.toolCallId)))
      await emit('pulpo.agent.tool.completed', { id: event.toolCallId, output, isError: event.isError, durationMs: item?.durationMs })
      if (manager.continuedWithoutAgent) agent.state.tools = []
      await snapshot()
    }
    await persistRunContext(event.type !== 'message_update' && event.type !== 'tool_execution_update')
  })
  await db.update(responses).set({ status: 'in_progress', startedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, responseId))
  try {
    await emit('pulpo.agent.started', { runId })
    const initialPrompt = buildAgentUserPrompt(record.response.input, attachedFiles) || 'How can I help?'
    if (!existingRun) {
      while (true) {
        try {
          resumedMessages = await compactAgentContext(
            resumedMessages,
            effectiveAgentCompactionThreshold(active.model.agentCompactionThresholdTokens, active.model.contextWindow),
            'pre_response',
            undefined,
            [initialPrompt],
          )
          agent.state.messages = resumedMessages
          agent.state.model = active.piModel
          skipMessageCount = resumedMessages.length
          break
        } catch (error) {
          if (activeIndex + 1 >= runtimes.length) throw error
          active = runtimes[++activeIndex]!
        }
      }
    }
    if (existingRun && resumedMessages.length > initialMessages(parentRun?.context).length) await agent.continue()
    else await agent.prompt(initialPrompt)
    let last = agent.state.messages.at(-1)
    let overflowRetried = false
    while (last?.role === 'assistant' && last.stopReason === 'error' && !assistantText(last)) {
      if (shouldRetryContextOverflow(last, active.model.contextWindow, overflowRetried)) {
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
          effectiveAgentCompactionThreshold(active.model.agentCompactionThresholdTokens, active.model.contextWindow),
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
      if (activeIndex + 1 >= runtimes.length || overflowRetried) break
      agent.state.messages = agent.state.messages.slice(0, -1)
      active = runtimes[++activeIndex]!
      agent.state.model = active.piModel
      const pricing = await getActivePricing(active.model.id)
      await db.update(responses).set({ actualModelId: active.model.id, pricingVersionId: pricing.id }).where(eq(responses.id, responseId))
      await db.update(requestLogs).set({ fallbackUsed: true, currentModelId: active.model.id, updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
      await publishAdminUsage(requestLog.id, true)
      await agent.continue()
      last = agent.state.messages.at(-1)
    }
    if (last?.role === 'assistant' && last.stopReason === 'error') throw new Error(last.errorMessage || 'Agent model turn failed')
    const cancelled = await isCancellationRequested(responseId)
    if (cancelled) throw new Error('Generation cancelled')
    await snapshot('completed')
    const [completed] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (completed) await persistResponseItems(responseId, completed.output as unknown[])
    await db.update(agentRuns).set({ status: 'completed', context: { messages: messagesForPersistence(agent.state.messages), billingTurns }, modelTurns, toolCalls, completedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, runId))
    const cost = usage.totalTokens ? await settleBudget({ responseId, usage, latencyMs: Date.now() - startedAt, costMicrosOverride: accruedCostMicros + accruedWebToolCostMicros }) : (await releaseBudget(responseId), 0)
    await db.update(requestLogs).set({ status: 'completed', actualModelId: active.model.id, inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, costMicros: cost, durationMs: Date.now() - startedAt, completedAt: new Date(), updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
    await publishAdminUsage(requestLog.id, true)
    await runPostResponseTasks(record, active, completed?.output as unknown[] ?? [], requestLog.id).catch((error) => {
      console.warn(JSON.stringify({ level: 'warn', service: 'pulpo-worker', event: 'post_response_tasks.failed', responseId, error: error instanceof Error ? error.message : String(error) }))
    })
  } catch (error) {
    const cancelled = await isCancellationRequested(responseId)
    const status = cancelled ? 'cancelled' : 'failed'
    await snapshot(status, error instanceof Error ? error.message : String(error))
    await db.update(agentRuns).set({ status, error: error instanceof Error ? error.message : String(error), context: { messages: messagesForPersistence(agent.state.messages), billingTurns }, completedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, runId))
    const cost = usage.totalTokens ? await settleBudget({ responseId, usage, latencyMs: Date.now() - startedAt, costMicrosOverride: accruedCostMicros + accruedWebToolCostMicros }) : (await releaseBudget(responseId), 0)
    await db.update(requestLogs).set({ status, actualModelId: active.model.id, inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, costMicros: cost, errorMessage: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt, completedAt: new Date(), updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
    await publishAdminUsage(requestLog.id, true)
    if (!cancelled) throw error
  } finally {
    clearTimeout(abortTimer); clearInterval(cancellationTimer)
  }
}
