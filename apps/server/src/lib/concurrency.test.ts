import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from './concurrency.js'

describe('mapWithConcurrency', () => {
  it('keeps input order and never exceeds the limit', async () => {
    let active = 0
    let peak = 0
    const results = await mapWithConcurrency([5, 1, 4, 2, 3], 2, async (value) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, value))
      active -= 1
      return value * 10
    })
    expect(results).toEqual([50, 10, 40, 20, 30])
    expect(peak).toBe(2)
  })

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([])
  })
})
