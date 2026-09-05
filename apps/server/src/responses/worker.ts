import OpenAI, { toFile } from 'openai'
import type { AssistantMessage, Context, Message, ThinkingLevel } from '@earendil-works/pi-ai'
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { applyResponseEventToSnapshot, type CompactionItem, type RecallItem, type ResponseEvent, type ResponseUsage } from '@pulpo/contracts'
import { db } from '../database/client.js'
import {
  chats,
  attachments,
  models,
  providerConnections,
  responseContentParts,
  responseItems,
  responses,
  userPreferences,
  applicationSettings,
  requestLogs,
  generationAttempts,
} from '../database/schema.js'
import { decryptSecret } from '../lib/crypto.js'
import { getConfig } from '../config.js'
import { newId } from '../lib/ids.js'
import { isCancellationRequested, publishResponseEvent, publishSnapshot } from './events.js'
import { getActivePricing, releaseBudget, settleBudget } from '../accounting/service.js'
import { toSnapshot } from './service.js'
import { getBlobStore } from '../storage/index.js'
import { publishAdminUsage } from '../admin/usage-events.js'
import { redis } from '../redis.js'
import { parsePersonalizationSettings } from '../settings/application-settings.js'
import { composeCustomInstructions } from '../settings/instruction-presets.js'
import { processAgentGeneration } from '../agent/runner.js'
import { runPostResponseTasks } from './post-tasks.js'
import { EMPTY_USAGE, providerReportedCostMicros, trackBilledInternalModelCall } from './model-calls.js'
import { providerCacheRequestOptions } from './provider-cache.js'
import { createModelImageInterceptor, interceptOpenAIInputImages, type ModelImageInterceptor } from './image-ocr.js'
import { modelImageRendition } from './model-image.js'
import { sanitizeContextForStorage, sanitizeOutputForClient } from './public-output.js'
import { COMPACTION_PROMPT, compactConversation, retainedEntries } from './compaction.js'
import { shouldCompactContext } from './compaction-policy.js'
import { splitCodexConversationExchanges, type CodexConversationExchange } from './codex-compaction.js'
import { temporaryChatIsExpired } from '../chats/temporary.js'
import { normalChatIsExpired } from '../chats/expiration.js'
import { activeDetailedPayloadCondition, detailedPayloadCaptureIsActive } from '../logging/detailed-payload-retention.js'
import { resolveModelParameters } from './model-parameters.js'
import { backgroundRequestParameter, promptCacheKeyParameter, responseIncludeParameter } from './upstream-request.js'
import { browserChatOutputError, generationOutputHasStarted } from './output-text.js'
import { firstTokenTimeout } from './first-token-timeout.js'
import { responseAttachmentIds, responseInputText } from '../messages/input.js'
import { recalledChatContext, recallItemFromOutput, retrieveAutomaticRecall } from '../episodic-memory/automatic-recall.js'
import { memoryDocumentContext, readMemoryDocument } from '../memory-document/service.js'
import {
  GenerationAttemptError,
  MAX_MODEL_CHAIN_LENGTH,
  canFallbackAfterGenerationError,
  classifyGenerationError,
  completionTokensPerSecond,
  fallbackModelAttemptLimit,
  isModelSticky,
  isSlowCompletion,
  markModelSticky,
  primaryModelAttemptLimit,
} from './fallback-policy.js'
import { CODEX_PROVIDER_ID } from '../codex/constants.js'
import { codexErrorRequiresReauthentication, createCodexModels, markCodexReauthenticationRequired, redactedCodexError } from '../codex/credential-store.js'
import { codexInferenceReferenceCostMicros } from '../codex/reference-cost.js'
import { agentThinkingLevel } from '../agent/model-parameters.js'
import { estimateInputTokens } from '../accounting/pricing.js'

type UpstreamEvent = { type: string; [key: string]: unknown }

function accumulateEventOutput(output: unknown[], event: ResponseEvent): unknown[] {
  return applyResponseEventToSnapshot({
    responseId: event.responseId,
    status: 'in_progress',
    sequence: event.sequence - 1,
    output,
    usage: null,
    error: null,
    updatedAt: event.emittedAt,
  }, event).output
}

function normalizeUsage(usage: unknown): ResponseUsage {
  const value = (usage ?? {}) as {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number }
    output_tokens_details?: { reasoning_tokens?: number }
  }
  return {
    inputTokens: value.input_tokens ?? 0,
    cachedInputTokens: value.input_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: value.input_tokens_details?.cache_write_tokens ?? 0,
    outputTokens: value.output_tokens ?? 0,
    reasoningTokens: value.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: value.total_tokens ?? (value.input_tokens ?? 0) + (value.output_tokens ?? 0),
  }
}

async function settleWithSidecars(input: {
  responseId: string
  usage: ResponseUsage | null | undefined
  latencyMs: number
  providerCostMicros?: number
  additionalCostMicros: number
  inferenceReferenceCostMicros?: number
}): Promise<number> {
  const hasGeneration = Boolean(input.usage && input.usage.totalTokens > 0)
  if (!hasGeneration && input.additionalCostMicros <= 0) {
    await releaseBudget(input.responseId)
    return 0
  }
  return settleBudget({
    responseId: input.responseId,
    usage: input.usage ?? EMPTY_USAGE,
    latencyMs: input.latencyMs,
    costMicrosOverride: hasGeneration ? input.providerCostMicros : 0,
    additionalCostMicros: input.additionalCostMicros,
    inferenceReferenceCostMicros: input.inferenceReferenceCostMicros,
  })
}

async function persistItems(responseId: string, output: unknown[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(responseItems).where(eq(responseItems.responseId, responseId))
    for (const [position, raw] of output.entries()) {
      const item = raw as { id?: string; type?: string; role?: string; status?: string; content?: unknown[] }
      const itemId = newId()
      await tx.insert(responseItems).values({
        id: itemId,
        responseId,
        upstreamItemId: item.id,
        type: item.type ?? 'unknown',
        role: item.role,
        status: item.status,
        position,
        payload: raw,
      })
      if (Array.isArray(item.content)) {
        for (const [partPosition, part] of item.content.entries()) {
          const typedPart = part as { type?: string }
          await tx.insert(responseContentParts).values({
            id: newId(),
            responseItemId: itemId,
            type: typedPart.type ?? 'unknown',
            position: partPosition,
            payload: part,
          })
        }
      }
    }
  })
}

