import { describe, expect, it } from 'vitest'
import { modelChartColor } from './usage-chart-colors'

describe('usage chart model colors', () => {
  it('keeps colors tied to model identity when metric rankings change', () => {
    const tokenRanking = ['gpt-5.6-luna', 'gpt-5.6-sol', 'claude-opus-4.1']
    const usdRanking = ['claude-opus-4.1', 'gpt-5.6-sol', 'gpt-5.6-luna']

    const tokenColors = new Map(tokenRanking.map((modelId) => [modelId, modelChartColor(modelId)]))
    const usdColors = new Map(usdRanking.map((modelId) => [modelId, modelChartColor(modelId)]))

    for (const modelId of tokenRanking) expect(usdColors.get(modelId)).toBe(tokenColors.get(modelId))
  })
})
