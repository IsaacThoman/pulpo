import { describe, expect, it } from 'vitest'
import { denseRange, shaped } from '../ranges.js'
import { Errors, isMatrix, matrix, type Scalar, type Value } from '../types.js'
import { functionRegistry } from './index.js'
import { call, createContext } from './testing.js'

const expanded = (value: Value): Value => isMatrix(value) ? denseRange(value) : value

// Enumerate the registry, rather than maintaining a list that silently misses new functions.
// Probe every argument position, with other arguments scalar or range-shaped. Small dense
// equivalents are the oracle: full-column engine reads use the same compressed representation.
describe('every registered function respects logical range storage', () => {
  for (const spec of functionRegistry().values()) {
    it(spec.name, () => {
      for (const [rows, cols] of [[10, 1], [1, 10], [4, 5]] as const) {
        for (const prefix of [[2, 3, 4, 5], ['a', true, null, Errors.DIV0], [Errors.DIV0, 3, 'a', false]] as Scalar[][]) {
          for (const tail of [null, '', 0, 1, true, Errors.NA] as Scalar[]) {
            const compact = shaped(matrix(Math.min(rows, 2), Math.min(cols, 2), Array.from({ length: Math.min(rows, 2) * Math.min(cols, 2) }, (_, i) => prefix[i]!)), rows, cols, tail)
            const dense = denseRange(compact)
            const count = spec.maxArgs <= 8 ? spec.maxArgs : spec.minArgs + 1
            for (let position = 0; position < count; position++) {
              for (const together of [false, true]) {
                const args: Value[] = Array.from({ length: count }, (_, i) => i === position || together && spec.args?.[Math.min(i, spec.args.length - 1)] === 'any' ? compact : 1)
                const expected = spec.fn(createContext(), args.map((v) => v === compact ? dense : v))
                const actual = spec.fn(createContext(), args)
                expect(expanded(actual), `${spec.name}: ${rows}x${cols}, tail=${String(tail)}, argument=${position}, together=${together}`).toEqual(typeof expected === 'number' ? expect.closeTo(expected, 10) : expanded(expected))
              }
            }
          }
        }
      }
    })
  }
})


it('joins weighted value and delimiter runs in order, including empty delimiter cycles', () => {
  for (const valueTail of [null, '', 'x', true, 7] as Scalar[]) {
    for (const delimiterTail of [null, '', '-', 0] as Scalar[]) {
      const values = shaped(matrix(2, 2, ['a', null, 'b', 'c']), 6, 5, valueTail)
      const delimiters = shaped(matrix(1, 2, ['-', '/']), 3, 4, delimiterTail)
      for (const ignore of [true, false]) {
        expect(call('TEXTJOIN', [delimiters, ignore, values])).toEqual(call('TEXTJOIN', [denseRange(delimiters), ignore, denseRange(values)]))
      }
    }
  }
})

it('checks exact text boundaries without materializing large uniform tails', () => {
  const blanks = (rows: number) => shaped(matrix(1, 1, ['a']), rows, 1)
  expect(call('TEXTJOIN', [',', false, blanks(32767)])).toBe('a' + ','.repeat(32766))
  expect(call('TEXTJOIN', [',', false, blanks(32768)])).toBe(Errors.VALUE)
  expect(call('ARRAYTOTEXT', [blanks(16384)])).toBe('a' + ', '.repeat(16383))
  expect(call('ARRAYTOTEXT', [blanks(16385)])).toBe(Errors.VALUE)
  expect(call('ARRAYTOTEXT', [blanks(32763), 1])).toHaveLength(32767)
  expect(call('ARRAYTOTEXT', [blanks(32764), 1])).toBe(Errors.VALUE)
  const hugeDelimiter = shaped(matrix(1, 1, ['-']), 1_048_576, 1, '')
  expect(call('TEXTJOIN', [hugeDelimiter, false, shaped(matrix(1, 1, ['a']), 1_048_576, 1)])).toBe('a-')
})


it('indexes a long stored delimiter cycle without rescanning it for every value', () => {
  const delimiters = matrix(1, 20_000, new Array<Scalar>(20_000).fill(''))
  delimiters.data[19_998] = '-'
  const values = shaped(matrix(1, 1, ['x']), 20_000, 1, 'x')
  expect(call('TEXTJOIN', [delimiters, false, values])).toBe('x'.repeat(19_999) + '-x')
})
