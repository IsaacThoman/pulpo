/**
 * Walking aggregate arguments with Excel's rules. A value written directly as an argument
 * (`SUM(1, "3", TRUE)`) is coerced like an operator operand; values that come from a reference or
 * an array (`SUM(A1:A3)`, `SUM({1,"3",TRUE})`) only count when they are numbers, and text, logicals
 * and blanks there are skipped. Errors propagate either way unless the function ignores them.
 */

import { Errors, isError, isLambda, isMatrix, isReference, type FunctionContext, type Scalar, type Value } from '../types.js'
import { fail, parseNumber, toMatrix, type Args } from './coerce.js'

export interface CollectOptions {
  /**
   * Direct text arguments: `coerce` parses them and fails with #VALUE! (SUM, AVERAGE), `skip`
   * parses them and drops what does not parse (COUNT).
   */
  directText?: 'coerce' | 'skip'
  /** The `A` functions (AVERAGEA, MAXA, …): text in references counts as 0 and logicals as 1/0. */
  referenceAll?: boolean
  /** COUNT ignores errors instead of propagating them. */
  skipErrors?: boolean
  /** Direct logicals count (default true). */
  directLogicals?: boolean
}

/**
 * Calls `visit` for every value in the arguments. `direct` is true for values written straight in
 * the call rather than coming from a reference or array.
 */
export function forEachValue(ctx: FunctionContext, args: Args, visit: (value: Scalar, direct: boolean) => void): void {
  for (const arg of args) {
    if (arg === undefined) {
      visit(null, true)
    } else if (isReference(arg)) {
      for (const area of ctx.resolveAreas(arg)) for (const value of area.data) visit(value, false)
    } else if (isMatrix(arg)) {
      for (const value of arg.data) visit(value, false)
    } else if (isLambda(arg)) {
      fail(Errors.VALUE)
    } else {
      visit(arg, true)
    }
  }
}

/** The numbers an aggregate (SUM, AVERAGE, MAX, STDEV, …) sees, following `CollectOptions`. */
export function collectNumbers(ctx: FunctionContext, args: Args, options: CollectOptions = {}): number[] {
  const out: number[] = []
  const directText = options.directText ?? 'coerce'
  const directLogicals = options.directLogicals ?? true
  forEachValue(ctx, args, (value, direct) => {
    if (typeof value === 'number') {
      out.push(value)
    } else if (isError(value)) {
      if (!options.skipErrors) fail(value)
    } else if (direct) {
      if (value === null) {
        out.push(0)
      } else if (typeof value === 'boolean') {
        if (directLogicals) out.push(value ? 1 : 0)
      } else {
        const parsed = parseNumber(value, ctx)
        if (parsed !== undefined) out.push(parsed)
        else if (directText === 'coerce') fail(Errors.VALUE)
      }
    } else if (options.referenceAll) {
      if (typeof value === 'boolean') out.push(value ? 1 : 0)
      else if (typeof value === 'string') out.push(0)
    }
  })
  return out
}

/**
 * Pairs of numbers from two equally long arrays, keeping only positions where both are numbers
 * (CORREL, SLOPE, COVAR, …). Errors propagate; different counts are #N/A.
 */
export function numberPairs(ctx: FunctionContext, a: Value | undefined, b: Value | undefined): [number[], number[]] {
  const ma = toMatrix(ctx, a)
  const mb = toMatrix(ctx, b)
  if (ma.data.length !== mb.data.length) fail(Errors.NA)
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < ma.data.length; i++) {
    const x = ma.data[i] ?? null
    const y = mb.data[i] ?? null
    if (isError(x)) fail(x)
    if (isError(y)) fail(y)
    if (typeof x === 'number' && typeof y === 'number') {
      xs.push(x)
      ys.push(y)
    }
  }
  return [xs, ys]
}