async function prepareInputFiles(client: OpenAI, userId: string, input: unknown[], model: typeof models.$inferSelect, interceptor: ModelImageInterceptor): Promise<unknown[]> {
  const prepared: unknown[] = []
  const normalizedInput = await interceptOpenAIInputImages(input, model, interceptor)
  for (const item of normalizedInput) {
    const typed = item as { content?: unknown[] }
    if (!Array.isArray(typed.content)) {
      prepared.push(item)
      continue
    }
    const content: unknown[] = []
    for (const part of typed.content) {
      const filePart = part as { type?: string; attachment_id?: string }
      if (filePart.type !== 'input_file' || !filePart.attachment_id) {
        content.push(part)
        continue
      }
      const [attachment] = await db.select().from(attachments).where(and(
        eq(attachments.id, filePart.attachment_id),
        eq(attachments.userId, userId),
      )).limit(1)
      if (!attachment || attachment.status !== 'ready') throw new Error('Attachment is unavailable')
      const bytes = await getBlobStore().get(attachment.objectKey)
      if (attachment.mimeType.startsWith('image/')) {
        const rendition = await modelImageRendition(bytes, attachment.mimeType, attachment.checksum)
        const dataUrl = `data:${rendition.mimeType};base64,${rendition.data.toString('base64')}`
        const text = await interceptor.intercept(model, { data: rendition.data, mimeType: rendition.mimeType, label: attachment.originalName, attachmentId: attachment.id, sourceChecksum: attachment.checksum })
        content.push(text === null ? { type: 'input_image', image_url: dataUrl } : { type: 'input_text', text })
        continue
      }
      let fileId = attachment.openaiFileId
      if (!fileId) {
        const uploaded = await client.files.create({
          file: await toFile(bytes, attachment.originalName, { type: attachment.mimeType }),
          purpose: 'user_data',
        })
        fileId = uploaded.id
        await db.update(attachments).set({ openaiFileId: fileId, updatedAt: new Date() }).where(and(
          eq(attachments.id, attachment.id),
          eq(attachments.userId, userId),
        ))
      }
      content.push({ type: 'input_file', file_id: fileId })
    }
    prepared.push({ ...typed, content })
  }
  return prepared
}

async function contextualInput(
  client: OpenAI,
  record: { response: typeof responses.$inferSelect; model: typeof models.$inferSelect },
  history: Array<typeof responses.$inferSelect>,
  requestLogId: string,
  recallItem: RecallItem | null,
  publicApi: boolean,
  onCompactionUpdate: (item: CompactionItem) => Promise<void>,
  onBilledCost: (costMicros: number) => void,
): Promise<{ input: unknown[]; compactionItems: CompactionItem[] }> {
  const [[preferences], [personalizationRow]] = publicApi ? [[], []] : await Promise.all([
    db.select().from(userPreferences).where(eq(userPreferences.userId, record.response.userId)).limit(1),
    db.select({ value: applicationSettings.value }).from(applicationSettings)
      .where(eq(applicationSettings.key, 'personalization')).limit(1),
  ])
  const values = (preferences?.values ?? {}) as { customInstructions?: string; memoryEnabled?: boolean; instructionPresetSelections?: unknown }
  const customInstructions = publicApi ? '' : composeCustomInstructions(parsePersonalizationSettings(personalizationRow?.value), values)
  const memoryContext = values.memoryEnabled
    ? memoryDocumentContext(await readMemoryDocument(record.response.userId))
    : ''
  const context: unknown[] = []
  if (record.model.systemPrompt.trim()) context.push({ role: 'developer', content: record.model.systemPrompt.trim() })
  if (customInstructions) context.push({ role: 'developer', content: `User-provided custom instructions:\n${customInstructions}` })
  if (memoryContext) context.push({ role: 'developer', content: memoryContext })
  const recallContext = recalledChatContext(recallItem)
  if (recallContext) context.push({ role: 'developer', content: recallContext })
  const existingItem = (record.response.output as unknown[]).find((raw): raw is CompactionItem => {
    const item = raw as Partial<CompactionItem>
    return item.type === 'pulpo_compaction' && item.phase === 'pre_response'
  })
  const compacted = await compactConversation({
    responseId: record.response.id,
    modelId: record.model.id,
    enabled: record.model.compactionEnabled,
    thresholdTokens: record.model.compactionThresholdTokens,
    retainedTurns: record.model.compactionRetainedTurns,
    fixedContext: context,
    currentInput: record.response.input as unknown[],
    history,
    existingItem,
    invoke: async (older) => {
      const compactionInput = [{ role: 'user' as const, content: `${COMPACTION_PROMPT}\n\n${JSON.stringify(older)}` }]
      const maxOutputTokens = Math.min(2_000, record.model.maxOutputTokens)
      const billed = await trackBilledInternalModelCall({
        responseId: record.response.id,
        requestLogId,
        modelId: record.model.id,
        upstreamModelId: record.model.upstreamModelId,
        purpose: 'compaction',
        requestInput: compactionInput,
        maxOutputTokens,
        required: true,
        invoke: () => client.responses.create({
          model: record.model.upstreamModelId,
          input: compactionInput,
          store: false,
          max_output_tokens: maxOutputTokens,
        }),
      })
      if ('skipped' in billed) throw new Error('Insufficient balance for conversation compaction')
      onBilledCost(billed.costMicros)
      return billed.result.output_text
    },
    onUpdate: onCompactionUpdate,
  })
  if (!compacted.item && existingItem) {
    const updatedAt = new Date()
    await db.update(responses).set({ output: recallItem ? [recallItem] : [], updatedAt }).where(eq(responses.id, record.response.id))
    const [updated] = await db.select().from(responses).where(eq(responses.id, record.response.id)).limit(1)
    if (updated) await publishSnapshot(toSnapshot(updated))
  }
  return { input: [...context, ...compacted.conversation, ...(record.response.input as unknown[])], compactionItems: compacted.item ? [compacted.item] : [] }
}

