import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import type { AssistantMessage, Model } from '@earendil-works/pi-ai'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { agentRuns, applicationSettings, attachments, generationAttempts, models, providerConnections, requestLogs, responses, toolExecutions } from '../database/schema.js'
import { decryptSecret } from '../lib/crypto.js'
import { getConfig } from '../config.js'
import { newId } from '../lib/ids.js'
import { parseAgentSettings } from '../settings/application-settings.js'
import { isCancellationRequested, publishResponseEvent, publishSnapshot } from '../responses/events.js'
import { toSnapshot } from '../responses/service.js'
import { persistResponseItems } from '../responses/storage.js'
import { extendBudgetReservation, getActivePricing, releaseBudget, settleBudget } from '../accounting/service.js'
import { WorkspaceManager } from './controller.js'
import { createWorkspaceTools } from './tools.js'
import { publishAdminUsage } from '../admin/usage-events.js'
import { buildAgentSystemPrompt, buildAgentUserPrompt } from './policy.js'
import OpenAI from 'openai'
import { runPostResponseTasks } from '../responses/post-tasks.js'
import { calculateCostMicros } from '../accounting/pricing.js'
import { truncateUtf8 } from './output.js'
import { buildAgentOutput, type ToolTimelineItem } from './timeline.js'

function assistantText(message: AssistantMessage): string {
  return message.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('')
}

