import { describe, expect, it } from 'vitest'
import { insertAll, maxOf, minOf, pushAll } from './collections.js'

const large = Array.from({ length: 150_000 }, (_, index) => index + 1)

describe('input-sized collections', () => {
  it('reduces large arrays and iterators without argument spreading', () => {
    expect(maxOf(large)).toBe(150_000)
    expect(minOf(large.values())).toBe(1)
    expect(maxOf(large.map((value) => -value))).toBe(-1)
    expect(minOf([])).toBe(Infinity)
    expect(maxOf([])).toBe(-Infinity)
  })

  it('keeps Math extrema semantics for NaN, infinity, and signed zero', () => {
    expect(maxOf([1, NaN, 2])).toBeNaN()
    expect(minOf([1, NaN, 2])).toBeNaN()
    expect(maxOf([Infinity, 1])).toBe(Infinity)
    expect(minOf([-Infinity, 1])).toBe(-Infinity)
    expect(maxOf([-0, 0])).toBe(0)
    expect(minOf([0, -0])).toBe(-0)
  })

  it('appends all values in order and handles self-append', () => {
    const target = [-1, 0]
    pushAll(target, large)
    expect(target).toEqual([-1, 0, ...large])
    const self = [1, 2]
    pushAll(self, self)
    expect(self).toEqual([1, 2, 1, 2])
    pushAll(self, [])
    expect(self).toEqual([1, 2, 1, 2])
  })

  it('inserts large collections without changing prefix or suffix order', () => {
    const target = [-1, 0, 150_001]
    insertAll(target, 2, large)
    expect(target).toEqual([-1, 0, ...large, 150_001])
    insertAll(target, 0, [-2])
    expect(target[0]).toBe(-2)
    const self = [1, 2]
    insertAll(self, 1, self)
    expect(self).toEqual([1, 1, 2, 2])
  })
})
