import { eq } from 'drizzle-orm'
import type { ResponseUsage } from '@pulpo/contracts'
import { calculateCostMicros, calculateReservationMicros, type Pricing } from '../accounting/pricing.js'
import { extendBudgetReservationFixedCost, getActivePricing } from '../accounting/service.js'
import { db } from '../database/client.js'
import { generationAttempts } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { classifyGenerationError } from './fallback-policy.js'

export const EMPTY_USAGE: ResponseUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
}

export function isInsufficientBalanceError(error: unknown): boolean {
  return error instanceof AppError && error.code === 'insufficient_balance'
}

export function modelCallUsage(usage: unknown): ResponseUsage {
  const value = (usage ?? {}) as Record<string, unknown>
  const inputDetails = (value.input_tokens_details ?? {}) as Record<string, unknown>
  const outputDetails = (value.output_tokens_details ?? {}) as Record<string, unknown>
  const inputTokens = Number(value.input_tokens ?? value.inputTokens ?? 0)
  const outputTokens = Number(value.output_tokens ?? value.outputTokens ?? 0)
  return {
    inputTokens,
    cachedInputTokens: Number(inputDetails.cached_tokens ?? value.cachedInputTokens ?? 0),
    cacheWriteTokens: Number(inputDetails.cache_write_tokens ?? value.cacheWriteTokens ?? 0),
    outputTokens,
    reasoningTokens: Number(outputDetails.reasoning_tokens ?? value.reasoningTokens ?? 0),
    totalTokens: Number(value.total_tokens ?? value.totalTokens ?? inputTokens + outputTokens),
  }
}

export function providerReportedCostMicros(usage: unknown): number | undefined {
  const cost = (usage as { cost?: unknown } | null | undefined)?.cost
  if (typeof cost !== 'number') return undefined
  if (!Number.isFinite(cost) || cost < 0) return undefined
  return Math.round(cost * 1_000_000)
}

export async function trackInternalModelCall<T extends { usage?: unknown; id?: string }>(input: {
  requestLogId: string
  modelId: string
  upstreamModelId: string
  purpose: 'compaction' | 'ocr' | 'title' | 'memory'
  retryAttempt?: number
  pricing?: Pricing
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
    retryAttempt: input.retryAttempt ?? 1,
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
      cacheWriteTokens: usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      costMicros: input.pricing ? calculateCostMicros(usage, input.pricing) : 0,
      completedAt: new Date(),
    }).where(eq(generationAttempts.id, id))
    return result
  } catch (error) {
    await db.update(generationAttempts).set({
      status: 'failed',
      errorCategory: classifyGenerationError(error),
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      completedAt: new Date(),
    }).where(eq(generationAttempts.id, id))
    throw error
  }
}

export async function reserveInternalModelCall(input: {
  responseId: string
  modelId: string
  requestInput: unknown
  maxOutputTokens: number
  required?: boolean
}): Promise<boolean> {
  const pricing = await getActivePricing(input.modelId)
  try {
    await extendBudgetReservationFixedCost(
      input.responseId,
      calculateReservationMicros(input.requestInput, input.maxOutputTokens, pricing),
    )
    return true
  } catch (error) {
    if (!input.required && isInsufficientBalanceError(error)) return false
    throw error
  }
}

export async function trackBilledInternalModelCall<T extends { usage?: unknown; id?: string }>(input: {
  responseId: string
  requestLogId: string
  modelId: string
  upstreamModelId: string
  purpose: 'compaction' | 'ocr' | 'title' | 'memory'
  requestInput: unknown
  maxOutputTokens: number
  required?: boolean
  retryAttempt?: number
  invoke: () => Promise<T>
}): Promise<{ result: T; costMicros: number } | { skipped: true; costMicros: 0 }> {
  const reserved = await reserveInternalModelCall({
    responseId: input.responseId,
    modelId: input.modelId,
    requestInput: input.requestInput,
    maxOutputTokens: input.maxOutputTokens,
    required: input.required,
  })
  if (!reserved) return { skipped: true, costMicros: 0 }
  const pricing = await getActivePricing(input.modelId)
  const result = await trackInternalModelCall({
    requestLogId: input.requestLogId,
    modelId: input.modelId,
    upstreamModelId: input.upstreamModelId,
    purpose: input.purpose,
    retryAttempt: input.retryAttempt,
    pricing,
    invoke: input.invoke,
  })
  return { result, costMicros: calculateCostMicros(modelCallUsage(result.usage), pricing) }
}
