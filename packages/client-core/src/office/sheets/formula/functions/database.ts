/**
 * Database functions (DSUM, DAVERAGE, …). The database and criteria are ranges whose first row
 * holds field names. Criteria cells in one row must all match (AND); rows are alternatives (OR);
 * empty criteria cells match anything. As in Excel's advanced filter, plain text criteria match
 * values that begin with the text (`"Ap"` matches "Apple"); use `="=Ap"` for an exact match.
 */

import { maxOf, minOf } from '../../../../collections.js'

import { denseRange } from '../ranges.js'


import { Errors, isError, type FunctionContext, type FunctionSpec, type Matrix, type Scalar } from '../types.js'
import { cell, compareText, define, fail, numberToText, omitted, scalarOf, toMatrix, type Args } from './coerce.js'
import { parseCriteria, type Predicate } from './criteria.js'
import { mean, variance } from './numeric.js'

function headerName(v: Scalar): string {
  if (v === null) return ''
  if (typeof v === 'number') return numberToText(v)
  if (isError(v)) return v.code
  return String(v)
}

function fieldIndex(ctx: FunctionContext, db: Matrix, field: Scalar): number {
  if (isError(field)) return fail(field)
  if (typeof field === 'number') {
    const i = Math.trunc(field)
    if (i < 1 || i > db.cols) return fail(Errors.VALUE)
    return i - 1
  }
  if (typeof field === 'string') {
    for (let c = 0; c < db.cols; c++) if (compareText(headerName(cell(db, 0, c)), field.trim()) === 0) return c
  }
  return fail(Errors.VALUE)
}

/** Indexes (database rows, 1-based past the header) of the records matching the criteria range. */
function matchingRecords(ctx: FunctionContext, db: Matrix, criteria: Matrix): number[] {
  const records: number[] = []
  const alternatives: { col: number; test: Predicate }[][] = []
  for (let r = 1; r < criteria.rows; r++) {
    const tests: { col: number; test: Predicate }[] = []
    for (let c = 0; c < criteria.cols; c++) {
      const value = cell(criteria, r, c)
      if (value === null || value === '') continue
      const name = headerName(cell(criteria, 0, c))
      let col = -1
      for (let k = 0; k < db.cols; k++) if (compareText(headerName(cell(db, 0, k)), name) === 0) col = k
      // A criterion under an unknown heading matches nothing.
      tests.push({ col, test: col < 0 ? () => false : parseCriteria(value, ctx, { prefixText: true }) })
    }
    alternatives.push(tests)
  }
  for (let r = 1; r < db.rows; r++) {
    const matches = !alternatives.length || alternatives.some((tests) => tests.every(({ col, test }) => test(cell(db, r, col))))
    if (matches) records.push(r)
  }
  return records
}

function fieldValues(ctx: FunctionContext, args: Args): { values: Scalar[]; records: number; noField: boolean } {
  const db = denseRange(toMatrix(ctx, args[0]))
  const criteria = denseRange(toMatrix(ctx, args[2]))
  if (db.rows < 1) return fail(Errors.VALUE)
  const records = matchingRecords(ctx, db, criteria)
  if (omitted(args, 1)) return { values: records.map(() => null), records: records.length, noField: true }
  const col = fieldIndex(ctx, db, scalarOf(args[1], ctx))
  return { values: records.map((r) => cell(db, r, col)), records: records.length, noField: false }
}

function numbers(values: Scalar[]): number[] {
  const out: number[] = []
  for (const v of values) {
    if (typeof v === 'number') out.push(v)
  }
  return out
}

/** A D-function; `reduce` gets the field's values of the matching records. */
function dbFunction(name: string, reduce: (values: Scalar[]) => Scalar, countWithoutField = false): FunctionSpec {
  return define({
    name,
    min: 3,
    max: 3,
    args: ['any', 'scalar', 'any'],
    fn: (ctx, args) => {
      const { values, records, noField } = fieldValues(ctx, args)
      // DCOUNT/DCOUNTA with an empty field count the matching records.
      if (noField) return countWithoutField ? records : fail(Errors.VALUE)
      return reduce(values)
    },
  })
}

export const DATABASE_FUNCTIONS: FunctionSpec[] = [
  dbFunction('DSUM', (values) => numbers(values).reduce((a, b) => a + b, 0)),
  dbFunction('DAVERAGE', (values) => mean(numbers(values))),
  dbFunction('DCOUNT', (values) => numbers(values).length, true),
  dbFunction('DCOUNTA', (values) => values.filter((v) => v !== null && v !== '').length, true),
  dbFunction('DMAX', (values) => {
    const n = numbers(values)
    return n.length ? maxOf(n) : 0
  }),
  dbFunction('DMIN', (values) => {
    const n = numbers(values)
    return n.length ? minOf(n) : 0
  }),
  dbFunction('DPRODUCT', (values) => {
    const n = numbers(values)
    return n.length ? n.reduce((a, b) => a * b, 1) : 0
  }),
  dbFunction('DSTDEV', (values) => Math.sqrt(variance(numbers(values), true))),
  dbFunction('DSTDEVP', (values) => Math.sqrt(variance(numbers(values), false))),
  dbFunction('DVAR', (values) => variance(numbers(values), true)),
  dbFunction('DVARP', (values) => variance(numbers(values), false)),
  dbFunction('DGET', (values) => {
    if (values.length === 0) return fail(Errors.VALUE)
    if (values.length > 1) return fail(Errors.NUM)
    return values[0] ?? null
  }),
]
