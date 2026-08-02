import OpenAI, { toFile } from 'openai'
import { createHash } from 'node:crypto'
import { and, asc, eq, gt, isNull, ne, sql } from 'drizzle-orm'
import { applyResponseEventToSnapshot, type ResponseEvent, type ResponseUsage } from '@pulpo/contracts'
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
  ocrAttempts,
  ocrCacheEntries,
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
import { parseLoggingSettings, parseOcrSettings } from '../settings/application-settings.js'
import { processAgentGeneration } from '../agent/runner.js'
import { runPostResponseTasks } from './post-tasks.js'
import { trackInternalModelCall } from './model-calls.js'

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

async function prepareInputFiles(client: OpenAI, input: unknown[], model: typeof models.$inferSelect, requestLogId: string): Promise<unknown[]> {
  const [ocrRow, loggingRow] = await Promise.all([
    db.select().from(applicationSettings).where(eq(applicationSettings.key, 'ocr')).limit(1).then((rows) => rows[0]),
    db.select().from(applicationSettings).where(eq(applicationSettings.key, 'logging')).limit(1).then((rows) => rows[0]),
  ])
  const ocrSettings = parseOcrSettings(ocrRow?.value)
  const logging = parseLoggingSettings(loggingRow?.value)
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
        if (!ocrSettings.enabled || !model.interceptImagesWithOcr) {
          content.push({ type: 'input_image', image_url: dataUrl })
          continue
        }
        const attemptId = newId()
        const started = Date.now()
        const providerFingerprint = `${ocrSettings.providerMode}:${ocrSettings.providerConnectionId ?? ocrSettings.customBaseUrl}:${ocrSettings.model}`
        const checksum = createHash('sha256').update(providerFingerprint).update(bytes).digest('hex')
        try {
          const [cached] = ocrSettings.cacheEnabled ? await db.select().from(ocrCacheEntries).where(and(eq(ocrCacheEntries.checksum, checksum), gt(ocrCacheEntries.expiresAt, new Date()))).limit(1) : []
          let text = cached?.text
          let rawResponse: unknown
          if (!text) {
            let ocrClient: OpenAI
            if (ocrSettings.providerMode === 'existing' && ocrSettings.providerConnectionId) {
              const [provider] = await db.select().from(providerConnections).where(eq(providerConnections.id, ocrSettings.providerConnectionId)).limit(1)
              if (!provider) throw new Error('OCR provider is unavailable')
              ocrClient = new OpenAI({ apiKey: decryptSecret(provider.encryptedApiKey, getConfig().ENCRYPTION_KEY), baseURL: provider.baseUrl, timeout: provider.requestTimeoutMs })
            } else if (ocrSettings.customBaseUrl && ocrSettings.encryptedCustomApiKey) {
              ocrClient = new OpenAI({ apiKey: decryptSecret(ocrSettings.encryptedCustomApiKey, getConfig().ENCRYPTION_KEY), baseURL: ocrSettings.customBaseUrl })
            } else throw new Error('OCR provider is not configured')
            rawResponse = await trackInternalModelCall({
              requestLogId,
              modelId: model.id,
              upstreamModelId: ocrSettings.model,
              purpose: 'ocr',
              invoke: () => ocrClient.responses.create({ model: ocrSettings.model, instructions: ocrSettings.systemPrompt, input: [{ role: 'user', content: [{ type: 'input_image', image_url: dataUrl, detail: 'auto' }] }], store: false }),
            })
            text = (rawResponse as { output_text?: string }).output_text?.trim()
            if (!text) throw new Error('OCR returned no text')
            if (ocrSettings.cacheEnabled) await db.insert(ocrCacheEntries).values({ checksum, providerFingerprint, text, expiresAt: new Date(Date.now() + ocrSettings.cacheTtlSeconds * 1000) }).onConflictDoUpdate({ target: ocrCacheEntries.checksum, set: { text, expiresAt: new Date(Date.now() + ocrSettings.cacheTtlSeconds * 1000) } })
          }
          await db.insert(ocrAttempts).values({ id: attemptId, requestLogId, attachmentId: attachment.id, sourceChecksum: attachment.checksum, modelId: ocrSettings.model, status: 'completed', cached: Boolean(cached), requestPayload: logging.logDetailedPayloads ? { model: ocrSettings.model, input: dataUrl } : null, responsePayload: logging.logDetailedPayloads ? rawResponse : null, durationMs: Date.now() - started })
          await db.update(requestLogs).set({ ocrStatus: 'completed', updatedAt: new Date() }).where(eq(requestLogs.id, requestLogId))
          content.push({ type: 'input_text', text: `[OCR text from ${attachment.originalName}]\n${text}` })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'OCR failed'
          await db.insert(ocrAttempts).values({ id: attemptId, requestLogId, attachmentId: attachment.id, sourceChecksum: attachment.checksum, modelId: ocrSettings.model, status: 'failed', errorMessage: message, durationMs: Date.now() - started })
          await db.update(requestLogs).set({ ocrStatus: 'failed', updatedAt: new Date() }).where(eq(requestLogs.id, requestLogId))
          content.push({ type: 'input_text', text: `[OCR error for ${attachment.originalName}: ${message}]` })
        }
        await publishAdminUsage(requestLogId, true)
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
  return prepared
}

