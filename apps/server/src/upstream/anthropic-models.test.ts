import { describe, expect, it } from 'vitest'
import { anthropicEffort, anthropicModelCapabilities, claudeModelVersion, thinkingBudget } from './anthropic-models.js'

function capabilities(id: string) {
  const value = anthropicModelCapabilities(id)
  return { ...value, efforts: [...value.efforts].sort() }
}

describe('claudeModelVersion', () => {
  it.each([
    ['claude-opus-5-5', { family: 'opus', major: 5, minor: 5 }],
    ['claude-sonnet-4-5-20250929', { family: 'sonnet', major: 4, minor: 5 }],
    ['claude-haiku-4-5-20251001', { family: 'haiku', major: 4, minor: 5 }],
    ['claude-opus-4-20250514', { family: 'opus', major: 4, minor: 0 }],
    ['claude-opus-4-1', { family: 'opus', major: 4, minor: 1 }],
    ['anthropic.claude-opus-4-8-v1:0', { family: 'opus', major: 4, minor: 8 }],
    ['us.anthropic.claude-sonnet-4-6', { family: 'sonnet', major: 4, minor: 6 }],
    ['claude-opus-4-5@20251101', { family: 'opus', major: 4, minor: 5 }],
    ['Claude-Fable-1', { family: 'fable', major: 1, minor: 0 }],
    ['claude-3-7-sonnet-20250219', { family: 'sonnet', major: 3, minor: 7 }],
    ['claude-3.5-haiku', { family: 'haiku', major: 3, minor: 5 }],
    ['claude-3-opus-20240229', { family: 'opus', major: 3, minor: 0 }],
    ['some-other-model', undefined],
    ['notclaude-opus-4-6', undefined],
  ])('parses %s', (id, expected) => {
    expect(claudeModelVersion(id)).toEqual(expected)
  })

  // BUG: Bedrock global cross-region inference profiles use a six-letter
  // `global.` prefix, which the `[a-z]{2,4}` prefix pattern does not strip.
  it('parses Bedrock global inference profile ids', () => {
    expect(claudeModelVersion('global.anthropic.claude-sonnet-4-5-20250929-v1:0')).toEqual({ family: 'sonnet', major: 4, minor: 5 })
  })

  // DOUBT: dotted modern ids (OpenRouter style) lose their minor version, while legacy ids accept dots.
  it('parses dotted modern ids such as anthropic/claude-opus-4.6', () => {
    expect(claudeModelVersion('anthropic/claude-opus-4.6')).toEqual({ family: 'opus', major: 4, minor: 6 })
  })
})

describe('anthropicModelCapabilities', () => {
  const base = ['high', 'low', 'medium']
  it.each([
    ['claude-fable-1', { adaptiveThinking: true, thinkingAlwaysOn: true, thinksByDefault: true, sampling: false, efforts: [...base, 'max', 'xhigh'].sort() }],
    ['claude-opus-4-5-20251101', { adaptiveThinking: false, thinkingAlwaysOn: false, thinksByDefault: false, sampling: true, efforts: base }],
    ['claude-opus-4-6', { adaptiveThinking: true, thinkingAlwaysOn: false, thinksByDefault: false, sampling: true, efforts: [...base, 'max'].sort() }],
    ['claude-opus-4-7', { adaptiveThinking: true, thinkingAlwaysOn: false, thinksByDefault: false, sampling: false, efforts: [...base, 'max', 'xhigh'].sort() }],
    ['claude-opus-5-5', { adaptiveThinking: true, thinkingAlwaysOn: true, thinksByDefault: true, sampling: false, efforts: [...base, 'max', 'xhigh'].sort() }],
    ['claude-sonnet-4-5', { adaptiveThinking: false, thinkingAlwaysOn: false, thinksByDefault: false, sampling: true, efforts: base }],
    ['claude-sonnet-4-6', { adaptiveThinking: true, thinkingAlwaysOn: false, thinksByDefault: false, sampling: true, efforts: [...base, 'max'].sort() }],
    ['claude-sonnet-5', { adaptiveThinking: true, thinkingAlwaysOn: false, thinksByDefault: true, sampling: false, efforts: [...base, 'max', 'xhigh'].sort() }],
    ['claude-sonnet-5-5', { adaptiveThinking: true, thinkingAlwaysOn: true, thinksByDefault: true, sampling: false, efforts: [...base, 'max', 'xhigh'].sort() }],
    ['claude-haiku-4-5', { adaptiveThinking: false, thinkingAlwaysOn: false, thinksByDefault: false, sampling: true, efforts: base }],
    ['glm-4.6', { adaptiveThinking: false, thinkingAlwaysOn: false, thinksByDefault: false, sampling: true, efforts: base }],
  ])('%s', (id, expected) => {
    expect(capabilities(id)).toEqual(expected)
  })

  it('thinks by default from Opus 5 and Sonnet 5 onward', () => {
    expect(anthropicModelCapabilities('claude-opus-5').thinksByDefault).toBe(true)
    expect(anthropicModelCapabilities('claude-opus-5').thinkingAlwaysOn).toBe(false)
    expect(anthropicModelCapabilities('claude-opus-4-8').thinksByDefault).toBe(false)
    expect(anthropicModelCapabilities('claude-mythos-1').thinksByDefault).toBe(true)
  })
})

describe('anthropicEffort', () => {
  it('maps Responses efforts onto supported levels', () => {
    const modern = anthropicModelCapabilities('claude-opus-4-7')
    const legacy = anthropicModelCapabilities('claude-haiku-4-5')
    expect(anthropicEffort('none', modern)).toBe('low')
    expect(anthropicEffort('minimal', modern)).toBe('low')
    expect(anthropicEffort('medium', legacy)).toBe('medium')
    expect(anthropicEffort('xhigh', modern)).toBe('xhigh')
    expect(anthropicEffort('max', modern)).toBe('max')
    expect(anthropicEffort('xhigh', legacy)).toBe('high')
    expect(anthropicEffort('max', legacy)).toBe('high')
    expect(anthropicEffort('xhigh', anthropicModelCapabilities('claude-opus-4-6'))).toBe('high')
    expect(anthropicEffort('weird', modern)).toBe('medium')
  })
})

describe('thinkingBudget', () => {
  it('stays within [1024, max_tokens - 1024]', () => {
    expect(thinkingBudget('minimal', 64_000)).toBe(1_024)
    expect(thinkingBudget('low', 64_000)).toBe(2_048)
    expect(thinkingBudget('medium', 64_000)).toBe(8_192)
    expect(thinkingBudget('high', 64_000)).toBe(16_384)
    expect(thinkingBudget('max', 64_000)).toBe(32_000)
    expect(thinkingBudget('unknown', 64_000)).toBe(8_192)
    expect(thinkingBudget('high', 4_096)).toBe(3_072)
    expect(thinkingBudget('low', 2_048)).toBe(1_024)
    expect(thinkingBudget('low', 2_047)).toBeUndefined()
  })
})
