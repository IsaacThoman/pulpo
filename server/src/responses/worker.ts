import OpenAI from 'openai'
import { and, asc, eq, ne } from 'drizzle-orm'
import type { ResponseEvent, ResponseUsage } from '@pulpo/contracts'
import { db } from '../database/client.js'
import {
  chats,
  models,
  notifications,
  providerConnections,
  responseContentParts,
  responseItems,
  responses,
} from '../database/schema.js'
import { decryptSecret } from '../lib/crypto.js'
import { getConfig } from '../config.js'
import { newId } from '../lib/ids.js'
import { isCancellationRequested, publishResponseEvent, publishSnapshot } from './events.js'
import { releaseBudget, settleBudget } from '../accounting/service.js'
import { toSnapshot } from './service.js'

type UpstreamEvent = { type: string; [key: string]: unknown }

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

function previewFromOutput(output: unknown[]): string {
  for (const item of output) {
    const content = (item as { content?: Array<{ type?: string; text?: string }> }).content
    const text = content?.find((part) => part.type === 'output_text')?.text
    if (text) return text.slice(0, 160)
  }
  return 'Response completed'
}

export async function processGeneration(
  responseId: string,
  options: { willRetry?: boolean } = {},
): Promise<void> {
  const startedAt = Date.now()
  const [record] = await db
    .select({ response: responses, model: models, provider: providerConnections })
    .from(responses)
    .innerJoin(models, eq(responses.modelId, models.id))
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
  const history = await db
    .select()
    .from(responses)
    .where(and(eq(responses.chatId, record.response.chatId), ne(responses.id, responseId)))
    .orderBy(asc(responses.createdAt))
  const input = [
    ...history.flatMap((turn) => [...(turn.input as unknown[]), ...(turn.output as unknown[])]),
    ...(record.response.input as unknown[]),
  ]
  let sequence = record.response.lastSequence
  let output = record.response.output as unknown[]
  let usage: ResponseUsage | null = null
  let lastSnapshotAt = 0
  const controller = new AbortController()
  await db.update(responses).set({ status: 'in_progress', startedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, responseId))
  try {
    const stream = await client.responses.create({
      model: record.model.upstreamModelId,
      input: input as never,
      stream: true,
      background: record.response.executionMode === 'background',
      store: false,
      metadata: { pulpo_response_id: responseId, pulpo_chat_id: record.response.chatId },
    }, { signal: controller.signal })
    for await (const rawEvent of stream) {
      if (await isCancellationRequested(responseId)) {
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
      const upstreamResponse = upstream.response as { id?: string; output?: unknown[]; usage?: unknown } | undefined
      if (upstreamResponse?.id) {
        await db.update(responses).set({ openaiResponseId: upstreamResponse.id }).where(eq(responses.id, responseId))
      }
      if (upstreamResponse?.output) output = upstreamResponse.output
      if (upstreamResponse?.usage) usage = normalizeUsage(upstreamResponse.usage)
      await publishResponseEvent(event)
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
    await persistItems(responseId, output)
    const completedAt = new Date()
    await db.update(responses).set({
      status: 'completed', output, usage, lastSequence: sequence, completedAt, updatedAt: completedAt,
    }).where(eq(responses.id, responseId))
    if (usage) await settleBudget({ responseId, usage, latencyMs: Date.now() - startedAt })
    else await releaseBudget(responseId)
    const preview = previewFromOutput(output)
    await db.insert(notifications).values({
      id: newId(),
      userId: record.response.userId,
      type: 'response.completed',
      title: 'Response complete',
      body: preview,
      data: { responseId, chatId: record.response.chatId },
    })
    await db.update(chats).set({ updatedAt: completedAt }).where(eq(chats.id, record.response.chatId))
    const [completed] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
    if (completed) await publishSnapshot(toSnapshot(completed))
  } catch (error) {
    const cancelled = await isCancellationRequested(responseId)
    const completedAt = new Date()
    await db.update(responses).set({
      status: cancelled ? 'cancelled' : options.willRetry ? 'queued' : 'failed',
      error: { message: error instanceof Error ? error.message : 'Generation failed' },
      lastSequence: sequence,
      completedAt: cancelled || !options.willRetry ? completedAt : null,
      updatedAt: completedAt,
    }).where(eq(responses.id, responseId))
    if (cancelled || !options.willRetry) await releaseBudget(responseId)
    if (!cancelled) throw error
  }
}
