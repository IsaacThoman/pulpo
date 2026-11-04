import { describe, expect, it } from 'vitest'
import { Errors, matrix, type Scalar } from '../types.js'
import { bool, define, fail, liftOver, num, text } from './coerce.js'
import { parseCriteria, wildcardMatch } from './criteria.js'
import { collectNumbers } from './iterate.js'
import { roundDecimal } from './numeric.js'
import { arr, createContext, ref } from './testing.js'

describe('scalar coercion', () => {
  it.each<[Scalar | undefined, number | string]>([
    [3, 3],
    [true, 1],
    [false, 0],
    [null, 0],
    [undefined, 0],
    ['12', 12],
    [' 12 ', 12],
    ['1e3', 1000],
    ['abc', '#VALUE!'],
    ['', '#VALUE!'],
    [Errors.NA, '#N/A'],
  ])('num(%s) → %s', (input, expected) => {
    const result = (() => {
      try {
        return num(input)
      } catch (error) {
        return String(error)
      }
    })()
    expect(result).toBe(expected)
  })

  it('converts to text and logicals like Excel', () => {
    expect(text(1 / 3)).toBe('0.333333333333333')
    expect(text(true)).toBe('TRUE')
    expect(text(null)).toBe('')
    expect(bool('true')).toBe(true)
    expect(bool(' FALSE ')).toBe(false)
    expect(bool(2)).toBe(true)
    expect(bool(null)).toBe(false)
    expect(() => bool('yes')).toThrow()
    expect(text(matrix(1, 1, ['only']))).toBe('only')
    expect(() => text(matrix(1, 2, ['a', 'b']))).toThrow()
  })

  it('turns thrown errors and bad numbers into results', () => {
    const spec = define({ name: 'T', min: 1, max: 1, fn: (_ctx, args) => (args[0] === 1 ? fail(Errors.REF) : args[0] === 2 ? 0 / 0 : args[0] === 3 ? -0 : 'x'.repeat(40000)) })
    const ctx = createContext()
    expect(spec.fn(ctx, [1])).toBe(Errors.REF)
    expect(spec.fn(ctx, [2])).toBe(Errors.NUM)
    expect(Object.is(spec.fn(ctx, [3]), 0)).toBe(true)
    expect(spec.fn(ctx, [4])).toBe(Errors.VALUE)
  })
})

describe('roundDecimal', () => {
  it.each([
    [2.675, 2, 'half', 2.68],
    [1.005, 2, 'half', 1.01],
    [-2.5, 0, 'half', -3],
    [1.45, 1, 'half', 1.5],
    [0.285, 2, 'half', 0.29],
    [1234567.891, -3, 'half', 1235000],
    [5e-324, 2, 'half', 0],
    [1.0000000000000002, 0, 'up', 1],
    [0.1 + 0.7, 1, 'down', 0.8],
    [123.456, -1, 'up', 130],
    [999.9, -3, 'half', 1000],
    [4, -2, 'up', 100],
  ] as const)('round(%s, %s, %s) → %s', (x, digits, mode, expected) => {
    expect(roundDecimal(x, digits, mode)).toBe(expected)
  })
})

describe('wildcards', () => {
  it.each([
    ['a*', 'apple', true],
    ['A*', 'apple', true],
    ['*le', 'apple', true],
    ['?pple', 'apple', true],
    ['?ple', 'apple', false],
    ['a~*', 'a*', true],
    ['a~*', 'ab', false],
    ['a~?', 'a?', true],
    ['~~', '~', true],
    ['a.c', 'abc', false],
    ['(x)', '(x)', true],
    ['*', '', true],
    ['?', '', false],
    ['a*b*c', 'aXXbYYc', true],
    ['line*', 'line1\nline2', true],
  ])('%s matches %s: %s', (pattern, value, expected) => {
    expect(wildcardMatch(pattern, value)).toBe(expected)
  })
})

