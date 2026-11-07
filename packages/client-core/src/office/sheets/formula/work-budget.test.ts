import { beforeAll, describe, expect, it } from 'vitest'
import { FormulaEngine } from './engine.js'
import { EVALUATOR_FUNCTIONS } from './builtins.js'
import { functionRegistry } from './functions/index.js'
import { TEXT_FORMAT_FUNCTIONS } from './functions/text-format.js'

import { guardedEngine } from './budget-test-utils.js'

const targeted: Record<string, string[]> = {
  WORKDAY: ['1000000,1000000', '1000000,-500000'],
  'WORKDAY.INTL': ['1,300000,"1111110"', '2900000,-300000,"1111110"'],
  NETWORKDAYS: ['0,2958465', '2958465,0'],
  'NETWORKDAYS.INTL': ['0,2958465,"1111110"'],
  RATE: ['1000000,-1,1000000'], IRR: ['{-1,1,-1,1},0.000001'],
  XIRR: ['{-1,1,-1,1},{1,100,10000,2958465},0.000001'],
  PRICE: ['1,2958465,0.05,0.05,100,4'], YIELD: ['1,2958465,0.05,50,100,4'],
  COUPNUM: ['1,2958465,4'], COUPPCD: ['1,2958465,4'], COUPNCD: ['1,2958465,4'],
  COUPDAYS: ['1,2958465,4'], COUPDAYSNC: ['1,2958465,4'], COUPDAYBS: ['1,2958465,4'],
  CUMIPMT: ['0.000001,1000000,100,1,1000000,0'], CUMPRINC: ['0.000001,1000000,100,1,1000000,0'],
  VDB: ['100,1,1000000,0,1000000'], DB: ['100,1,1000000000000,1000000000000'],
  COMBIN: ['1000000000000,500000000000'], PERMUT: ['1000000000000,1000000000000'],
  FACT: ['170'], FACTDOUBLE: ['300'], MULTINOMIAL: ['1000000,1000000'], ROMAN: ['3999'],
  BASE: ['9007199254740991,2,255'], DECIMAL: [`"${'1'.repeat(255)}",2`],
  'BINOM.DIST.RANGE': ['1000000,0.5,0,1000000'],
  'BINOM.INV': ['1000000,0.5,0.5'], 'HYPGEOM.DIST': ['500000,1000000,1000000,2000000,TRUE'],
  'GAMMA.DIST': ['1000000,1000000,1,TRUE'], 'BETA.INV': ['0.5,1000000,1000000'],
  SUBSTITUTE: ['REPT("a",32767),"a","b",1000000000000'],
  REPT: ['"x",1000000000000', '"",1000000000000'],
  NUMBERVALUE: ['"1"&REPT("%",32766)'],
  ARABIC: ['REPT("I",255)'],
  PROPER: ['REPT("a",32767)'],
  TEXTSPLIT: ['REPT("a",32767),"b"'],
  TEXTJOIN: ['"",FALSE,REPT("x",32767),"x"'],
  SEQUENCE: ['1000000', '1000000000000'], RANDARRAY: ['1000000', '1000000000000'],
  MAKEARRAY: ['1000000,1,LAMBDA(r,c,r+c)'],
  MAP: ['A:A,LAMBDA(x,1)'], REDUCE: ['0,A:A,LAMBDA(a,x,a+1)'], SCAN: ['0,A:A,LAMBDA(a,x,a+1)'],
  BYROW: ['A:A,LAMBDA(x,1)'], BYCOL: ['1:1,LAMBDA(x,1)'],
  LET: ['f,LAMBDA(n,IF(n=0,0,f(n-1))),f(1000000000000)'],
  LAMBDA: ['n,n+1'],
  DATEDIF: ['1,2958465,"M"'], EDATE: ['1,1000000000000'], YEARFRAC: ['1,2958465,1'],
}

const functions = functionRegistry(TEXT_FORMAT_FUNCTIONS)
const names = [...new Set([...functions.keys(), ...EVALUATOR_FUNCTIONS])]
let guarded: ReturnType<typeof guardedEngine>

