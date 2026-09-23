import { describe, expect, it } from 'vitest'
import { modelChartColors } from './usage-chart-colors'

describe('usage chart model colors', () => {
  it('keeps colors tied to model identity when metric rankings change', () => {
    const tokenRanking = ['gpt-5.6-luna', 'gpt-5.6-sol', 'claude-opus-4.1']
    const usdRanking = ['claude-opus-4.1', 'gpt-5.6-sol', 'gpt-5.6-luna']

    const tokenColors = modelChartColors(tokenRanking)
    const usdColors = modelChartColors(usdRanking)

    for (const modelId of tokenRanking) expect(usdColors.get(modelId)).toBe(tokenColors.get(modelId))
  })

  it('gives models whose ids hash to the same slot distinct colors', () => {
    // glm-5.3-flash / gpt-5.6-sol and glm-5.2 / muse-glimmer-30b / deepseek-v4-flash share hash slots
    const models = [
      'glm-5.3-flash',
      'gpt-5.6-luna',
      'glm-5.3-flash-fireworks',
      'glm-5.2',
      'muse-glimmer-30b',
      'gpt-5.6-sol',
      'deepseek-v4.1-flash',
      'deepseek-v4-flash',
    ]
    const colors = modelChartColors(models)

    expect(colors.size).toBe(models.length)
    expect(new Set(colors.values()).size).toBe(models.length)
  })
})