describe('parseCriteria', () => {
  const values: Scalar[] = [0, 1, 2, 10, '1', '10', 'apple', 'Banana', '', null, true, false, Errors.NA, Errors.DIV0, 'a*b']
  const matching = (criterion: Scalar): Scalar[] => values.filter(parseCriteria(criterion))

  it.each<[Scalar, Scalar[]]>([
    [1, [1, '1']],
    ['1', [1, '1']],
    ['=10', [10, '10']],
    ['>1', [2, 10]],
    ['>=1', [1, 2, 10]],
    ['<2', [0, 1]],
    ['<=0', [0]],
    ['<>1', [0, 2, 10, '10', 'apple', 'Banana', '', null, true, false, Errors.NA, Errors.DIV0, 'a*b']],
    ['apple', ['apple']],
    ['APPLE', ['apple']],
    ['b*', ['Banana']],
    ['?????', ['apple']],
    ['*', ['1', '10', 'apple', 'Banana', '', 'a*b']],
    ['a~*b', ['a*b']],
    ['<>apple', [0, 1, 2, 10, '1', '10', 'Banana', '', null, true, false, Errors.NA, Errors.DIV0, 'a*b']],
    ['>b', ['Banana']],
    ['<b', ['1', '10', 'apple', '', 'a*b']],
    ['', ['', null]],
    ['=', [null]],
    ['<>', [0, 1, 2, 10, '1', '10', 'apple', 'Banana', '', true, false, Errors.NA, Errors.DIV0, 'a*b']],
    [true, [true]],
    ['FALSE', [false]],
    ['<>TRUE', [0, 1, 2, 10, '1', '10', 'apple', 'Banana', '', null, false, Errors.NA, Errors.DIV0, 'a*b']],
    ['#N/A', [Errors.NA]],
    [Errors.DIV0, [Errors.DIV0]],
    [null, [0]],
  ])('%s', (criterion, expected) => {
    expect(matching(criterion)).toEqual(expected)
  })

  it('treats plain text as a prefix for database criteria', () => {
    const predicate = parseCriteria('app', undefined, { prefixText: true })
    expect(predicate('apple')).toBe(true)
    expect(predicate('pineapple')).toBe(false)
    expect(parseCriteria('=app', undefined, { prefixText: true })('apple')).toBe(false)
  })
})

describe('collectNumbers', () => {
  const ctx = createContext({ cells: { A1: 1, A2: '2', A3: true, A5: 5, B1: Errors.REF } })

  it('coerces direct values and skips non-numbers in ranges', () => {
    expect(collectNumbers(ctx, [ref('A1:A5')])).toEqual([1, 5])
    expect(collectNumbers(ctx, ['2', true, null])).toEqual([2, 1, 0])
    expect(collectNumbers(ctx, [arr([[1, '2', true]])])).toEqual([1])
    expect(collectNumbers(ctx, [ref('A1:A5')], { referenceAll: true })).toEqual([1, 0, 1, 5])
    expect(collectNumbers(ctx, ['x', 3], { directText: 'skip' })).toEqual([3])
    expect(collectNumbers(ctx, [ref('A1:B1')], { skipErrors: true })).toEqual([1])
    expect(() => collectNumbers(ctx, [ref('A1:B1')])).toThrow()
    expect(() => collectNumbers(ctx, ['x'])).toThrow()
  })
})

describe('liftOver', () => {
  it('broadcasts like the evaluator, with #N/A outside the smaller array', () => {
    const ctx = createContext()
    const result = liftOver(ctx, [arr([[1, 2, 3]]), arr([[10], [20]]), 100], (values) => (values as number[]).reduce((a, b) => a + b, 0))
    expect(result).toEqual(matrix(2, 3, [111, 112, 113, 121, 122, 123]))
    const ragged = liftOver(ctx, [arr([[1, 2]]), arr([[1, 2, 3]])], ([a, b]) => (typeof a === 'number' && typeof b === 'number' ? a + b : (a as Scalar)))
    expect(ragged).toEqual(matrix(1, 3, [2, 4, Errors.NA]))
    expect(liftOver(ctx, [5, undefined], ([a, b]) => `${String(a)}|${String(b)}`)).toBe('5|null')
  })
})
