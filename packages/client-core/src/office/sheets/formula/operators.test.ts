import { describe, expect, it } from 'vitest'
import { FormulaEngine } from './engine.js'
import { testFunctions } from './testing.js'
import { Errors, isError, isMatrix, type Matrix, type Scalar } from './types.js'
import { numberToText } from './values.js'

function setup(): FormulaEngine {
  const engine = new FormulaEngine({ functions: testFunctions() })
  engine.setSheets(['Sheet1'])
  // A1 is blank; B1 = 5; C1 = "text"; D1 = TRUE.
  engine.setCell(0, 0, 1, { value: 5 })
  engine.setCell(0, 0, 2, { value: 'text' })
  engine.setCell(0, 0, 3, { value: true })
  return engine
}

function show(value: Scalar | Matrix): unknown {
  if (isMatrix(value)) {
    const rows: unknown[][] = []
    for (let r = 0; r < value.rows; r++) rows.push(value.data.slice(r * value.cols, (r + 1) * value.cols).map(show))
    return rows
  }
  return isError(value) ? value.code : value
}

const engine = setup()
const run = (formula: string) => show(engine.evaluateFormula(formula, 0, 9, 9))

// Expected values are what Excel 365 shows for these formulas.
describe('operators', () => {
  it.each<[string, unknown]>([
    ['1+1', 2],
    ['"1"+"2"', 3],
    ['"3"*"4"', 12],
    ['TRUE+TRUE', 2],
    ['-TRUE', -1],
    ['-"2"', -2],
    ['+"a"', 'a'],
    ['"a"+1', '#VALUE!'],
    ['""+1', '#VALUE!'],
    ['A1+1', 1],
    ['A1&"x"', 'x'],
    ['B1*2', 10],
    ['C1*2', '#VALUE!'],
    ['D1*2', 2],
    ['1/0', '#DIV/0!'],
    ['A1/A1', '#DIV/0!'],
    ['0^0', '#NUM!'],
    ['0^-1', '#DIV/0!'],
    ['(-8)^(1/3)', '#NUM!'],
    ['(-8)^3', -512],
    ['-2^2', 4],
    ['2^3^2', 64],
    ['2^-1', 0.5],
    ['50%', 0.5],
    ['10%%', 0.001],
    ['1E308*10', '#NUM!'],
    ['1/3&""', '0.333333333333333'],
    ['2/3&""', '0.666666666666667'],
    ['10^15&""', '1E+15'],
    ['123456789012345&""', '123456789012345'],
    ['1234567890123456&""', '1.23456789012346E+15'],
    ['0.000001&""', '0.000001'],
    ['1.5E-10&""', '1.5E-10'],
    ['-0.5&""', '-0.5'],
    ['1&TRUE', '1TRUE'],
    ['TRUE&""', 'TRUE'],
    ['0.1+0.2=0.3', true],
    ['0.1+0.2', 0.30000000000000004],
    ['0.5-0.4-0.1', 0],
    ['(0.5-0.4-0.1)*1', -2.7755575615628914e-17],
    ['1=1.0000000000000002', true],
    ['"a"="A"', true],
    ['"a"<"B"', true],
    ['"abc"<"abd"', true],
    ['1<"a"', true],
    ['"z"<TRUE', true],
    ['FALSE<TRUE', true],
    ['"1"=1', false],
    ['A1=0', true],
    ['A1=""', true],
    ['A1=FALSE', true],
    ['A1<1', true],
    ['1<>1', false],
    ['2>=2', true],
    ['#N/A=1', '#N/A'],
    ['1=#N/A', '#N/A'],
    ['#DIV/0!+#N/A', '#DIV/0!'],
    ['"abc"&#REF!', '#REF!'],
    ['-#NUM!', '#NUM!'],
    ['{1,2}+{10;20}', [[11, 12], [21, 22]]],
    ['{1,2,3}+{1,2}', [[2, 4, '#N/A']]],
    ['{1,2}*2', [[2, 4]]],
    ['-{1,-2}', [[-1, 2]]],
    ['{1,2}>1', [[false, true]]],
    ['UNKNOWNFN(1)', '#NAME?'],
    ['NoSuchName', '#NAME?'],
    ['Nope!A1', '#REF!'],
    ['[1]Sheet1!A1', '#REF!'],
    ['A1:B1 C1:D1', '#NULL!'],
    ['1:1 A:A', 0],
    ['SUM((B1,D1))', 5],
    ['SUM((B1,D1),D1)', 5],
    ['@{7,8}', 7],
    ['_xlfn.CONCAT("a","b")', 'ab'],
    ['_xlfn._xlws.CONCAT("a")', 'a'],
  ])('%s', (formula, expected) => {
    expect(run(formula)).toEqual(expected)
  })

  it('rejects text longer than 32767 characters', () => {
    engine.setCell(0, 0, 4, { value: 'x'.repeat(20000) })
    engine.setCell(0, 0, 5, { value: 'y'.repeat(13000) })
    expect(run('E1&F1')).toBe('#VALUE!')
    expect(run('LEN(E1&E1)')).toBe('#VALUE!')
    expect(run('LEN(E1&"y")')).toBe(20001)
  })

  it('formats numbers like General', () => {
    expect(numberToText(0)).toBe('0')
    expect(numberToText(-0)).toBe('0')
    expect(numberToText(100)).toBe('100')
    expect(numberToText(1e21)).toBe('1E+21')
    expect(numberToText(0.1 + 0.2)).toBe('0.3')
    expect(numberToText(123.456)).toBe('123.456')
    expect(numberToText(1e-9)).toBe('0.000000001')
    expect(numberToText(-1.23e-12)).toBe('-1.23E-12')
    expect(numberToText(999999999999999.9)).toBe('1E+15')
  })

  it('exposes error constants that compare by code', () => {
    expect(run('#N/A')).toBe(Errors.NA.code)
  })
})
