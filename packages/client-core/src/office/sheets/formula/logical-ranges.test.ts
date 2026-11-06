import { describe, expect, it } from 'vitest'
import { MAX_COLS, MAX_ROWS, parseCellName } from '../address.js'
import { functionRegistry } from './functions/index.js'
import { FormulaEngine } from './engine.js'
import { isMatrix, logicalSize, matrixGet, type Scalar } from './types.js'

function book(): FormulaEngine {
  const engine = new FormulaEngine({ functions: functionRegistry() })
  engine.setSheets(['Sheet1', 'Sheet2', 'Results'])
  return engine
}
function set(engine: FormulaEngine, sheet: number, name: string, value: Scalar): void {
  const at = parseCellName(name)!
  engine.setCell(sheet, at.row, at.col, { value })
}

describe('logical range dimensions', () => {
  it('reproduces XLOOKUP across sheets with unrelated used rows', () => {
    const engine = book()
    set(engine, 0, 'A1', 'key')
    set(engine, 1, 'A1', 42)
    set(engine, 1, 'C11', 99)
    expect(engine.evaluateFormula('XLOOKUP("key",Sheet1!A:A,Sheet2!A:A)', 2)).toBe(42)
    expect(engine.evaluateFormula('XLOOKUP("key",Sheet1!A1:A11,Sheet2!A1:A11)', 2)).toBe(42)
  })
})

function snapshot(value: ReturnType<FormulaEngine['evaluateFormula']>): unknown {
  if (!isMatrix(value)) return value
  const size = logicalSize(value)
  return { ...size, first: matrixGet(value, 0, 0), last: matrixGet(value, size.rows - 1, size.cols - 1), prefix: Array.from({ length: Math.min(size.rows, 5) }, (_, r) => Array.from({ length: Math.min(size.cols, 5) }, (_, c) => matrixGet(value, r, c))) }
}