function codexAssistantText(output: unknown): string {
  if (!Array.isArray(output)) return ''
  return output.flatMap((item) => {
    const content = (item as { content?: unknown[] }).content
    return Array.isArray(content) ? content.flatMap((part) => {
      const value = part as { type?: string; text?: string }
      return value.type === 'output_text' && value.text ? [value.text] : []
    }) : []
  }).join('\n')
}

function codexUsage(message: AssistantMessage): ResponseUsage {
  return {
    inputTokens: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite,
    cachedInputTokens: message.usage.cacheRead,
    cacheWriteTokens: message.usage.cacheWrite,
    outputTokens: message.usage.output,
    reasoningTokens: message.usage.reasoning ?? 0,
    totalTokens: message.usage.totalTokens,
  }
}

async function codexCurrentUserMessage(response: typeof responses.$inferSelect): Promise<Message> {
  const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = []
  const text = responseInputText(response.input)
  if (text) content.push({ type: 'text', text })
  const attachmentIds = responseAttachmentIds(response.input)
  if (attachmentIds.length) {
    const rows = await db.select().from(attachments).where(and(
      eq(attachments.userId, response.userId), inArray(attachments.id, attachmentIds), eq(attachments.status, 'ready'),
    ))
    for (const attachment of rows) {
      if (!attachment.mimeType.startsWith('image/')) continue
      const rendition = await modelImageRendition(await getBlobStore().get(attachment.objectKey), attachment.mimeType, attachment.checksum)
      content.push({ type: 'image', data: rendition.data.toString('base64'), mimeType: rendition.mimeType })
    }
  }
  return { role: 'user', content: content.length === 1 && content[0]?.type === 'text' ? content[0].text : content, timestamp: response.createdAt.getTime() }
}

