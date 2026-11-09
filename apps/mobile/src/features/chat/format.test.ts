import { describe, expect, it } from 'vitest'
import { spokenRemaining, spokenTimeAgo, timeAgo } from './format'

describe('timeAgo', () => {
  const now = Date.UTC(2026, 7, 4, 12)

  it('matches the web chat timestamp buckets', () => {
    expect(timeAgo(now - 59_000, now)).toBe('just now')
    expect(timeAgo(now - 60_000, now)).toBe('1m ago')
    expect(timeAgo(now - 3_600_000, now)).toBe('1h ago')
    expect(timeAgo(now - 86_400_000, now)).toBe('1d ago')
    expect(timeAgo(now - 30 * 86_400_000, now)).toBe('1mo ago')
    expect(timeAgo(now - 365 * 86_400_000, now)).toBe('1y ago')
  })

  it('handles future and invalid timestamps without negative labels', () => {
    expect(timeAgo(now + 60_000, now)).toBe('just now')
    expect(timeAgo(Number.NaN, now)).toBe('just now')
  })
})

describe('spoken times', () => {
  const now = Date.UTC(2026, 7, 4, 12)

  it('spells out units a screen reader would misread', () => {
    expect(spokenTimeAgo(now - 59_000, now)).toBe('just now')
    expect(spokenTimeAgo(now - 60_000, now)).toBe('1 minute ago')
    expect(spokenTimeAgo(now - 5 * 60_000, now)).toBe('5 minutes ago')
    expect(spokenTimeAgo(now - 2 * 3_600_000, now)).toBe('2 hours ago')
    expect(spokenTimeAgo(now - 86_400_000, now)).toBe('1 day ago')
    expect(spokenTimeAgo(now - 60 * 86_400_000, now)).toBe('2 months ago')
    expect(spokenTimeAgo(now - 365 * 86_400_000, now)).toBe('1 year ago')
  })

  it('describes the time left before expiry', () => {
    expect(spokenRemaining(0)).toBe('now')
    expect(spokenRemaining(30_000)).toBe('1 minute')
    expect(spokenRemaining(12 * 60_000)).toBe('12 minutes')
    expect(spokenRemaining(5 * 3_600_000 + 1)).toBe('5 hours')
    expect(spokenRemaining(3 * 86_400_000)).toBe('3 days')
  })
})
