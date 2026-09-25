import { describe, expect, it, vi } from 'vitest'

vi.mock('../redis.js', () => ({ redis: {} }))

const { costLimitItemId, costLimitPause, nextCostLimitMicros, waitForCostLimitDecision } = await import('./cost-limit.js')

const responseId = '00000000-0000-4000-8000-000000000214'
const now = new Date('2026-09-24T00:00:00.000Z')

describe('Agent cost limit pauses', () => {
  it('keeps running when disabled or below the limit', () => {
    expect(costLimitPause({ responseId, thresholdMicros: undefined, costMicros: 50_000_000, current: undefined, now })).toBeUndefined()
    expect(costLimitPause({ responseId, thresholdMicros: 1_000_000, costMicros: 999_999, current: undefined, now })).toBeUndefined()
  })

  it('pauses once the accrued cost reaches the limit', () => {
    expect(costLimitPause({ responseId, thresholdMicros: 1_000_000, costMicros: 1_020_000, current: undefined, agentTurn: 3, now })).toEqual({
      id: costLimitItemId(responseId),
      type: 'pulpo_cost_limit',
      status: 'awaiting_confirmation',
      threshold_micros: 1_000_000,
      limit_micros: 1_000_000,
      cost_micros: 1_020_000,
      paused_at: now.toISOString(),
      agent_turn: 3,
    })
  })

  it('pauses again at the next multiple of the limit after continuing', () => {
    const paused = costLimitPause({ responseId, thresholdMicros: 1_000_000, costMicros: 1_020_000, current: undefined, now })!
    const continued = { ...paused, status: 'continued' as const }
    expect(nextCostLimitMicros(1_020_000, 1_000_000)).toBe(2_000_000)
    expect(nextCostLimitMicros(3_500_000, 1_000_000)).toBe(4_000_000)
    expect(costLimitPause({ responseId, thresholdMicros: 1_000_000, costMicros: 1_900_000, current: continued, now })).toBeUndefined()
    expect(costLimitPause({ responseId, thresholdMicros: 1_000_000, costMicros: 2_100_000, current: continued, now })).toMatchObject({
      status: 'awaiting_confirmation', limit_micros: 2_000_000, cost_micros: 2_100_000,
    })
  })

  it('re-pauses at the same limit when a waiting run resumes', () => {
    const paused = costLimitPause({ responseId, thresholdMicros: 1_000_000, costMicros: 1_020_000, current: undefined, now })!
    expect(costLimitPause({ responseId, thresholdMicros: 1_000_000, costMicros: 1_020_000, current: paused, now })).toMatchObject({
      status: 'awaiting_confirmation', limit_micros: 1_000_000,
    })
  })
})

describe('waitForCostLimitDecision', () => {
  it('continues only on a confirmation for the current limit', async () => {
    const answers = ['1000000', null, '2000000']
    const clear = vi.fn(async () => undefined)
    const approval = { read: vi.fn(async () => answers.shift() ?? null), clear }
    await expect(waitForCostLimitDecision({ limitMicros: 2_000_000, approval, pollMs: 1 })).resolves.toBe('continue')
    expect(approval.read).toHaveBeenCalledTimes(3)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('stops when the run is aborted while waiting', async () => {
    const controller = new AbortController()
    const approval = { read: vi.fn(async () => null), clear: vi.fn(async () => undefined) }
    const decision = waitForCostLimitDecision({ limitMicros: 1_000_000, approval, signal: controller.signal, pollMs: 60_000 })
    await vi.waitFor(() => expect(approval.read).toHaveBeenCalled())
    controller.abort()
    await expect(decision).resolves.toBe('stopped')
  })
})