async function processCodexGenerationAttempt(
  record: { response: typeof responses.$inferSelect; model: typeof models.$inferSelect; provider: typeof providerConnections.$inferSelect },
  startedAt: number,
): Promise<void> {
  const responseId = record.response.id
  const allHistory = await db.select().from(responses).where(and(
    eq(responses.chatId, record.response.chatId), ne(responses.id, responseId), isNull(responses.deletedAt),
  )).orderBy(asc(responses.createdAt), asc(responses.id))
  const byId = new Map(allHistory.map((turn) => [turn.id, turn]))
  const lineage: typeof allHistory = []
  let parentId = record.response.parentResponseId
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    lineage.unshift(parent)
    parentId = parent.parentResponseId
  }
  const checkpoint = lineage.findLast((turn) => (turn.output as unknown[]).some((raw) => {
    const item = raw as Partial<CompactionItem>
    return item.type === 'pulpo_compaction' && item.phase === 'pre_response' && item.status === 'completed'
  }))
  const checkpointOutput = Array.isArray(checkpoint?.output) ? checkpoint.output : []
  const checkpointItem = checkpointOutput.find((raw: unknown) => {
    const item = raw as Partial<CompactionItem>
    return item.type === 'pulpo_compaction' && item.phase === 'pre_response' && item.status === 'completed'
  }) as CompactionItem | undefined
  const coveredIndex = checkpointItem?.covered_through_response_id
    ? lineage.findIndex((turn) => turn.id === checkpointItem.covered_through_response_id)
    : -1
  const effectiveLineage = coveredIndex >= 0 ? lineage.slice(coveredIndex + 1) : lineage
  const reusableCheckpoint = coveredIndex >= 0 ? checkpointItem : undefined
  const priorSummaryMessage: Message | undefined = reusableCheckpoint?.summary
    ? { role: 'user', content: `Earlier conversation summary:\n${reusableCheckpoint.summary}`, timestamp: checkpoint?.createdAt.getTime() ?? Date.now() }
    : undefined
  const exchanges: Array<CodexConversationExchange<Message>> = []
  for (const turn of effectiveLineage) {
    const exchange: Message[] = []
    const userText = responseInputText(turn.input)
    if (userText) exchange.push({ role: 'user', content: userText, timestamp: turn.createdAt.getTime() })
    const assistantText = codexAssistantText(turn.output)
    if (assistantText) exchange.push({
      role: 'assistant', content: [{ type: 'text', text: assistantText }], api: 'openai-codex-responses',
      provider: 'openai-codex', model: turn.actualModelId ?? turn.modelId,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: turn.completedAt?.getTime() ?? turn.updatedAt.getTime(),
    })
    if (exchange.length) exchanges.push({ responseId: turn.id, messages: exchange })
  }
  const currentMessage = await codexCurrentUserMessage(record.response)
  const messages = [...(priorSummaryMessage ? [priorSummaryMessage] : []), ...exchanges.flatMap((exchange) => exchange.messages), currentMessage]
  const context: Context = { systemPrompt: record.model.systemPrompt.trim() || undefined, messages }
  const codex = createCodexModels(record.response.userId)
  const piModel = codex.getModel('openai-codex', record.model.upstreamModelId)
  if (!piModel) throw new Error('The pinned Pi Codex catalog no longer contains this model')
  const contextItems: unknown[] = []
  const estimatedTokens = estimateInputTokens(context)
  if (shouldCompactContext({
    enabled: record.model.compactionEnabled,
    estimatedTokens,
    thresholdTokens: record.model.compactionThresholdTokens,
    unitCount: exchanges.length,
    retainedUnits: record.model.compactionRetainedTurns,
  })) {
    const split = splitCodexConversationExchanges(exchanges, record.model.compactionRetainedTurns)
    const older = [...(priorSummaryMessage ? [priorSummaryMessage] : []), ...split.older]
    const retained = split.retained
    const [requestLog] = await db.select({ id: requestLogs.id }).from(requestLogs).where(eq(requestLogs.responseId, responseId)).limit(1)
    if (requestLog && older.length) {
      const prompt = `${COMPACTION_PROMPT}\n\n${JSON.stringify(older)}`
      const maxOutputTokens = Math.min(2_000, record.model.maxOutputTokens)
      const billed = await trackBilledInternalModelCall({
        responseId, requestLogId: requestLog.id, modelId: record.model.id, upstreamModelId: record.model.upstreamModelId,
        purpose: 'compaction', requestInput: prompt, maxOutputTokens, required: true,
        invoke: async () => {
          const result = await codex.completeSimple(piModel, { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] }, {
            reasoning: 'low', maxTokens: maxOutputTokens, maxRetries: 0, transport: 'auto',
            sessionId: `pulpo:${record.response.userId}:${record.response.chatId}:compaction`,
          })
          return {
            id: result.responseId,
            usage: codexUsage(result),
            output_text: result.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n'),
          }
        },
      })
      if (!('skipped' in billed)) {
        context.messages = [
          { role: 'user', content: `Earlier conversation summary:\n${billed.result.output_text}`, timestamp: Date.now() },
          ...retained,
          currentMessage,
        ]
        contextItems.push({
          id: `compaction_${responseId}`, type: 'pulpo_compaction', phase: 'pre_response', status: 'completed',
          model_id: record.model.id, estimated_tokens: estimatedTokens, threshold_tokens: record.model.compactionThresholdTokens,
          retained_turns: retainedEntries(retained),
          retained_context: sanitizeContextForStorage(retained),
          retained_context_turns: sanitizeContextForStorage(split.retainedExchanges) as unknown[][],
          covered_through_response_id: split.coveredThroughResponseId ?? reusableCheckpoint?.covered_through_response_id,
          summary: billed.result.output_text, started_at: new Date().toISOString(), duration_ms: 0,
        })
      }
    }
  }
  const controller = new AbortController()
  const cancellationPoll = setInterval(() => {
    void isCancellationRequested(responseId).then((cancelled) => { if (cancelled) controller.abort() }).catch(() => undefined)
  }, 500)
  cancellationPoll.unref()
  const messageId = `msg_${responseId}`
  let text = ''
  let reasoning = ''
  let sequence = record.response.lastSequence
  let lastSnapshot = 0
  const output = () => [
    ...contextItems,
    ...(reasoning ? [{ id: `reasoning_${responseId}`, type: 'reasoning', summary: [{ type: 'summary_text', text: reasoning }] }] : []),
    { id: messageId, type: 'message', role: 'assistant', status: 'in_progress', content: [{ type: 'output_text', text, annotations: [] }] },
  ]
  await db.update(responses).set({ status: 'in_progress', startedAt: record.response.startedAt ?? new Date(), output: output(), updatedAt: new Date() })
    .where(eq(responses.id, responseId))
  try {
    const stream = codex.streamSimple(piModel, context, {
      reasoning: agentThinkingLevel(record.response.parameters as Record<string, unknown>) as ThinkingLevel,
      maxTokens: record.model.maxOutputTokens,
      maxRetries: 0,
      timeoutMs: record.provider.requestTimeoutMs,
      transport: 'auto',
      sessionId: `pulpo:${record.response.userId}:${record.response.chatId}`,
      signal: controller.signal,
    })
    let finalMessage: AssistantMessage | undefined
    for await (const event of stream) {
      if (event.type === 'text_delta') {
        text += event.delta
        sequence += 1
        await publishResponseEvent({ responseId, sequence, type: 'response.output_text.delta', payload: {
          type: 'response.output_text.delta', item_id: messageId, output_index: reasoning ? 1 : 0, content_index: 0, delta: event.delta,
        }, emittedAt: new Date().toISOString() })
      } else if (event.type === 'thinking_delta') {
        reasoning += event.delta
        sequence += 1
        await publishResponseEvent({ responseId, sequence, type: 'response.reasoning_summary_text.delta', payload: {
          type: 'response.reasoning_summary_text.delta', item_id: `reasoning_${responseId}`, output_index: 0, summary_index: 0, delta: event.delta,
        }, emittedAt: new Date().toISOString() })
      } else if (event.type === 'done') finalMessage = event.message
      else if (event.type === 'error') throw new Error(event.error.errorMessage ?? 'Codex generation failed')
      if (Date.now() - lastSnapshot > 250) {
        await db.update(responses).set({ output: output(), lastSequence: sequence, updatedAt: new Date() }).where(eq(responses.id, responseId))
        const [snapshot] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
        if (snapshot) await publishSnapshot(toSnapshot(snapshot))
        lastSnapshot = Date.now()
      }
    }
    if (!finalMessage) finalMessage = await stream.result()
    const usage = codexUsage(finalMessage)
    const terminalOutput = output().map((item) => {
      const value = item as Record<string, unknown>
      return value.type === 'message' ? { ...value, status: 'completed' } : item
    })
    await persistItems(responseId, terminalOutput)
    const completedAt = new Date()
    await db.update(responses).set({
      status: finalMessage.stopReason === 'length' ? 'incomplete' : 'completed', output: terminalOutput, usage,
      incompleteDetails: finalMessage.stopReason === 'length' ? { reason: 'max_output_tokens' } : null,
      lastSequence: sequence, openaiResponseId: finalMessage.responseId ?? null, completedAt, updatedAt: completedAt,
    }).where(eq(responses.id, responseId))
    const [requestLog] = await db.select({ id: requestLogs.id }).from(requestLogs).where(eq(requestLogs.responseId, responseId)).limit(1)
    let additionalCostMicros = 0
    if (requestLog) {
      try {
        additionalCostMicros = await runPostResponseTasks(record, record, terminalOutput, requestLog.id)
      } catch (error) {
        if (codexErrorRequiresReauthentication(error)) {
          await markCodexReauthenticationRequired(record.response.userId, 'Your Codex connection needs to be renewed.')
        }
      }
    }
    await settleWithSidecars({
      responseId,
      usage,
      latencyMs: Date.now() - startedAt,
      providerCostMicros: 0,
      additionalCostMicros,
      inferenceReferenceCostMicros: codexInferenceReferenceCostMicros(piModel, usage),
    })
    const [snapshot] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (snapshot) await publishSnapshot(toSnapshot(snapshot))
  } catch (error) {
    if (controller.signal.aborted || await isCancellationRequested(responseId)) {
      const completedAt = new Date()
      await db.update(responses).set({ status: 'cancelled', output: output(), lastSequence: sequence, completedAt, updatedAt: completedAt })
        .where(eq(responses.id, responseId))
      await releaseBudget(responseId)
      const [snapshot] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
      if (snapshot) await publishSnapshot(toSnapshot(snapshot))
      return
    }
    if (codexErrorRequiresReauthentication(error)) {
      await markCodexReauthenticationRequired(record.response.userId, 'Your Codex connection needs to be renewed.')
    }
    throw redactedCodexError(error)
  } finally {
    clearInterval(cancellationPoll)
  }
}

