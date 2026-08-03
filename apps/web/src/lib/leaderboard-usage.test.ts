import { describe, expect, it } from 'vitest'
import { toDailyModelUsage } from './leaderboard-usage'

describe('leaderboard usage chart data', () => {
  it('combines model rows into daily settled totals', () => {
    expect(toDailyModelUsage([
      { day: '2026-08-01', modelId: 'model-a', calls: 2, inputTokens: 10, outputTokens: 20, costMicros: 250_000 },
      { day: '2026-08-01', modelId: 'other', calls: 1, inputTokens: 5, outputTokens: 5, costMicros: 100_000 },
    ])).toEqual([{
      date: '2026-08-01', calls: 3, tokens: 40, cost: 0.35,
      models: [
        { modelId: 'model-a', calls: 2, tokens: 30, cost: 0.25 },
        { modelId: 'other', calls: 1, tokens: 10, cost: 0.1 },
      ],
    }])
  })

  it('creates contribution-only rows without model segments', () => {
    expect(toDailyModelUsage([{ day: '2026-08-01', calls: 1, inputTokens: 2, outputTokens: 3, costMicros: 0 }]))
      .toMatchObject([{ date: '2026-08-01', calls: 1, tokens: 5, models: [] }])
  })
})
