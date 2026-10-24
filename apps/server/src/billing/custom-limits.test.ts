import { describe, expect, it } from 'vitest'
import {
  customLimitAppliesToModels,
  customLimitAppliesToUser,
  customLimitMessage,
  customLimitPeriodStart,
  customLimitResetAt,
  tightestCustomLimit,
  type CustomLimitUsage,
} from './custom-limits.js'

const base = { enabled: true, target: 'everyone', plans: [] as string[], userIds: [] as string[] }
const member = { userId: 'user-1', role: 'user', plan: 'eight' as const }

describe('custom limit audiences', () => {
  it('covers everyone except admins', () => {
    expect(customLimitAppliesToUser(base, member)).toBe(true)
    expect(customLimitAppliesToUser(base, { ...member, role: 'admin' })).toBe(false)
    expect(customLimitAppliesToUser({ ...base, enabled: false }, member)).toBe(false)
  })

  it('covers the chosen plans', () => {
    const limit = { ...base, target: 'plans', plans: ['baby', 'fat'] }
    expect(customLimitAppliesToUser(limit, member)).toBe(false)
    expect(customLimitAppliesToUser(limit, { ...member, plan: 'fat' })).toBe(true)
    expect(customLimitAppliesToUser(limit, { ...member, plan: 'fat', role: 'admin' })).toBe(false)
  })

  it('covers named users, including admins', () => {
    const limit = { ...base, target: 'users', userIds: ['user-1'] }
    expect(customLimitAppliesToUser(limit, member)).toBe(true)
    expect(customLimitAppliesToUser(limit, { ...member, role: 'admin' })).toBe(true)
    expect(customLimitAppliesToUser(limit, { ...member, userId: 'user-2' })).toBe(false)
  })

  it('covers every model when none are listed', () => {
    expect(customLimitAppliesToModels({ modelIds: [] }, ['any'])).toBe(true)
    expect(customLimitAppliesToModels({ modelIds: ['opus'] }, ['sonnet'])).toBe(false)
    // A fallback answer from a limited model still counts against its limit.
    expect(customLimitAppliesToModels({ modelIds: ['opus'] }, ['sonnet', 'opus'])).toBe(true)
  })
})

describe('custom limit periods', () => {
  const now = new Date('2026-10-22T15:30:00.000Z') // Thursday

  it('uses UTC days, Monday weeks, and a rolling five hours', () => {
    expect(customLimitPeriodStart('daily', now).toISOString()).toBe('2026-10-22T00:00:00.000Z')
    expect(customLimitResetAt('daily', now)?.toISOString()).toBe('2026-10-23T00:00:00.000Z')
    expect(customLimitPeriodStart('weekly', now).toISOString()).toBe('2026-10-19T00:00:00.000Z')
    expect(customLimitResetAt('weekly', now)?.toISOString()).toBe('2026-10-26T00:00:00.000Z')
    expect(customLimitPeriodStart('five_hour', now).toISOString()).toBe('2026-10-22T10:30:00.000Z')
    expect(customLimitResetAt('five_hour', now)).toBeNull()
  })
})

describe('custom limit enforcement helpers', () => {
  const usage = (id: string, remainingMicros: number): CustomLimitUsage => ({
    id, name: id, period: 'daily', limitMicros: 10, modelIds: [], spentMicros: 0, pendingMicros: 0, remainingMicros, resetAt: null, freesAt: null,
  })

  it('picks the limit with the least room left', () => {
    expect(tightestCustomLimit([])).toBeNull()
    expect(tightestCustomLimit([usage('a', 5), usage('b', 2), usage('c', 7)])?.id).toBe('b')
  })

  it('explains when each kind of limit frees up', () => {
    expect(customLimitMessage({ name: 'Opus', period: 'daily', resetAt: null, freesAt: null }))
      .toBe('You\'ve reached the "Opus" daily usage limit. It resets at 00:00 UTC.')
    expect(customLimitMessage({ name: 'Opus', period: 'weekly', resetAt: null, freesAt: null }))
      .toBe('You\'ve reached the "Opus" weekly usage limit. It resets Monday at 00:00 UTC.')
    expect(customLimitMessage({ name: 'Opus', period: 'five_hour', resetAt: null, freesAt: new Date('2026-10-22T17:05:00.000Z') }))
      .toBe('You\'ve reached the "Opus" usage limit for the last 5 hours. Usage starts to free up at 17:05 UTC.')
  })
})