async function processGenerationAttempt(
  responseId: string,
  modelId: string,
  options: { willRetry?: boolean } = {},
): Promise<void> {
  const startedAt = Date.now()
  const [record] = await db
    .select({ response: responses, model: models, provider: providerConnections })
    .from(responses)
    .innerJoin(models, eq(models.id, modelId))
    .innerJoin(providerConnections, eq(models.providerConnectionId, providerConnections.id))
    .where(eq(responses.id, responseId))
    .limit(1)
  if (!record || ['completed', 'cancelled'].includes(record.response.status)) return
  if (record.provider.id === CODEX_PROVIDER_ID) {
    await processCodexGenerationAttempt(record, startedAt)
    return
  }
  const config = getConfig()
  const client = new OpenAI({
    apiKey: decryptSecret(record.provider.encryptedApiKey, config.ENCRYPTION_KEY),
    baseURL: record.provider.baseUrl,
    organization: record.provider.organizationId ?? undefined,
    project: record.provider.projectId ?? undefined,
    timeout: record.provider.requestTimeoutMs,
  })
  if (record.response.executionMode === 'background' && record.response.openaiResponseId) {
    const openaiResponseId = record.response.openaiResponseId
    const contextItems = (record.response.output as unknown[]).filter((item) => (
      ['pulpo_recall', 'pulpo_compaction'].includes((item as { type?: string }).type ?? '')
    ))
    const recoveryInclude = responseIncludeParameter(record.response.parameters)
    await db.update(responses).set({ status: 'in_progress', error: null, completedAt: null, updatedAt: new Date() }).where(eq(responses.id, responseId))
    try {
      try {
        const resumed = await client.responses.retrieve(openaiResponseId, {
          stream: true,
          starting_after: record.response.upstreamSequence,
          ...recoveryInclude as { include?: never },
        })
        let localSequence = record.response.lastSequence
        let recoveredOutput = record.response.output as unknown[]
        let recoveredUsage = record.response.usage
        for await (const rawEvent of resumed) {
          const upstream = rawEvent as unknown as UpstreamEvent
          localSequence += 1
          const event: ResponseEvent = { responseId, sequence: localSequence, type: upstream.type, payload: upstream, emittedAt: new Date().toISOString() }
          await publishResponseEvent(event)
          const upstreamResponse = upstream.response as { output?: unknown[]; usage?: unknown } | undefined
          recoveredOutput = upstreamResponse?.output ? [...contextItems, ...upstreamResponse.output] : accumulateEventOutput(recoveredOutput, event)
          recoveredUsage = upstreamResponse?.usage ? normalizeUsage(upstreamResponse.usage) : recoveredUsage
          await db.update(responses).set({
            output: recoveredOutput,
            usage: recoveredUsage,
            lastSequence: localSequence,
            upstreamSequence: Number(upstream.sequence_number ?? record.response.upstreamSequence),
            updatedAt: new Date(),
          }).where(eq(responses.id, responseId))
        }
      } catch {
        // Retrieval polling below is the authoritative fallback when stream resumption is unavailable.
      }
      for (let attempt = 0; attempt < 1_800; attempt += 1) {
        if (await isCancellationRequested(responseId)) {
          await client.responses.cancel(openaiResponseId).catch(() => undefined)
          await db.update(responses).set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, responseId))
          await releaseBudget(responseId)
          return
        }
        const recovered = await client.responses.retrieve(openaiResponseId, recoveryInclude as { include?: never })
        if (recovered.status && ['queued', 'in_progress'].includes(recovered.status)) {
          await new Promise((resolve) => setTimeout(resolve, 2_000))
          continue
        }
        const output = [...contextItems, ...(recovered.output as unknown[])]
        const usage = normalizeUsage(recovered.usage)
        const providerCostMicros = record.model.useProviderCost ? providerReportedCostMicros(recovered.usage) : undefined
        let status: typeof responses.$inferSelect.status = recovered.status === 'completed' ? 'completed'
          : recovered.status === 'cancelled' ? 'cancelled'
            : recovered.status === 'incomplete' ? 'incomplete' : 'failed'
        const outputError = status === 'completed' && record.response.origin === 'web'
          ? browserChatOutputError(output)
          : undefined
        if (outputError) status = 'failed'
        await persistItems(responseId, output)
        const completedAt = new Date()
        await db.update(responses).set({
          status,
          output,
          usage,
          incompleteDetails: recovered.incomplete_details ?? null,
          completedAt,
          updatedAt: completedAt,
          error: outputError
            ? { message: outputError }
            : recovered.error ? { message: recovered.error.message, code: recovered.error.code } : null,
        }).where(eq(responses.id, responseId))
        let additionalCostMicros = 0
        if (status === 'completed') {
          const [requestLog] = await db.select({ id: requestLogs.id }).from(requestLogs).where(eq(requestLogs.responseId, responseId)).limit(1)
          if (requestLog) additionalCostMicros = await runPostResponseTasks(record, record, output, requestLog.id).catch(() => 0)
        }
        if (usage.totalTokens > 0 || additionalCostMicros > 0) {
          await settleWithSidecars({ responseId, usage, latencyMs: Date.now() - startedAt, providerCostMicros, additionalCostMicros })
        } else await releaseBudget(responseId)
        const [snapshot] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
        if (snapshot) await publishSnapshot(toSnapshot(snapshot))
        return
      }
      throw new Error('Background response recovery timed out')
    } catch (error) {
      if (options.willRetry) throw new GenerationAttemptError(error instanceof Error ? error.message : 'Recovery failed', false, error)
      await db.update(responses).set({
        status: 'failed', error: { message: error instanceof Error ? error.message : 'Recovery failed' },
        completedAt: new Date(), updatedAt: new Date(),
      }).where(eq(responses.id, responseId))
      await releaseBudget(responseId)
      throw error
    }
  }
  const allHistory = await db
    .select()
    .from(responses)
    .where(and(eq(responses.chatId, record.response.chatId), ne(responses.id, responseId), isNull(responses.deletedAt)))
    .orderBy(asc(responses.createdAt), asc(responses.id))
  const byId = new Map(allHistory.map((turn) => [turn.id, turn]))
  const history: typeof allHistory = []
  let parentId = record.response.parentResponseId
  const seenParents = new Set<string>()
  while (parentId && !seenParents.has(parentId)) {
    seenParents.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    history.unshift(parent)
    parentId = parent.parentResponseId
  }
  const [requestLog] = await db.select({
    id: requestLogs.id,
    apiKeyId: requestLogs.apiKeyId,
    captureDetailedPayloads: requestLogs.captureDetailedPayloads,
    payloadExpiresAt: requestLogs.payloadExpiresAt,
  }).from(requestLogs).where(eq(requestLogs.responseId, responseId)).limit(1)
  if (!requestLog) throw new Error('Request log is missing')
  const [chatState] = await db.select({ temporary: chats.temporary }).from(chats)
    .where(eq(chats.id, record.response.chatId)).limit(1)
  let sidecarCostMicros = 0
  const imageInterceptor = await createModelImageInterceptor(requestLog.id, {
    allowCache: !chatState?.temporary,
    responseId,
    onBilledCost: (costMicros) => { sidecarCostMicros += costMicros },
  })
  let sequence = record.response.lastSequence
  const publicApi = Boolean(requestLog.apiKeyId)
  const existingRecallItem = publicApi ? null : recallItemFromOutput(record.response.output, responseId)
  const recallItem = publicApi ? null : existingRecallItem ?? await retrieveAutomaticRecall({
    responseId,
    userId: record.response.userId,
    currentChatId: record.response.chatId,
    query: responseInputText(record.response.input),
  })
  const recallItems = recallItem ? [recallItem] : []
  if (recallItem && !existingRecallItem) {
    sequence += 1
    const emittedAt = new Date().toISOString()
    await publishResponseEvent({ responseId, sequence, type: 'pulpo.recall.completed', payload: recallItem, emittedAt })
    await db.update(responses).set({
      status: 'in_progress',
      output: recallItems,
      lastSequence: sequence,
      startedAt: record.response.startedAt ?? new Date(emittedAt),
      updatedAt: new Date(emittedAt),
    }).where(eq(responses.id, responseId))
  }
  const contextual = await contextualInput(client, record, history, requestLog.id, recallItem, publicApi, async (item) => {
    sequence += 1
    const emittedAt = new Date().toISOString()
    const publicItem = sanitizeOutputForClient([item])[0]
    await publishResponseEvent({ responseId, sequence, type: 'pulpo.compaction.updated', payload: publicItem, emittedAt })
    const updatedAt = new Date(emittedAt)
    await db.update(responses).set({
      status: 'in_progress',
      output: [...recallItems, item],
      lastSequence: sequence,
      startedAt: record.response.startedAt ?? updatedAt,
      updatedAt,
    }).where(eq(responses.id, responseId))
    const [updated] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (updated) await publishSnapshot(toSnapshot(updated))
  }, (costMicros) => { sidecarCostMicros += costMicros })
  const input = await prepareInputFiles(client, record.response.userId, contextual.input, record.model, imageInterceptor)
  const contextItems: unknown[] = [...recallItems, ...contextual.compactionItems]
  let output: unknown[] = [...contextItems]
  let outputStarted = generationOutputHasStarted(output)
  let usage: ResponseUsage | null = null
  let providerCostMicros: number | undefined
  let upstreamResponseId = record.response.openaiResponseId
  let terminalStatus: typeof responses.$inferSelect.status = 'completed'
  let incompleteDetails: { reason?: string } | null = null
  let terminalError: { message: string; code?: string } | null = null
  let lastSnapshotAt = 0
  let lastTelemetryAt = 0
  let pendingEventCount = 0
  const flushTelemetry = async (force = false) => {
    if (pendingEventCount === 0 || (!force && Date.now() - lastTelemetryAt < 500)) return
    const eventCount = pendingEventCount
    await db.update(requestLogs).set({
      eventCount: sql`${requestLogs.eventCount} + ${eventCount}`,
      inputTokens: usage?.inputTokens,
      cachedInputTokens: usage?.cachedInputTokens,
      cacheWriteTokens: usage?.cacheWriteTokens,
      outputTokens: usage?.outputTokens,
      updatedAt: new Date(),
    }).where(eq(requestLogs.id, requestLog.id))
    pendingEventCount -= eventCount
    lastTelemetryAt = Date.now()
    await publishAdminUsage(requestLog.id)
  }
  const controller = new AbortController()
  const firstToken = firstTokenTimeout(controller, record.model.firstTokenTimeoutEnabled ? record.model.firstTokenTimeoutSeconds * 1000 : undefined)
  try {
    await db.update(responses).set({ status: 'in_progress', error: null, completedAt: null, startedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, responseId))
    const parameters = resolveModelParameters(record.model, record.response.parameters, {
      publicApi: Boolean(requestLog.apiKeyId),
    })
    const cacheOptions = providerCacheRequestOptions(record.provider, {
      userId: record.response.userId,
      chatId: record.response.chatId,
      runId: record.response.id,
    })
    const upstreamPayload = {
      ...(parameters as Record<string, never>),
      ...promptCacheKeyParameter(requestLog.apiKeyId ? parameters : {}, cacheOptions.promptCacheKey),
      model: record.model.upstreamModelId,
      input: input as never,
      stream: true as const,
      ...backgroundRequestParameter(record.response.executionMode),
      store: false as const,
    }
    if (detailedPayloadCaptureIsActive(requestLog)) {
      await db.update(requestLogs).set({ requestPayload: upstreamPayload, updatedAt: new Date() })
        .where(activeDetailedPayloadCondition(requestLog.id))
    }
    const stream = await client.responses.create(upstreamPayload, {
      signal: controller.signal,
      headers: cacheOptions.headers,
    })
    for await (const rawEvent of stream) {
      if (await isCancellationRequested(responseId)) {
        if (record.response.executionMode === 'background' && upstreamResponseId) {
          await client.responses.cancel(upstreamResponseId).catch(() => undefined)
        }
        controller.abort()
        throw new Error('Generation cancelled')
      }
      const upstream = rawEvent as unknown as UpstreamEvent
      sequence += 1
      const event: ResponseEvent = {
        responseId,
        sequence,
        type: upstream.type,
        payload: upstream,
        emittedAt: new Date().toISOString(),
      }
      const upstreamResponse = upstream.response as {
        id?: string
        output?: unknown[]
        usage?: unknown
        status?: string
        incomplete_details?: { reason?: string } | null
        error?: { message?: string; code?: string } | null
      } | undefined
      if (upstreamResponse?.id) {
        upstreamResponseId = upstreamResponse.id
        await db.update(responses).set({ openaiResponseId: upstreamResponse.id }).where(eq(responses.id, responseId))
      }
      output = upstreamResponse?.output ? [...contextItems, ...upstreamResponse.output] : accumulateEventOutput(output, event)
      outputStarted ||= firstToken.observe(upstream.type, upstream, output)
      if (upstreamResponse?.usage) {
        usage = normalizeUsage(upstreamResponse.usage)
        if (record.model.useProviderCost) providerCostMicros = providerReportedCostMicros(upstreamResponse.usage)
      }
      if (upstreamResponse?.status === 'incomplete') {
        terminalStatus = 'incomplete'
        incompleteDetails = upstreamResponse.incomplete_details ?? null
      } else if (upstreamResponse?.status === 'failed' || upstreamResponse?.status === 'cancelled') {
        terminalStatus = upstreamResponse.status
        terminalError = upstreamResponse.error?.message
          ? { message: upstreamResponse.error.message, ...(upstreamResponse.error.code ? { code: upstreamResponse.error.code } : {}) }
          : null
      } else if (upstreamResponse?.status === 'completed') {
        terminalStatus = 'completed'
      }
      await publishResponseEvent(event)
      pendingEventCount += 1
      const snapshotDue = Date.now() - lastSnapshotAt >= config.RESPONSE_SNAPSHOT_INTERVAL_MS
      const itemBoundary = upstream.type.endsWith('.done') || upstream.type === 'response.completed'
      await flushTelemetry(snapshotDue || itemBoundary)
      if (snapshotDue || itemBoundary) {
        lastSnapshotAt = Date.now()
        await db.update(responses).set({
          output,
          usage,
          lastSequence: sequence,
          upstreamSequence: Number(upstream.sequence_number ?? record.response.upstreamSequence),
          updatedAt: new Date(),
        }).where(eq(responses.id, responseId))
        const [updated] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
        if (updated) await publishSnapshot(toSnapshot(updated))
      }
    }
    firstToken.clear()
    firstToken.throwIfTimedOut()
    await flushTelemetry(true)
    if (terminalStatus === 'failed' || terminalStatus === 'cancelled') {
      throw new Error(terminalError?.message ?? `Generation ${terminalStatus}`)
    }
    if (record.response.origin === 'web') {
      const outputError = browserChatOutputError(output)
      if (outputError) throw new Error(outputError)
    }
    await persistItems(responseId, output)
    const completedAt = new Date()
    await db.update(responses).set({
      status: terminalStatus,
      output,
      usage,
      error: null,
      incompleteDetails,
      lastSequence: sequence,
      completedAt,
      updatedAt: completedAt,
    }).where(eq(responses.id, responseId))
    const postTaskCostMicros = terminalStatus === 'completed' ? await runPostResponseTasks(record, record, output, requestLog.id).catch((error) => {
      console.warn(JSON.stringify({ level: 'warn', service: 'pulpo-worker', event: 'post_response_tasks.failed', responseId, error: error instanceof Error ? error.message : String(error) }))
      return 0
    }) : 0
    await settleWithSidecars({
      responseId,
      usage,
      latencyMs: Date.now() - startedAt,
      providerCostMicros,
      additionalCostMicros: sidecarCostMicros + postTaskCostMicros,
    })
    await db.update(chats).set({ updatedAt: completedAt }).where(eq(chats.id, record.response.chatId))
    const [completed] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (completed) await publishSnapshot(toSnapshot(completed))
  } catch (caughtError) {
    firstToken.clear()
    const error = firstToken.error ?? caughtError
    await flushTelemetry(true).catch(() => undefined)
    const cancelled = await isCancellationRequested(responseId)
    const completedAt = new Date()
    await db.update(responses).set({
      status: cancelled ? 'cancelled' : options.willRetry ? 'queued' : 'failed',
      error: { message: error instanceof Error ? error.message : 'Generation failed' },
      lastSequence: sequence,
      completedAt: cancelled || !options.willRetry ? completedAt : null,
      updatedAt: completedAt,
    }).where(eq(responses.id, responseId))
    if (cancelled || !options.willRetry) {
      await settleWithSidecars({
        responseId,
        usage,
        latencyMs: Date.now() - startedAt,
        providerCostMicros,
        additionalCostMicros: sidecarCostMicros,
      })
      const [terminal] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
      if (terminal) await publishSnapshot(toSnapshot(terminal))
    }
    if (!cancelled) throw new GenerationAttemptError(error instanceof Error ? error.message : 'Generation failed', outputStarted, error)
  }
}

