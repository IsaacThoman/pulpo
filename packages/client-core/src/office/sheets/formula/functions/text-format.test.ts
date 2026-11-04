import { describe, expect, it } from 'vitest'
import { Errors, type FunctionContext, matrix, type Value } from '../types.js'
import { TEXT_FORMAT_FUNCTIONS } from './text-format.js'

function context(date1904 = false): FunctionContext {
  const unused = () => {
    throw new Error('not used by text functions')
  }
  return { date1904, sheet: 0, row: 0, col: 0, now: () => 45292, random: () => 0, resolve: unused, resolveAreas: unused, call: unused }
}

function call(name: string, ...args: (Value | undefined)[]): Value {
  const spec = TEXT_FORMAT_FUNCTIONS.find((candidate) => candidate.name === name)!
  return spec.fn(context(), args)
}

type Case = [string, (Value | undefined)[], Value]

const cases = (name: string, table: [(Value | undefined)[], Value][]): Case[] => table.map(([args, expected]) => [name, args, expected])

describe('text and format functions', () => {
  it.each<Case>([
    ...cases('TEXT', [
      [[1234.567, '#,##0.00'], '1,234.57'],
      [[0.256, '0%'], '26%'],
      [[45321, 'yyyy-mm-dd'], '2024-01-30'],
      [['45321', 'yyyy-mm-dd'], '2024-01-30'],
      [['1/30/2024', 'dddd'], 'Tuesday'],
      [['abc', '0.00'], 'abc'],
      [['abc', '@ "x"'], 'abc x'],
      [[true, '0'], 'TRUE'],
      [[null, '0.00'], '0.00'],
      [[undefined, '0.00'], '0.00'],
      [[Errors.NA, '0'], Errors.NA],
      [[1, Errors.DIV0], Errors.DIV0],
      [[1, ''], ''],
      [[-1, 'm/d/yyyy'], Errors.VALUE],
      [[1 / 3, '@'], '0.333333333333333'],
      [[1 / 3, 'General'], '0.333333333'],
      [[1234.5, '$#,##0.00_);($#,##0.00)'], '$1,234.50 '],
      [[-1234.5, '$#,##0.00_);($#,##0.00)'], '($1,234.50)'],
      [[1234.5, '0.00*-'], '1234.50'],
      [[1, '"abc'], Errors.VALUE],
      [[5, 5], '5'],
      [[0.5, 'h:mm AM/PM'], '12:00 PM'],
      [[1234567, '#,##0,"K"'], '1,235K'],
      [[12, '000'], '012'],
      [[1.5, '# ?/?'], '1 1/2'],
      [[12345, '0.00E+00'], '1.23E+04'],
      [[0.1 + 0.2, '0.00000000000000000'], '0.30000000000000000'],
      [[-5, '[>100]0;[<-100]0'], '-5'],
      [['50%', '0.0'], '0.5'],
      [[1.5, '[h]:mm'], '36:00'],
      [[1234.5, '[Red]#,##0'], '1,235'],
      [[matrix(1, 1, [1]), '0'], Errors.VALUE],
    ]),
    ...cases('VALUE', [
      [['123'], 123],
      [['$1,000'], 1000],
      [['50%'], 0.5],
      [['(12)'], -12],
      [['1e3'], 1000],
      [['abc'], Errors.VALUE],
      [[''], Errors.VALUE],
      [[5], 5],
      [[true], Errors.VALUE],
      [[null], 0],
      [['1/31/2024'], 45322],
      [['13:45'], 0.5729166666666666],
      [[Errors.NA], Errors.NA],
      [[' 12 '], 12],
      [['1,23'], Errors.VALUE],
    ]),
    ...cases('NUMBERVALUE', [
      [['2.500,27', ',', '.'], 2500.27],
      [['3.5%'], 0.035],
      [['9%%'], 0.0009],
      [[' 1 234 '], 1234],
      [[''], 0],
      [[null], 0],
      [['1,234.5'], 1234.5],
      [['1.2.3'], Errors.VALUE],
      [['1.5,2'], Errors.VALUE],
      [['1,5', ',', ','], Errors.VALUE],
      [['abc'], Errors.VALUE],
      [[5], 5],
      [[true], Errors.VALUE],
      [['1e3'], 1000],
      [['-1,000'], -1000],
      [['1', ''], Errors.VALUE],
      [['1.000,5', ',.', '.,'], 1000.5],
      [['%'], Errors.VALUE],
      [['12', ','], 12],
      [['1,5', ','], 1.5],
      [['1.234,5', ','], 1234.5],
      [['1.5', undefined, '.'], 15],
      [[Errors.REF], Errors.REF],
      [['1', Errors.NA], Errors.NA],
      [['1 000,25', ',', ' '], 1000.25],
    ]),
    ...cases('DATEVALUE', [
      [['1/31/2024'], 45322],
      [['2024-01-31'], 45322],
      [['31-Jan-2024'], 45322],
      [['January 31, 2024'], 45322],
      [['1/31/2024 13:45'], 45322],
      [['13:45'], Errors.VALUE],
      [['abc'], Errors.VALUE],
      [[45322], Errors.VALUE],
      [[true], Errors.VALUE],
      [[null], Errors.VALUE],
      [['2/29/1900'], 60],
      [['1/1/1900'], 1],
      [['12/31/1899'], Errors.VALUE],
      [['12/31/9999'], 2958465],
      [[Errors.NA], Errors.NA],
      [['5'], Errors.VALUE],
    ]),
    ...cases('TIMEVALUE', [
      [['12:00 PM'], 0.5],
      [['1/31/2024 6:00 PM'], 0.75],
      [['1/31/2024'], 0],
      [['12:00 AM'], 0],
      [['abc'], Errors.VALUE],
      [[0.5], Errors.VALUE],
      [['5'], Errors.VALUE],
      [[Errors.DIV0], Errors.DIV0],
    ]),
    ...cases('DOLLAR', [
      [[1234.567], '$1,234.57'],
      [[1234.567, 1], '$1,234.6'],
      [[-1234.567], '($1,234.57)'],
      [[1234.567, -2], '$1,200'],
      [[-1234.567, -2], '($1,200)'],
      [[0.5, 0], '$1'],
      [[-0.001], '$0.00'],
      [['5'], '$5.00'],
      [['abc'], Errors.VALUE],
      [[1, 128], Errors.VALUE],
      [[1234.5, 1.9], '$1,234.5'],
      [[99.995], '$100.00'],
      [[0], '$0.00'],
      [[null], '$0.00'],
      [[Errors.NA], Errors.NA],
      [[1, Errors.REF], Errors.REF],
      [[1.005, 2], '$1.01'],
    ]),
    ...cases('FIXED', [
      [[1234.567], '1,234.57'],
      [[1234.567, 1], '1,234.6'],
      [[-1234.567, 1], '-1,234.6'],
      [[1234.567, -1], '1,230'],
      [[-1234.567, -1, true], '-1230'],
      [[44.332], '44.33'],
      [[1234.5, 0, true], '1235'],
      [[2.5, 0], '3'],
      [[-2.5, 0], '-3'],
      [[1, 2, 'x'], Errors.VALUE],
      [[1e15, 0], '1,000,000,000,000,000'],
      [[1234.5, 2, 1], '1234.50'],
      [[-0.001, 2], '0.00'],
      [[1, 128], Errors.VALUE],
      [[1.5, 3], '1.500'],
      [['abc'], Errors.VALUE],
    ]),
    ...cases('VALUETOTEXT', [
      [['abc'], 'abc'],
      [['abc', 1], '"abc"'],
      [[1 / 3], '0.333333333333333'],
      [[true], 'TRUE'],
      [[false, 1], 'FALSE'],
      [[Errors.NA], '#N/A'],
      [[Errors.DIV0, 1], '#DIV/0!'],
      [[null], ''],
      [[5, 1], '5'],
      [[5, 2], Errors.VALUE],
      [['a"b', 1], '"a""b"'],
      [[1e20], '1E+20'],
      [[5, Errors.REF], Errors.REF],
      [[45321.75], '45321.75'],
    ]),
  ])('%s(%j) → %j', (name, args, expected) => {
    const result = call(name, ...args)
    if (typeof expected === 'number') expect(result).toBeCloseTo(expected, 12)
    else expect(result).toEqual(expected)
  })

  it('uses the 1904 date system from the context', () => {
    const spec = (name: string) => TEXT_FORMAT_FUNCTIONS.find((candidate) => candidate.name === name)!
    expect(spec('DATEVALUE').fn(context(true), ['1/1/1904'])).toBe(0)
    expect(spec('DATEVALUE').fn(context(true), ['1/1/2024'])).toBe(43830)
    expect(spec('TEXT').fn(context(true), [0, 'm/d/yyyy'])).toBe('1/1/1904')
    expect(spec('VALUE').fn(context(true), ['1/1/2024'])).toBe(43830)
  })

  it('declares arities and the _xlfn. prefix', () => {
    const shape = Object.fromEntries(TEXT_FORMAT_FUNCTIONS.map((spec) => [spec.name, [spec.minArgs, spec.maxArgs, spec.xlfn ?? false]]))
    expect(shape).toEqual({
      TEXT: [2, 2, false],
      VALUE: [1, 1, false],
      NUMBERVALUE: [1, 3, true],
      DATEVALUE: [1, 1, false],
      TIMEVALUE: [1, 1, false],
      DOLLAR: [1, 2, false],
      FIXED: [1, 3, false],
      VALUETOTEXT: [1, 2, true],
    })
  })
})
