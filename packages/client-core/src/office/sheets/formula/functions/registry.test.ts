import { describe, expect, it } from 'vitest'
import { Errors, matrix, type FunctionSpec } from '../types.js'
import { FUNCTION_DOCS, LIBRARY_FUNCTIONS, functionDoc, functionRegistry } from './index.js'
import { createContext } from './testing.js'

/** Functions the evaluator and text-format.ts implement; the docs must still cover them. */
const EVALUATOR_FUNCTIONS = [
  'IF', 'IFS', 'IFERROR', 'IFNA', 'SWITCH', 'CHOOSE', 'LET', 'LAMBDA', 'ISOMITTED', 'MAP', 'REDUCE', 'SCAN', 'BYROW', 'BYCOL',
  'MAKEARRAY', 'ROW', 'ROWS', 'COLUMN', 'COLUMNS', 'OFFSET', 'INDIRECT', 'INDEX', 'AREAS', 'ISREF', 'ISFORMULA', 'FORMULATEXT',
  'CELL', 'SHEET', 'SHEETS',
]
const TEXT_FORMAT_FUNCTIONS = ['TEXT', 'VALUE', 'NUMBERVALUE', 'DATEVALUE', 'TIMEVALUE', 'DOLLAR', 'FIXED', 'VALUETOTEXT']

describe('function registry', () => {
  it('has no duplicate names', () => {
    const names = LIBRARY_FUNCTIONS.map((spec) => spec.name)
    const duplicates = names.filter((name, i) => names.indexOf(name) !== i)
    expect(duplicates).toEqual([])
  })

  it('implements none of the evaluator or text-format functions', () => {
    const names = new Set(LIBRARY_FUNCTIONS.map((spec) => spec.name))
    expect([...EVALUATOR_FUNCTIONS, ...TEXT_FORMAT_FUNCTIONS].filter((name) => names.has(name))).toEqual([])
  })

  it('uses upper-case names and sane arities', () => {
    for (const spec of LIBRARY_FUNCTIONS) {
      expect(spec.name).toBe(spec.name.toUpperCase())
      expect(spec.minArgs).toBeLessThanOrEqual(spec.maxArgs)
      expect(spec.maxArgs).toBeLessThanOrEqual(255)
    }
  })

  it('implements the most-used functions', () => {
    expect(LIBRARY_FUNCTIONS.length).toBeGreaterThan(250)
  })

  it('builds a map and lets extra specs override library ones', () => {
    const extra: FunctionSpec = { name: 'IF', minArgs: 2, maxArgs: 3, fn: () => 1 }
    const override: FunctionSpec = { name: 'SUM', minArgs: 0, maxArgs: 0, fn: () => 42 }
    const registry = functionRegistry([extra, override])
    expect(registry.get('IF')).toBe(extra)
    expect(registry.get('SUM')).toBe(override)
    expect(registry.get('VLOOKUP')?.name).toBe('VLOOKUP')
    expect(registry.size).toBe(LIBRARY_FUNCTIONS.length + 1)
  })

  it('marks volatile and post-2007 functions', () => {
    const registry = functionRegistry()
    for (const name of ['RAND', 'RANDBETWEEN', 'RANDARRAY', 'NOW', 'TODAY']) expect(registry.get(name)?.volatile).toBe(true)
    for (const name of ['XLOOKUP', 'FILTER', 'CONCAT', 'STDEV.S', 'NORM.DIST', 'AGGREGATE', 'DAYS', 'BITAND']) expect(registry.get(name)?.xlfn).toBe(true)
    for (const name of ['SUM', 'VLOOKUP', 'SUMIFS', 'STDEV', 'CONCATENATE', 'NETWORKDAYS']) expect(registry.get(name)?.xlfn).toBeUndefined()
  })

  it('never throws for odd argument values', () => {
    const ctx = createContext()
    const samples = [undefined, null, 0, -1, 1.5, 1e308, '', 'abc', '12', true, Errors.NA, matrix(2, 2, [1, 'a', null, true])]
    for (const spec of LIBRARY_FUNCTIONS) {
      const count = Math.max(spec.minArgs, Math.min(spec.maxArgs, 3))
      for (const sample of samples) {
        const args = Array.from({ length: count }, () => sample)
        expect(() => spec.fn(ctx, args), `${spec.name}(${String(sample)})`).not.toThrow()
      }
    }
  })
})

describe('FUNCTION_DOCS', () => {
  const documented = new Set(FUNCTION_DOCS.map((doc) => doc.name))

  it('documents every library, evaluator, and text-format function', () => {
    const missing = [...LIBRARY_FUNCTIONS.map((spec) => spec.name), ...EVALUATOR_FUNCTIONS, ...TEXT_FORMAT_FUNCTIONS].filter((name) => !documented.has(name))
    expect(missing).toEqual([])
  })

  it('has no duplicate or undocumented-by-anyone entries', () => {
    const names = FUNCTION_DOCS.map((doc) => doc.name)
    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([])
    const known = new Set([...LIBRARY_FUNCTIONS.map((spec) => spec.name), ...EVALUATOR_FUNCTIONS, ...TEXT_FORMAT_FUNCTIONS])
    expect(names.filter((name) => !known.has(name))).toEqual([])
  })

  it('agrees with each spec about how many arguments are required', () => {
    for (const spec of LIBRARY_FUNCTIONS) {
      const doc = functionDoc(spec.name)!
      const required = doc.args.filter((arg) => !arg.optional).length
      const variadic = doc.args.some((arg) => arg.repeating)
      expect(required, spec.name).toBe(spec.minArgs)
      if (!variadic) expect(doc.args.length, spec.name).toBe(spec.maxArgs)
    }
  })

  it('parses signatures into argument hints', () => {
    expect(functionDoc('VLOOKUP')).toEqual({
      name: 'VLOOKUP',
      category: 'lookup',
      args: [{ name: 'lookup_value' }, { name: 'table_array' }, { name: 'col_index_num' }, { name: 'range_lookup', optional: true }],
      description: 'Looks for a value in the first column of a table and returns a value in the same row.',
    })
    expect(functionDoc('_xlfn.xlookup')?.name).toBe('XLOOKUP')
    expect(functionDoc('SUM')?.args).toEqual([{ name: 'number1' }, { name: 'number2', optional: true, repeating: true }])
    expect(FUNCTION_DOCS.every((doc) => doc.description.endsWith('.'))).toBe(true)
  })
})
