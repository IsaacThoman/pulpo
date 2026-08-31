import { describe, expect, it } from 'vitest'
import {
  COMPACTION_CONTEXT_SAFETY_TOKENS,
  COMPACTION_MIN_THRESHOLD_TOKENS,
  maximumCompactionThreshold,
  shouldCompactContext,
} from './compaction-policy.js'

describe('compaction policy', () => {
  it('reserves context space while keeping the minimum valid threshold', () => {
    expect(maximumCompactionThreshold(128_000)).toBe(128_000 - COMPACTION_CONTEXT_SAFETY_TOKENS)
    expect(maximumCompactionThreshold(4_500)).toBe(COMPACTION_MIN_THRESHOLD_TOKENS)
  })

  it('compacts only above the threshold when older units exist', () => {
    const base = { enabled: true, thresholdTokens: 10_000, unitCount: 5, retainedUnits: 2 }
    expect(shouldCompactContext({ ...base, estimatedTokens: 10_000 })).toBe(false)
    expect(shouldCompactContext({ ...base, estimatedTokens: 10_001 })).toBe(true)
    expect(shouldCompactContext({ ...base, estimatedTokens: 10_001, unitCount: 2 })).toBe(false)
    expect(shouldCompactContext({ ...base, estimatedTokens: 10_001, enabled: false })).toBe(false)
  })

  it('supports forced mid-run checks without bypassing enablement or retention', () => {
    expect(shouldCompactContext({ enabled: true, force: true, estimatedTokens: 1, thresholdTokens: 10_000, unitCount: 3, retainedUnits: 2 })).toBe(true)
    expect(shouldCompactContext({ enabled: false, force: true, estimatedTokens: 20_000, thresholdTokens: 10_000, unitCount: 3, retainedUnits: 2 })).toBe(false)
  })
})
