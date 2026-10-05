import { describe, expect, it } from 'vitest'
import { csvValues, resolveWindow } from './window.js'

const now = new Date('2026-10-03T12:00:00.000Z')

describe('analytics windows', () => {
  it('uses hourly buckets up to two days and a previous window of equal length', () => {
    const window = resolveWindow({ range: '24h', timeZone: 'UTC' }, now)
    expect(window.bucket).toBe('hour')
    expect(window.from?.toISOString()).toBe('2026-10-02T12:00:00.000Z')
    expect(window.previousFrom?.toISOString()).toBe('2026-10-01T12:00:00.000Z')
    expect(resolveWindow({ range: '7d', timeZone: 'UTC' }, now).bucket).toBe('day')
  })

  it('has no start or comparison for all time', () => {
    expect(resolveWindow({ range: 'all', timeZone: 'UTC' }, now)).toMatchObject({ from: null, previousFrom: null, bucket: 'day' })
  })

  it('validates custom ranges and picks the bucket from their span', () => {
    const custom = resolveWindow({ range: 'custom', from: '2026-10-03T00:00:00Z', to: '2026-10-03T06:00:00Z', timeZone: 'UTC' }, now)
    expect(custom.bucket).toBe('hour')
    expect(custom.previousFrom?.toISOString()).toBe('2026-10-02T18:00:00.000Z')
    expect(() => resolveWindow({ range: 'custom', from: '2026-10-03T06:00:00Z', to: '2026-10-03T00:00:00Z', timeZone: 'UTC' }, now)).toThrow('before its end')
  })

  it('parses comma lists without blanks or duplicates', () => {
    expect(csvValues(' failed, ,completed,failed ')).toEqual(['failed', 'completed'])
    expect(csvValues(undefined)).toEqual([])
  })
})
