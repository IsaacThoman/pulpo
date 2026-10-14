import { describe, expect, it } from 'vitest'
import {
  compactionContextPercent,
  managedCodexSettingsPatch,
  type ManagedCodexModelSettings,
  validManagedCodexSettings,
} from './codex-model-settings'

const model: ManagedCodexModelSettings = {
  id: 'codex:gpt-test', name: 'GPT Test', upstreamModelId: 'gpt-test', contextWindow: 200_000,
  maxOutputTokens: 32_000, minimumOutputReservationTokens: 8_000, compactionThresholdTokens: 100_000, compactionRetainedUserTokens: 20_000,
  maximumCompactionThresholdTokens: 180_000,
}

describe('managed Codex model settings', () => {
  it('shows the threshold as a percentage of context', () => {
    expect(compactionContextPercent(100_000, 200_000)).toBe(50)
    expect(compactionContextPercent(1, 0)).toBe(0)
  })

  it('validates the server-supported bounds', () => {
    expect(validManagedCodexSettings(model)).toBe(true)
    expect(validManagedCodexSettings({ ...model, minimumOutputReservationTokens: 0 })).toBe(false)
    expect(validManagedCodexSettings({ ...model, minimumOutputReservationTokens: 1_500 })).toBe(true)
    expect(validManagedCodexSettings({ ...model, compactionThresholdTokens: 180_001 })).toBe(false)
    expect(validManagedCodexSettings({ ...model, compactionRetainedUserTokens: 0 })).toBe(true)
    expect(validManagedCodexSettings({ ...model, compactionRetainedUserTokens: 100_000 })).toBe(true)
    expect(validManagedCodexSettings({ ...model, compactionRetainedUserTokens: 100_001 })).toBe(false)
    expect(validManagedCodexSettings({ ...model, compactionRetainedUserTokens: -1 })).toBe(false)
    expect(validManagedCodexSettings({ ...model, compactionRetainedUserTokens: 1.5 })).toBe(false)
  })

  it('builds a restricted patch without managed model fields', () => {
    expect(managedCodexSettingsPatch(model)).toEqual({
      minimumOutputReservationTokens: 8_000,
      compactionThresholdTokens: 100_000,
      compactionRetainedUserTokens: 20_000,
    })
  })
})
