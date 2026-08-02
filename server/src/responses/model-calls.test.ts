import { describe, expect, it } from 'vitest'
import { modelCallUsage } from './model-calls.js'

describe('model-call usage normalization', () => {
  it('preserves per-turn token details for the admin usage feed', () => {
    expect(modelCallUsage({
      input_tokens: 120,
      input_tokens_details: { cached_tokens: 40 },
      output_tokens: 30,
      output_tokens_details: { reasoning_tokens: 10 },
      total_tokens: 150,
    })).toEqual({ inputTokens: 120, cachedInputTokens: 40, outputTokens: 30, reasoningTokens: 10, totalTokens: 150 })
  })
})
