import { describe, expect, it } from 'vitest'
import { timeAgo } from './format'

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
