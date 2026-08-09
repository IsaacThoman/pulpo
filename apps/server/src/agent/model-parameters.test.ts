import { describe, expect, it } from 'vitest'
import { agentThinkingLevel } from './model-parameters.js'

describe('agent model parameters', () => {
  it('uses the configured Responses reasoning effort', () => {
    expect(agentThinkingLevel({ reasoning: { effort: 'high', summary: 'auto' } })).toBe('high')
    expect(agentThinkingLevel({ reasoning: { effort: 'max' } })).toBe('max')
  })

  it('keeps the current level for unsupported or omitted efforts', () => {
    expect(agentThinkingLevel({ reasoning: { effort: 'none' } }, 'low')).toBe('low')
    expect(agentThinkingLevel({}, 'xhigh')).toBe('xhigh')
  })
})
