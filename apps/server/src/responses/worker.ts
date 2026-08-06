import OpenAI, { toFile } from 'openai'
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm'
import { applyResponseEventToSnapshot, type CompactionItem, type ResponseEvent, type ResponseUsage } from '@pulpo/contracts'
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
  memories,
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
import { parseLoggingSettings } from '../settings/application-settings.js'
import { processAgentGeneration } from '../agent/runner.js'
import { runPostResponseTasks } from './post-tasks.js'
import { providerReportedCostMicros, trackInternalModelCall } from './model-calls.js'
import { createModelImageInterceptor, interceptOpenAIInputImages, type ModelImageInterceptor } from './image-ocr.js'
import { COMPACTION_PROMPT, compactConversation } from './compaction.js'

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
    input_tokens_details?: { cached_tokens?: number }
    output_tokens_details?: { reasoning_tokens?: number }
  }
  return {
    inputTokens: value.input_tokens ?? 0,
    cachedInputTokens: value.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: value.output_tokens ?? 0,
    reasoningTokens: value.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: value.total_tokens ?? (value.input_tokens ?? 0) + (value.output_tokens ?? 0),
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

async function prepareInputFiles(client: OpenAI, input: unknown[], model: typeof models.$inferSelect, interceptor: ModelImageInterceptor): Promise<unknown[]> {
  const prepared: unknown[] = []
  for (const item of input) {
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
      const [attachment] = await db.select().from(attachments).where(eq(attachments.id, filePart.attachment_id)).limit(1)
      if (!attachment || attachment.status !== 'ready') throw new Error('Attachment is unavailable')
      const bytes = await getBlobStore().get(attachment.objectKey)
      if (attachment.mimeType.startsWith('image/')) {
        const dataUrl = `data:${attachment.mimeType};base64,${Buffer.from(bytes).toString('base64')}`
        const text = await interceptor.intercept(model, { data: bytes, mimeType: attachment.mimeType, label: attachment.originalName, attachmentId: attachment.id, sourceChecksum: attachment.checksum })
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
        await db.update(attachments).set({ openaiFileId: fileId, updatedAt: new Date() }).where(eq(attachments.id, attachment.id))
      }
      content.push({ type: 'input_file', file_id: fileId })
    }
    prepared.push({ ...typed, content })
  }
  return interceptOpenAIInputImages(prepared, model, interceptor)
}

async function contextualInput(
  client: OpenAI,
  record: { response: typeof responses.$inferSelect; model: typeof models.$inferSelect },
  history: Array<typeof responses.$inferSelect>,
  requestLogId: string,
  onCompactionUpdate: (item: CompactionItem) => Promise<void>,
): Promise<{ input: unknown[]; compactionItems: CompactionItem[] }> {
  const [preferences] = await db.select().from(userPreferences).where(eq(userPreferences.userId, record.response.userId)).limit(1)
  const values = (preferences?.values ?? {}) as { customInstructions?: string; memoryEnabled?: boolean }
  const enabledMemories = values.memoryEnabled
    ? await db.select().from(memories).where(and(eq(memories.userId, record.response.userId), eq(memories.enabled, true)))
    : []
  const context: unknown[] = []
  if (record.model.systemPrompt.trim()) context.push({ role: 'developer', content: record.model.systemPrompt.trim() })
  if (values.customInstructions?.trim()) context.push({ role: 'developer', content: `User-provided custom instructions:\n${values.customInstructions.trim()}` })
  if (enabledMemories.length) context.push({ role: 'developer', content: `User-approved memories:\n${enabledMemories.map((memory) => `- ${memory.content}`).join('\n')}` })
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
      const summaryResponse = await trackInternalModelCall({
        requestLogId,
        modelId: record.model.id,
        upstreamModelId: record.model.upstreamModelId,
        purpose: 'compaction',
        invoke: () => client.responses.create({
          model: record.model.upstreamModelId,
          input: [{ role: 'user', content: `${COMPACTION_PROMPT}\n\n${JSON.stringify(older)}` }],
          store: false,
          max_output_tokens: Math.min(2_000, record.model.maxOutputTokens),
        }),
      })
      return summaryResponse.output_text
    },
    onUpdate: onCompactionUpdate,
  })
  if (!compacted.item && existingItem) {
    const updatedAt = new Date()
    await db.update(responses).set({ output: [], updatedAt }).where(eq(responses.id, record.response.id))
    const [updated] = await db.select().from(responses).where(eq(responses.id, record.response.id)).limit(1)
    if (updated) await publishSnapshot(toSnapshot(updated))
  }
  return { input: [...context, ...compacted.conversation, ...(record.response.input as unknown[])], compactionItems: compacted.item ? [compacted.item] : [] }
}

