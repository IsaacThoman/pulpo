import { describe, expect, it } from 'vitest'
import { agentThinkingLevel, resolveAgentModelParameters } from './model-parameters.js'

describe('agent model parameters', () => {
  it('uses the configured Responses reasoning effort', () => {
    expect(agentThinkingLevel({ reasoning: { effort: 'high', summary: 'auto' } })).toBe('high')
    expect(agentThinkingLevel({ reasoning: { effort: 'max' } })).toBe('max')
  })

  it('keeps the current level for unsupported or omitted efforts', () => {
    expect(agentThinkingLevel({ reasoning: { effort: 'none' } }, 'low')).toBe('low')
    expect(agentThinkingLevel({}, 'xhigh')).toBe('xhigh')
  })

  it('keeps selected reasoning while applying parameters from each active fallback model', () => {
    const flex = resolveAgentModelParameters(
      { allowedParameters: ['reasoning', 'service_tier'], defaultParameters: { reasoning: { effort: 'medium' }, service_tier: 'flex' } },
      { reasoning: { effort: 'high' } },
    )
    const standard = resolveAgentModelParameters(
      { allowedParameters: ['reasoning', 'service_tier'], defaultParameters: { service_tier: 'default' } },
      { reasoning: { effort: 'high' } },
      flex.reasoning,
    )

    expect(flex).toEqual({ parameters: { reasoning: { effort: 'high' }, service_tier: 'flex' }, reasoning: 'high' })
    expect(standard).toEqual({ parameters: { service_tier: 'default', reasoning: { effort: 'high' } }, reasoning: 'high' })
  })
})
