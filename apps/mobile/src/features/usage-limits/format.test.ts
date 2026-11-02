import { describe, expect, it } from 'vitest'
import type { UsageLimits } from '@pulpo/contracts'
import { planName, remainingLabel, usageLimitRows } from './format'

const bar = { remainingPercentage: 60, availableBarPercentage: 60, pendingBarPercentage: 10 }
const at = (iso: string, options: Intl.DateTimeFormatOptions) => `Resets ${new Date(iso).toLocaleString('en-US', options)}`

describe('usage limit rows', () => {
  it('lists weekly, five-hour, then custom limits with their reset times', () => {
    const limits: UsageLimits = {
      plan: 'eight',
      weekly: { ...bar, resetsAt: '2026-11-09T00:00:00.000Z' },
      fiveHour: { ...bar, remainingPercentage: 40, resetsAt: '2026-11-02T15:00:00.000Z' },
      custom: [
        { ...bar, id: 'daily', name: 'Opus daily', period: 'daily', coversExtras: false, models: ['Claude Opus', 'Claude Sonnet'], resetsAt: '2026-11-03T00:00:00.000Z' },
        { ...bar, id: 'rolling', name: 'Burst', period: 'five_hour', coversExtras: true, models: [], resetsAt: null },
      ],
    }
    expect(usageLimitRows(limits, 'en-US')).toEqual([
      { key: 'weekly', label: 'Weekly usage', ...bar, reset: at('2026-11-09T00:00:00.000Z', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) },
      { key: 'five-hour', label: '5-hour usage', ...bar, remainingPercentage: 40, reset: at('2026-11-02T15:00:00.000Z', { hour: 'numeric', minute: '2-digit' }) },
      {
        key: 'custom-daily', label: 'Opus daily', ...bar,
        reset: at('2026-11-03T00:00:00.000Z', { hour: 'numeric', minute: '2-digit' }),
        hint: 'Applies to Claude Opus, Claude Sonnet · Model usage only, not tools or workspace time',
      },
      { key: 'custom-rolling', label: 'Burst', ...bar, reset: 'Rolling 5-hour window' },
    ])
  })

  it('waits for first use before a five-hour window has a reset time', () => {
    const [row] = usageLimitRows({ plan: 'fat', weekly: null, fiveHour: { ...bar, resetsAt: null }, custom: [] })
    expect(row).toMatchObject({ key: 'five-hour', reset: 'Starts on first use' })
  })

  it('has no rows for a plan without limits', () => {
    expect(usageLimitRows({ plan: 'baby', weekly: null, fiveHour: null, custom: [] })).toEqual([])
  })

  it('names plans and remaining usage without amounts', () => {
    expect(['baby', 'eight', 'fat'].map(plan => planName(plan as UsageLimits['plan']))).toEqual(['Pulpo Baby', 'Pulpo Eight', 'Pulpo Fat'])
    expect(remainingLabel({ remainingPercentage: 7 })).toBe('7% left')
  })
})
