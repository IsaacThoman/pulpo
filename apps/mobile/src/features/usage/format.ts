import type { UsageVisibility } from '@pulpo/contracts'

/**
 * Settled usage as profiles and the leaderboard show it. Counts only: the server also sends what
 * each call cost, and the app never shows balances, credits, or prices.
 */
export type UsageRange = '24h' | '7d' | '30d' | '90d' | 'all'
export type UsageMetric = 'calls' | 'tokens'

export const USAGE_RANGES: readonly { value: UsageRange; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'all', label: 'All' },
]

export const USAGE_METRICS: readonly { value: UsageMetric; label: string }[] = [
  { value: 'calls', label: 'Calls' },
  { value: 'tokens', label: 'Tokens' },
]

export interface UsageCounts {
  calls: number
  inputTokens: number
  outputTokens: number
}

export interface UsageDayRow extends UsageCounts {
  /** The day in the viewer's time zone, starting `YYYY-MM-DD`. */
  day: string
}

export interface UsageTopModel extends UsageCounts {
  modelId: string
  name: string
}

/** One person's or one circle's usage, as the activity endpoints return it. */
export interface UsageActivity {
  summary: UsageCounts & { firstUsedAt: string | null }
  /** The chosen range, one row per day and model. */
  daily: UsageDayRow[]
  /** The past year, one row per day. */
  contribution: UsageDayRow[]
  topModels: UsageTopModel[]
}

export interface UsageRecord {
  id: string
  createdAt: string
  model: { id: string; name: string }
  inputTokens: number
  outputTokens: number
  /** Who made the call; leaderboards show them, a profile's records are all its owner's. */
  participant?: { id: string; displayName: string; username: string; avatarUrl: string | null; profileColor: string | null }
}

export interface LeaderboardEntry {
  userId: string
  displayName: string
  username: string
  avatarUrl: string | null
  profileColor: string | null
  calls: number
  tokens: number
}

const DAY_MS = 86_400_000
/** The most bars a phone-width chart keeps readable; longer ranges group days into each bar. */
export const MAX_CHART_BARS = 46

export function tokensOf(counts: Pick<UsageCounts, 'inputTokens' | 'outputTokens'>): number {
  return counts.inputTokens + counts.outputTokens
}

export function metricOf(counts: UsageCounts, metric: UsageMetric): number {
  return metric === 'tokens' ? tokensOf(counts) : counts.calls
}

