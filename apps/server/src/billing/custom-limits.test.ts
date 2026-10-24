import { describe, expect, it } from 'vitest'
import { allocateInOrderMicros } from './allocation.js'
import {
  allocateCustomSettlementMicros,
  compareCustomLimits,
  customLimitAppliesToModels,
  customLimitAppliesToUser,
  customLimitPeriodStart,
  customLimitResetAt,
  sharedCustomLimitMicros,
} from './custom-limits.js'

const base = { enabled: true, target: 'everyone', plans: [] as string[], userIds: [] as string[] }
const member = { userId: 'user-1', plan: 'eight' as const }

describe('custom limit audiences', () => {
  it('covers everyone when enabled', () => {
    expect(customLimitAppliesToUser(base, member)).toBe(true)
    expect(customLimitAppliesToUser({ ...base, enabled: false }, member)).toBe(false)
  })

  it('covers the chosen plans', () => {
    const limit = { ...base, target: 'plans', plans: ['baby', 'fat'] }
    expect(customLimitAppliesToUser(limit, member)).toBe(false)
    expect(customLimitAppliesToUser(limit, { ...member, plan: 'fat' })).toBe(true)
  })

  it('covers named users', () => {
    const limit = { ...base, target: 'users', userIds: ['user-1'] }
    expect(customLimitAppliesToUser(limit, member)).toBe(true)
    expect(customLimitAppliesToUser(limit, { ...member, userId: 'user-2' })).toBe(false)
  })

  it('covers every model when none are listed', () => {
    expect(customLimitAppliesToModels({ modelIds: [] }, ['any'])).toBe(true)
    expect(customLimitAppliesToModels({ modelIds: ['opus'] }, ['sonnet'])).toBe(false)
    // A fallback answer from a covered model can still draw on its allowance.
    expect(customLimitAppliesToModels({ modelIds: ['opus'] }, ['sonnet', 'opus'])).toBe(true)
  })
})

describe('custom limit periods', () => {
  const now = new Date('2026-10-22T15:30:00.000Z') // Thursday

  it('uses UTC days, Monday weeks, and a rolling five hours', () => {
    expect(customLimitPeriodStart('daily', now)?.toISOString()).toBe('2026-10-22T00:00:00.000Z')
    expect(customLimitResetAt('daily', now)?.toISOString()).toBe('2026-10-23T00:00:00.000Z')
    expect(customLimitPeriodStart('weekly', now)?.toISOString()).toBe('2026-10-19T00:00:00.000Z')
    expect(customLimitResetAt('weekly', now)?.toISOString()).toBe('2026-10-26T00:00:00.000Z')
    expect(customLimitPeriodStart('five_hour', now)).toBeNull()
    expect(customLimitResetAt('five_hour', now)).toBeNull()
  })
})

describe('custom limit allowances', () => {
  const limit = (id: string, period: string, modelIds: string[], createdAt = '2026-10-01T00:00:00.000Z') => ({ id, period, modelIds, createdAt: new Date(createdAt) })

  it('spends model-specific allowances first, then the soonest to reset', () => {
    const limits = [
      limit('all-daily', 'daily', []),
      limit('opus-weekly', 'weekly', ['opus']),
      limit('all-rolling', 'five_hour', []),
      limit('opus-daily-new', 'daily', ['opus'], '2026-10-02T00:00:00.000Z'),
      limit('opus-daily', 'daily', ['opus']),
    ]
    expect(limits.sort(compareCustomLimits).map((row) => row.id))
      .toEqual(['opus-daily', 'opus-daily-new', 'opus-weekly', 'all-rolling', 'all-daily'])
  })

  it('shares the chosen percentage, rounded down', () => {
    expect(sharedCustomLimitMicros({ limitMicros: 1_000_001, sharePercent: 50 })).toBe(500_000)
    expect(sharedCustomLimitMicros({ limitMicros: 1_000_000, sharePercent: 0 })).toBe(0)
    expect(sharedCustomLimitMicros({ limitMicros: 1_000_000, sharePercent: 100 })).toBe(1_000_000)
  })

  it('draws allowances in order, each up to what it has left', () => {
    const sources = [{ key: 'a', availableMicros: 30 }, { key: 'b', availableMicros: 0 }, { key: 'c', availableMicros: 50 }]
    expect([...allocateInOrderMicros(60, sources)]).toEqual([['a', 30], ['c', 30]])
    expect([...allocateInOrderMicros(500, sources)]).toEqual([['a', 30], ['c', 50]])
    expect(allocateInOrderMicros(0, sources).size).toBe(0)
  })

  it('holds allowances that do not cover extras to the inference part, in order', () => {
    const sources = [
      { key: 'model-only', availableMicros: 100, coversExtras: false },
      { key: 'covering', availableMicros: 30 },
      { key: 'model-only-2', availableMicros: 100, coversExtras: false },
    ]
    // 70 of 100 is inference: the model-only allowances fund at most that between them.
    expect([...allocateInOrderMicros(100, sources, 70)]).toEqual([['model-only', 70], ['covering', 30]])
    expect([...allocateInOrderMicros(100, sources.slice(1), 70)]).toEqual([['covering', 30], ['model-only-2', 70]])
    expect([...allocateInOrderMicros(100, [sources[0]!], 0)]).toEqual([])
  })

  it('settles within what each allowance reserved', () => {
    const funders = [
      { limitId: 'limit-1', ownerUserId: 'owner', reservedMicros: 30, coversExtras: true },
      { limitId: 'limit-1', ownerUserId: 'member', reservedMicros: 10, coversExtras: true },
    ]
    expect(Object.fromEntries(allocateCustomSettlementMicros(20, 20, funders))).toEqual({ 'limit-1:owner': 15, 'limit-1:member': 5 })
    expect(Object.fromEntries(allocateCustomSettlementMicros(100, 100, funders))).toEqual({ 'limit-1:owner': 30, 'limit-1:member': 10 })
  })

  it('settles only inference to allowances that do not cover extras, and extras to those that do', () => {
    const funders = [
      { limitId: 'model-only', ownerUserId: 'user', reservedMicros: 80, coversExtras: false },
      { limitId: 'covering', ownerUserId: 'user', reservedMicros: 30, coversExtras: true },
    ]
    expect(Object.fromEntries(allocateCustomSettlementMicros(60, 40, funders))).toEqual({ 'model-only:user': 40, 'covering:user': 20 })
    expect(Object.fromEntries(allocateCustomSettlementMicros(100, 90, funders))).toEqual({ 'model-only:user': 80, 'covering:user': 20 })
    expect(Object.fromEntries(allocateCustomSettlementMicros(100, 10, funders))).toEqual({ 'model-only:user': 10, 'covering:user': 30 })
  })
})