describe('registry-wide adversarial value budget', () => {
  beforeAll(() => { guarded = guardedEngine() })
  it('proves the watchdog detects an uncharged loop', () => {
    // Remove the real budget charge from a copy of SUBSTITUTE, proving this guard catches
    // the exact class of regression even when the interpreter turns the watchdog into #VALUE!.
    const unbudgeted = guardedEngine({ omitSubstituteCharge: true })
    const args = targeted.SUBSTITUTE![0]!
    expect(unbudgeted.run(`SUBSTITUTE(${args})`).tripped).toBe(true)
    expect(guarded.run(`SUBSTITUTE(${args})`).stoppedEarly).toBe(true)
  })
  for (const name of names) {
    it(name, () => {
      const spec = functions.get(name)
      const count = spec ? Math.min(spec.maxArgs, Math.max(spec.minArgs, 8)) : 4
      const cases = new Set(targeted[name] ?? [])
      // Every registry addition is covered automatically, at minimum and optional arities,
      // with each position varied independently and all positions huge together.
      for (const length of new Set([spec?.minArgs ?? 1, count])) {
        for (const value of ['1000000', '1000000000000', '-1000000000000', '1e100', '1e308']) {
          cases.add(Array(length).fill(value).join(','))
          for (let pos = 0; pos < length; pos++) cases.add(Array.from({ length }, (_, i) => i === pos ? value : '1').join(','))
        }
      }
      for (const args of cases) {
        const formula = `${name}(${args})`
        const result = guarded.run(formula)
        expect(result.tripped, `${formula.slice(0, 160)} exceeded ${result.iterations} independent loop iterations`).toBe(false)
        expect(result.stoppedEarly || result.ms < 100, `${name} took ${result.ms}ms`).toBe(true)
      }
    })
  }
})

it('propagates exhausted budgets through nested and lifted calls and lambda combinators', () => {
  for (const formula of [
    'SUM(WORKDAY.INTL(SEQUENCE(500),300000,"1111110"))',
    'CUMIPMT(0.000001,1000000,100,1,1000000,0)',
    'VDB(100,1,1000000,0,1000000)',
    'SUM(MAP(SEQUENCE(10),LAMBDA(x,BINOM.DIST.RANGE(1000000,0.5,0,1000000))))',
    'REDUCE(0,A1:A10000,LAMBDA(a,x,a+1))', 'SCAN(0,A1:A10000,LAMBDA(a,x,a+1))',
    'MAP(A1:A10000,LAMBDA(x,1))', 'BYROW(A1:A10000,LAMBDA(x,1))', 'MAKEARRAY(1000000,1,LAMBDA(r,c,1))',
    'LET(f,LAMBDA(n,IF(n=0,0,f(n-1))),f(1000000000000))',
    'IFERROR(VDB(100,1,1000000,0,1000000),0)',
  ]) {
    const engine = new FormulaEngine({ functions, maxWork: 100 })
    engine.setSheets(['Sheet1'])
    engine.setCell(0, 2, 2, { formula })
    expect(engine.recalc().stoppedEarly, formula).toBe(true)
  }
})

// Inputs stay small enough to pass argument-size charges. Their product exceeds the budget.
const shapeCases: Record<string, string[]> = {
  ...Object.fromEntries(['DSUM', 'DAVERAGE', 'DCOUNT', 'DCOUNTA', 'DMAX', 'DMIN', 'DPRODUCT', 'DSTDEV', 'DSTDEVP', 'DVAR', 'DVARP', 'DGET'].map((name) => [name, ['A1:A513,1,B1:B513']])),
  COUNTIF: ['A2:A513,B2:B513'], SUMIF: ['A2:A513,B2:B513,A2:A513'], AVERAGEIF: ['A2:A513,B2:B513,A2:A513'],
  COUNTIFS: ['A2:A513,B2:B513', Array(64).fill('A2:A513,1').join(',')],
  SUMIFS: ['A2:A513,A2:A513,B2:B513', 'A2:A513,' + Array(64).fill('A2:A513,1').join(',')],
  AVERAGEIFS: ['A2:A513,A2:A513,B2:B513'], MAXIFS: ['A2:A513,A2:A513,B2:B513'], MINIFS: ['A2:A513,A2:A513,B2:B513'],
  MATCH: ['B2:B513,A2:A513,0', 'E2:E513,D2:D513,0'],
  XMATCH: ['B2:B513,A2:A513,0', 'E2:E513,D2:D513,2'],
  XLOOKUP: ['B2:B513,A2:A513,A2:A513', 'E2:E513,D2:D513,A2:A513,,2'],
  VLOOKUP: ['B2:B513,A2:A513,1,FALSE'], HLOOKUP: ['B2:B513,A2:SS2,1,FALSE'],
  FREQUENCY: ['B2:B513,A2:A513'],
  SORT: ['A2:A513,TRANSPOSE(A2:A513)', 'F2:F513'], SORTBY: ['A2:A513,' + Array(40).fill('A2:A513,1').join(',')],
  UNIQUE: ['A2:B513'], FILTER: ['A2:B513,A2:A513'], TRANSPOSE: ['A2:B513'],
  MMULT: ['G2:AL33,G2:AL33'],
  MAP: ['A2:A513,LAMBDA(x,SUM(B2:B513))'],
  REDUCE: ['0,A2:A513,LAMBDA(a,x,a+SUM(B2:B513))'], SCAN: ['0,A2:A513,LAMBDA(a,x,a+SUM(B2:B513))'],
  BYROW: ['A2:A513,LAMBDA(x,SUM(B2:B513))'], BYCOL: ['TRANSPOSE(A2:A513),LAMBDA(x,SUM(B2:B513))'],
  MAKEARRAY: ['512,1,LAMBDA(r,c,SUM(B2:B513))'],
  TEXTSPLIT: ['REPT("a",1000),D2:D513', '"a",,";"'],
}

