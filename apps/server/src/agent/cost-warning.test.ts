import { describe, expect, it } from 'vitest'
import { costWarningItemId, nextCostWarning } from './cost-warning.js'

const responseId = '00000000-0000-4000-8000-000000000214'
const now = new Date('2026-09-24T00:00:00.000Z')

describe('Agent cost warnings', () => {
  it('stays quiet when disabled or below the threshold', () => {
    expect(nextCostWarning({ responseId, thresholdMicros: undefined, costMicros: 50_000_000, current: undefined, now })).toBeUndefined()
    expect(nextCostWarning({ responseId, thresholdMicros: 1_000_000, costMicros: 999_999, current: undefined, now })).toBeUndefined()
  })

  it('warns once the accrued cost reaches the threshold', () => {
    expect(nextCostWarning({ responseId, thresholdMicros: 1_000_000, costMicros: 1_000_000, current: undefined, now })).toEqual({
      id: costWarningItemId(responseId),
      type: 'pulpo_cost_warning',
      threshold_micros: 1_000_000,
      cost_micros: 1_000_000,
      triggered_at: now.toISOString(),
    })
  })

  it('updates an existing warning only when the cost rises', () => {
    const current = nextCostWarning({ responseId, thresholdMicros: 1_000_000, costMicros: 1_200_000, current: undefined, now })!
    expect(nextCostWarning({ responseId, thresholdMicros: 1_000_000, costMicros: 1_200_000, current })).toBeUndefined()
    expect(nextCostWarning({ responseId, thresholdMicros: undefined, costMicros: 1_500_000, current })).toEqual({
      ...current,
      cost_micros: 1_500_000,
    })
  })
})
