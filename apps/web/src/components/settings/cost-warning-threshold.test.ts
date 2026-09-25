import { describe, expect, it } from 'vitest'
import { parseCostWarningThreshold } from './cost-warning-threshold'

describe('parseCostWarningThreshold', () => {
  it('converts dollars to whole-cent USD micros', () => {
    expect(parseCostWarningThreshold('2.5')).toBe(2_500_000)
    expect(parseCostWarningThreshold('$0.126')).toBe(130_000)
  })

  it('clamps to the supported range and rejects non-numbers', () => {
    expect(parseCostWarningThreshold('0')).toBe(10_000)
    expect(parseCostWarningThreshold('5000')).toBe(1_000_000_000)
    expect(parseCostWarningThreshold('')).toBeUndefined()
    expect(parseCostWarningThreshold('abc')).toBeUndefined()
  })
})
