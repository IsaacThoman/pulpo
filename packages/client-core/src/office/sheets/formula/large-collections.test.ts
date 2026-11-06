import { describe, expect, it } from 'vitest'
import { FormulaEngine } from './engine.js'
import { functionRegistry } from './functions/index.js'
import { call, createContext } from './functions/testing.js'
import { testFunctions } from './testing.js'
import { isMatrix, matrix, matrixGet } from './types.js'

const count = 150_000
const sequence = 'SEQUENCE(150000)'

function engine(): FormulaEngine {
  const engine = new FormulaEngine({ functions: functionRegistry() })
  engine.setSheets(['Sheet1'])
  return engine
}

describe('formula collections above the JavaScript call argument limit', () => {
  it.each([
    [`MAXIFS(${sequence},${sequence},">0")`, count],
    [`MINIFS(${sequence},${sequence},">0")`, 1],
    [`MAXIFS(-${sequence},${sequence},">0")`, -1],
    [`MINIFS(${sequence},${sequence},">150000")`, 0],
    [`MAXIFS(${sequence},${sequence},">150000")`, 0],
    [`SUBTOTAL(4,${sequence})`, count],
    [`SUBTOTAL(5,${sequence})`, 1],
    [`SUBTOTAL(104,${sequence})`, count],
    [`SUBTOTAL(105,${sequence})`, 1],
    [`AGGREGATE(4,0,${sequence})`, count],
    [`AGGREGATE(5,0,${sequence})`, 1],
    [`DMAX(VSTACK("value",${sequence}),1,{"value";">0"})`, count],
    [`DMIN(VSTACK("value",${sequence}),1,{"value";">0"})`, 1],
    [`MAX(HSTACK(${sequence},-${sequence}))`, count],
    [`MIN(VSTACK(${sequence},-${sequence}))`, -count],
    [`MAX(MAP(${sequence},LAMBDA(n,n)))`, count],
    [`INDEX(SORTBY(${sequence},${sequence},-1),1)`, count],
  ])('%s', (formula, expected) => {
    expect(engine().evaluateFormula(formula)).toBe(expected)
  })

  it('splits 150k rows of text without spreading row widths', () => {
    const value = call('TEXTSPLIT', ['a\n'.repeat(count - 1) + 'z', ',', '\n'])
    expect(isMatrix(value)).toBe(true)
    if (!isMatrix(value)) return
    expect(value.rows).toBe(count)
    expect(value.cols).toBe(1)
    expect(matrixGet(value, count - 1, 0)).toBe('z')
  })

  it('reduces large arrays in the evaluator testing registry too', () => {
    const values = matrix(count, 1, Array.from({ length: count }, (_, i) => i + 1))
    const ctx = createContext()
    expect(testFunctions().get('MAX')!.fn(ctx, [values])).toBe(count)
    expect(testFunctions().get('MIN')!.fn(ctx, [values])).toBe(1)
    const stacked = testFunctions().get('VSTACK')!.fn(ctx, [values, 0])
    expect(isMatrix(stacked) && stacked.rows).toBe(count + 1)
    expect(isMatrix(stacked) && matrixGet(stacked, count - 1, 0)).toBe(count)
  })
})
