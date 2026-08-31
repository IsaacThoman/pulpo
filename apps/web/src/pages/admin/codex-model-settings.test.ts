import { describe, expect, it } from 'vitest'
import {
  compactionContextPercent,
  managedCodexSettingsPatch,
  type ManagedCodexModelSettings,
  validManagedCodexSettings,
} from './codex-model-settings'

const model: ManagedCodexModelSettings = {
  id: 'codex:gpt-test', name: 'GPT Test', upstreamModelId: 'gpt-test', contextWindow: 200_000,
  maxOutputTokens: 32_000, compactionThresholdTokens: 100_000, compactionRetainedTurns: 4,
  maximumCompactionThresholdTokens: 195_904,
}

describe('managed Codex model settings', () => {
  it('shows the threshold as a percentage of context', () => {
    expect(compactionContextPercent(100_000, 200_000)).toBe(50)
    expect(compactionContextPercent(1, 0)).toBe(0)
  })

  it('validates the server-supported bounds', () => {
    expect(validManagedCodexSettings(model)).toBe(true)
    expect(validManagedCodexSettings({ ...model, compactionThresholdTokens: 196_000 })).toBe(false)
    expect(validManagedCodexSettings({ ...model, compactionRetainedTurns: 0 })).toBe(false)
  })

  it('builds a restricted patch without managed model fields', () => {
    expect(managedCodexSettingsPatch(model)).toEqual({
      compactionThresholdTokens: 100_000,
      compactionRetainedTurns: 4,
    })
  })
})
