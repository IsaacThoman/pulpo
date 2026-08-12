import { describe, expect, it } from 'vitest'
import { AI_ICONS, isAiIconAvailable, providerIcon } from './ai-icons'

describe('AI icon availability', () => {
  it('makes the OpenAI logo available to lab and model pickers', () => {
    const openai = AI_ICONS.find((icon) => icon.id === 'openai')

    expect(openai).toBeDefined()
    expect(isAiIconAvailable(openai!, 'lab')).toBe(true)
    expect(isAiIconAvailable(openai!, 'model')).toBe(true)

    const modelLogoIds = AI_ICONS
      .filter((icon) => isAiIconAvailable(icon, 'model'))
      .map((icon) => icon.id)

    expect(modelLogoIds).toContain('openai')
  })

  it.each([
    ['MiniMax Labs', 'minimax'],
    ['Zhipu AI', 'zhipu'],
  ] as const)('maps %s to its lab icon', (provider, iconId) => {
    const icon = AI_ICONS.find((candidate) => candidate.id === iconId)

    expect(icon).toBeDefined()
    expect(isAiIconAvailable(icon!, 'lab')).toBe(true)
    expect(providerIcon(provider)).toBe(iconId)
  })

  it.each(['minimax-color', 'zhipu-color'])('makes %s available to model pickers', (iconId) => {
    const icon = AI_ICONS.find((candidate) => candidate.id === iconId)

    expect(icon).toBeDefined()
    expect(icon?.color).toBe(true)
    expect(isAiIconAvailable(icon!, 'model')).toBe(true)
  })
})
