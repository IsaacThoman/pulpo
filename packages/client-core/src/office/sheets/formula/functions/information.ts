/** Information functions (ISREF, ISFORMULA, CELL, SHEET, … need references and live in the evaluator). */

import { Errors, isError, isLambda, isMatrix, isReference, type ErrorCode, type FunctionSpec, type Scalar } from '../types.js'
import { define, fail, num, scalarOf } from './coerce.js'

const ERROR_TYPE: Partial<Record<ErrorCode, number>> = {
  '#NULL!': 1,
  '#DIV/0!': 2,
  '#VALUE!': 3,
  '#REF!': 4,
  '#NAME?': 5,
  '#NUM!': 6,
  '#N/A': 7,
  '#GETTING_DATA': 8,
  '#SPILL!': 9,
  '#CONNECT!': 10,
  '#BLOCKED!': 11,
  '#UNKNOWN!': 12,
  '#FIELD!': 13,
  '#CALC!': 14,
  '#BUSY!': 15,
}

function is(name: string, test: (value: Scalar) => boolean): FunctionSpec {
  return define({ name, min: 1, max: 1, fn: (_ctx, args) => test(args[0] === undefined ? null : scalarOf(args[0])) })
}

function parity(name: string, odd: boolean): FunctionSpec {
  return define({
    name,
    min: 1,
    max: 1,
    fn: (ctx, args) => {
      const v = scalarOf(args[0])
      if (typeof v === 'boolean') return fail(Errors.VALUE)
      const n = Math.trunc(num(v, ctx))
      return Math.abs(n % 2) === (odd ? 1 : 0)
    },
  })
}

export const INFORMATION_FUNCTIONS: FunctionSpec[] = [
  is('ISBLANK', (v) => v === null),
  is('ISERR', (v) => isError(v) && v.code !== '#N/A'),
  is('ISERROR', (v) => isError(v)),
  is('ISNA', (v) => isError(v) && v.code === '#N/A'),
  is('ISNUMBER', (v) => typeof v === 'number'),
  is('ISTEXT', (v) => typeof v === 'string'),
  is('ISNONTEXT', (v) => typeof v !== 'string'),
  is('ISLOGICAL', (v) => typeof v === 'boolean'),
  parity('ISEVEN', false),
  parity('ISODD', true),
  define({
    name: 'N',
    min: 1,
    max: 1,
    fn: (_ctx, args) => {
      const v = scalarOf(args[0])
      if (typeof v === 'number') return v
      if (typeof v === 'boolean') return v ? 1 : 0
      if (isError(v)) return fail(v)
      return 0
    },
  }),
  define({ name: 'NA', min: 0, max: 0, fn: () => Errors.NA }),
  define({
    name: 'TYPE',
    min: 1,
    max: 1,
    args: ['any'],
    fn: (ctx, args) => {
      const v = args[0]
      if (isLambda(v)) return 128
      if (isMatrix(v)) return v.rows * v.cols === 1 ? typeOf(v.data[0] ?? null) : 64
      if (isReference(v)) {
        const area = v.areas[0]
        if (v.areas.length > 1) return 16
        if (area && (area.bottom > area.top || area.right > area.left)) return 64
        return typeOf(ctx.resolve(v).data[0] ?? null)
      }
      return typeOf(v ?? null)
    },
  }),
  define({
    name: 'ERROR.TYPE',
    min: 1,
    max: 1,
    fn: (_ctx, args) => {
      const v = scalarOf(args[0])
      if (!isError(v)) return Errors.NA
      return ERROR_TYPE[v.code] ?? Errors.NA
    },
  }),
]

function typeOf(v: Scalar): number {
  if (typeof v === 'string') return 2
  if (typeof v === 'boolean') return 4
  if (isError(v)) return 16
  return 1
}
