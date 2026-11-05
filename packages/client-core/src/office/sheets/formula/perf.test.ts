import { describe, expect, it } from 'vitest'
import { FormulaEngine } from './engine.js'
import { testFunctions } from './testing.js'

// Loose bounds: these guard against accidental quadratic behavior, not against slow CI machines.
function timed<T>(label: string, fn: () => T): { result: T; ms: number } {
  const start = performance.now()
  const result = fn()
  const ms = performance.now() - start
  console.info(`[perf] ${label}: ${ms.toFixed(0)}ms`)
  return { result, ms }
}

function engine(): FormulaEngine {
  const instance = new FormulaEngine({ functions: testFunctions() })
  instance.setSheets(['Sheet1'])
  return instance
}

describe('performance', () => {
  it('loads 100k values and 50k formulas and recalculates them all quickly', () => {
    const book = engine()
    const { ms: load } = timed('load 100k values + 50k formulas', () => {
      for (let row = 0; row < 100_000; row++) book.setCell(0, row, 0, { value: row })
      for (let row = 0; row < 50_000; row++) book.setCell(0, row, 1, { formula: `A${row + 1}*2+A${row + 2}` })
    })
    const { ms: full } = timed('full recalc', () => book.recalc({ full: true }))
    expect(book.getValue(0, 49_999, 1)).toBe(49_999 * 2 + 50_000)
    expect(load + full).toBeLessThan(5000)
  })

  it('recalculates a single change through a 10k-cell chain quickly', () => {
    const book = engine()
    book.setCell(0, 0, 0, { value: 1 })
    for (let row = 0; row < 10_000; row++) book.setCell(0, row, 1, { formula: row === 0 ? 'A1' : `B${row}+1` })
    for (let row = 0; row < 10_000; row++) book.setCell(0, row, 2, { value: row })
    book.recalc()
    book.setCell(0, 0, 0, { value: 100 })
    const { result, ms } = timed('incremental 10k chain', () => book.recalc())
    expect(result.changed).toHaveLength(10_000)
    expect(book.getValue(0, 9_999, 1)).toBe(100 + 9_999)
    expect(ms).toBeLessThan(500)
    book.setCell(0, 5, 2, { value: -1 })
    const { result: untouched, ms: idle } = timed('incremental unrelated change', () => book.recalc())
    expect(untouched.changed).toHaveLength(0)
    expect(idle).toBeLessThan(50)
  })

  it('stores SUM(A:A) over 100k rows as one range entry, not per-cell edges', () => {
    const book = engine()
    for (let row = 0; row < 100_000; row++) book.setCell(0, row, 0, { value: 1 })
    for (let row = 0; row < 200; row++) book.setCell(0, row, 1, { formula: 'SUM(A:A)' })
    expect(book.dependencyStats()).toEqual({ formulas: 200, cellEdges: 0, rangeEntries: 1 })
    timed('200 x SUM(A:A) over 100k rows', () => book.recalc())
    expect(book.getValue(0, 199, 1)).toBe(100_000)
    book.setCell(0, 50_000, 0, { value: 2 })
    const { result } = timed('incremental change under SUM(A:A)', () => book.recalc())
    expect(result.changed).toHaveLength(200)
    expect(book.getValue(0, 0, 1)).toBe(100_001)
  })

  it('handles many distinct overlapping ranges', () => {
    const book = engine()
    for (let row = 0; row < 5_000; row++) book.setCell(0, row, 0, { value: 1 })
    for (let row = 0; row < 5_000; row++) book.setCell(0, row, 1, { formula: `SUM(A$1:A${row + 1})` })
    timed('5k running totals', () => book.recalc())
    expect(book.getValue(0, 4_999, 1)).toBe(5_000)
    book.setCell(0, 4_999, 0, { value: 5 })
    const { result, ms } = timed('change at the bottom of 5k running totals', () => book.recalc())
    expect(result.changed).toEqual([{ sheet: 0, row: 4_999, col: 1 }])
    expect(ms).toBeLessThan(200)
  })
})