describe('registry-wide adversarial shape budget', () => {
  let shape: ReturnType<typeof guardedEngine>
  const populate = (engine: FormulaEngine) => {
    engine.setCell(0, 0, 0, { value: 'value' })
    engine.setCell(0, 0, 1, { value: 'value' })
    for (let row = 1; row <= 512; row++) {
      for (const [col, value] of [[0, 1], [1, 2], [3, 'a'.repeat(30) + 'b'], [4, '*a*a*a*a*c'], [5, (row * 137) % 512]] as const) engine.setCell(0, row, col, { value })
    }
    for (let row = 1; row <= 32; row++) for (let col = 6; col < 38; col++) engine.setCell(0, row, col, { value: 1 })
  }
  beforeAll(() => {
    shape = guardedEngine({ maxWork: 12_000, maxIterations: 100_000, callbacks: true })
    populate(shape.engine)
  })
  it('detects missing predicate charges inside native array callbacks', () => {
    const unbudgeted = guardedEngine({ omitShapeCharges: true, maxWork: 12_000, maxIterations: 100_000, callbacks: true })
    populate(unbudgeted.engine)
    expect(unbudgeted.run('DSUM(A1:A513,1,B1:B513)').tripped).toBe(true)
    expect(shape.run('DSUM(A1:A513,1,B1:B513)').stoppedEarly).toBe(true)
  })
  it('charges sorting comparisons beyond linear input sizes', () => {
    const sorted = guardedEngine({ maxWork: 4_000, maxIterations: 100_000, callbacks: true })
    populate(sorted.engine)
    expect(sorted.run('SORT(F2:F513)').stoppedEarly).toBe(true)
  })
  for (const name of names) it(name, () => {
    const spec = functions.get(name)
    const cases = new Set(shapeCases[name] ?? [])
    // New functions automatically get pairs of range arguments at each accepted position,
    // including crossed row/column shapes. Targeted cases above exercise valid quadratic paths.
    const count = spec ? Math.min(spec.maxArgs, Math.max(spec.minArgs, 3)) : 3
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      for (const other of ['B2:B513', 'TRANSPOSE(B2:B513)']) cases.add(Array.from({ length: count }, (_, k) => k === i ? 'A2:A513' : k === j ? other : '1').join(','))
    }
    for (const args of cases) {
      const formula = `${name}(${args})`
      const result = shape.run(formula)
      expect(result.tripped, `${formula.slice(0, 160)} exceeded ${result.iterations} independent iterations`).toBe(false)
    }
  })
  for (const formula of ['A2:A513+TRANSPOSE(B2:B513)', 'A2:A513&TRANSPOSE(B2:B513)', 'IFERROR(DSUM(A1:A513,1,B1:B513),0)', ...Object.entries(shapeCases).flatMap(([name, cases]) => cases.map((args) => `${name}(${args})`))]) {
    // Linear functions may complete; every expensive path must actually stop early.
    if (/^(UNIQUE|FILTER|TRANSPOSE)\(/.test(formula) || formula === 'TEXTSPLIT("a",,";")' || formula === 'SORT(F2:F513)') continue
    it(`stops ${formula.slice(0, 100)}`, () => {
      expect(shape.run(formula).stoppedEarly, formula).toBe(true)
    })
  }
})

it('interrupts the reported 10,000 by 10,000 database scan in the production engine', () => {
  const engine = new FormulaEngine({ functions, maxWork: 100_000 })
  engine.setSheets(['Sheet1'])
  for (const col of [0, 1]) engine.setCell(0, 0, col, { value: 'value' })
  for (let row = 1; row <= 10_000; row++) {
    engine.setCell(0, row, 0, { value: 1 })
    engine.setCell(0, row, 1, { value: 2 })
  }
  engine.setCell(0, 0, 2, { formula: 'DSUM(A1:A10001,1,B1:B10001)' })
  expect(engine.recalc().stoppedEarly).toBe(true)
})
