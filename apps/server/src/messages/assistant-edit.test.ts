import { describe, expect, it } from 'vitest'
import { assistantEditInheritedValues, type AssistantEditSource } from './assistant-edit.js'

function source(agentMode: boolean): AssistantEditSource {
  return {
    modelId: 'model',
    pricingVersionId: null,
    parentResponseId: null,
    userMessageId: null,
    executionMode: 'stream',
    agentMode,
    input: [],
    instructions: null,
    presetSelections: {},
    parameters: {},
  }
}

describe('assistant edit inheritance', () => {
  it('preserves Agent mode for edited response branches', () => {
    expect(assistantEditInheritedValues(source(true)).agentMode).toBe(true)
    expect(assistantEditInheritedValues(source(false)).agentMode).toBe(false)
  })
})
