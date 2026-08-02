import { eq } from 'drizzle-orm'
import type { ResponseUsage } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { generationAttempts } from '../database/schema.js'
import { newId } from '../lib/ids.js'

export function modelCallUsage(usage: unknown): ResponseUsage {
  const value = (usage ?? {}) as Record<string, unknown>
  const inputDetails = (value.input_tokens_details ?? {}) as Record<string, unknown>
  const outputDetails = (value.output_tokens_details ?? {}) as Record<string, unknown>
  const inputTokens = Number(value.input_tokens ?? value.inputTokens ?? 0)
  const outputTokens = Number(value.output_tokens ?? value.outputTokens ?? 0)
  return {
    inputTokens,
    cachedInputTokens: Number(inputDetails.cached_tokens ?? value.cachedInputTokens ?? 0),
    outputTokens,
    reasoningTokens: Number(outputDetails.reasoning_tokens ?? value.reasoningTokens ?? 0),
    totalTokens: Number(value.total_tokens ?? value.totalTokens ?? inputTokens + outputTokens),
  }
}

export async function trackInternalModelCall<T extends { usage?: unknown; id?: string }>(input: {
  requestLogId: string
  modelId: string
  upstreamModelId: string
  purpose: 'compaction' | 'ocr' | 'title' | 'memory'
  invoke: () => Promise<T>
}): Promise<T> {
  const id = newId()
  const startedAt = Date.now()
  await db.insert(generationAttempts).values({
    id,
    requestLogId: input.requestLogId,
    modelId: input.modelId,
    upstreamModelId: input.upstreamModelId,
    source: 'tool',
    purpose: input.purpose,
    attempt: 1,
  })
  try {
    const result = await input.invoke()
    const usage = modelCallUsage(result.usage)
    await db.update(generationAttempts).set({
      status: 'completed',
      upstreamResponseId: result.id,
      durationMs: Date.now() - startedAt,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      completedAt: new Date(),
    }).where(eq(generationAttempts.id, id))
    return result
  } catch (error) {
    await db.update(generationAttempts).set({
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      completedAt: new Date(),
    }).where(eq(generationAttempts.id, id))
    throw error
  }
}
