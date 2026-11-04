import { describe, expect, it } from 'vitest'
import { MAX_TICKS, computeValueScale, niceStep, roundToStep } from './scale.js'

function range(min: number, max: number, maxIntervals = 6, extra = {}) {
  const scale = computeValueScale(min, max, { maxIntervals, ...extra })
  return [scale.min, scale.max, scale.majorUnit]
}

describe('niceStep', () => {
  it('rounds up to 1, 2, or 5 × 10ⁿ', () => {
    expect([0.7, 1, 1.3, 2, 2.1, 4.9, 5.1, 17, 2300, 0.0031].map(niceStep)).toEqual([1, 1, 2, 2, 5, 5, 10, 20, 5000, 0.005])
    expect(niceStep(0)).toBe(1)
    expect(niceStep(Number.NaN)).toBe(1)
  })

  it('removes float noise from ticks', () => {
    expect(roundToStep(0.1 + 0.2, 0.1)).toBe(0.3)
    expect(roundToStep(-0, 1)).toBe(0)
  })
})

describe('computeValueScale', () => {
  it('starts at zero and adds headroom like Excel', () => {
    expect(range(40, 95)).toEqual([0, 100, 20])
    expect(range(0, 100)).toEqual([0, 120, 20])
    expect(range(12_500, 21_300, 8)).toEqual([0, 25_000, 5_000])
  })

  it('leaves zero out when the data sits far from it (the 5/6 rule)', () => {
    const [min, max] = range(950, 1000)
    expect(min).toBeGreaterThan(0)
    expect(min).toBeLessThan(950)
    expect(max).toBeGreaterThanOrEqual(1000)
  })

  it('spans negative values on both sides', () => {
    expect(range(-5, 95)).toEqual([-20, 100, 20])
    expect(range(-4200, 21_300, 8)).toEqual([-10_000, 25_000, 5_000])
    const [min, max] = range(-80, -10)
    expect(max).toBe(0)
    expect(min).toBeLessThanOrEqual(-80)
  })

  it('uses fewer ticks on shorter axes', () => {
    expect(computeValueScale(0, 100, { maxIntervals: 2 }).majorUnit).toBe(100)
    expect(computeValueScale(0, 100, { maxIntervals: 12 }).majorUnit).toBe(10)
  })

  it('honors fixed bounds and units from the file', () => {
    expect(range(0, 95, 6, { min: 10, max: 90 })).toEqual([10, 90, 20])
    expect(computeValueScale(0, 95, { maxIntervals: 6, min: 10, max: 90 }).ticks).toEqual([10, 30, 50, 70, 90])
    expect(range(0, 95, 6, { majorUnit: 25 })).toEqual([0, 100, 25])
    expect(range(0, 95, 6, { max: 50 })).toEqual([0, 50, 10])
  })

  it('ignores a major unit that would produce absurd tick counts', () => {
    const scale = computeValueScale(0, 100, { maxIntervals: 6, majorUnit: 1e-300 })
    expect(scale.ticks.length).toBeLessThanOrEqual(MAX_TICKS + 1)
    expect(scale.majorUnit).toBe(20)
  })

  it('scales percent-stacked axes from 0 to 100%', () => {
    expect(range(0, 1, 6, { percent: true })).toEqual([0, 1, 0.2])
    const [min, max] = range(-0.07, 1, 6, { percent: true })
    expect(min).toBe(-0.2)
    expect(max).toBe(1)
  })

  it('places log ticks at powers of the base', () => {
    const scale = computeValueScale(3, 4500, { maxIntervals: 10, logBase: 10 })
    expect(scale.ticks).toEqual([1, 10, 100, 1000, 10_000])
    expect(computeValueScale(-5, 0, { maxIntervals: 10, logBase: 10 }).ticks.every((tick) => tick > 0)).toBe(true)
  })

  it('handles flat and missing data', () => {
    expect(range(0, 0)).toEqual([0, 1, 0.2])
    expect(range(Number.NaN, Number.NaN)).toEqual([0, 1, 0.2])
    expect(range(7, 7)[0]).toBe(0)
    expect(range(-7, -7)[1]).toBe(0)
  })
})
