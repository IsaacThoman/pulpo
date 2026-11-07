import { describe, expect, it } from 'vitest'
import { MAX_COLS, MAX_ROWS, parseCellName } from '../address.js'
import { OWNED_FUNCTIONS } from './builtins.js'
import { functionRegistry } from './functions/index.js'
import { FormulaEngine } from './engine.js'
import { forEachLogical } from './ranges.js'
import { Errors, isError, isMatrix, logicalSize, matrix, matrixGet, type Scalar } from './types.js'

function book(): FormulaEngine {
  const engine = new FormulaEngine({ functions: functionRegistry(), random: () => 0.5, now: () => 1_700_000_000_000 })
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

// The engine must not change results when an unrelated cell expands its stored prefix.
// In addition to the dense/compact registry test, exercise the actual whole-axis read path
// for every registered function, including scalar functions that lift over ranges.
function canonical(value: ReturnType<FormulaEngine['evaluateFormula']>): unknown {
  if (!isMatrix(value)) return value
  const runs: { value: Scalar; count: number }[] = []
  forEachLogical(value, (cell, count) => {
    const last = runs.at(-1)
    if (last && (last.value === cell || isError(last.value) && isError(cell) && last.value.code === cell.code)) last.count += count
    else runs.push({ value: cell, count })
  }, { weightedTail: true })
  return { ...logicalSize(value), runs }
}

// Owned functions are dispatched before the library registry. Valid argument templates keep
// geometry functions (and lazy/lambda functions) off meaningless argument-error paths.
const ownedRangeCases: Record<string, string[]> = {
  IF: ['IF(TRUE,R,0)'], IFS: ['IFS(TRUE,R)'],
  IFERROR: ['IFERROR(R,7)'], IFNA: ['IFNA(R,7)'],
  SWITCH: ['SWITCH(1,1,R)'], CHOOSE: ['CHOOSE(1,R)'],
  LET: ['LET(x,R,x)'], LAMBDA: ['LAMBDA(x,x)(R)'],
  ISOMITTED: ['LAMBDA(x,ISOMITTED(x))(R)'],
  MAP: ['MAP(R,LAMBDA(x,x+1))'], REDUCE: ['REDUCE(0,TAKE(R,100,100),LAMBDA(x,y,x+y))'],
  SCAN: ['SCAN(0,R,LAMBDA(x,y,x+y))'],
  BYROW: ['BYROW(R,LAMBDA(x,SUM(x)))'], BYCOL: ['BYCOL(R,LAMBDA(x,SUM(x)))'],
  MAKEARRAY: ['MAKEARRAY(1,COLUMNS(R),LAMBDA(x,y,y))'],
  ROW: ['ROW(R)'], COLUMN: ['COLUMN(R)'], ROWS: ['ROWS(R)'], COLUMNS: ['COLUMNS(R)'],
  AREAS: ['AREAS(R)', 'AREAS((R,Sheet2!A1))'], OFFSET: ['OFFSET(R,0,0)'],
  INDIRECT: ['INDIRECT("R")'], INDEX: ['INDEX(R,0,0)', 'INDEX((Sheet2!A1,R),0,0,2)'],
  ISREF: ['ISREF(R)', 'ISREF(INDEX(R,0,0))'],
  ISFORMULA: ['ISFORMULA(R)'], FORMULATEXT: ['FORMULATEXT(R)'],
  CELL: ['CELL("address",R)', 'CELL("row",R)', 'CELL("col",R)', 'CELL("contents",R)'],
  INFO: ['IF(ISREF(R),INFO("numfile"))'], SHEET: ['SHEET(R)'], SHEETS: ['SHEETS(R)'],
}

function geometryProbes(formula: string): string[] {
  return [formula, `INDEX(${formula},100,1)`, `INDEX(${formula},1,100)`, `ROWS(${formula})`, `COLUMNS(${formula})`]
}

function expectAxisInvariant(template: string, horizontal: boolean, empty: boolean): void {
  const engine = book()
  if (!empty) {
    set(engine, 0, 'A1', 2)
    set(engine, 0, horizontal ? 'B1' : 'A2', 3)
  }
  const axis = horizontal ? '1:1' : 'A:A'
  const full = horizontal ? 'A1:XFD1' : `A1:A${MAX_ROWS}`
  const formula = template.replaceAll('__RANGE__', `Sheet1!${axis}`)
  const probes = geometryProbes(formula)
  const before = probes.map((probe) => canonical(engine.evaluateFormula(probe, 2)))
  const compare = (): void => {
    probes.forEach((probe, i) => {
      expect(canonical(engine.evaluateFormula(probe, 2)), probe).toEqual(before[i])
      expect(canonical(engine.evaluateFormula(probe.replaceAll(axis, full), 2)), probe).toEqual(before[i])
    })
  }
  compare()
  // Extending both axes still leaves the probes at row/column 100 outside the used area.
  set(engine, 0, 'K11', 99)
  compare()
}

describe('registry whole-axis invariance', () => {
  it('covers every evaluator-owned function as well as the library registry', () => {
    expect(Object.keys(ownedRangeCases).sort()).toEqual([...OWNED_FUNCTIONS.keys()].sort())
  })
  for (const [name, templates] of Object.entries(ownedRangeCases)) {
    it(`evaluator ${name}`, () => {
      for (const horizontal of [false, true]) for (const empty of [true, false]) {
        for (const template of templates) expectAxisInvariant(template.replaceAll(/\bR\b/g, '__RANGE__'), horizontal, empty)
      }
    })
  }
  for (const spec of functionRegistry().values()) {
    it(spec.name, () => {
      for (const horizontal of [false, true]) for (const empty of [true, false]) {
        for (const transform of ['__RANGE__', '1/(__RANGE__)', '(__RANGE__+1)']) {
          const count = spec.maxArgs <= 8 ? spec.maxArgs : spec.minArgs + 1
          for (let pos = 0; pos < count; pos++) {
            const args = Array.from({ length: count }, (_, i) => i === pos ? transform : '1')
            expectAxisInvariant(`${spec.name}(${args.join(',')})`, horizontal, empty)
          }
        }
      }
    })
  }
})

describe('reference geometry beyond the populated prefix', () => {
  for (const horizontal of [false, true]) {
    const axis = horizontal ? '1:1' : 'A:A'
    const full = horizontal ? 'A1:XFD1' : `A1:A${MAX_ROWS}`
    const length = horizontal ? MAX_COLS : MAX_ROWS
    const rows = horizontal ? 1 : length
    const cols = horizontal ? length : 1
    const coordinate = horizontal ? 'COLUMN' : 'ROW'
    const index = horizontal ? '1,100' : '100,1'
    const last = horizontal ? `1,${length}` : `${length},1`
    const dimension = horizontal ? 'COLUMNS' : 'ROWS'
    const take = horizontal ? ',,100' : ',100'
    const drop = horizontal ? ',,99' : ',99'
    const choose = horizontal ? 'CHOOSECOLS' : 'CHOOSEROWS'
    const formulas: [string, Scalar][] = [
      ['ROWS(R)', rows], ['COLUMNS(R)', cols], ['AREAS(R)', 1], ['ISREF(R)', true],
      ['AREAS((R,Sheet2!A1))', 2],
      ['CELL("address",R)', 'Sheet1!$A$1'],
      ['CELL("row",R)', 1], ['CELL("col",R)', 1],
      ['ISREF(INDEX(R,0,0))', true], ['ISREF(OFFSET(R,0,0))', true],
      [`${dimension}(OFFSET(R,0,0))`, length],
      [`${dimension}(INDEX((Sheet2!A1,R),0,0,2))`, length],
      [`INDEX(OFFSET(R,0,0),${index})`, 0],
      [`INDEX(INDEX(R,0,0),${last})`, 0],
      [`${coordinate}(INDEX(R,${index}))`, 100],
      [`CELL("${horizontal ? 'col' : 'row'}",INDEX(R,${index}))`, 100],
      [`INDEX(TAKE(R${take}),${index})`, 0],
      [`${dimension}(TAKE(R${take}))`, 100],
      [`INDEX(DROP(R${drop}),${index})`, 0],
      [`${dimension}(DROP(R${drop}))`, length - 99],
      [`INDEX(${choose}(R,100,-1),${horizontal ? '1,2' : '2,1'})`, 0],
      [`${dimension}(${choose}(R,100,-1))`, 2],
      [`INDEX(EXPAND(TAKE(R${take}),${horizontal ? '1,101' : '101,1'},7),${index})`, 0],
      [`INDEX(EXPAND(TAKE(R${take}),${horizontal ? '1,101' : '101,1'},7),${horizontal ? '1,101' : '101,1'})`, 7],
      [`${dimension}(EXPAND(TAKE(R${take}),${horizontal ? '1,101' : '101,1'}))`, 101],
      // Nonuniform coordinate arrays must respect the materialization limit, independent of data.
      [`INDEX(${coordinate}(R),${index})`, horizontal ? 100 : Errors.NUM],
      [`${dimension}(${coordinate}(R))`, horizontal ? length : Errors.NUM],
      [`INDEX(SEQUENCE(ROWS(R),COLUMNS(R)),${index})`, horizontal ? 100 : Errors.NUM],
      [`${dimension}(SEQUENCE(ROWS(R),COLUMNS(R)))`, horizontal ? length : Errors.NUM],
      [`INDEX(ROW(OFFSET(R,0,0,100,1)),100)`, 100],
      [`INDEX(COLUMN(OFFSET(R,0,0,1,100)),1,100)`, 100],
    ]
    it.each(formulas)(`${axis}: %s`, (template, expected) => {
      const engine = book()
      for (const stage of ['empty', 'small', 'expanded']) {
        if (stage === 'small') set(engine, 0, 'B2', 7)
        if (stage === 'expanded') set(engine, 0, 'CV20', 99)
        for (const range of [axis, full]) {
          const formula = template.replaceAll(/\bR\b/g, `Sheet1!${range}`)
          expect(engine.evaluateFormula(formula, 2), `${stage}: ${formula}`).toEqual(expected)
        }
      }
    })
  }

  it('reproduces COLUMN(1:1) versus the 100-column explicit range', () => {
    const engine = book()
    for (const range of ['1:1', 'A1:CV1']) {
      expect(engine.evaluateFormula(`INDEX(COLUMN(${range}),1,100)`)).toBe(100)
    }
  })

  it('preserves shifted coordinate origins and rejects oversized nonuniform arrays', () => {
    const engine = book()
    for (const [formula, expected] of [
      ['INDEX(ROW(Sheet1!A100:A199),100)', 199],
      ['ROWS(ROW(Sheet1!A100:A199))', 100],
      ['INDEX(COLUMN(Sheet1!CV1:XFD1),1,100)', 199],
      ['COLUMNS(COLUMN(Sheet1!CV1:XFD1))', MAX_COLS - 99],
      ['ROWS(ROW(Sheet1!A1:A1000001))', Errors.NUM],
      ['COLUMN(Sheet1!A:A)', 1], ['ROW(Sheet1!1:1)', 1],
    ] as const) expect(engine.evaluateFormula(formula, 2), formula).toEqual(expected)
  })

  it('sizes coordinate and reference spills from logical bounds on an empty sheet', () => {
    const engine = book()
    engine.setCell(2, 0, 0, { formula: 'COLUMN(Sheet1!1:1)' })
    engine.setCell(2, 1, 1, { formula: 'COLUMN(Sheet1!1:1)' })
    engine.setCell(2, 2, 0, { formula: 'ROW(Sheet1!A:A)' })
    engine.setCell(2, 3, 0, { formula: 'OFFSET(Sheet1!1:1,0,0)' })
    engine.setCell(2, 4, 0, { formula: 'INDEX(Sheet1!1:1,0,0)' })
    engine.setCell(2, 5, 0, { formula: 'TAKE(Sheet1!A:A,100)' })
    for (const expanded of [false, true]) {
      if (expanded) set(engine, 0, 'CV20', 99)
      engine.recalc({ full: true })
      expect(engine.getSpill(2, 0, 0)).toEqual({ rows: 1, cols: MAX_COLS })
      expect(engine.getValue(2, 0, 99)).toBe(100)
      expect(engine.getValue(2, 0, MAX_COLS - 1)).toBe(MAX_COLS)
      expect(engine.getValue(2, 1, 1)).toEqual(Errors.SPILL)
      expect(engine.getValue(2, 2, 0)).toEqual(Errors.NUM)
      for (const row of [3, 4]) {
        expect(engine.getSpill(2, row, 0)).toEqual({ rows: 1, cols: MAX_COLS })
        expect(engine.getValue(2, row, 99)).toBe(0)
      }
      expect(engine.getSpill(2, 5, 0)).toEqual({ rows: 100, cols: 1 })
      expect(engine.getValue(2, 104, 0)).toBe(0)
    }
  })
})

it('joins logical blanks with bounded text output, including cycling delimiter ranges', () => {
  const engine = book()
  set(engine, 0, 'A1', 'a')
  expect(engine.evaluateFormula('TEXTJOIN(",",FALSE,Sheet1!A:A)', 2)).toEqual(Errors.VALUE)
  expect(engine.evaluateFormula('TEXTJOIN(",",FALSE,Sheet1!A1:A10)', 2)).toBe('a,,,,,,,,,')
  expect(engine.evaluateFormula('TEXTJOIN(",",TRUE,Sheet1!A:A)', 2)).toBe('a')
  expect(engine.evaluateFormula('TEXTJOIN("",FALSE,Sheet1!A:A)', 2)).toBe('a')
  expect(engine.evaluateFormula('CONCAT(Sheet1!A:A)', 2)).toBe('a')
  expect(engine.evaluateFormula('ARRAYTOTEXT(Sheet1!A:A)', 2)).toEqual(Errors.VALUE)
  expect(engine.evaluateFormula('ARRAYTOTEXT(Sheet1!A:A,1)', 2)).toEqual(Errors.VALUE)
  expect(engine.evaluateFormula('TEXTJOIN({"-",""},FALSE,Sheet1!A1:A10)', 2)).toBe('a-----')
  // A whole-column delimiter is a logical cycle with many empty entries, not just its prefix.
  expect(engine.evaluateFormula('TEXTJOIN(Sheet1!A:A,FALSE,{1,2,3,4})', 2)).toBe('1a234')
  expect(engine.evaluateFormula('TEXTJOIN("",FALSE,Sheet1!A:A&"x")', 2)).toEqual(Errors.VALUE)
})

it('streams counting and A-aggregates over transformed whole-column tails', () => {
  const engine = book()
  set(engine, 0, 'A1', 2)
  for (const [formula, expected] of [
    ['AVERAGEA(Sheet1!A:A+1)', (MAX_ROWS + 2) / MAX_ROWS],
    ['MINA(Sheet1!A:A+1)', 1], ['MAXA(Sheet1!A:A+1)', 3],
    ['PRODUCT(Sheet1!A:A+1)', 3], ['COUNT(Sheet1!A:A+1)', MAX_ROWS],
    ['COUNTA(Sheet1!A:A&"")', MAX_ROWS], ['COUNTBLANK(Sheet1!A:A&"")', MAX_ROWS - 1],
    ['SUBTOTAL(3,Sheet1!A:A&"")', MAX_ROWS],
  ] as const) expect(engine.evaluateFormula(formula, 2), formula).toBe(expected)
  expect(canonical(engine.evaluateFormula('IFERROR(1/Sheet1!A:A,7)', 2))).toEqual(canonical(engine.evaluateFormula(`IFERROR(1/Sheet1!A1:A${MAX_ROWS},7)`, 2)))
  expect(engine.evaluateFormula('INDEX(IFERROR(1/Sheet1!A:A,7),100)', 2)).toBe(7)
})


it('handles an error that exists only in an omitted tail lazily', () => {
  const source = { ...matrix(1, 1, [2]), logicalRows: MAX_ROWS, omittedValue: Errors.DIV0 }
  const functions = functionRegistry([
    { name: 'TAIL', minArgs: 0, maxArgs: 0, fn: () => source },
    { name: 'NATAIL', minArgs: 0, maxArgs: 0, fn: () => ({ ...source, omittedValue: Errors.NA }) },
  ])
  const engine = new FormulaEngine({ functions })
  engine.setSheets(['Results'])
  expect(engine.evaluateFormula('INDEX(IFERROR(TAIL(),7),100)')).toBe(7)
  expect(engine.evaluateFormula('INDEX(IFNA(TAIL(),7),100)')).toEqual(Errors.DIV0)
  expect(engine.evaluateFormula('INDEX(IFNA(NATAIL(),7),100)')).toBe(7)
  expect(engine.evaluateFormula('SUM(IFNA(NATAIL(),0))')).toBe(2)
})

// Cached results from LibreOffice 26.8.2.2, recalculated via a fresh headless profile.
// Calc permits strings beyond Excel's 32,767-character limit, so the full-column
// TEXTJOIN(FALSE) overflow remains an explicit Excel-limit test above.
it('matches the LibreOffice logical-range sample', () => {
  const engine = book()
  set(engine, 0, 'A1', 'a')
  set(engine, 0, 'B1', 2)
  set(engine, 0, 'B2', 3)
  for (const [formula, expected] of [
    ['TEXTJOIN(",",FALSE,Sheet1!A1:A10)', 'a,,,,,,,,,'],
    ['TEXTJOIN(",",TRUE,Sheet1!A:A)', 'a'], ['CONCAT(Sheet1!A:A)', 'a'],
    ['COUNTBLANK(Sheet1!A:A)', 1048575], ['COUNTA(Sheet1!A:A)', 1],
    ['COUNT(Sheet1!B:B)', 2], ['AVERAGEA(Sheet1!B:B)', 2.5],
    ['MINA(Sheet1!B:B)', 2], ['MAXA(Sheet1!B:B)', 3], ['PRODUCT(Sheet1!B:B)', 6],
    ['MATCH(3,Sheet1!B:B,0)', 2], ['ROWS(Sheet1!A:A)', 1048576], ['COLUMNS(Sheet1!1:1)', 16384],
  ] as const) expect(engine.evaluateFormula(formula, 2), formula).toBe(expected)
})


it('replaces whole-column division errors in reductions', () => {
  const engine = book()
  set(engine, 0, 'A1', 1)
  for (const range of ['Sheet1!A:A', 'Sheet1!A1:A10']) {
    expect(engine.evaluateFormula(`SUM(IFERROR(1/${range},0))`, 2)).toBe(1)
  }
  set(engine, 0, 'C11', 99)
  expect(engine.evaluateFormula('SUM(IFERROR(1/Sheet1!A:A,0))', 2)).toBe(1)
})

it('preserves errors and nonblank values in compact cached spills', () => {
  for (const tail of [Errors.NA, 7]) {
    const engine = book()
    const cached = { ...matrix(1, 1, [2]), logicalRows: 10, omittedValue: tail }
    engine.setCell(2, 0, 0, { formula: 'UNIMPLEMENTED()', cached })
    expect(engine.getSpill(2, 0, 0)).toEqual({ rows: 10, cols: 1 })
    expect(engine.getValue(2, 9, 0)).toEqual(tail)
  }
})
