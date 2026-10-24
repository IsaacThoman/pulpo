import { diagnosticFetch } from '../logging/diagnostic-fetch.js'
import { diagnosticContext, withDiagnosticContext, recordReconstructedDiagnostic } from '../logging/provider-diagnostics.js'
import { safeErrorMessage } from '../database/errors.js'
import { toFile } from 'openai'
import { isContextOverflow, type AssistantMessage, type Context, type Message, type ThinkingLevel } from '@earendil-works/pi-ai'
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
import { createUpstreamTextClient, type UpstreamTextClient } from '../upstream/client.js'
import { getConfig } from '../config.js'
import { newId } from '../lib/ids.js'
import { isCancellationRequested, createResponseEventPublisher, publishSnapshot } from './events.js'
import { getActivePricing, releaseBudget, resizeBudgetReservation, retainBudgetReservation, settleBudget } from '../accounting/service.js'
import { toSnapshot } from './service.js'
import { getBlobStore } from '../storage/index.js'
import { publishAdminUsage } from '../admin/usage-events.js'
import { redis } from '../redis.js'
import { parsePersonalizationSettings } from '../settings/application-settings.js'
import { composeCustomInstructions } from '../settings/instruction-presets.js'
import { processAgentGeneration } from '../agent/runner.js'
import { runPostResponseTasks, type PostResponseTaskResult } from './post-tasks.js'
import { EMPTY_USAGE, providerReportedCostMicros, trackBilledInternalModelCall } from './model-calls.js'
import { providerCacheRequestOptions, providerPromptCacheParameters } from './provider-cache.js'
import { createModelImageInterceptor, interceptOpenAIInputImages, type ModelImageInterceptor } from './image-ocr.js'
import { modelImageRendition, type ProviderImageOptions } from './model-image.js'
import { sanitizeOutputForClient } from './public-output.js'
import {
  canRetryOverflowWithCompaction,
  codexConversation,
  compactCodexConversation,
  compactResponsesConversation,
  preResponseCompactionItem,
  responsesConversation,
  summaryRequestParameters,
} from './compaction.js'
import { piUserTextMessage } from '../compaction/pi-history.js'
import { summaryMaxOutputTokens } from '../compaction/policy.js'
import { SUMMARIZATION_PROMPT } from '../compaction/prompt.js'
import { responsesUserTextItem } from '../compaction/responses-history.js'
import { CompactionError, CompactionOverflowError } from '../compaction/summarize.js'
import { temporaryChatIsExpired } from '../chats/temporary.js'
import { normalChatIsExpired } from '../chats/expiration.js'
import { resolveModelParameters } from './model-parameters.js'
import { backgroundRequestParameter, promptCacheKeyParameter, publicOutputTokenLimit, responseIncludeParameter, strippableUpstreamParameter, upstreamErrorDetails } from './upstream-request.js'
import { browserChatOutputError, generationOutputHasStarted } from './output-text.js'
import { firstTokenTimeout } from './first-token-timeout.js'
import { responseAttachmentIds, responseInputText } from '../messages/input.js'
import { recalledChatContext } from '../episodic-memory/automatic-recall.js'
import { loadGenerationMemory } from './memory-context.js'
import {
  ContextOverflowError,
  GenerationAttemptError,
  MAX_MODEL_CHAIN_LENGTH,
  canFallbackAfterGenerationError,
  classifyGenerationError,
  isContextOverflowError,
  completionTokensPerSecond,
  fallbackModelAttemptLimit,
  incompleteStreamAttemptLimit,
  isModelSticky,
  isSlowCompletion,
  markModelSticky,
  primaryModelAttemptLimit,
} from './fallback-policy.js'
import { codexEnabled, codexDisabledError } from '../codex/policy.js'
import { startCodexGeneration } from '../codex/generation-policy.js'
import { CODEX_PROVIDER_ID } from '../codex/constants.js'
import { codexErrorRequiresReauthentication, createCodexModels, markCodexReauthenticationRequired, redactedCodexError, safeCodexErrorMessage } from '../codex/credential-store.js'
import { codexInferenceReferenceCostMicros } from '../codex/reference-cost.js'
import { agentThinkingLevel } from '../agent/model-parameters.js'
import { calculateCostMicros } from '../accounting/pricing.js'
import { generationTimeContext, TIME_CONTEXT_INSTRUCTIONS, withGenerationTimeContext } from './time-context.js'

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

/**
 * A completed answer stays completed: billing problems after that point are
 * logged for reconciliation instead of failing the response.
 */