/** In full below 10,000, then compact: 1,284 · 12.9K · 4.2M. */
export function compactCount(value: number, locale?: string): string {
  const rounded = Math.round(value)
  if (Math.abs(rounded) < 10_000) return rounded.toLocaleString(locale)
  for (const [size, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) {
    if (Math.abs(rounded) < size) continue
    const scaled = rounded / size
    // One decimal until three digits, and never "1000.0K".
    const text = Math.abs(scaled) >= 100 ? Math.round(scaled).toString() : scaled.toFixed(1).replace(/\.0$/, '')
    return `${text}${suffix}`
  }
  return rounded.toString()
}

export function metricUnit(metric: UsageMetric, value: number): string {
  if (metric === 'tokens') return value === 1 ? 'token' : 'tokens'
  return value === 1 ? 'call' : 'calls'
}

/** "1,284 calls", "12.9K tokens". */
export function metricLabel(value: number, metric: UsageMetric, locale?: string): string {
  return `${compactCount(value, locale)} ${metricUnit(metric, Math.round(value))}`
}

/** Per-day averages keep a decimal while they are small, as "0.3 calls" says more than "0 calls". */
export function averageLabel(value: number, locale?: string): string {
  return value > 0 && value < 10 ? value.toFixed(1) : compactCount(value, locale)
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function startOfDay(time: number): Date {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function parseDay(day: string): Date | null {
  const [year, month, date] = day.slice(0, 10).split('-').map(Number)
  if (!year || !month || !date) return null
  return new Date(year, month - 1, date)
}

function rangeDays(range: Exclude<UsageRange, 'all'>): number {
  return range === '24h' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 90
}

/** Days in the chosen period, for per-day averages; "All" counts from the first use. */
export function periodDays(range: UsageRange, firstUsedAt: string | null, now = Date.now()): number {
  if (range !== 'all') return rangeDays(range)
  const first = firstUsedAt ? Date.parse(firstUsedAt) : Number.NaN
  if (!Number.isFinite(first)) return 1
  return Math.max(1, Math.round((startOfDay(now).getTime() - startOfDay(first).getTime()) / DAY_MS) + 1)
}

function shortDate(date: Date, locale?: string, withYear = false): string {
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' as const } : {}) })
}

export interface ChartBar {
  /** The first day the bar covers. */
  key: string
  /** "Nov 3", or "Nov 3 – 5" when the bar groups several days. */
  label: string
  value: number
}

/**
 * The chart's bars: every day of the range, days without usage included, so time runs evenly
 * left to right. Ranges too long for a bar a day group consecutive days.
 */
export function chartBars(rows: readonly UsageDayRow[], range: UsageRange, metric: UsageMetric, now = Date.now(), locale?: string): ChartBar[] {
  const byDay = new Map<string, number>()
  for (const row of rows) {
    const key = row.day.slice(0, 10)
    byDay.set(key, (byDay.get(key) ?? 0) + metricOf(row, metric))
  }
  const today = startOfDay(now)
  let first: Date
  if (range === 'all') {
    const earliest = [...byDay.keys()].sort()[0]
    first = (earliest ? parseDay(earliest) : null) ?? today
    if (first > today) first = today
  } else {
    // The range reaches back whole days from now, so its first day is usually a partial one.
    first = startOfDay(now - rangeDays(range) * DAY_MS)
  }
  const days = Math.round((today.getTime() - first.getTime()) / DAY_MS) + 1
  const perBar = Math.max(1, Math.ceil(days / MAX_CHART_BARS))
  const bars: ChartBar[] = []
  // Group from the newest day back, so the last bar always ends today and only the oldest is short.
  for (let end = days - 1; end >= 0; end -= perBar) {
    const start = Math.max(0, end - perBar + 1)
    let value = 0
    for (let offset = start; offset <= end; offset += 1) value += byDay.get(dayKey(addDays(first, offset))) ?? 0
    const from = addDays(first, start)
    const to = addDays(first, end)
    const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()
    const label = start === end
      ? shortDate(from, locale)
      : `${shortDate(from, locale)} – ${sameMonth ? to.getDate() : shortDate(to, locale)}`
    bars.unshift({ key: dayKey(from), label, value })
  }
  return bars
}

/** A clean value at or above `max` for the chart's top gridline: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceCeiling(max: number): number {
  if (max <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(max))
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude
    // Counts are whole; a ceiling of 2.5 would label a gridline nobody can reach.
    if (candidate >= max && Number.isInteger(candidate)) return candidate
  }
  return 10 * magnitude
}

export interface UsageTotals {
  calls: number
  tokens: number
  callsPerDay: number
  tokensPerDay: number
}

export function usageTotals(activity: UsageActivity | undefined, range: UsageRange, now = Date.now()): UsageTotals {
  const calls = activity?.summary.calls ?? 0
  const tokens = activity ? tokensOf(activity.summary) : 0
  const days = periodDays(range, activity?.summary.firstUsedAt ?? null, now)
  return { calls, tokens, callsPerDay: calls / days, tokensPerDay: tokens / days }
}

export interface RankedModel {
  modelId: string
  name: string
  value: number
  /** Its part of the period's total, 0 to 1. */
  share: number
}

/** Models by the chosen measure. The server ranks by spend, which the app does not show. */
export function rankedModels(activity: UsageActivity | undefined, metric: UsageMetric): RankedModel[] {
  if (!activity) return []
  const total = metricOf(activity.summary, metric)
  return activity.topModels
    .map((model) => ({
      modelId: model.modelId,
      // Models hidden from other people arrive rolled into one entry.
      name: model.modelId === 'other' ? 'Other' : model.name,
      value: metricOf(model, metric),
    }))
    .filter((model) => model.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .map((model) => ({ ...model, share: total > 0 ? Math.min(1, model.value / total) : 0 }))
}

export interface ContributionCell {
  key: string
  /** "Nov 3, 2026" */
  label: string
  value: number
  /** 0 is no usage; 1 to 4 are quartiles of the days that had some. */
  level: 0 | 1 | 2 | 3 | 4
  /** Before the year shown: a gap that keeps the first week's days in their rows. */
  placeholder: boolean
}

export interface ContributionYear {
  /** Sunday-first columns, oldest first; the last may be short. */
  weeks: ContributionCell[][]
  /** Month names over the column where each month's first full week starts. */
  months: { label: string; column: number }[]
  activeDays: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Month labels closer than this many columns would overlap. */
const MIN_MONTH_COLUMNS = 3

/** The past year of activity as a week-by-week grid, like the web's contribution graph. */
export function contributionYear(rows: readonly UsageDayRow[], metric: UsageMetric, now = Date.now(), locale?: string): ContributionYear {
  const byDay = new Map<string, number>()
  for (const row of rows) {
    const key = row.day.slice(0, 10)
    byDay.set(key, (byDay.get(key) ?? 0) + metricOf(row, metric))
  }
  const end = startOfDay(now)
  const start = addDays(end, -364)
  const gridStart = addDays(start, -start.getDay())

  const positive: number[] = []
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const value = byDay.get(dayKey(day)) ?? 0
    if (value > 0) positive.push(value)
  }
  positive.sort((a, b) => a - b)
  const quartile = (fraction: number) => positive[Math.floor(positive.length * fraction)] ?? 0
  const [q1, q2, q3] = [quartile(0.25), quartile(0.5), quartile(0.75)]
  const levelOf = (value: number): ContributionCell['level'] => value <= 0 ? 0 : value <= q1 ? 1 : value <= q2 ? 2 : value <= q3 ? 3 : 4

  const weeks: ContributionCell[][] = []
  const months: ContributionYear['months'] = []
  let week: ContributionCell[] = []
  let lastMonth = -1
  for (let day = gridStart; day <= end; day = addDays(day, 1)) {
    const placeholder = day < start
    const value = placeholder ? 0 : byDay.get(dayKey(day)) ?? 0
    if (day.getDay() === 0 && day.getMonth() !== lastMonth && !placeholder) {
      // A partial leading month leaves too little room for its name; the next month's wins.
      const previous = months[months.length - 1]
      if (previous && weeks.length - previous.column < MIN_MONTH_COLUMNS) months.pop()
      months.push({ label: MONTHS[day.getMonth()]!, column: weeks.length })
      lastMonth = day.getMonth()
    }
    week.push({ key: dayKey(day), label: shortDate(day, locale, true), value, level: levelOf(value), placeholder })
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }
  if (week.length) weeks.push(week)
  return { weeks, months, activeDays: positive.length }
}

export interface RankedEntry extends LeaderboardEntry {
  rank: number
  value: number
  /** The bar's length against the leader's, 0 to 1. */
  fraction: number
}

/** People by the chosen measure, ties broken the same way every time. */
export function rankLeaderboard(entries: readonly LeaderboardEntry[], metric: UsageMetric): RankedEntry[] {
  const valueOf = (entry: LeaderboardEntry) => metric === 'tokens' ? entry.tokens : entry.calls
  const sorted = [...entries].sort((a, b) =>
    valueOf(b) - valueOf(a)
    || b.calls - a.calls
    || b.tokens - a.tokens
    || a.displayName.localeCompare(b.displayName)
    || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
  const top = sorted[0] ? valueOf(sorted[0]) : 0
  return sorted.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    value: valueOf(entry),
    fraction: top > 0 ? valueOf(entry) / top : 0,
  }))
}

/** When a call was made: the time today, the date and time before that. */
export function recordTimeLabel(iso: string, now = Date.now(), locale?: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const time = date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  if (dayKey(date) === dayKey(new Date(now))) return time
  return `${shortDate(date, locale, date.getFullYear() !== new Date(now).getFullYear())}, ${time}`
}

/** "Joined Aug 15, 2026" */
export function joinedLabel(iso: string | null | undefined, locale?: string): string | undefined {
  if (!iso) return undefined
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return undefined
  return `Joined ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)}`
}

export const USAGE_VISIBILITY_ICONS: Record<UsageVisibility, string> = { pool: 'lock', friends: 'person.2', public: 'globe' }

/** Who can see a profile's usage, worded for its owner or for a visitor. */
export function usageVisibilitySummary(visibility: UsageVisibility, own: boolean): string {
  if (visibility === 'public') return 'Usage visible to everyone'
  if (visibility === 'friends') return own ? 'Usage visible to friends' : 'Usage visible to their friends'
  return own ? 'Usage visible to your Pool' : 'Usage visible to their Pool'
}

/** Shown in place of usage its owner has not shared with the viewer, without naming their setting. */
export function usagePrivateNotice(name: string): string {
  return `${name} hasn’t shared their usage with you.`
}
