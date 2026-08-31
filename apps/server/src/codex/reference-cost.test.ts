import { describe, expect, it } from 'vitest'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { codexInferenceReferenceCostMicros } from './reference-cost.js'

describe('codexInferenceReferenceCostMicros', () => {
  const model = openaiCodexProvider().getModels().find((candidate) => candidate.id === 'gpt-5.4')!

  it('calculates API-equivalent value without changing Pulpo billing prices', () => {
    expect(codexInferenceReferenceCostMicros(model, {
      inputTokens: 100_000,
      cachedInputTokens: 40_000,
      cacheWriteTokens: 0,
      outputTokens: 10_000,
      reasoningTokens: 2_000,
      totalTokens: 110_000,
    })).toBe(310_000)
  })

  it('applies the request-wide long-context tier from the pinned catalog', () => {
    expect(codexInferenceReferenceCostMicros(model, {
      inputTokens: 300_000,
      cachedInputTokens: 100_000,
      cacheWriteTokens: 0,
      outputTokens: 10_000,
      reasoningTokens: 0,
      totalTokens: 310_000,
    })).toBe(1_275_000)
  })
})