export async function processGeneration(responseId: string): Promise<void> {
  const [base] = await db.select({
    response: responses,
    model: models,
    log: requestLogs,
    chatDeletedAt: chats.deletedAt,
    chatTemporary: chats.temporary,
    chatExpiresAt: chats.expiresAt,
  })
    .from(responses)
    .innerJoin(chats, eq(chats.id, responses.chatId))
    .innerJoin(models, eq(responses.modelId, models.id))
    .innerJoin(requestLogs, eq(requestLogs.responseId, responses.id))
    .where(eq(responses.id, responseId)).limit(1)
  if (!base || ['completed', 'cancelled'].includes(base.response.status)) return
  const chatRetention = { temporary: base.chatTemporary, expiresAt: base.chatExpiresAt }
  if (base.chatDeletedAt || temporaryChatIsExpired(chatRetention) || normalChatIsExpired(chatRetention)) {
    const now = new Date()
    await db.update(responses).set({ status: 'cancelled', completedAt: now, updatedAt: now }).where(eq(responses.id, responseId))
    await releaseBudget(responseId)
    return
  }
  if (base.response.agentMode) {
    await processAgentGeneration(responseId)
    return
  }
  const detailedPayloadsEnabled = detailedPayloadCaptureIsActive(base.log)
  let model: typeof models.$inferSelect | undefined = base.model
  let fallbackFrom: string | null = null
  let attemptLimit = primaryModelAttemptLimit(base.model)
  let retryDelaySeconds = base.model.retryDelaySeconds
  let lastError: unknown
  const visited = new Set<string>()

  while (model && visited.size < MAX_MODEL_CHAIN_LENGTH && !visited.has(model.id)) {
    visited.add(model.id)
    if (await isModelSticky(redis, model.id) && model.fallbackModelId) {
      const source = model
      fallbackFrom = model.id
      ;[model] = await db.select().from(models).where(and(eq(models.id, model.fallbackModelId), eq(models.enabled, true))).limit(1)
      attemptLimit = fallbackModelAttemptLimit(source)
      retryDelaySeconds = source.retryDelaySeconds
      await db.update(requestLogs).set({ stickyFallbackUsed: true, fallbackUsed: true, currentModelId: model?.id ?? null, updatedAt: new Date() }).where(eq(requestLogs.id, base.log.id))
      await publishAdminUsage(base.log.id, true)
      continue
    }
    for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
      const attemptId = newId()
      const attemptStarted = Date.now()
      await db.insert(generationAttempts).values({ id: attemptId, requestLogId: base.log.id, modelId: model.id, upstreamModelId: model.upstreamModelId, source: base.log.origin, purpose: 'generation', retryAttempt: attempt + 1, fallbackFromModelId: fallbackFrom })
      await db.update(requestLogs).set({ status: 'in_progress', startedAt: base.log.startedAt ?? new Date(), currentModelId: model.id, currentRetryAttempt: attempt + 1, currentTurnNumber: null, retryCount: sql`${requestLogs.retryCount} + ${attempt > 0 ? 1 : 0}`, fallbackUsed: fallbackFrom !== null, updatedAt: new Date() }).where(eq(requestLogs.id, base.log.id))
      await publishAdminUsage(base.log.id, true)
      try {
        const actualPricing = await getActivePricing(model.id)
        await db.update(responses).set({ pricingVersionId: actualPricing.id, actualModelId: model.id }).where(eq(responses.id, responseId))
        await processGenerationAttempt(responseId, model.id, { willRetry: true })
        const [completed] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
        const usage = completed?.usage as ResponseUsage | null
        const durationMs = Date.now() - (base.log.startedAt ?? base.log.createdAt).getTime()
        const [costRow] = await db.execute<{ cost: string }>(sql`select coalesce(sum(cost_micros), 0)::text as cost from usage_events where response_id = ${responseId}`)
        await db.transaction(async (tx) => {
          await tx.update(generationAttempts).set({
            status: 'completed', durationMs: Date.now() - attemptStarted, upstreamResponseId: completed?.openaiResponseId,
            inputTokens: usage?.inputTokens ?? 0, cachedInputTokens: usage?.cachedInputTokens ?? 0, cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0, reasoningTokens: usage?.reasoningTokens ?? 0,
            costMicros: Number(costRow?.cost ?? 0), completedAt: new Date(),
          }).where(eq(generationAttempts.id, attemptId))
          await tx.update(responses).set({ actualModelId: model!.id }).where(eq(responses.id, responseId))
          await tx.update(requestLogs).set({
            status: completed?.status ?? 'completed', actualModelId: model!.id, currentModelId: model!.id,
            inputTokens: usage?.inputTokens ?? 0, cachedInputTokens: usage?.cachedInputTokens ?? 0, cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0, reasoningTokens: usage?.reasoningTokens ?? 0,
            costMicros: Number(costRow?.cost ?? 0), durationMs,
            tokensPerSecond: durationMs > 0 ? completionTokensPerSecond(durationMs, usage?.outputTokens ?? 0) : null,
            completedAt: new Date(), updatedAt: new Date(),
          }).where(eq(requestLogs.id, base.log.id))
        })
        if (detailedPayloadsEnabled) {
          await db.update(requestLogs).set({ responsePayload: { output: completed?.output ?? [], usage }, updatedAt: new Date() })
            .where(activeDetailedPayloadCondition(base.log.id))
        }
        if (isSlowCompletion(model, durationMs, usage?.outputTokens ?? 0)) await markModelSticky(redis, model, 'slow_completion')
        await publishAdminUsage(base.log.id, true)
        return
      } catch (error) {
        lastError = error
        const category = classifyGenerationError(error)
        await db.update(generationAttempts).set({ status: 'failed', errorCategory: category, errorMessage: error instanceof Error ? error.message : String(error), durationMs: Date.now() - attemptStarted, completedAt: new Date() }).where(eq(generationAttempts.id, attemptId))
        if (!canFallbackAfterGenerationError(error)) { model = undefined; break }
        if (attempt + 1 < attemptLimit && retryDelaySeconds > 0) await new Promise((resolve) => setTimeout(resolve, retryDelaySeconds * 1000))
      }
    }
    if (!model) break
    await markModelSticky(redis, model, classifyGenerationError(lastError))
    const source = model
    fallbackFrom = model.id
    if (!model.fallbackModelId) { model = undefined; break }
    ;[model] = await db.select().from(models).where(and(eq(models.id, model.fallbackModelId), eq(models.enabled, true))).limit(1)
    attemptLimit = fallbackModelAttemptLimit(source)
    retryDelaySeconds = source.retryDelaySeconds
    await db.update(requestLogs).set({ fallbackUsed: true, currentModelId: model?.id ?? null, updatedAt: new Date() }).where(eq(requestLogs.id, base.log.id))
    await publishAdminUsage(base.log.id, true)
  }

  const message = lastError instanceof Error ? lastError.message : 'Generation failed'
  const category = classifyGenerationError(lastError)
  const completedAt = new Date()
  await db.transaction(async (tx) => {
    await tx.update(responses).set({ status: 'failed', error: { message, category }, completedAt, updatedAt: completedAt }).where(eq(responses.id, responseId))
    await tx.update(requestLogs).set({ status: 'failed', errorCategory: category, errorMessage: message, durationMs: Date.now() - (base.log.startedAt ?? base.log.createdAt).getTime(), completedAt, updatedAt: completedAt }).where(eq(requestLogs.id, base.log.id))
  })
  await releaseBudget(responseId)
  const [terminal] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
  if (terminal) await publishSnapshot(toSnapshot(terminal))
  await publishAdminUsage(base.log.id, true)
}
