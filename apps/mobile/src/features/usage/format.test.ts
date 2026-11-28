import { describe, expect, it } from 'vitest'
import {
  MAX_CHART_BARS,
  averageLabel,
  chartBars,
  compactCount,
  contributionYear,
  dayKey,
  joinedLabel,
  metricLabel,
  niceCeiling,
  periodDays,
  rankLeaderboard,
  rankedModels,
  recordTimeLabel,
  usagePrivateNotice,
  usageTotals,
  usageVisibilitySummary,
  type LeaderboardEntry,
  type UsageActivity,
  type UsageDayRow,
} from './format'

// Local noon, so the day is the same in every time zone the tests run in.
const NOW = new Date(2026, 10, 10, 12).getTime()
const day = (daysAgo: number) => dayKey(new Date(2026, 10, 10 - daysAgo, 12))
const row = (daysAgo: number, calls: number, tokens = calls * 100): UsageDayRow => ({ day: day(daysAgo), calls, inputTokens: tokens / 2, outputTokens: tokens / 2 })
const activity = (overrides: Partial<UsageActivity> = {}): UsageActivity => ({
  summary: { calls: 30, inputTokens: 2_000, outputTokens: 1_000, firstUsedAt: new Date(2026, 9, 1, 9).toISOString() },
  daily: [],
  contribution: [],
  topModels: [],
  ...overrides,
})

describe('usage numbers', () => {
  it('writes counts in full until they pass 10,000, then compactly', () => {
    expect(compactCount(0, 'en-US')).toBe('0')
    expect(compactCount(1_284, 'en-US')).toBe('1,284')
    expect(compactCount(9_999, 'en-US')).toBe('9,999')
    expect(compactCount(12_940, 'en-US')).toBe('12.9K')
    expect(compactCount(250_000, 'en-US')).toBe('250K')
    expect(compactCount(4_200_000, 'en-US')).toBe('4.2M')
    expect(compactCount(3_000_000_000, 'en-US')).toBe('3B')
  })

  it('names what a count measures, one or many', () => {
    expect(metricLabel(1, 'calls', 'en-US')).toBe('1 call')
    expect(metricLabel(42, 'calls', 'en-US')).toBe('42 calls')
    expect(metricLabel(1, 'tokens', 'en-US')).toBe('1 token')
    expect(metricLabel(12_940, 'tokens', 'en-US')).toBe('12.9K tokens')
  })

  it('keeps a decimal on small per-day averages', () => {
    expect(averageLabel(0, 'en-US')).toBe('0')
    expect(averageLabel(0.34, 'en-US')).toBe('0.3')
    expect(averageLabel(42.6, 'en-US')).toBe('43')
  })

  it('averages over the chosen period, or since the first use for all time', () => {
    expect(periodDays('24h', null, NOW)).toBe(1)
    expect(periodDays('90d', null, NOW)).toBe(90)
    expect(periodDays('all', new Date(2026, 10, 1, 23).toISOString(), NOW)).toBe(10)
    expect(periodDays('all', null, NOW)).toBe(1)
    expect(usageTotals(activity(), '30d', NOW)).toEqual({ calls: 30, tokens: 3_000, callsPerDay: 1, tokensPerDay: 100 })
    expect(usageTotals(undefined, '30d', NOW)).toEqual({ calls: 0, tokens: 0, callsPerDay: 0, tokensPerDay: 0 })
  })
})

