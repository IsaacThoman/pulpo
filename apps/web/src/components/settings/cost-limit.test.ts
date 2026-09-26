import { describe, expect, it } from 'vitest'
import { parseCostLimit } from './cost-limit'

describe('parseCostLimit', () => {
  it('converts dollars to whole-cent USD micros', () => {
    expect(parseCostLimit('2.5')).toBe(2_500_000)
    expect(parseCostLimit('$0.126')).toBe(130_000)
  })

  it('clamps to the supported range and rejects non-numbers', () => {
    expect(parseCostLimit('0')).toBe(10_000)
    expect(parseCostLimit('5000')).toBe(1_000_000_000)
    expect(parseCostLimit('')).toBeUndefined()
    expect(parseCostLimit('abc')).toBeUndefined()
  })
})
