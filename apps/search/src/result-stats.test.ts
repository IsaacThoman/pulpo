import { describe, expect, it } from 'vitest'
import { formatResultStats } from './result-stats'

describe('result stats', () => {
  it('counts results, names the engines and gives the time in seconds', () => {
    expect(formatResultStats(10, { elapsedMs: 1823, providers: ['kagi'] })).toMatch(/^10 results from Kagi in 1.82 seconds$/)
    expect(formatResultStats(1, { elapsedMs: 640, providers: ['firecrawl'] })).toMatch(/^1 result from Firecrawl in 0.64 seconds$/)
    expect(formatResultStats(20, { elapsedMs: 4100, providers: ['kagi', 'firecrawl'] })).toMatch(/^20 results from Kagi and Firecrawl in 4.10 seconds$/)
  })

  it('leaves out what it does not know', () => {
    expect(formatResultStats(3, { providers: ['kagi'] })).toBe('3 results from Kagi')
    expect(formatResultStats(3, { elapsedMs: Number.NaN, providers: [] })).toBe('3 results')
  })
})