async function contextualInput(client: OpenAI, record: { response: typeof responses.$inferSelect; model: typeof models.$inferSelect }, history: Array<typeof responses.$inferSelect>, requestLogId: string): Promise<unknown[]> {
  const [preferences] = await db.select().from(userPreferences).where(eq(userPreferences.userId, record.response.userId)).limit(1)
  const values = (preferences?.values ?? {}) as { customInstructions?: string; memoryEnabled?: boolean }
  const enabledMemories = values.memoryEnabled
    ? await db.select().from(memories).where(and(eq(memories.userId, record.response.userId), eq(memories.enabled, true)))
    : []
  const [interfaceSetting] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'interface')).limit(1)
  const task = (interfaceSetting?.value ?? {}) as { compaction?: boolean; compactionTokens?: number }
  let conversation = history.flatMap((turn) => [...(turn.input as unknown[]), ...(turn.output as unknown[])])
  const threshold = Math.max(2_000, task.compactionTokens ?? 12_000)
  const estimatedTokens = JSON.stringify(conversation).length / 4
  if (task.compaction !== false && estimatedTokens > threshold && conversation.length > 4) {
    const retained = conversation.slice(-4)
    const older = conversation.slice(0, -4)
    const summaryResponse = await trackInternalModelCall({
      requestLogId,
      modelId: record.model.id,
      upstreamModelId: record.model.upstreamModelId,
      purpose: 'compaction',
      invoke: () => client.responses.create({
        model: record.model.upstreamModelId,
        input: [{ role: 'user', content: `Summarize this earlier conversation faithfully for context. Preserve decisions, facts, code constraints, and unresolved tasks.\n\n${JSON.stringify(older)}` }],
        store: false,
        max_output_tokens: Math.min(2_000, record.model.maxOutputTokens),
      }),
    })
    conversation = [{ role: 'developer', content: `Summary of earlier conversation:\n${summaryResponse.output_text}` }, ...retained]
  }
  const context: unknown[] = []
  if (record.model.systemPrompt.trim()) context.push({ role: 'developer', content: record.model.systemPrompt.trim() })
  if (values.customInstructions?.trim()) context.push({ role: 'developer', content: `User-provided custom instructions:\n${values.customInstructions.trim()}` })
  if (enabledMemories.length) context.push({ role: 'developer', content: `User-approved memories:\n${enabledMemories.map((memory) => `- ${memory.content}`).join('\n')}` })
  return [...context, ...conversation, ...(record.response.input as unknown[])]
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
          recoveredOutput = upstreamResponse?.output ?? accumulateEventOutput(recoveredOutput, event)
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
        const output = recovered.output as unknown[]
        const usage = normalizeUsage(recovered.usage)
        const status = recovered.status === 'completed' ? 'completed'
          : recovered.status === 'cancelled' ? 'cancelled'
            : recovered.status === 'incomplete' ? 'incomplete' : 'failed'
        await persistItems(responseId, output)
        const completedAt = new Date()
        await db.update(responses).set({
          status, output, usage, completedAt, updatedAt: completedAt,
          error: recovered.error ? { message: recovered.error.message, code: recovered.error.code } : null,
        }).where(eq(responses.id, responseId))
        if (usage.totalTokens > 0) await settleBudget({ responseId, usage, latencyMs: Date.now() - startedAt })
        else await releaseBudget(responseId)
        if (status === 'completed') {
          const [requestLog] = await db.select({ id: requestLogs.id }).from(requestLogs).where(eq(requestLogs.responseId, responseId)).limit(1)
          if (requestLog) await runPostResponseTasks(client, record, output, requestLog.id).catch(() => undefined)
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
    .orderBy(asc(responses.createdAt))
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
  const input = await prepareInputFiles(client, await contextualInput(client, record, history, requestLog.id), record.model, requestLog.id)
  let sequence = record.response.lastSequence
  let output = record.response.output as unknown[]
  let usage: ResponseUsage | null = null
  let upstreamResponseId = record.response.openaiResponseId
  let lastSnapshotAt = 0
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
      output = upstreamResponse?.output ?? accumulateEventOutput(output, event)
      if (upstreamResponse?.usage) usage = normalizeUsage(upstreamResponse.usage)
      await publishResponseEvent(event)
      await db.update(requestLogs).set({ eventCount: sql`${requestLogs.eventCount} + 1`, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, updatedAt: new Date() }).where(eq(requestLogs.id, requestLog.id))
      await publishAdminUsage(requestLog.id)
      const snapshotDue = Date.now() - lastSnapshotAt >= config.RESPONSE_SNAPSHOT_INTERVAL_MS
      const itemBoundary = upstream.type.endsWith('.done') || upstream.type === 'response.completed'
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
    if (firstTokenTimer) { clearTimeout(firstTokenTimer); firstTokenTimer = undefined }
    await persistItems(responseId, output)
    const completedAt = new Date()
    await db.update(responses).set({
      status: 'completed', output, usage, lastSequence: sequence, completedAt, updatedAt: completedAt,
    }).where(eq(responses.id, responseId))
    if (usage) await settleBudget({ responseId, usage, latencyMs: Date.now() - startedAt })
    else await releaseBudget(responseId)
    await runPostResponseTasks(client, record, output, requestLog.id).catch((error) => {
      console.warn(JSON.stringify({ level: 'warn', service: 'pulpo-worker', event: 'post_response_tasks.failed', responseId, error: error instanceof Error ? error.message : String(error) }))
    })
    await db.update(chats).set({ updatedAt: completedAt }).where(eq(chats.id, record.response.chatId))
    const [completed] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (completed) await publishSnapshot(toSnapshot(completed))
  } catch (error) {
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
      if (usage && usage.totalTokens > 0) await settleBudget({ responseId, usage, latencyMs: Date.now() - startedAt })
      else await releaseBudget(responseId)
      const [terminal] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
      if (terminal) await publishSnapshot(toSnapshot(terminal))
    }
    if (!cancelled) throw new GenerationAttemptError(error instanceof Error ? error.message : 'Generation failed', sequence > record.response.lastSequence)
  }
}

function classifyError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (message.includes('rate') || message.includes('429')) return 'rate_limit'
  if (message.includes('timeout') || message.includes('timed out') || message.includes('abort')) return 'timeout'
  if (message.includes('budget') || message.includes('balance')) return 'budget'
  if (message.includes('validation') || message.includes('invalid')) return 'validation'
  if (/\b5\d\d\b/.test(message) || message.includes('fetch') || message.includes('network') || message.includes('connect')) return 'provider_http'
  if (message.includes('cancel')) return 'cancellation'
  return 'worker'
}

export async function processGeneration(responseId: string): Promise<void> {
  const [base] = await db.select({ response: responses, model: models, log: requestLogs })
    .from(responses).innerJoin(models, eq(responses.modelId, models.id)).innerJoin(requestLogs, eq(requestLogs.responseId, responses.id))
    .where(eq(responses.id, responseId)).limit(1)
  if (!base || ['completed', 'cancelled'].includes(base.response.status)) return
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