async function resolvedParameters(record: { response: typeof responses.$inferSelect; model: typeof models.$inferSelect }): Promise<Record<string, unknown>> {
  const allowed = new Set(record.model.allowedParameters as string[])
  const reserved = new Set(['model', 'input', 'stream', 'store', 'metadata'])
  const result = Object.fromEntries(Object.entries(record.model.defaultParameters as Record<string, unknown>).filter(([key]) => allowed.has(key) && !reserved.has(key)))
  for (const [key, value] of Object.entries(record.response.parameters as Record<string, unknown>)) if (allowed.has(key) && !reserved.has(key)) result[key] = value
  return result
}

class GenerationAttemptError extends Error {
  constructor(message: string, readonly outputStarted: boolean) { super(message) }
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
    const compactionItems = (record.response.output as unknown[]).filter((item) => (item as { type?: string }).type === 'pulpo_compaction')
    await db.update(responses).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(responses.id, responseId))
    try {
      try {
        const resumed = await client.responses.retrieve(openaiResponseId, {
          stream: true,
          starting_after: record.response.upstreamSequence,
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
          recoveredOutput = upstreamResponse?.output ? [...compactionItems, ...upstreamResponse.output] : accumulateEventOutput(recoveredOutput, event)
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
        const recovered = await client.responses.retrieve(openaiResponseId)
        if (recovered.status && ['queued', 'in_progress'].includes(recovered.status)) {
          await new Promise((resolve) => setTimeout(resolve, 2_000))
          continue
        }
        const output = [...compactionItems, ...(recovered.output as unknown[])]
        const usage = normalizeUsage(recovered.usage)
        const providerCostMicros = record.model.useProviderCost ? providerReportedCostMicros(recovered.usage) : undefined
        const status = recovered.status === 'completed' ? 'completed'
          : recovered.status === 'cancelled' ? 'cancelled'
            : recovered.status === 'incomplete' ? 'incomplete' : 'failed'
        await persistItems(responseId, output)
        const completedAt = new Date()
        await db.update(responses).set({
          status, output, usage, completedAt, updatedAt: completedAt,
          error: recovered.error ? { message: recovered.error.message, code: recovered.error.code } : null,
        }).where(eq(responses.id, responseId))
        if (usage.totalTokens > 0) await settleBudget({ responseId, usage, latencyMs: Date.now() - startedAt, costMicrosOverride: providerCostMicros })
        else await releaseBudget(responseId)
        if (status === 'completed') {
          const [requestLog] = await db.select({ id: requestLogs.id }).from(requestLogs).where(eq(requestLogs.responseId, responseId)).limit(1)
          if (requestLog) await runPostResponseTasks(record, record, output, requestLog.id).catch(() => undefined)
        }
        const [snapshot] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
        if (snapshot) await publishSnapshot(toSnapshot(snapshot))
        return
      }
      throw new Error('Background response recovery timed out')
    } catch (error) {
      if (options.willRetry) throw new GenerationAttemptError(error instanceof Error ? error.message : 'Recovery failed', false)
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
  const [requestLog] = await db.select({ id: requestLogs.id }).from(requestLogs).where(eq(requestLogs.responseId, responseId)).limit(1)
  if (!requestLog) throw new Error('Request log is missing')
  const [chatState] = await db.select({ temporary: chats.temporary }).from(chats)
    .where(eq(chats.id, record.response.chatId)).limit(1)
  const imageInterceptor = await createModelImageInterceptor(requestLog.id, {
    allowCache: !chatState?.temporary,
  })
  let sequence = record.response.lastSequence
  const contextual = await contextualInput(client, record, history, requestLog.id, async (item) => {
    sequence += 1
    const emittedAt = new Date().toISOString()
    await publishResponseEvent({ responseId, sequence, type: 'pulpo.compaction.updated', payload: item, emittedAt })
    const updatedAt = new Date(emittedAt)
    await db.update(responses).set({
      status: 'in_progress',
      output: [item],
      lastSequence: sequence,
      startedAt: record.response.startedAt ?? updatedAt,
      updatedAt,
    }).where(eq(responses.id, responseId))
    const [updated] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (updated) await publishSnapshot(toSnapshot(updated))
  })
  const generationStartSequence = sequence
  const input = await prepareInputFiles(client, contextual.input, record.model, imageInterceptor)
  let output: unknown[] = [...contextual.compactionItems]
  let usage: ResponseUsage | null = null
  let providerCostMicros: number | undefined
  let upstreamResponseId = record.response.openaiResponseId
  let lastSnapshotAt = 0
  let lastTelemetryAt = 0
  let pendingEventCount = 0
  const flushTelemetry = async (force = false) => {
    if (pendingEventCount === 0 || (!force && Date.now() - lastTelemetryAt < 500)) return
    const eventCount = pendingEventCount
    await db.update(requestLogs).set({
      eventCount: sql`${requestLogs.eventCount} + ${eventCount}`,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      updatedAt: new Date(),
    }).where(eq(requestLogs.id, requestLog.id))
    pendingEventCount -= eventCount
    lastTelemetryAt = Date.now()
    await publishAdminUsage(requestLog.id)
  }
  const controller = new AbortController()
  let firstTokenTimer: ReturnType<typeof setTimeout> | undefined
  if (record.model.firstTokenTimeoutEnabled) firstTokenTimer = setTimeout(() => controller.abort(new Error('First-token timeout')), record.model.firstTokenTimeoutSeconds * 1000)
  await db.update(responses).set({ status: 'in_progress', startedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, responseId))
  try {
    const parameters = await resolvedParameters(record)
    const upstreamPayload = {
      ...(parameters as Record<string, never>),
      model: record.model.upstreamModelId,
      input: input as never,
      stream: true as const,
      background: record.response.executionMode === 'background',
      store: false as const,
      metadata: { pulpo_response_id: responseId, pulpo_chat_id: record.response.chatId },
    }
    const [loggingRow] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'logging')).limit(1)
    if (parseLoggingSettings(loggingRow?.value).logDetailedPayloads) await db.update(requestLogs).set({ requestPayload: upstreamPayload, updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
    const stream = await client.responses.create(upstreamPayload, { signal: controller.signal })
    for await (const rawEvent of stream) {
      if (await isCancellationRequested(responseId)) {
        if (record.response.executionMode === 'background' && upstreamResponseId) {
          await client.responses.cancel(upstreamResponseId).catch(() => undefined)
        }
        controller.abort()
        throw new Error('Generation cancelled')
      }
      const upstream = rawEvent as unknown as UpstreamEvent
      if (firstTokenTimer && (upstream.type.includes('output_text.delta') || upstream.type.includes('content_part.added'))) { clearTimeout(firstTokenTimer); firstTokenTimer = undefined }
      sequence += 1
      const event: ResponseEvent = {
        responseId,
        sequence,
        type: upstream.type,
        payload: upstream,
        emittedAt: new Date().toISOString(),
      }
      const upstreamResponse = upstream.response as { id?: string; output?: unknown[]; usage?: unknown } | undefined
      if (upstreamResponse?.id) {
        upstreamResponseId = upstreamResponse.id
        await db.update(responses).set({ openaiResponseId: upstreamResponse.id }).where(eq(responses.id, responseId))
      }
      output = upstreamResponse?.output ? [...contextual.compactionItems, ...upstreamResponse.output] : accumulateEventOutput(output, event)
      if (upstreamResponse?.usage) {
        usage = normalizeUsage(upstreamResponse.usage)
        if (record.model.useProviderCost) providerCostMicros = providerReportedCostMicros(upstreamResponse.usage)
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
    await flushTelemetry(true)
    if (firstTokenTimer) { clearTimeout(firstTokenTimer); firstTokenTimer = undefined }
    await persistItems(responseId, output)
    const completedAt = new Date()
    await db.update(responses).set({
      status: 'completed', output, usage, lastSequence: sequence, completedAt, updatedAt: completedAt,
    }).where(eq(responses.id, responseId))
    if (usage) await settleBudget({ responseId, usage, latencyMs: Date.now() - startedAt, costMicrosOverride: providerCostMicros })
    else await releaseBudget(responseId)
    await runPostResponseTasks(record, record, output, requestLog.id).catch((error) => {
      console.warn(JSON.stringify({ level: 'warn', service: 'pulpo-worker', event: 'post_response_tasks.failed', responseId, error: error instanceof Error ? error.message : String(error) }))
    })
    await db.update(chats).set({ updatedAt: completedAt }).where(eq(chats.id, record.response.chatId))
    const [completed] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (completed) await publishSnapshot(toSnapshot(completed))
  } catch (error) {
    await flushTelemetry(true).catch(() => undefined)
    if (firstTokenTimer) clearTimeout(firstTokenTimer)
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
      if (usage && usage.totalTokens > 0) await settleBudget({ responseId, usage, latencyMs: Date.now() - startedAt, costMicrosOverride: providerCostMicros })
      else await releaseBudget(responseId)
      const [terminal] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
      if (terminal) await publishSnapshot(toSnapshot(terminal))
    }
    if (!cancelled) throw new GenerationAttemptError(error instanceof Error ? error.message : 'Generation failed', sequence > generationStartSequence)
  }
}

function classifyError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (message.includes('compaction')) return 'worker'
  if (message.includes('rate') || message.includes('429')) return 'rate_limit'
  if (message.includes('timeout') || message.includes('timed out') || message.includes('abort')) return 'timeout'
  if (message.includes('budget') || message.includes('balance')) return 'budget'
  if (message.includes('validation') || message.includes('invalid')) return 'validation'
  if (/\b5\d\d\b/.test(message) || message.includes('fetch') || message.includes('network') || message.includes('connect')) return 'provider_http'
  if (message.includes('cancel')) return 'cancellation'
  return 'worker'
}

export async function processGeneration(responseId: string): Promise<void> {
  const [base] = await db.select({ response: responses, model: models, log: requestLogs, chatDeletedAt: chats.deletedAt })
    .from(responses)
    .innerJoin(chats, eq(chats.id, responses.chatId))
    .innerJoin(models, eq(responses.modelId, models.id))
    .innerJoin(requestLogs, eq(requestLogs.responseId, responses.id))
    .where(eq(responses.id, responseId)).limit(1)
  if (!base || ['completed', 'cancelled'].includes(base.response.status)) return
  if (base.chatDeletedAt) {
    const now = new Date()
    await db.update(responses).set({ status: 'cancelled', completedAt: now, updatedAt: now }).where(eq(responses.id, responseId))
    await releaseBudget(responseId)
    return
  }
  if (base.response.agentMode) {
    await processAgentGeneration(responseId)
    return
  }
  const [loggingRow] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'logging')).limit(1)
  const logging = parseLoggingSettings(loggingRow?.value)
  let model: typeof models.$inferSelect | undefined = base.model
  let fallbackFrom: string | null = null
  let lastError: unknown
  const visited = new Set<string>()

  while (model && visited.size < 8 && !visited.has(model.id)) {
    visited.add(model.id)
    if (await redis.get(`pulpo:model-sticky:${model.id}`) && model.fallbackModelId) {
      fallbackFrom = model.id
      ;[model] = await db.select().from(models).where(and(eq(models.id, model.fallbackModelId), eq(models.enabled, true))).limit(1)
      await db.update(requestLogs).set({ stickyFallbackUsed: true, fallbackUsed: true, currentModelId: model?.id ?? null, updatedAt: new Date() }).where(eq(requestLogs.id, base.log.id))
      await publishAdminUsage(base.log.id, true)
      continue
    }
    for (let attempt = 0; attempt <= model.maxRetries; attempt += 1) {
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
            inputTokens: usage?.inputTokens ?? 0, cachedInputTokens: usage?.cachedInputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0, reasoningTokens: usage?.reasoningTokens ?? 0,
            costMicros: Number(costRow?.cost ?? 0), completedAt: new Date(),
          }).where(eq(generationAttempts.id, attemptId))
          await tx.update(responses).set({ actualModelId: model!.id }).where(eq(responses.id, responseId))
          await tx.update(requestLogs).set({
            status: completed?.status ?? 'completed', actualModelId: model!.id, currentModelId: model!.id,
            inputTokens: usage?.inputTokens ?? 0, cachedInputTokens: usage?.cachedInputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0, reasoningTokens: usage?.reasoningTokens ?? 0,
            costMicros: Number(costRow?.cost ?? 0), durationMs,
            tokensPerSecond: durationMs > 0 ? ((usage?.outputTokens ?? 0) * 1000) / durationMs : null,
            responsePayload: logging.logDetailedPayloads ? { output: completed?.output ?? [], usage } : null,
            completedAt: new Date(), updatedAt: new Date(),
          }).where(eq(requestLogs.id, base.log.id))
        })
        if (model.slowStickyEnabled && model.stickyFallbackSeconds > 0 && durationMs >= model.slowStickyMinCompletionSeconds * 1000 && ((usage?.outputTokens ?? 0) * 1000) / Math.max(durationMs, 1) < model.slowStickyMinTokensPerSecond) {
          await redis.set(`pulpo:model-sticky:${model.id}`, 'slow_completion', 'EX', model.stickyFallbackSeconds)
        }
        await publishAdminUsage(base.log.id, true)
        return
      } catch (error) {
        lastError = error
        const category = classifyError(error)
        await db.update(generationAttempts).set({ status: 'failed', errorCategory: category, errorMessage: error instanceof Error ? error.message : String(error), durationMs: Date.now() - attemptStarted, completedAt: new Date() }).where(eq(generationAttempts.id, attemptId))
        if ((error instanceof GenerationAttemptError && error.outputStarted) || !['provider_http', 'rate_limit', 'timeout', 'worker'].includes(category)) { model = undefined; break }
        if (attempt < model.maxRetries && model.retryDelaySeconds > 0) await new Promise((resolve) => setTimeout(resolve, model!.retryDelaySeconds * 1000))
      }
    }
    if (!model) break
    if (model.stickyFallbackSeconds > 0) await redis.set(`pulpo:model-sticky:${model.id}`, classifyError(lastError), 'EX', model.stickyFallbackSeconds)
    fallbackFrom = model.id
    if (!model.fallbackModelId) { model = undefined; break }
    ;[model] = await db.select().from(models).where(and(eq(models.id, model.fallbackModelId), eq(models.enabled, true))).limit(1)
    await db.update(requestLogs).set({ fallbackUsed: true, currentModelId: model?.id ?? null, updatedAt: new Date() }).where(eq(requestLogs.id, base.log.id))
    await publishAdminUsage(base.log.id, true)
  }

  const message = lastError instanceof Error ? lastError.message : 'Generation failed'
  const category = classifyError(lastError)
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
