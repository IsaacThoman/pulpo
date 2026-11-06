/**
 * Walking aggregate arguments with Excel's rules. A value written directly as an argument
 * (`SUM(1, "3", TRUE)`) is coerced like an operator operand; values that come from a reference or
 * an array (`SUM(A1:A3)`, `SUM({1,"3",TRUE})`) only count when they are numbers, and text, logicals
 * and blanks there are skipped. Errors propagate either way unless the function ignores them.
 */

import { alignedRanges } from '../ranges.js'
import { MAX_ARRAY_CELLS, omittedCells, Errors, isError, isLambda, isMatrix, isReference, type FunctionContext, type Scalar, type Value } from '../types.js'
import { sum } from './numeric.js'
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
export function forEachValue(ctx: FunctionContext, args: Args, visit: (value: Scalar, direct: boolean, count: number) => void): void {
  for (const arg of args) {
    if (arg === undefined) {
      visit(null, true, 1)
    } else if (isReference(arg)) {
      for (const area of ctx.resolveAreas(arg)) {
        for (const value of area.data) visit(value, false, 1)
        if (omittedCells(area)) visit(area.omittedValue ?? null, false, omittedCells(area))
      }
    } else if (isMatrix(arg)) {
      for (const value of arg.data) visit(value, false, 1)
      if (omittedCells(arg)) visit(arg.omittedValue ?? null, false, omittedCells(arg))
    } else if (isLambda(arg)) {
      fail(Errors.VALUE)
    } else {
      visit(arg, true, 1)
    }
  }
}

/** The numbers an aggregate (SUM, AVERAGE, MAX, STDEV, …) sees, following `CollectOptions`. */
export function forEachNumber(ctx: FunctionContext, args: Args, visit: (value: number, count: number) => void, options: CollectOptions = {}): void {
  const directText = options.directText ?? 'coerce'
  const directLogicals = options.directLogicals ?? true
  forEachValue(ctx, args, (value, direct, count) => {
    const push = (number: number): void => {
      visit(number, count)
    }
    if (typeof value === 'number') {
      push(value)
    } else if (isError(value)) {
      if (!options.skipErrors) fail(value)
    } else if (direct) {
      if (value === null) {
        push(0)
      } else if (typeof value === 'boolean') {
        if (directLogicals) push(value ? 1 : 0)
      } else {
        const parsed = parseNumber(value, ctx)
        if (parsed !== undefined) push(parsed)
        else if (directText === 'coerce') fail(Errors.VALUE)
      }
    } else if (options.referenceAll) {
      if (typeof value === 'boolean') push(value ? 1 : 0)
      else if (typeof value === 'string') push(0)
    }
  })
}

export function collectNumbers(ctx: FunctionContext, args: Args, options: CollectOptions = {}): number[] {
  const out: number[] = []
  forEachNumber(ctx, args, (value, count) => {
    if (out.length + count > MAX_ARRAY_CELLS) fail(Errors.NUM)
    for (let i = 0; i < count; i++) out.push(value)
  }, options)
  return out
}

/** Streaming summaries do not allocate an entry for every numeric cell in a uniform tail. */
export function numberSummary(ctx: FunctionContext, args: Args, options: CollectOptions = {}): { total: number; squares: number; count: number; min: number; max: number; product: number } {
  const totals: number[] = []
  const squareTotals: number[] = []
  let count = 0, min = Infinity, max = -Infinity, product = 1
  forEachNumber(ctx, args, (value, weight) => {
    totals.push(value * weight)
    squareTotals.push(value * value * weight)
    count += weight
    min = Math.min(min, value)
    max = Math.max(max, value)
    product *= value ** weight
  }, options)
  return { total: sum(totals), squares: sum(squareTotals), count, min: count ? min : 0, max: count ? max : 0, product: count ? product : 0 }
}

/**
 * Pairs of numbers from two equally long arrays, keeping only positions where both are numbers
 * (CORREL, SLOPE, COVAR, …). Errors propagate; different counts are #N/A.
 */
export function numberPairs(ctx: FunctionContext, a: Value | undefined, b: Value | undefined): [number[], number[]] {
  const ma = toMatrix(ctx, a)
  const mb = toMatrix(ctx, b)
  const xs: number[] = []
  const ys: number[] = []
  alignedRanges([ma, mb], ([x, y], count) => {
    if (isError(x)) fail(x)
    if (isError(y)) fail(y)
    if (typeof x === 'number' && typeof y === 'number') {
      if (xs.length + count > MAX_ARRAY_CELLS) fail(Errors.NUM)
      for (let i = 0; i < count; i++) { xs.push(x); ys.push(y) }
    }
  }, Errors.NA, true)
  return [xs, ys]
}
