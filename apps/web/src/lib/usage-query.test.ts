import { describe, expect, it } from 'vitest'
import { flattenUsagePages, usageQueryParams } from './usage-query'

describe('usage queries', () => {
  it('sends an explicit range and browser time zone', () => {
    const params = usageQueryParams('90d')
    expect(params.get('range')).toBe('90d')
    expect(params.get('timeZone')).toBeTruthy()
  })

  it('keeps every cursor page instead of imposing a client record cap', () => {
    const rows = flattenUsagePages([
      { data: Array.from({ length: 100 }, (_, index) => index) },
      { data: Array.from({ length: 100 }, (_, index) => index + 100) },
      { data: Array.from({ length: 50 }, (_, index) => index + 200) },
    ])
    expect(rows).toHaveLength(250)
    expect(rows.at(-1)).toBe(249)
  })
})
