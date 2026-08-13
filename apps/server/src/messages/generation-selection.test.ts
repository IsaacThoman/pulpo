import { describe, expect, it } from 'vitest'
import { resolveBranchGenerationSettings } from './generation-selection.js'

describe('branch generation settings', () => {
  const original = {
    executionMode: 'background' as const,
    presetSelections: { reasoning: 'low', verbosity: 'short' },
    agentMode: false,
  }

  it('uses the current UI selections for a new response branch', () => {
    expect(resolveBranchGenerationSettings(original, {
      modelId: 'model-2',
      presetSelections: { reasoning: 'high', verbosity: 'long' },
      agentMode: true,
    })).toEqual({
      executionMode: undefined,
      presetSelections: { reasoning: 'high', verbosity: 'long' },
      agentMode: true,
    })
  })

  it('retains stored values for older clients that omit generation selections', () => {
    expect(resolveBranchGenerationSettings(original, {})).toEqual(original)
  })
})