async function settleCompletedResponse(input: Parameters<typeof settleWithSidecars>[0]): Promise<void> {
  try {
    await settleWithSidecars(input)
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', service: 'pulpo-worker', event: 'billing.settlement_failed', responseId: input.responseId, additionalCostMicros: input.additionalCostMicros, error: safeErrorMessage(error) }))
  }
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

async function prepareInputFiles(client: UpstreamTextClient, userId: string, input: unknown[], model: typeof models.$inferSelect, interceptor: ModelImageInterceptor, provider: ProviderImageOptions): Promise<unknown[]> {
  const prepared: unknown[] = []
  const normalizedInput = await interceptOpenAIInputImages(input, model, interceptor, provider)
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
        const text = await interceptor.intercept(model, { data: rendition.data, mimeType: rendition.mimeType, label: attachment.originalName, attachmentId: attachment.id, sourceChecksum: attachment.checksum })
        const outgoing = text === null ? await modelImageRendition(bytes, attachment.mimeType, attachment.checksum, provider) : rendition
        const dataUrl = `data:${outgoing.mimeType};base64,${outgoing.data.toString('base64')}`
        content.push(text === null ? { type: 'input_image', image_url: dataUrl } : { type: 'input_text', text })
        continue
      }
      // Only Responses providers host uploaded files; other protocols take the bytes inline.
      if (!client.openai) {
        content.push({ type: 'input_file', filename: attachment.originalName, file_data: `data:${attachment.mimeType};base64,${Buffer.from(bytes).toString('base64')}` })
        continue
      }
      let fileId = attachment.openaiFileId
      if (!fileId) {
        const uploaded = await client.openai.files.create({
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

/** Collapse inlined `file_data` to a reference so budget estimates match Responses file ids. */
function inlineFilesAsReferences(input: unknown[]): unknown[] {
  return input.map((item) => {
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) return item
    return { ...(item as object), content: content.map((part) => {
      const value = part as { type?: string; file_data?: string; filename?: string }
      return value.type === 'input_file' && typeof value.file_data === 'string' ? { type: 'input_file', filename: value.filename } : part
    }) }
  })
}

type ContextCompaction = {
  /** Compact even below the limit: the provider rejected this context as too long. */
  force: boolean
  /** Request parameters the main request sends (tools, instructions, cache identity). */
  requestParameters: Record<string, unknown>
  headers?: Record<string, string>
  prepareInput: (input: unknown[]) => Promise<unknown[]>
  onUpdate: (item: CompactionItem) => Promise<void>
  onBilledCost: (costMicros: number) => void
}

async function contextualInput(
  client: UpstreamTextClient,
  record: { response: typeof responses.$inferSelect; model: typeof models.$inferSelect },
  history: Array<typeof responses.$inferSelect>,
  requestLogId: string,
  recallItem: RecallItem | null,
  memoryContext: string,
  publicApi: boolean,
  startedAt: number,
  compaction: ContextCompaction,
): Promise<{ input: unknown[]; compactionItems: CompactionItem[] }> {
  const [[preferences], [personalizationRow]] = publicApi ? [[], []] : await Promise.all([
    db.select().from(userPreferences).where(eq(userPreferences.userId, record.response.userId)).limit(1),
    db.select({ value: applicationSettings.value }).from(applicationSettings)
      .where(eq(applicationSettings.key, 'personalization')).limit(1),
  ])
  const values = (preferences?.values ?? {}) as { customInstructions?: string; memoryEnabled?: boolean; instructionPresetSelections?: unknown }
  const customInstructions = publicApi ? '' : composeCustomInstructions(parsePersonalizationSettings(personalizationRow?.value), values)
  const context: unknown[] = []
  if (record.model.systemPrompt.trim()) context.push({ role: 'developer', content: record.model.systemPrompt.trim() })
  if (customInstructions) context.push({ role: 'developer', content: `User-provided custom instructions:\n${customInstructions}` })
  if (memoryContext) context.push({ role: 'developer', content: memoryContext })
  const recallContext = recalledChatContext(recallItem)
  if (recallContext) context.push({ role: 'developer', content: recallContext })
  const timeContext = publicApi ? '' : generationTimeContext(record.response, startedAt)
  if (timeContext) {
    context.push({ role: 'developer', content: TIME_CONTEXT_INSTRUCTIONS })
    context.push({ role: 'developer', content: timeContext })
  }
  const existingItem = preResponseCompactionItem(record.response.output)
  const summaryParameters = summaryRequestParameters(compaction.requestParameters)
  const compacted = await compactResponsesConversation({
    responseId: record.response.id,
    model: record.model,
    parent: history.at(-1),
    conversation: responsesConversation(history),
    existingItem,
    force: compaction.force,
    fixedContext: context,
    tools: Array.isArray(summaryParameters.tools) ? summaryParameters.tools : undefined,
    instructions: typeof summaryParameters.instructions === 'string' ? summaryParameters.instructions : undefined,
    summarize: async (conversation) => {
      // The real request with the summary prompt appended, so its prefix matches the cached main request.
      const input = await compaction.prepareInput([...context, ...conversation, responsesUserTextItem(SUMMARIZATION_PROMPT)])
      const maxOutputTokens = summaryMaxOutputTokens(record.model.maxOutputTokens)
      const billed = await trackBilledInternalModelCall({
        responseId: record.response.id,
        requestLogId,
        modelId: record.model.id,
        upstreamModelId: record.model.upstreamModelId,
        purpose: 'compaction',
        requestInput: { input: client.openai ? input : inlineFilesAsReferences(input), parameters: summaryParameters },
        maxOutputTokens,
        required: true,
        invoke: () => createSummaryResponse(client, {
          ...summaryParameters,
          model: record.model.upstreamModelId,
          input,
          store: false,
          max_output_tokens: maxOutputTokens,
        }, compaction.headers, record.response.id),
      })
      if ('skipped' in billed) throw new Error('Insufficient balance for conversation compaction')
      compaction.onBilledCost(billed.costMicros)
      return billed.result.output_text
    },
    onUpdate: compaction.onUpdate,
  })
  if (!compacted.item && existingItem) {
    const updatedAt = new Date()
    await db.update(responses).set({ output: recallItem ? [recallItem] : [], updatedAt }).where(eq(responses.id, record.response.id))
    const [updated] = await db.select().from(responses).where(eq(responses.id, record.response.id)).limit(1)
    if (updated) await publishSnapshot(toSnapshot(updated))
  }
  return { input: [...context, ...compacted.conversation, ...(record.response.input as unknown[])], compactionItems: compacted.item ? [compacted.item] : [] }
}

/** Non-streaming summarizer call; a provider context overflow drops the oldest history and retries. */
async function createSummaryResponse(client: UpstreamTextClient, body: Record<string, unknown> & { model: string }, headers: Record<string, string> | undefined, responseId: string) {
  try {
    return await withStrippedParameters(body, responseId, (payload) => client.responses.create({ ...payload, stream: false }, { headers }))
  } catch (error) {
    if (!isContextOverflowError(error)) throw error
    throw new CompactionOverflowError(`Context compaction request exceeded the model context window: ${safeErrorMessage(error)}`, { cause: error })
  }
}

/** Persist and publish a compaction item ahead of the response output; returns the new sequence. */
async function publishCompactionUpdate(
  response: typeof responses.$inferSelect,
  publishResponseEvent: ReturnType<typeof createResponseEventPublisher>,
  sequence: number,
  item: CompactionItem,
  leadingItems: unknown[],
): Promise<number> {
  const next = sequence + 1
  const emittedAt = new Date().toISOString()
  const publicItem = sanitizeOutputForClient([item])[0]
  await publishResponseEvent({ responseId: response.id, sequence: next, type: 'pulpo.compaction.updated', payload: publicItem, emittedAt })
  const updatedAt = new Date(emittedAt)
  await db.update(responses).set({
    status: 'in_progress',
    output: [...leadingItems, item],
    lastSequence: next,
    startedAt: response.startedAt ?? updatedAt,
    updatedAt,
  }).where(eq(responses.id, response.id))
  const [updated] = await db.select().from(responses).where(eq(responses.id, response.id)).limit(1)
  if (updated) await publishSnapshot(toSnapshot(updated))
  return next
}

/** Ancestors of a response, oldest first, stopping at a deleted or missing turn. */
async function responseLineage(response: typeof responses.$inferSelect): Promise<Array<typeof responses.$inferSelect>> {
  const allHistory = await db
    .select()
    .from(responses)
    .where(and(eq(responses.chatId, response.chatId), ne(responses.id, response.id), isNull(responses.deletedAt)))
    .orderBy(asc(responses.createdAt), asc(responses.id))
  const byId = new Map(allHistory.map((turn) => [turn.id, turn]))
  const lineage: typeof allHistory = []
  let parentId = response.parentResponseId
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    lineage.push(parent)
    parentId = parent.parentResponseId
  }
  return lineage.reverse()
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

/** Codex rejected the request as too long; the provider text is withheld like other Codex errors. */
const CODEX_CONTEXT_OVERFLOW_MESSAGE = 'Codex rejected the request because the conversation exceeds the model context window.'

async function processCodexGenerationAttempt(
  record: { response: typeof responses.$inferSelect; model: typeof models.$inferSelect; provider: typeof providerConnections.$inferSelect },
  startedAt: number,
  options: { forceCompaction?: boolean } = {},
): Promise<void> {
  const responseId = record.response.id
  const publishResponseEvent = createResponseEventPublisher(record.response)
  const lineage = await responseLineage(record.response)
  const currentMessage = await codexCurrentUserMessage(record.response)
  const systemPrompt = withGenerationTimeContext(record.model.systemPrompt, record.response, startedAt) || undefined
  const codex = createCodexModels(record.response.userId)
  const piModel = codex.getModel('openai-codex', record.model.upstreamModelId)
  if (!piModel) throw new Error('The pinned Pi Codex catalog no longer contains this model')
  // The summarizer shares the main stream's session so both reuse one prompt cache.
  const sessionId = `pulpo:${record.response.userId}:${record.response.chatId}`
  let sequence = record.response.lastSequence
  const [requestLog] = await db.select({ id: requestLogs.id }).from(requestLogs).where(eq(requestLogs.responseId, responseId)).limit(1)
  // Compaction billed by an earlier attempt is reused, not re-billed, so carry its cost forward.
  const [priorSidecars] = requestLog
    ? await db.select({ total: sql<number>`coalesce(sum(${generationAttempts.costMicros}), 0)::bigint` })
      .from(generationAttempts).where(and(eq(generationAttempts.requestLogId, requestLog.id), eq(generationAttempts.source, 'tool')))
    : []
  let sidecarCostMicros = Number(priorSidecars?.total ?? 0)
  const conversation = codexConversation(lineage)
  // Runs before the try below so compaction errors never reach the reauthentication check.
  const compacted = requestLog ? await compactCodexConversation({
    responseId,
    model: record.model,
    parent: lineage.at(-1),
    conversation,
    existingItem: preResponseCompactionItem(record.response.output),
    force: options.forceCompaction,
    systemPrompt,
    summarize: async (messages) => {
      const summaryContext: Context = { systemPrompt, messages: [...messages, piUserTextMessage(SUMMARIZATION_PROMPT)] }
      const maxOutputTokens = summaryMaxOutputTokens(record.model.maxOutputTokens)
      const billed = await trackBilledInternalModelCall({
        responseId, requestLogId: requestLog.id, modelId: record.model.id, upstreamModelId: record.model.upstreamModelId,
        purpose: 'compaction', requestInput: summaryContext, maxOutputTokens, required: true,
        invoke: async () => {
          // completeSimple resolves provider failures as error messages instead of rejecting.
          const result = await codex.completeSimple(piModel, summaryContext, {
            reasoning: 'low', maxTokens: maxOutputTokens, maxRetries: 0, timeoutMs: record.provider.requestTimeoutMs, transport: 'auto', sessionId,
          })
          if (result.stopReason === 'error' || result.stopReason === 'aborted') {
            if (isContextOverflow(result, piModel.contextWindow)) throw new CompactionOverflowError()
            const error = new Error(result.errorMessage ?? 'Codex request failed')
            if (codexErrorRequiresReauthentication(error)) await markCodexReauthenticationRequired(record.response.userId, 'Your Codex connection needs to be renewed.')
            throw new CompactionError(`Context compaction failed: ${safeCodexErrorMessage(error)}`)
          }
          return {
            id: result.responseId,
            usage: codexUsage(result),
            output_text: result.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n'),
          }
        },
      })
      if ('skipped' in billed) throw new Error('Insufficient balance for conversation compaction')
      sidecarCostMicros += billed.costMicros
      return billed.result.output_text
    },
    onUpdate: async (item) => {
      sequence = await publishCompactionUpdate(record.response, publishResponseEvent, sequence, item, [])
    },
  }) : { conversation }
  const context: Context = { systemPrompt, messages: [...compacted.conversation, currentMessage] }
  const contextItems: unknown[] = compacted.item ? [compacted.item] : []
  const controller = new AbortController()
  const cancellationPoll = setInterval(() => {
    void isCancellationRequested(responseId).then((cancelled) => { if (cancelled) controller.abort() }).catch(() => undefined)
  }, 500)
  cancellationPoll.unref()
  const messageId = `msg_${responseId}`
  let text = ''
  let reasoning = ''
  let lastSnapshot = 0
  const output = () => [
    ...contextItems,
    ...(reasoning ? [{ id: `reasoning_${responseId}`, type: 'reasoning', summary: [{ type: 'summary_text', text: reasoning }] }] : []),
    { id: messageId, type: 'message', role: 'assistant', status: 'in_progress', content: [{ type: 'output_text', text, annotations: [] }] },
  ]
  await db.update(responses).set({ status: 'in_progress', startedAt: record.response.startedAt ?? new Date(), output: output(), updatedAt: new Date() })
    .where(eq(responses.id, responseId))
  try {
    const reservation = await resizeBudgetReservation({
      responseId, accruedCostMicros: sidecarCostMicros, accruedExtraCostMicros: sidecarCostMicros, requestInput: context,
      maxOutputTokens: publicOutputTokenLimit(record.model.maxOutputTokens, record.response.parameters as Record<string, unknown>).max_output_tokens,
      minimumOutputReservationTokens: record.model.minimumOutputReservationTokens,
      pricing: await getActivePricing(record.model.id),
    })
    const stream = codex.streamSimple(piModel, context, {
      reasoning: agentThinkingLevel(record.response.parameters as Record<string, unknown>) as ThinkingLevel,
      maxTokens: reservation.maxOutputTokens,
      maxRetries: 0,
      timeoutMs: record.provider.requestTimeoutMs,
      transport: 'auto',
      sessionId,
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
      else if (event.type === 'error') {
        const message = event.error.errorMessage ?? 'Codex generation failed'
        throw isContextOverflow(event.error, piModel.contextWindow) ? new ContextOverflowError(message) : new Error(message)
      }
      if (Date.now() - lastSnapshot > 250) {
        await db.update(responses).set({ output: output(), lastSequence: sequence, updatedAt: new Date() }).where(eq(responses.id, responseId))
        const [snapshot] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
        if (snapshot) await publishSnapshot(toSnapshot(snapshot))
        lastSnapshot = Date.now()
      }
    }
    if (!finalMessage) finalMessage = await stream.result()
    if (!text) text = finalMessage.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('')
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
    let additionalCostMicros = sidecarCostMicros
    if (requestLog) {
      const postTasks = await runPostResponseTasks(record, record, terminalOutput, requestLog.id)
      additionalCostMicros += postTasks.costMicros
      if (postTasks.error && codexErrorRequiresReauthentication(postTasks.error)) {
        await markCodexReauthenticationRequired(record.response.userId, 'Your Codex connection needs to be renewed.')
      }
    }
    await settleCompletedResponse({
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
      await settleWithSidecars({ responseId, usage: null, latencyMs: Date.now() - startedAt, additionalCostMicros: sidecarCostMicros })
      const [snapshot] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
      if (snapshot) await publishSnapshot(toSnapshot(snapshot))
      return
    }
    // Overflow texts mention tokens, which the reauthentication check would misread.
    if (error instanceof ContextOverflowError) throw new ContextOverflowError(CODEX_CONTEXT_OVERFLOW_MESSAGE)
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
  options: { willRetry?: boolean; forceCompaction?: boolean } = {},
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
  const publishResponseEvent = createResponseEventPublisher(record.response)
  if (record.provider.id === CODEX_PROVIDER_ID) {
    await processCodexGenerationAttempt(record, startedAt, { forceCompaction: options.forceCompaction })
    return
  }
  const config = getConfig()
  const client = createUpstreamTextClient(record.provider, {
    fetch: diagnosticFetch({ purpose: 'generation', userId: record.response.userId, providerId: record.provider.id, modelId: record.model.id, upstreamModelId: record.model.upstreamModelId }),
  })
  // Only the Responses API can resume or poll a background generation; other
  // protocols regenerate from the stored request after a worker restart.
  const resumable = client.openai
  if (record.response.executionMode === 'background' && record.response.openaiResponseId && resumable) {
    const openaiResponseId = record.response.openaiResponseId
    const contextItems = (record.response.output as unknown[]).filter((item) => (
      ['pulpo_recall', 'pulpo_compaction'].includes((item as { type?: string }).type ?? '')
    ))
    const recoveryInclude = responseIncludeParameter(record.response.parameters)
    await db.update(responses).set({ status: 'in_progress', error: null, completedAt: null, updatedAt: new Date() }).where(eq(responses.id, responseId))
    try {
      try {
        const resumed = await resumable.responses.retrieve(openaiResponseId, {
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
          await resumable.responses.cancel(openaiResponseId).catch(() => undefined)
          await db.update(responses).set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, responseId))
          await releaseBudget(responseId)
          return
        }
        const recovered = await resumable.responses.retrieve(openaiResponseId, recoveryInclude as { include?: never })
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
          if (requestLog) additionalCostMicros = (await runPostResponseTasks(record, record, output, requestLog.id)).costMicros
        }
        if (usage.totalTokens > 0 || additionalCostMicros > 0) {
          await settleCompletedResponse({ responseId, usage, latencyMs: Date.now() - startedAt, providerCostMicros, additionalCostMicros })
        } else await releaseBudget(responseId)
        const [snapshot] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
        if (snapshot) await publishSnapshot(toSnapshot(snapshot))
        return
      }
      throw new Error('Background response recovery timed out')
    } catch (error) {
      if (options.willRetry) throw new GenerationAttemptError(safeErrorMessage(error), false, error)
      await db.update(responses).set({
        status: 'failed', error: { message: safeErrorMessage(error) },
        completedAt: new Date(), updatedAt: new Date(),
      }).where(eq(responses.id, responseId))
      await releaseBudget(responseId)
      throw error
    }
  }
  const history = await responseLineage(record.response)
  const [requestLog] = await db.select({
    id: requestLogs.id,
    apiKeyId: requestLogs.apiKeyId,
    captureDetailedPayloads: requestLogs.captureDetailedPayloads,
    payloadExpiresAt: requestLogs.payloadExpiresAt,
  }).from(requestLogs).where(eq(requestLogs.responseId, responseId)).limit(1)
  if (!requestLog) throw new Error('Request log is missing')
  const [chatState] = await db.select({ temporary: chats.temporary }).from(chats)
    .where(eq(chats.id, record.response.chatId)).limit(1)
  const [priorSidecars] = await db.select({ total: sql<number>`coalesce(sum(${generationAttempts.costMicros}), 0)::bigint` })
    .from(generationAttempts).where(and(eq(generationAttempts.requestLogId, requestLog.id), eq(generationAttempts.source, 'tool')))
  let sidecarCostMicros = Number(priorSidecars?.total ?? 0)
  const [priorGeneration] = await db.select({ total: sql<number>`coalesce(sum(${generationAttempts.costMicros}), 0)::bigint` })
    .from(generationAttempts).where(and(eq(generationAttempts.requestLogId, requestLog.id), eq(generationAttempts.purpose, 'generation'), eq(generationAttempts.status, 'failed')))
  const priorGenerationCostMicros = Number(priorGeneration?.total ?? 0)
  // Free excess output headroom while required preprocessing reserves its own calls.
  await resizeBudgetReservation({
    responseId, accruedCostMicros: sidecarCostMicros + priorGenerationCostMicros, accruedExtraCostMicros: sidecarCostMicros, requestInput: record.response.input,
    maxOutputTokens: Math.min(record.model.minimumOutputReservationTokens, publicOutputTokenLimit(record.model.maxOutputTokens, record.response.parameters as Record<string, unknown>).max_output_tokens),
    minimumOutputReservationTokens: record.model.minimumOutputReservationTokens,
    pricing: await getActivePricing(record.model.id),
  })
  const imageInterceptor = await createModelImageInterceptor(requestLog.id, {
    allowCache: !chatState?.temporary,
    responseId,
    onBilledCost: (costMicros) => { sidecarCostMicros += costMicros },
  })
  let sequence = record.response.lastSequence
  const publicApi = Boolean(requestLog.apiKeyId)
  const [memoryPreferences] = publicApi ? [] : await db.select({ values: userPreferences.values }).from(userPreferences)
    .where(eq(userPreferences.userId, record.response.userId)).limit(1)
  const memory = await loadGenerationMemory({
    chat: chatState,
    memoryEnabled: (memoryPreferences?.values as { memoryEnabled?: unknown } | undefined)?.memoryEnabled,
    publicApi,
    responseId,
    userId: record.response.userId,
    currentChatId: record.response.chatId,
    query: responseInputText(record.response.input),
    output: record.response.output,
  })
  const { recallItem } = memory
  const recallItems = recallItem ? [recallItem] : []
  if (recallItem && !memory.reusedRecall) {
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
  const parameters = resolveModelParameters(record.model, record.response.parameters, { publicApi })
  const cacheOptions = providerCacheRequestOptions(record.provider, {
    userId: record.response.userId,
    chatId: record.response.chatId,
    runId: record.response.id,
  })
  // Shared by the main request and the summarizer so both hit the same prompt cache.
  const requestParameters = {
    ...providerPromptCacheParameters(record.model.promptCachingEnabled, parameters),
    ...promptCacheKeyParameter(publicApi ? parameters : {}, cacheOptions.promptCacheKey),
  }
  const prepareInput = (items: unknown[]) => prepareInputFiles(client, record.response.userId, items, record.model, imageInterceptor, record.provider)
  const contextual = await contextualInput(client, record, history, requestLog.id, recallItem, memory.memoryContext, publicApi, startedAt, {
    force: options.forceCompaction === true,
    requestParameters,
    headers: cacheOptions.headers,
    prepareInput,
    onUpdate: async (item) => {
      sequence = await publishCompactionUpdate(record.response, publishResponseEvent, sequence, item, recallItems)
    },
    onBilledCost: (costMicros) => { sidecarCostMicros += costMicros },
  })
  const input = await prepareInput(contextual.input)
  const contextItems: unknown[] = [...recallItems, ...contextual.compactionItems]
  let output: unknown[] = [...contextItems]
  let outputStarted = generationOutputHasStarted(output)
  let usage: ResponseUsage | null = null
  let providerCostMicros: number | undefined
  const pricing = await getActivePricing(record.model.id)
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
    const reservation = await resizeBudgetReservation({
      responseId,
      accruedCostMicros: sidecarCostMicros + priorGenerationCostMicros,
      accruedExtraCostMicros: sidecarCostMicros,
      // Inlined file bytes are not text tokens; reserve for them as the Responses path does for a file_id.
      requestInput: { input: client.openai ? input : inlineFilesAsReferences(input), parameters },
      maxOutputTokens: publicOutputTokenLimit(record.model.maxOutputTokens, {
        ...parameters, ...record.response.parameters as Record<string, unknown>,
      }).max_output_tokens,
      minimumOutputReservationTokens: record.model.minimumOutputReservationTokens,
      pricing,
    })
    await db.update(responses).set({ pricingVersionId: pricing.id }).where(eq(responses.id, responseId))
    const upstreamPayload = {
      ...requestParameters,
      max_output_tokens: reservation.maxOutputTokens,
      model: record.model.upstreamModelId,
      input: input as never,
      stream: true as const,
      ...backgroundRequestParameter(record.response.executionMode),
      store: false as const,
    }
    const stream = await createUpstreamStream(client, upstreamPayload, { signal: controller.signal, headers: cacheOptions.headers }, responseId)
    for await (const rawEvent of stream) {
      if (await isCancellationRequested(responseId)) {
        if (record.response.executionMode === 'background' && upstreamResponseId && client.openai) {
          await client.openai.responses.cancel(upstreamResponseId).catch(() => undefined)
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
      // Only Responses ids can be retrieved later; translated message ids would
      // make a background fallback try to resume a response that does not exist.
      if (upstreamResponse?.id && client.openai && upstreamResponse.id !== upstreamResponseId) {
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
    // The answer is already completed; releasing unused budget is best effort.
    await retainBudgetReservation(responseId, sidecarCostMicros + priorGenerationCostMicros + (usage ? providerCostMicros ?? calculateCostMicros(usage, pricing) : 0), sidecarCostMicros).catch((error) => {
      console.warn(JSON.stringify({ level: 'warn', service: 'pulpo-worker', event: 'billing.retain_failed', responseId, error: safeErrorMessage(error) }))
    })
    const postTasks: PostResponseTaskResult = terminalStatus === 'completed' ? await runPostResponseTasks(record, record, output, requestLog.id) : { costMicros: 0 }
    if (postTasks.error) console.warn(JSON.stringify({ level: 'warn', service: 'pulpo-worker', event: 'post_response_tasks.failed', responseId, error: safeErrorMessage(postTasks.error) }))
    const postTaskCostMicros = postTasks.costMicros
    await settleCompletedResponse({
      responseId,
      usage,
      latencyMs: Date.now() - startedAt,
      providerCostMicros,
      additionalCostMicros: sidecarCostMicros + priorGenerationCostMicros + postTaskCostMicros,
    })
    await db.update(chats).set({ updatedAt: completedAt }).where(eq(chats.id, record.response.chatId))
    const [completed] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (completed) await publishSnapshot(toSnapshot(completed))
  } catch (caughtError) {
    firstToken.clear()
    const error = firstToken.error ?? caughtError
    const attemptId = diagnosticContext.getStore()?.modelCallId
    if (attemptId && usage && usage.totalTokens > 0) {
      await db.update(generationAttempts).set({
        inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, cacheWriteTokens: usage.cacheWriteTokens,
        outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens,
        costMicros: providerCostMicros ?? calculateCostMicros(usage, pricing),
      }).where(eq(generationAttempts.id, attemptId))
    }
    await flushTelemetry(true).catch(() => undefined)
    const cancelled = await isCancellationRequested(responseId)
    const completedAt = new Date()
    await db.update(responses).set({
      status: cancelled ? 'cancelled' : options.willRetry ? 'queued' : 'failed',
      error: { message: safeErrorMessage(error), ...upstreamErrorFields(error) },
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
        additionalCostMicros: sidecarCostMicros + priorGenerationCostMicros,
      })
      const [terminal] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
      if (terminal) await publishSnapshot(toSnapshot(terminal))
    }
    if (!cancelled) throw new GenerationAttemptError(safeErrorMessage(error), outputStarted, error)
  }
}

/** A context overflow before any output is retried once with a forced compaction. */
async function canCompactAfterOverflow(
  error: unknown,
  model: typeof models.$inferSelect,
  response: typeof responses.$inferSelect,
): Promise<boolean> {
  // Read the attempt's output only for an actual overflow.
  if (!isContextOverflowError(error)) return false
  const [current] = await db.select({ output: responses.output }).from(responses).where(eq(responses.id, response.id)).limit(1)
  return canRetryOverflowWithCompaction({
    error,
    enabled: model.compactionEnabled,
    hasHistory: Boolean(response.parentResponseId),
    modelId: model.id,
    output: current?.output,
  })
}

/** Provider status, code, and param persisted with a failure so public clients see the real rejection. */
function upstreamErrorFields(error: unknown): { upstream?: { status: number; code?: string; param?: string; type?: string } } {
  const source = error instanceof GenerationAttemptError && error.upstreamError ? error.upstreamError : error
  const details = upstreamErrorDetails(source)
  if (details.status === undefined) return {}
  return { upstream: {
    status: details.status,
    ...(details.code ? { code: details.code } : {}),
    ...(details.param ? { param: details.param } : {}),
    ...(details.type ? { type: details.type } : {}),
  } }
}

const MAX_UPSTREAM_PARAMETER_STRIPS = 3

/**
 * Open the upstream stream, dropping parameters the provider explicitly rejects.
 * Providers differ on which sampling knobs each model accepts; a request should
 * degrade to the provider's defaults rather than fail on a knob the client set.
 */
async function createUpstreamStream<Payload extends Record<string, unknown> & { stream: true; model: string }>(
  client: UpstreamTextClient,
  payload: Payload,
  options: { signal: AbortSignal; headers?: Record<string, string> },
  responseId: string,
) {
  return withStrippedParameters(payload, responseId, (current) => client.responses.create(current, options))
}

async function withStrippedParameters<Payload extends Record<string, unknown>, Result>(
  payload: Payload,
  responseId: string,
  create: (payload: Payload) => Promise<Result>,
): Promise<Result> {
  let current: Payload = payload
  for (let strips = 0; ; strips += 1) {
    try {
      return await create(current)
    } catch (error) {
      const parameter = strips < MAX_UPSTREAM_PARAMETER_STRIPS ? strippableUpstreamParameter(error, current) : undefined
      if (!parameter) throw error
      console.info(JSON.stringify({ level: 'info', service: 'pulpo-worker', event: 'upstream.parameter_stripped', responseId, parameter, message: safeErrorMessage(error) }))
      current = Object.fromEntries(Object.entries(current).filter(([key]) => key !== parameter)) as Payload
    }
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
  if (!base || ['completed', 'incomplete', 'cancelled', 'failed'].includes(base.response.status)) return
  const failureLog = base.log
  const chatRetention = { temporary: base.chatTemporary, expiresAt: base.chatExpiresAt }
  if (base.chatDeletedAt || temporaryChatIsExpired(chatRetention) || normalChatIsExpired(chatRetention)) {
    const now = new Date()
    await db.update(responses).set({ status: 'cancelled', completedAt: now, updatedAt: now }).where(eq(responses.id, responseId))
    await releaseBudget(responseId)
    return
  }
  const codexAllowed = base.model.providerConnectionId === CODEX_PROVIDER_ID
    ? await startCodexGeneration(responseId)
    : await codexEnabled()
  if (codexAllowed === null) return
  if (!codexAllowed && base.model.providerConnectionId === CODEX_PROVIDER_ID) {
    await failGeneration(codexDisabledError())
    return
  }
  if (base.response.agentMode) {
    await processAgentGeneration(responseId, codexAllowed)
    return
  }
  let model: typeof models.$inferSelect | undefined = base.model
  let fallbackFrom: string | null = null
  let attemptLimit = primaryModelAttemptLimit(base.model)
  let retryDelaySeconds = base.model.retryDelaySeconds
  let lastError: unknown
  // The model whose context overflowed once; its later attempts compact first.
  let overflowCompactionModelId: string | undefined
  const visited = new Set<string>()

  while (model && visited.size < MAX_MODEL_CHAIN_LENGTH && !visited.has(model.id)) {
    if (!codexAllowed && model.providerConnectionId === CODEX_PROVIDER_ID) {
      lastError = codexDisabledError()
      break
    }
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
        await withDiagnosticContext({ requestLogId: base.log.id, modelCallId: attemptId, purpose: 'generation', metadata: { retryAttempt: attempt + 1, fallbackFromModelId: fallbackFrom } }, () => processGenerationAttempt(responseId, model!.id, { willRetry: true, forceCompaction: overflowCompactionModelId === model!.id }))
        const [completed] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
        if (model.providerConnectionId === CODEX_PROVIDER_ID) await recordReconstructedDiagnostic({ requestLogId: base.log.id, modelCallId: attemptId, purpose: 'generation', providerId: CODEX_PROVIDER_ID, modelId: model.id, upstreamModelId: model.upstreamModelId }, { input: base.response.input, parameters: base.response.parameters }, { output: completed?.output, usage: completed?.usage }, { retryAttempt: attempt + 1 }, completed?.status ?? 'completed')
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
        if (isSlowCompletion(model, durationMs, usage?.outputTokens ?? 0)) await markModelSticky(redis, model, 'slow_completion')
        await publishAdminUsage(base.log.id, true)
        return
      } catch (error) {
        if (model.providerConnectionId === CODEX_PROVIDER_ID) await recordReconstructedDiagnostic({ requestLogId: base.log.id, modelCallId: attemptId, purpose: 'generation', providerId: CODEX_PROVIDER_ID, modelId: model.id, upstreamModelId: model.upstreamModelId }, { input: base.response.input }, { error: safeErrorMessage(error) }, { failureStage: 'application', retryAttempt: attempt + 1 }, 'failed')
        lastError = error
        const category = classifyGenerationError(error)
        await db.update(generationAttempts).set({ status: 'failed', errorCategory: category, errorMessage: safeErrorMessage(error), durationMs: Date.now() - attemptStarted, completedAt: new Date() }).where(eq(generationAttempts.id, attemptId))
        if (!overflowCompactionModelId && await canCompactAfterOverflow(error, model, base.response)) {
          // One extra attempt that compacts before resending.
          overflowCompactionModelId = model.id
          attemptLimit += 1
          continue
        }
        if (!canFallbackAfterGenerationError(error)) { model = undefined; break }
        attemptLimit = incompleteStreamAttemptLimit(attemptLimit, error instanceof Error ? error.message : undefined)
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

  await failGeneration(lastError)

  async function failGeneration(error: unknown): Promise<void> {
    const message = safeErrorMessage(error)
    const category = classifyGenerationError(error)
    const completedAt = new Date()
    await db.transaction(async (tx) => {
      await tx.update(responses).set({ status: 'failed', error: { message, category, ...(error instanceof Error && 'code' in error ? { code: error.code } : {}), ...upstreamErrorFields(error) }, completedAt, updatedAt: completedAt }).where(eq(responses.id, responseId))
      await tx.update(requestLogs).set({ status: 'failed', errorCategory: category, errorMessage: message, durationMs: Date.now() - (failureLog.startedAt ?? failureLog.createdAt).getTime(), completedAt, updatedAt: completedAt }).where(eq(requestLogs.id, failureLog.id))
    })
    const [incurred] = await db.select({ total: sql<number>`coalesce(sum(${generationAttempts.costMicros}), 0)::bigint` })
      .from(generationAttempts).where(eq(generationAttempts.requestLogId, failureLog.id))
    const incurredCostMicros = Number(incurred?.total ?? 0)
    if (incurredCostMicros > 0) {
      const [failed] = await db.select({ usage: responses.usage }).from(responses).where(eq(responses.id, responseId))
      await settleBudget({ responseId, usage: failed?.usage as ResponseUsage ?? EMPTY_USAGE,
        latencyMs: Date.now() - (failureLog.startedAt ?? failureLog.createdAt).getTime(), costMicrosOverride: incurredCostMicros })
      await db.update(requestLogs).set({ costMicros: incurredCostMicros }).where(eq(requestLogs.id, failureLog.id))
    } else await releaseBudget(responseId)
    const [terminal] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (terminal) await publishSnapshot(toSnapshot(terminal))
    await publishAdminUsage(failureLog.id, true)
  }
}