describe('daily chart bars', () => {
  it('gives every day of the range a bar, days without usage included', () => {
    const bars = chartBars([row(0, 4), row(2, 1), row(2, 2)], '7d', 'calls', NOW, 'en-US')
    expect(bars.map((bar) => bar.value)).toEqual([0, 0, 0, 0, 0, 3, 0, 4])
    expect(bars[0]).toMatchObject({ key: day(7), label: 'Nov 3' })
    expect(bars.at(-1)).toMatchObject({ key: day(0), label: 'Nov 10' })
  })

  it('counts tokens when asked', () => {
    expect(chartBars([row(0, 4, 900)], '24h', 'tokens', NOW).map((bar) => bar.value)).toEqual([0, 900])
  })

  it('groups days once a bar a day would not fit, ending on today', () => {
    const bars = chartBars([row(0, 1), row(1, 2), row(89, 5)], '90d', 'calls', NOW, 'en-US')
    expect(bars.length).toBeLessThanOrEqual(MAX_CHART_BARS)
    // 91 days, two to a bar: the oldest bar holds the odd day out.
    expect(bars).toHaveLength(46)
    expect(bars.at(-1)).toMatchObject({ label: 'Nov 9 – 10', value: 3 })
    expect(bars[0]).toMatchObject({ label: 'Aug 12', value: 0 })
    expect(bars[1]).toMatchObject({ label: 'Aug 13 – 14', value: 5 })
    expect(bars.reduce((sum, bar) => sum + bar.value, 0)).toBe(8)
  })

  it('names both months when a grouped bar crosses into the next', () => {
    const bars = chartBars([row(100, 1)], 'all', 'calls', NOW, 'en-US')
    expect(bars.some((bar) => bar.label === 'Sep 30 – Oct 2')).toBe(true)
  })

  it('starts all-time usage at its first day, or shows today alone when there is none', () => {
    expect(chartBars([row(3, 2), row(1, 1)], 'all', 'calls', NOW).map((bar) => bar.value)).toEqual([2, 0, 1, 0])
    expect(chartBars([], 'all', 'calls', NOW)).toEqual([{ key: day(0), label: expect.any(String), value: 0 }])
  })

  it('tops the scale at a clean whole number', () => {
    expect(niceCeiling(0)).toBe(1)
    expect(niceCeiling(1)).toBe(1)
    expect(niceCeiling(3)).toBe(5)
    expect(niceCeiling(17)).toBe(20)
    expect(niceCeiling(21)).toBe(25)
    expect(niceCeiling(26)).toBe(50)
    expect(niceCeiling(980)).toBe(1_000)
    expect(niceCeiling(12_400)).toBe(20_000)
  })
})

describe('models', () => {
  const models = activity({
    summary: { calls: 10, inputTokens: 500, outputTokens: 500, firstUsedAt: null },
    topModels: [
      { modelId: 'big', name: 'Big', calls: 2, inputTokens: 400, outputTokens: 400 },
      { modelId: 'small', name: 'Small', calls: 7, inputTokens: 50, outputTokens: 50 },
      { modelId: 'other', name: 'Hidden model', calls: 1, inputTokens: 50, outputTokens: 50 },
      { modelId: 'unused', name: 'Unused', calls: 0, inputTokens: 0, outputTokens: 0 },
    ],
  })

  it('ranks by the chosen measure with each model’s share, never by spend', () => {
    expect(rankedModels(models, 'calls')).toEqual([
      { modelId: 'small', name: 'Small', value: 7, share: 0.7 },
      { modelId: 'big', name: 'Big', value: 2, share: 0.2 },
      { modelId: 'other', name: 'Other', value: 1, share: 0.1 },
    ])
    expect(rankedModels(models, 'tokens').map((model) => [model.modelId, model.share])).toEqual([['big', 0.8], ['other', 0.1], ['small', 0.1]])
    expect(rankedModels(undefined, 'calls')).toEqual([])
  })
})

