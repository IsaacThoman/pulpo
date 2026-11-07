/**
 * A tiny function registry for tests of the engine (and of code built on it) until the real
 * library is wired in. Deliberately minimal; not Excel-complete.
 */

import { denseRange, forEachLogical } from './ranges.js'
import { maxOf, minOf } from '../../../collections.js'

import { Errors, isError, isMatrix, isReference, matrix, type FunctionContext, type FunctionSpec, type Scalar, type Value } from './types.js'
import { toNumber, toText } from './values.js'

/** Calls `visit` for every scalar in the arguments; `direct` is false for values from ranges and arrays. */
function eachScalar(ctx: FunctionContext, values: (Value | undefined)[], visit: (value: Scalar, direct: boolean) => boolean | void): void {
  for (const value of values) {
    if (value === undefined) continue
    if (isReference(value)) {
      let stopped = false
      for (const area of ctx.resolveAreas(value)) {
        forEachLogical(area, (item, count) => {
          // These stand-in aggregates ignore blank multiplicity; all other values repeat.
          for (let i = 0; i < (item === null ? 1 : count) && !stopped; i++) stopped = visit(item, false) === false
        }, { weightedTail: true })
        if (stopped) return
      }
    } else if (isMatrix(value)) {
      let stopped = false
      forEachLogical(value, (item, count) => {
        for (let i = 0; i < (item === null ? 1 : count) && !stopped; i++) stopped = visit(item, false) === false
      }, { weightedTail: true })
      if (stopped) return
    } else if (typeof value !== 'object' || value === null || isError(value)) {
      if (visit(value, true) === false) return
    }
  }
}

function numbers(ctx: FunctionContext, values: (Value | undefined)[]): number[] | Scalar {
  const out: number[] = []
  let failure: Scalar | undefined
  eachScalar(ctx, values, (value, direct) => {
    if (isError(value)) {
      failure = value
      return false
    }
    if (typeof value === 'number') out.push(value)
    else if (direct && value !== null) {
      const n = toNumber(value, ctx.date1904)
      if (isError(n)) {
        failure = n
        return false
      }
      out.push(n)
    }
  })
  return failure ?? out
}

function aggregate(name: string, fn: (values: number[]) => Scalar): FunctionSpec {
  return {
    name,
    minArgs: 1,
    maxArgs: 255,
    args: ['any'],
    fn: (ctx, args) => {
      const values = numbers(ctx, args)
      return Array.isArray(values) ? fn(values) : values
    },
  }
}

function unary(name: string, fn: (x: number) => Scalar): FunctionSpec {
  return {
    name,
    minArgs: 1,
    maxArgs: 1,
    fn: (ctx, [arg]) => {
      const n = toNumber((arg ?? null) as Scalar, ctx.date1904)
      return isError(n) ? n : fn(n)
    },
  }
}

const SPECS: FunctionSpec[] = [
  aggregate('SUM', (values) => values.reduce((a, b) => a + b, 0)),
  aggregate('COUNT', (values) => values.length),
  aggregate('MAX', (values) => (values.length ? maxOf(values) : 0)),
  aggregate('MIN', (values) => (values.length ? minOf(values) : 0)),
  aggregate('PRODUCT', (values) => values.reduce((a, b) => a * b, 1)),
  unary('ABS', Math.abs),
  unary('SQRT', (x) => (x < 0 ? Errors.NUM : Math.sqrt(x))),
  unary('INT', Math.floor),
  {
    name: 'CONCAT',
    minArgs: 1,
    maxArgs: 255,
    args: ['any'],
    xlfn: true,
    fn: (ctx, args) => {
      let out = ''
      let failure: Scalar | undefined
      eachScalar(ctx, args, (value) => {
        const text = toText(value)
        if (isError(text)) {
          failure = text
          return false
        }
        out += text
      })
      return failure ?? out
    },
  },
  {
    name: 'LEN',
    minArgs: 1,
    maxArgs: 1,
    fn: (_ctx, [arg]) => {
      const text = toText((arg ?? null) as Scalar)
      return isError(text) ? text : text.length
    },
  },
  {
    name: 'UPPER',
    minArgs: 1,
    maxArgs: 1,
    fn: (_ctx, [arg]) => {
      const text = toText((arg ?? null) as Scalar)
      return isError(text) ? text : text.toUpperCase()
    },
  },
  { name: 'ISBLANK', minArgs: 1, maxArgs: 1, fn: (_ctx, [arg]) => arg === null },
  { name: 'ISERROR', minArgs: 1, maxArgs: 1, fn: (_ctx, [arg]) => isError(arg) },
  { name: 'NA', minArgs: 0, maxArgs: 0, fn: () => Errors.NA },
  { name: 'NOW', minArgs: 0, maxArgs: 0, volatile: true, fn: (ctx) => ctx.now() },
  { name: 'RAND', minArgs: 0, maxArgs: 0, volatile: true, fn: (ctx) => ctx.random() },
  {
    name: 'SEQUENCE',
    minArgs: 1,
    maxArgs: 4,
    xlfn: true,
    fn: (ctx, args) => {
      const [rows, cols, start, step] = [args[0], args[1] ?? 1, args[2] ?? 1, args[3] ?? 1].map((arg) => toNumber((arg ?? null) as Scalar, ctx.date1904))
      for (const n of [rows, cols, start, step]) if (isError(n)) return n
      const r = Math.trunc(rows as number)
      const c = Math.trunc(cols as number)
      if (r < 1 || c < 1) return Errors.CALC
      const data: Scalar[] = []
      for (let k = 0; k < r * c; k++) data.push((start as number) + k * (step as number))
      return matrix(r, c, data)
    },
  },
  {
    name: 'TRANSPOSE',
    minArgs: 1,
    maxArgs: 1,
    args: ['any'],
    fn: (ctx, [arg]) => {
      const source = denseRange(isReference(arg) ? ctx.resolve(arg) : isMatrix(arg) ? arg : matrix(1, 1, [(arg ?? null) as Scalar]))
      const data: Scalar[] = []
      for (let c = 0; c < source.cols; c++) for (let r = 0; r < source.rows; r++) data.push(source.data[r * source.cols + c] ?? null)
      return matrix(source.cols, source.rows, data)
    },
  },
  {
    name: 'VSTACK',
    minArgs: 1,
    maxArgs: 254,
    args: ['any'],
    xlfn: true,
    fn: (ctx, args) => {
      const parts = args.map((arg) => denseRange(isReference(arg) ? ctx.resolve(arg) : isMatrix(arg) ? arg : matrix(1, 1, [(arg ?? null) as Scalar])))
      const cols = maxOf(parts.map((part) => part.cols))
      const data: Scalar[] = []
      for (const part of parts) for (let r = 0; r < part.rows; r++) for (let c = 0; c < cols; c++) data.push(c < part.cols ? (part.data[r * part.cols + c] ?? null) : Errors.NA)
      return matrix(data.length / cols, cols, data)
    },
  },
]

/** A fresh registry of the test functions. */
export function testFunctions(): Map<string, FunctionSpec> {
  return new Map(SPECS.map((spec) => [spec.name, spec]))
}
