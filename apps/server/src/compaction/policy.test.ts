import { describe, expect, it } from 'vitest'
import {
  COMPACTION_MIN_THRESHOLD_TOKENS,
  autoCompactLimit,
  effectiveRetainedUserTokens,
  hardContextLimit,
  maximumCompactionThreshold,
  shouldAutoCompact,
  SUMMARY_MAX_OUTPUT_TOKENS,
  summaryMaxOutputTokens,
} from './policy.js'

describe('compaction policy', () => {
  it('clamps the admin threshold to 90% of the context window', () => {
    // Codex pin: a 272k window compacts at 244,800 even when 250k is configured.
    expect(autoCompactLimit(250_000, 272_000)).toBe(244_800)
    expect(autoCompactLimit(100_000, 272_000)).toBe(100_000)
    expect(autoCompactLimit(1_000_000, 128_000)).toBe(115_200)
  })

  it('never returns a limit below one token', () => {
    expect(autoCompactLimit(0, 128_000)).toBe(1)
    expect(autoCompactLimit(10_000, 0)).toBe(1)
  })

  it('treats 95% of the window as full', () => {
    expect(hardContextLimit(200_000)).toBe(190_000)
    expect(hardContextLimit(1_001)).toBe(950)
  })

  it('caps the admin threshold at 90% of the window but keeps the minimum valid', () => {
    expect(maximumCompactionThreshold(128_000)).toBe(115_200)
    expect(maximumCompactionThreshold(1_000)).toBe(COMPACTION_MIN_THRESHOLD_TOKENS)
  })

  it('caps the summary output at the model maximum', () => {
    expect(summaryMaxOutputTokens(128_000)).toBe(SUMMARY_MAX_OUTPUT_TOKENS)
    expect(summaryMaxOutputTokens(4_096)).toBe(4_096)
  })

  it('keeps retained user tokens to a quarter of the limit', () => {
    expect(effectiveRetainedUserTokens(20_000, 200_000)).toBe(20_000)
    expect(effectiveRetainedUserTokens(20_000, 30_000)).toBe(7_500)
    expect(effectiveRetainedUserTokens(0, 200_000)).toBe(0)
  })

  it('compacts at or above the limit when enabled', () => {
    expect(shouldAutoCompact({ enabled: true, tokens: 99, limit: 100 })).toBe(false)
    expect(shouldAutoCompact({ enabled: true, tokens: 100, limit: 100 })).toBe(true)
    expect(shouldAutoCompact({ enabled: false, tokens: 1_000, limit: 100 })).toBe(false)
  })
})
