import { describe, expect, it } from 'vitest'
import { AI_ICONS, isAiIconAvailable } from './ai-icons'

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
})
