import OpenAI, { toFile } from 'openai'
import { and, asc, eq, ne } from 'drizzle-orm'
import type { ResponseEvent, ResponseUsage } from '@pulpo/contracts'
import { db } from '../database/client.js'
import {
  chats,
  attachments,
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
import { getBlobStore } from '../storage/index.js'

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

async function prepareInputFiles(client: OpenAI, input: unknown[]): Promise<unknown[]> {
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
      let fileId = attachment.openaiFileId
      if (!fileId) {
        const bytes = await getBlobStore().get(attachment.objectKey)
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
  if (record.response.executionMode === 'background' && record.response.openaiResponseId) {
    const openaiResponseId = record.response.openaiResponseId
    await db.update(responses).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(responses.id, responseId))
    try {
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
        if (status === 'completed') await settleBudget({ responseId, usage, latencyMs: Date.now() - startedAt })
        else await releaseBudget(responseId)
        const [snapshot] = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
        if (snapshot) await publishSnapshot(toSnapshot(snapshot))
        return
      }
      throw new Error('Background response recovery timed out')
    } catch (error) {
      if (options.willRetry) throw error
      await db.update(responses).set({
        status: 'failed', error: { message: error instanceof Error ? error.message : 'Recovery failed' },
        completedAt: new Date(), updatedAt: new Date(),
      }).where(eq(responses.id, responseId))
      await releaseBudget(responseId)
      throw error
    }
  }
  const history = await db
    .select()
    .from(responses)
    .where(and(eq(responses.chatId, record.response.chatId), ne(responses.id, responseId)))
    .orderBy(asc(responses.createdAt))
  const input = await prepareInputFiles(client, [
    ...history.flatMap((turn) => [...(turn.input as unknown[]), ...(turn.output as unknown[])]),
    ...(record.response.input as unknown[]),
  ])
  let sequence = record.response.lastSequence
  let output = record.response.output as unknown[]
  let usage: ResponseUsage | null = null
  let upstreamResponseId = record.response.openaiResponseId
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
      const upstreamResponse = upstream.response as { id?: string; output?: unknown[]; usage?: unknown } | undefined
      if (upstreamResponse?.id) {
        upstreamResponseId = upstreamResponse.id
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