for (const horizontal of [false, true]) {
  describe(horizontal ? 'whole rows' : 'whole columns', () => {
    const axis = horizontal ? '1:1' : 'A:A'
    const explicit = horizontal ? 'A1:K1' : 'A1:A11'
    const full = horizontal ? 'A1:XFD1' : `A1:A${MAX_ROWS}`
    const length = horizontal ? MAX_COLS : MAX_ROWS
    const a = `Sheet1!${axis}`
    const b = `Sheet2!${axis}`
    function fixture(): FormulaEngine {
      const engine = book()
      for (let i = 0; i < 3; i++) {
        set(engine, 0, horizontal ? `${String.fromCharCode(65 + i)}1` : `A${i + 1}`, i + 1)
        set(engine, 1, horizontal ? `${String.fromCharCode(65 + i)}1` : `A${i + 1}`, 2 * (i + 1))
      }
      set(engine, 1, horizontal ? 'K3' : 'C11', 99)
      return engine
    }
    const finite = (formula: string): string => formula.replaceAll(axis, explicit)
    const prefix = (formula: string): string => horizontal ? `TAKE(${formula},,3)` : `TAKE(${formula},3)`
    const cases: [string, string, unknown][] = [
      ['XLOOKUP', `XLOOKUP(2,${a},${b})`, 4],
      ['LOOKUP', `LOOKUP(2,${a},${b})`, 4],
      ['MATCH', `MATCH(2,${a},0)`, 2],
      ['XMATCH', `XMATCH(2,${a},0,-1)`, 2],
      ['INDEX tail', `INDEX(${b},${horizontal ? '1,10' : '10'})`, 0],
      ['SUMIF', `SUMIF(${a},">0",${b})`, 12],
      ['AVERAGEIF', `AVERAGEIF(${a},">0",${b})`, 4],
      ['SUMIFS', `SUMIFS(${b},${a},">0")`, 12],
      ['COUNTIFS', `COUNTIFS(${a},">0",${b},">0")`, 3],
      ['AVERAGEIFS', `AVERAGEIFS(${b},${a},">0")`, 4],
      ['MAXIFS', `MAXIFS(${b},${a},">0")`, 6],
      ['MINIFS', `MINIFS(${b},${a},">0")`, 2],
      ['SUMPRODUCT', `SUMPRODUCT(${a},${b})`, 28],
      ['SUMX2MY2', `SUMX2MY2(${a},${b})`, -42],
      ['SUMX2PY2', `SUMX2PY2(${a},${b})`, 70],
      ['SUMXMY2', `SUMXMY2(${a},${b})`, 14],
      ['CORREL', `CORREL(${a},${b})`, 1],
      ['COVAR', `COVAR(${a},${b})`, 4 / 3],
      ['COVARIANCE.S', `COVARIANCE.S(${a},${b})`, 2],
      ['SLOPE', `SLOPE(${b},${a})`, 2],
      ['INTERCEPT', `INTERCEPT(${b},${a})`, 0],
      ['RSQ', `RSQ(${a},${b})`, 1],
      ['FORECAST', `FORECAST(4,${b},${a})`, 8],
      ['FILTER', `FILTER(${a},${b}>0)`, undefined],
      ['SORTBY', prefix(`SORTBY(${a},${b},-1)`), undefined],
      ['CHOOSE', prefix(`${horizontal ? 'CHOOSEROWS' : 'CHOOSECOLS'}(${a},1)`), undefined],
      ['arithmetic', `SUMPRODUCT((${a}+${b})*(${b}-${a}))`, 42],
      ['broadcast scalar function', `SUMPRODUCT(ABS(${a}-${b}))`, 6],
      ['lazy broadcast', `SUMPRODUCT(IF(${a}>0,${b},0))`, 12],
    ]
    it.each(cases)('%s matches an explicit finite range', (_name, formula, expected) => {
      const engine = fixture()
      const result = engine.evaluateFormula(formula, 2)
      expect(snapshot(result)).toEqual(snapshot(engine.evaluateFormula(finite(formula), 2)))
      if (typeof expected === 'number') expect(result).toBeCloseTo(expected, 10)
      else expect(isMatrix(result)).toBe(true)
    })
    it('counts and searches the entire logical tail without expanding it', () => {
      const engine = fixture()
      for (const formula of [`COUNTIFS(${a},"",${b},"")`, `XMATCH(1,${a}+1,0,-1)`, `SUMPRODUCT((${a}=0)*(${b}=0))`]) {
        const result = engine.evaluateFormula(formula, 2)
        expect(result).toEqual(engine.evaluateFormula(formula.replaceAll(axis, full), 2))
        expect(result).toBe(formula.startsWith('XMATCH') ? length : length - 3)
      }
      expect(engine.evaluateFormula(`${horizontal ? 'COLUMNS' : 'ROWS'}(ABS(${a}))`, 2)).toBe(length)
      expect(engine.evaluateFormula(`SUM(${a}+1)`, 2)).toBe(length + 6)
      expect(engine.evaluateFormula(`COUNT(${a}+1)`, 2)).toBe(length)
      expect(engine.evaluateFormula(`AVERAGE(${a}+1)`, 2)).toBeCloseTo((length + 6) / length, 12)
      expect(engine.evaluateFormula(`MIN(${a}+1)`, 2)).toBe(1)
      expect(snapshot(engine.evaluateFormula(`UNIQUE(${a},${horizontal ? 'TRUE' : 'FALSE'})`, 2))).toEqual(snapshot(engine.evaluateFormula(finite(`UNIQUE(${a},${horizontal ? 'TRUE' : 'FALSE'})`), 2)))
      const result = engine.evaluateFormula(`${a}+${b}`, 2)
      expect(isMatrix(result)).toBe(true)
      if (isMatrix(result)) {
        expect(result.data.length).toBeLessThan(20)
        expect(logicalSize(result)).toEqual(horizontal ? { rows: 1, cols: MAX_COLS } : { rows: MAX_ROWS, cols: 1 })
        expect(matrixGet(result, horizontal ? 0 : 100, horizontal ? 100 : 0)).toBe(0)
      }
    })
    it('includes sum_range data past the criteria range materialized tail', () => {
      const engine = fixture()
      set(engine, 1, horizontal ? 'E1' : 'A5', 10)
      for (const fn of ['SUMIF', 'AVERAGEIF']) {
        const formula = `${fn}(${a},"",${b})`
        expect(engine.evaluateFormula(formula, 2)).toBe(10)
        expect(engine.evaluateFormula(finite(formula), 2)).toBe(10)
      }
    })
    it('retrieves omitted cells and validates logical shapes', () => {
      const engine = fixture()
      set(engine, 1, horizontal ? 'E1' : 'A5', 10)
      expect(engine.evaluateFormula(`XLOOKUP(10,${b},${a})`, 2)).toBe(0)
      for (const fn of ['CORREL(A,B)', 'SUMXMY2(A,B)']) {
        const formula = fn.replace(/\bA\b/g, a).replace(/\bB\b/g, `Sheet2!${explicit}`)
        expect(engine.evaluateFormula(formula, 2)).toEqual({ code: '#N/A' })
      }
      for (const fn of ['XLOOKUP(1,A,B)', 'SUMIFS(A,B,1)', 'SUMPRODUCT(A,B)', 'FILTER(A,B)', 'SORTBY(A,B)']) {
        // Replace placeholders separately so function names are never changed.
        const safe = fn.replace(/\bA\b/g, a).replace(/\bB\b/g, `Sheet2!${explicit}`)
        expect(engine.evaluateFormula(safe, 2)).toEqual({ code: '#VALUE!' })
      }
    })
  })
}

it('uses logical table dimensions for HLOOKUP/VLOOKUP and array INDEX', () => {
  const engine = book()
  set(engine, 0, 'A1', 7)
  expect(engine.evaluateFormula(`VLOOKUP(7,Sheet1!A:XFD,${MAX_COLS},FALSE)`, 2)).toBe(0)
  expect(engine.evaluateFormula(`HLOOKUP(7,Sheet1!1:1048576,${MAX_ROWS},FALSE)`, 2)).toBe(0)
  expect(engine.evaluateFormula(`INDEX(Sheet1!A:A+1,${MAX_ROWS})`, 2)).toBe(1)
  expect(engine.evaluateFormula('INDEX(Sheet1!1:1+1,1,16384)', 2)).toBe(1)
  expect(engine.evaluateFormula('CHOOSECOLS(Sheet1!1:1,-1)', 2)).toBe(0)
})

it('sizes spills using logical bounds and reads their omitted cells', () => {
  const engine = book()
  set(engine, 0, 'A1', 7)
  engine.setCell(2, 1, 0, { formula: 'Sheet1!A:A' })
  engine.setCell(2, 3, 1, { formula: 'Sheet1!1:1' })
  engine.setCell(2, 5, 0, { formula: 'Sheet1!1:1+1' })
  engine.recalc()
  expect(engine.getValue(2, 1, 0)).toEqual({ code: '#SPILL!' })
  expect(engine.getValue(2, 3, 1)).toEqual({ code: '#SPILL!' })
  expect(engine.getSpill(2, 5, 0)).toEqual({ rows: 1, cols: MAX_COLS })
  expect(engine.getValue(2, 5, MAX_COLS - 1)).toBe(1)
})