describe('year of activity', () => {
  it('lays out a year of weeks ending today, with earlier days left blank', () => {
    const year = contributionYear([row(0, 1), row(1, 2), row(2, 3), row(3, 8), row(400, 50)], 'calls', NOW, 'en-US')
    expect(year.weeks.length).toBeGreaterThanOrEqual(53)
    expect(year.weeks.slice(0, -1).every((week) => week.length === 7)).toBe(true)
    const cells = year.weeks.flat()
    expect(cells.at(-1)).toMatchObject({ key: day(0), label: 'Nov 10, 2026', value: 1, placeholder: false })
    expect(cells.filter((cell) => !cell.placeholder)).toHaveLength(365)
    expect(cells.find((cell) => !cell.placeholder)?.key).toBe(day(364))
    // Usage older than the year is not counted.
    expect(year.activeDays).toBe(4)
  })

  it('shades days by quartile of the days with usage', () => {
    const year = contributionYear([row(0, 1), row(1, 2), row(2, 3), row(3, 8)], 'calls', NOW)
    const levels = Object.fromEntries(year.weeks.flat().filter((cell) => cell.value > 0).map((cell) => [cell.value, cell.level]))
    expect(levels).toEqual({ 1: 1, 2: 1, 3: 2, 8: 3 })
    expect(year.weeks.flat().find((cell) => cell.key === day(10))?.level).toBe(0)
  })

  it('labels months where their first full week starts, without crowding', () => {
    const { months, weeks } = contributionYear([], 'calls', NOW)
    expect(months.at(-1)).toEqual({ label: 'Nov', column: weeks.findIndex((week) => week[0]!.key === '2026-11-01') })
    for (let index = 1; index < months.length; index += 1) expect(months[index]!.column - months[index - 1]!.column).toBeGreaterThanOrEqual(3)
  })
})

describe('leaderboard', () => {
  const entry = (userId: string, calls: number, tokens: number, displayName = userId): LeaderboardEntry => ({ userId, displayName, username: userId, avatarUrl: null, profileColor: null, calls, tokens })

  it('ranks by the chosen measure against the leader', () => {
    const entries = [entry('ann', 5, 900), entry('bo', 10, 100), entry('cy', 0, 0)]
    expect(rankLeaderboard(entries, 'calls').map((row) => [row.rank, row.userId, row.value, row.fraction])).toEqual([[1, 'bo', 10, 1], [2, 'ann', 5, 0.5], [3, 'cy', 0, 0]])
    expect(rankLeaderboard(entries, 'tokens').map((row) => row.userId)).toEqual(['ann', 'bo', 'cy'])
  })

  it('orders ties the same way every time', () => {
    const tied = [entry('b', 1, 5, 'Sam'), entry('a', 1, 5, 'Sam'), entry('c', 1, 9, 'Alex')]
    expect(rankLeaderboard(tied, 'calls').map((row) => row.userId)).toEqual(['c', 'a', 'b'])
    expect(rankLeaderboard([...tied].reverse(), 'calls').map((row) => row.userId)).toEqual(['c', 'a', 'b'])
    expect(rankLeaderboard([entry('a', 0, 0)], 'calls')[0]!.fraction).toBe(0)
  })
})

describe('profile wording', () => {
  it('says when a call was made', () => {
    expect(recordTimeLabel(new Date(2026, 10, 10, 9, 5).toISOString(), NOW, 'en-US')).toBe('9:05 AM')
    expect(recordTimeLabel(new Date(2026, 10, 3, 14, 30).toISOString(), NOW, 'en-US')).toBe('Nov 3, 2:30 PM')
    expect(recordTimeLabel(new Date(2025, 11, 31, 14, 30).toISOString(), NOW, 'en-US')).toBe('Dec 31, 2025, 2:30 PM')
    expect(recordTimeLabel('nonsense', NOW)).toBe('')
  })

  it('says when someone joined', () => {
    expect(joinedLabel(new Date(2026, 7, 15, 12).toISOString(), 'en-US')).toBe('Joined Aug 15, 2026')
    expect(joinedLabel(undefined)).toBeUndefined()
    expect(joinedLabel('nonsense')).toBeUndefined()
  })

  it('says who can see usage, for the owner and for a visitor', () => {
    expect(usageVisibilitySummary('public', true)).toBe('Usage visible to everyone')
    expect(usageVisibilitySummary('friends', true)).toBe('Usage visible to friends')
    expect(usageVisibilitySummary('friends', false)).toBe('Usage visible to their friends')
    expect(usageVisibilitySummary('pool', true)).toBe('Usage visible to your Pool')
    expect(usageVisibilitySummary('pool', false)).toBe('Usage visible to their Pool')
    expect(usagePrivateNotice('Jordan')).toBe('Jordan hasn’t shared their usage with you.')
  })
})
