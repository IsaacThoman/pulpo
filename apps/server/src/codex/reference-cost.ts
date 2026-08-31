import { calculateCost, type Api, type Model } from '@earendil-works/pi-ai'
import type { ResponseUsage } from '@pulpo/contracts'

/**
 * API-equivalent value of subscription-backed Codex inference.
 * Informational only: this must never be used for Pulpo settlement or balances.
 */
export function codexInferenceReferenceCostMicros(model: Model<Api>, usage: ResponseUsage): number {
  const cachedInputTokens = Math.min(usage.inputTokens, Math.max(0, usage.cachedInputTokens))
  const cacheWriteTokens = Math.min(
    usage.inputTokens - cachedInputTokens,
    Math.max(0, usage.cacheWriteTokens),
  )
  const uncachedInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens - cacheWriteTokens)
  const cost = calculateCost(model, {
    input: uncachedInputTokens,
    output: Math.max(0, usage.outputTokens),
    cacheRead: cachedInputTokens,
    cacheWrite: cacheWriteTokens,
    totalTokens: Math.max(0, usage.totalTokens),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  })
  return Math.max(0, Math.round(cost.total * 1_000_000))
}