function toolResultText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content
  return content?.flatMap((part) => part.type === 'text' ? [part.text ?? ''] : []).join('\n') ?? ''
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
  const [settingsRow] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1)
  const settings = parseAgentSettings(settingsRow?.value)
  if (!settings.enabled || !record.model.agentEnabled) throw new Error('Agent mode is no longer available')
  const [parentRun] = record.response.parentResponseId
    ? await db.select({ context: agentRuns.context }).from(agentRuns).innerJoin(responses, eq(agentRuns.responseId, responses.id)).where(eq(responses.id, record.response.parentResponseId)).limit(1)
    : []
  const [existingRun] = await db.select().from(agentRuns).where(eq(agentRuns.responseId, responseId)).limit(1)
  const runId = existingRun?.id ?? newId()
  const resumedMessages = initialMessages(existingRun?.context ?? parentRun?.context)
  await db.insert(agentRuns).values({ id: runId, responseId, status: 'running', context: { messages: resumedMessages }, startedAt: new Date() }).onConflictDoUpdate({ target: agentRuns.responseId, set: { status: 'running', updatedAt: new Date() } })
  const [requestLog] = await db.select().from(requestLogs).where(eq(requestLogs.responseId, responseId)).limit(1)
  if (!requestLog) throw new Error('Request log is missing')
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
  let sequence = record.response.lastSequence; let modelTurns = 0; let toolCalls = 0
  let usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 }; let accruedCostMicros = 0
  const billingTurns: Array<Record<string, unknown>> = []
  const modelTurnStartedAt = new Map<number, number>()
  const turnDurationsMs = new Map<number, number>()
  const toolItems = new Map<string, ToolTimelineItem>()
  let workspaceItem: Record<string, unknown> | undefined
  let workspaceStartedAtMs: number | undefined
  const skipMessageCount = initialMessages(parentRun?.context).length
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
    const messages = [
      ...(state?.messages ?? resumedMessages),
      ...(hasStreaming ? [streamingMessage as AgentMessage] : []),
    ]
    const output = buildAgentOutput({
      messages,
      skipMessageCount,
      toolItems,
      workspaceItem,
      turnDurationsMs,
      streaming: hasStreaming && !terminal,
      terminal: Boolean(terminal),
    })
    await db.update(responses).set({ status: terminal ?? 'in_progress', output, usage, error: errorMessage ? { message: errorMessage } : undefined, lastSequence: sequence, completedAt: terminal ? new Date() : undefined, updatedAt: new Date() }).where(eq(responses.id, responseId))
    const [updated] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (updated) await publishSnapshot(toSnapshot(updated))
    lastSnapshotAt = Date.now()
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
  const abortTimer = setTimeout(() => agent.abort(), settings.responseTimeoutSeconds * 1000)
  const cancellationTimer = setInterval(() => void isCancellationRequested(responseId).then((cancelled) => { if (cancelled) agent.abort() }), 500)
  agent = new Agent({
    initialState: {
      systemPrompt: buildAgentSystemPrompt(record.model.systemPrompt, record.model.agentInstructions),
      model: active.piModel,
      tools: createWorkspaceTools(manager, settings.commandTimeoutSeconds * 1000, markToolStarted),
      messages: resumedMessages,
      thinkingLevel: 'medium',
    },
    streamFn: (model, context, options) => streams.streamSimple(model as Model<'openai-responses'>, context, { ...options, apiKey: active.apiKey, maxTokens: active.model.maxOutputTokens, timeoutMs: active.provider.requestTimeoutMs, maxRetries: active.model.maxRetries }),
    toolExecution: 'sequential',
    beforeToolCall: async () => {
      if (manager.continuedWithoutAgent) return { block: true, reason: 'Agent tools were disabled at the user’s request' }
      return toolCalls >= settings.maxToolCalls ? { block: true, reason: `Tool call limit (${settings.maxToolCalls}) reached` } : undefined
    },
  })
  agent.subscribe(async (event) => {
    if (event.type === 'turn_start') {
      modelTurns += 1
      if (modelTurns > settings.maxModelTurns) agent.abort()
      if (modelTurns > 1) await extendBudgetReservation({ responseId, requestInput: agent.state.messages, maxOutputTokens: active.model.maxOutputTokens, pricing: await getActivePricing(active.model.id) })
    } else if (event.type === 'message_start' && event.message.role === 'assistant') {
      modelTurnStartedAt.set(modelTurns, Date.now())
      await db.insert(generationAttempts).values({ id: newId(), requestLogId: requestLog.id, modelId: active.model.id, upstreamModelId: active.model.upstreamModelId, source: 'agent', purpose: 'generation', fallbackFromModelId: activeIndex ? runtimes[activeIndex - 1]!.model.id : null, retryAttempt: 1, turnNumber: modelTurns, status: 'in_progress' })
      await db.update(responses).set({ actualModelId: active.model.id }).where(eq(responses.id, responseId))
      await db.update(requestLogs).set({ status: 'in_progress', currentModelId: active.model.id, currentRetryAttempt: 1, currentTurnNumber: modelTurns, fallbackUsed: activeIndex > 0, updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
    } else if (event.type === 'message_update') {
      const update = event.assistantMessageEvent
      if (update.type === 'text_delta') await emit('response.output_text.delta', { delta: update.delta })
      if (update.type === 'thinking_delta') await emit('response.reasoning_summary_text.delta', { delta: update.delta })
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
      const item = toolItems.get(event.toolCallId)
      if (item) {
        const durationMs = item.startedAt ? Math.max(0, Date.now() - Date.parse(item.startedAt)) : undefined
        Object.assign(item, { output, status: event.isError ? 'failed' : 'completed', isError: event.isError, ...(durationMs !== undefined ? { durationMs } : {}) })
      }
      await db.update(toolExecutions).set({ workspaceLeaseId: manager.leaseId, status: event.isError ? 'failed' : 'completed', output, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(toolExecutions.agentRunId, runId), eq(toolExecutions.operationId, event.toolCallId)))
      await emit('pulpo.agent.tool.completed', { id: event.toolCallId, output, isError: event.isError, durationMs: item?.durationMs })
      if (manager.continuedWithoutAgent) agent.state.tools = []
      await snapshot()
    }
    await db.update(agentRuns).set({ workspaceLeaseId: manager.leaseId, context: { messages: agent.state.messages, billingTurns }, modelTurns, toolCalls, updatedAt: new Date() }).where(eq(agentRuns.id, runId))
  })
  await db.update(responses).set({ status: 'in_progress', startedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, responseId))
  try {
    await emit('pulpo.agent.started', { runId })
    if (existingRun && resumedMessages.length > initialMessages(parentRun?.context).length) await agent.continue()
    else await agent.prompt(buildAgentUserPrompt(record.response.input, attachedFiles) || 'How can I help?')
    let last = agent.state.messages.at(-1)
    while (last?.role === 'assistant' && last.stopReason === 'error' && !assistantText(last) && activeIndex + 1 < runtimes.length) {
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
    await db.update(agentRuns).set({ status: 'completed', context: { messages: agent.state.messages, billingTurns }, modelTurns, toolCalls, completedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, runId))
    const cost = usage.totalTokens ? await settleBudget({ responseId, usage, latencyMs: Date.now() - startedAt, costMicrosOverride: accruedCostMicros }) : (await releaseBudget(responseId), 0)
    await db.update(requestLogs).set({ status: 'completed', actualModelId: active.model.id, inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, costMicros: cost, durationMs: Date.now() - startedAt, completedAt: new Date(), updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
    await publishAdminUsage(requestLog.id, true)
    const postTaskClient = new OpenAI({ apiKey: active.apiKey, baseURL: active.provider.baseUrl, timeout: active.provider.requestTimeoutMs, maxRetries: active.model.maxRetries })
    await runPostResponseTasks(postTaskClient, record, completed?.output as unknown[] ?? [], requestLog.id).catch((error) => {
      console.warn(JSON.stringify({ level: 'warn', service: 'pulpo-worker', event: 'post_response_tasks.failed', responseId, error: error instanceof Error ? error.message : String(error) }))
    })
  } catch (error) {
    const cancelled = await isCancellationRequested(responseId)
    const status = cancelled ? 'cancelled' : 'failed'
    await snapshot(status, error instanceof Error ? error.message : String(error))
    await db.update(agentRuns).set({ status, error: error instanceof Error ? error.message : String(error), context: { messages: agent.state.messages, billingTurns }, completedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, runId))
    const cost = usage.totalTokens ? await settleBudget({ responseId, usage, latencyMs: Date.now() - startedAt, costMicrosOverride: accruedCostMicros }) : (await releaseBudget(responseId), 0)
    await db.update(requestLogs).set({ status, actualModelId: active.model.id, inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, costMicros: cost, errorMessage: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt, completedAt: new Date(), updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
    await publishAdminUsage(requestLog.id, true)
    if (!cancelled) throw error
  } finally {
    clearTimeout(abortTimer); clearInterval(cancellationTimer)
  }
}
