import { describe, expect, it } from 'vitest'
import { modelCallUsage, providerReportedCostMicros } from './model-calls.js'

describe('model-call usage normalization', () => {
  it('preserves per-turn token details for the admin usage feed', () => {
    expect(modelCallUsage({
      input_tokens: 120,
      input_tokens_details: { cached_tokens: 40, cache_write_tokens: 20 },
      output_tokens: 30,
      output_tokens_details: { reasoning_tokens: 10 },
      total_tokens: 150,
    })).toEqual({ inputTokens: 120, cachedInputTokens: 40, cacheWriteTokens: 20, outputTokens: 30, reasoningTokens: 10, totalTokens: 150 })
  })
})

describe('provider-reported cost normalization', () => {
  it('converts a USD usage cost to integer micros', () => {
    expect(providerReportedCostMicros({ cost: 0.00005 })).toBe(50)
  })

  it('accepts zero but ignores missing, negative, and non-numeric costs', () => {
    expect(providerReportedCostMicros({ cost: 0 })).toBe(0)
    expect(providerReportedCostMicros({})).toBeUndefined()
    expect(providerReportedCostMicros({ cost: -1 })).toBeUndefined()
    expect(providerReportedCostMicros({ cost: 'not-a-number' })).toBeUndefined()
  })
})
