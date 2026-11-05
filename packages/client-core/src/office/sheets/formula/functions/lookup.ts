/**
 * Lookups: VLOOKUP, HLOOKUP, LOOKUP, MATCH, XLOOKUP, XMATCH, plus ADDRESS and HYPERLINK.
 *
 * Exact matches compare case-insensitively within one type (the number 1 never matches the text
 * "1"); VLOOKUP/HLOOKUP/MATCH exact matches and XLOOKUP/XMATCH mode 2 use `*`/`?`/`~` wildcards for
 * text. Approximate matches are binary searches like Excel's: values of another type than the
 * lookup value (text among numbers, blanks, errors) are stepped over, which is what makes idioms
 * such as `LOOKUP(2, 1/(A:A="x"), B:B)` return the last match.
 */

import { omittedCells } from '../types.js'
import { MAX_COLS, MAX_ROWS, columnName, quoteSheetName } from '../../address.js'
import { Errors, isError, isReference, matrix, type FunctionContext, type FunctionSpec, type Scalar, type Value } from '../types.js'
import { bool, cell, check, compareText, defInt, define, fail, int, matrixCol, matrixRow, num, omitted, scalarOf, text, toMatrix, type Args } from './coerce.js'
import { hasWildcards, wildcardMatch } from './criteria.js'

/** A lookup value: errors propagate, blanks look up 0. */
function lookupValue(value: Value | undefined, ctx: FunctionContext): Scalar {
  const v = scalarOf(value, ctx)
  if (isError(v)) return fail(v)
  return v === null ? 0 : v
}

/** Compares two values of the same type; undefined when the types differ (not comparable). */
export function lookupCompare(a: Scalar, b: Scalar): number | undefined {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'string' && typeof b === 'string') return compareText(a, b)
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return undefined
}

function exactEquals(lookup: Scalar, candidate: Scalar, wildcards: boolean): boolean {
  if (typeof lookup === 'string' && typeof candidate === 'string') {
    return wildcards && hasWildcards(lookup) ? wildcardMatch(lookup, candidate) : compareText(lookup, candidate) === 0
  }
  return lookupCompare(lookup, candidate) === 0
}

/** First (or last) index whose value equals `lookup`, or -1. */
export function linearExact(values: readonly Scalar[], lookup: Scalar, wildcards: boolean, reverse = false): number {
  if (reverse) {
    for (let i = values.length - 1; i >= 0; i--) if (exactEquals(lookup, values[i] ?? null, wildcards)) return i
    return -1
  }
  for (let i = 0; i < values.length; i++) if (exactEquals(lookup, values[i] ?? null, wildcards)) return i
  return -1
}

/**
 * Excel's approximate-match binary search. Ascending: the last position whose value is <= lookup;
 * descending: the last position whose value is >= lookup. Values of other types are stepped over.
 */
export function binaryApprox(values: readonly Scalar[], lookup: Scalar, descending = false): number {
  let lo = 0
  let hi = values.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    let j = mid
    let c: number | undefined
    while (j <= hi && (c = lookupCompare(values[j] ?? null, lookup)) === undefined) j++
    if (j > hi || c === undefined) {
      hi = mid - 1
      continue
    }
    if (descending ? c >= 0 : c <= 0) {
      best = j
      lo = j + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

/**
 * XLOOKUP/XMATCH: `matchMode` 0 exact, -1 exact or next smaller, 1 exact or next larger,
 * 2 wildcard; `searchMode` 1 first-to-last, -1 last-to-first, 2 binary ascending, -2 binary
 * descending.
 */
export function xfind(values: readonly Scalar[], lookup: Scalar, matchMode: number, searchMode: number): number {
  if (searchMode === 2 || searchMode === -2) return xbinary(values, lookup, matchMode, searchMode === -2)
  const reverse = searchMode === -1
  const exact = linearExact(values, lookup, matchMode === 2, reverse)
  if (exact >= 0 || matchMode === 0 || matchMode === 2) return exact
  let best = -1
  const order = reverse ? values.map((_, i) => values.length - 1 - i) : values.map((_, i) => i)
  for (const i of order) {
    const c = lookupCompare(values[i] ?? null, lookup)
    if (c === undefined) continue
    if (matchMode === -1 && c < 0 && (best < 0 || lookupCompare(values[i] ?? null, values[best] ?? null)! > 0)) best = i
    if (matchMode === 1 && c > 0 && (best < 0 || lookupCompare(values[i] ?? null, values[best] ?? null)! < 0)) best = i
  }
  return best
}

function xbinary(values: readonly Scalar[], lookup: Scalar, matchMode: number, descending: boolean): number {
  // Binary search over the values comparable with the lookup value.
  const indexes: number[] = []
  for (let i = 0; i < values.length; i++) if (lookupCompare(values[i] ?? null, lookup) !== undefined) indexes.push(i)
  const sign = descending ? -1 : 1
  const cmp = (k: number): number => sign * lookupCompare(values[indexes[k]!] ?? null, lookup)!
  // First position (in search order) whose value is >= lookup.
  let lo = 0
  let hi = indexes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cmp(mid) < 0) lo = mid + 1
    else hi = mid
  }
  if (lo < indexes.length && cmp(lo) === 0) return indexes[lo]!
  if (matchMode === 0 || matchMode === 2) return -1
  // In search order, values before `lo` are "smaller" for ascending data.
  const wantSmaller = descending ? matchMode === 1 : matchMode === -1
  const k = wantSmaller ? lo - 1 : lo
  return k >= 0 && k < indexes.length ? indexes[k]! : -1
}

function matchType(ctx: FunctionContext, args: Args, index: number): number {
  if (index >= args.length) return 1
  const t = num(args[index], ctx)
  return t > 0 ? 1 : t < 0 ? -1 : 0
}

function find(values: readonly Scalar[], lookup: Scalar, type: number): number {
  if (type === 0) return linearExact(values, lookup, true)
  return binaryApprox(values, lookup, type < 0)
}

function vhlookup(ctx: FunctionContext, args: Args, horizontal: boolean): Value {
  const lookup = lookupValue(args[0], ctx)
  const table = toMatrix(ctx, args[1])
  const index = int(args[2], ctx)
  const approximate = args.length > 3 ? bool(args[3], ctx) : true
  if (index < 1) return fail(Errors.VALUE)
  if (index > (horizontal ? table.rows : table.cols)) return fail(Errors.REF)
  const keys = horizontal ? matrixRow(table, 0) : matrixCol(table, 0)
  const at = approximate ? binaryApprox(keys, lookup) : linearExact(keys, lookup, true)
  if (at < 0) return fail(Errors.NA)
  return horizontal ? cell(table, index - 1, at) : cell(table, at, index - 1)
}

/** A vector's values; 2-D arrays are #N/A for MATCH. */
function vector(ctx: FunctionContext, value: Value | undefined, error = Errors.NA): { values: Scalar[]; vertical: boolean } {
  const m = toMatrix(ctx, value)
  if (m.rows > 1 && m.cols > 1) return fail(error)
  const values = m.data.slice()
  if (omittedCells(m)) values.push(m.omittedValue ?? null)
  return { values, vertical: m.cols === 1 && (m.logicalRows ?? m.rows) > 1 }
}

function lookupFn(ctx: FunctionContext, args: Args): Value {
  const lookup = lookupValue(args[0], ctx)
  const source = toMatrix(ctx, args[1])
  if (args.length < 3) {
    // Array form: search the first row or column, return from the last one.
    const byRow = source.cols > source.rows
    const keys = byRow ? matrixRow(source, 0) : matrixCol(source, 0)
    const at = binaryApprox(keys, lookup)
    if (at < 0) return fail(Errors.NA)
    return byRow ? cell(source, source.rows - 1, at) : cell(source, at, source.cols - 1)
  }
  if (source.rows > 1 && source.cols > 1) return fail(Errors.NA)
  const at = binaryApprox(source.data, lookup)
  if (at < 0) return fail(Errors.NA)
  const resultArg = args[2]
  if (isReference(resultArg)) {
    const area = resultArg.areas[0]!
    const vertical = area.bottom > area.top || area.right === area.left
    const target = vertical ? { ...area, top: area.top + at, bottom: area.top + at, right: area.left } : { ...area, left: area.left + at, right: area.left + at, bottom: area.top }
    return ctx.resolve({ kind: 'ref', areas: [target] }).data[0] ?? null
  }
  const result = toMatrix(ctx, resultArg)
  return result.data[at] ?? fail(Errors.NA)
}

function xlookup(ctx: FunctionContext, args: Args): Value {
  const lookup = lookupValue(args[0], ctx)
  const lookupArray = toMatrix(ctx, args[1])
  const returnArray = toMatrix(ctx, args[2])
  const matchMode = defInt(args, 4, 0, ctx)
  const searchMode = defInt(args, 5, 1, ctx)
  check([0, -1, 1, 2].includes(matchMode), Errors.VALUE)
  check([1, -1, 2, -2].includes(searchMode), Errors.VALUE)
  if (lookupArray.rows > 1 && lookupArray.cols > 1) return fail(Errors.VALUE)
  const vertical = lookupArray.cols === 1
  const length = lookupArray.data.length
  if (vertical ? returnArray.rows !== length : returnArray.cols !== length) return fail(Errors.VALUE)
  const at = xfind(lookupArray.data, lookup, matchMode, searchMode)
  if (at < 0) {
    if (!omitted(args, 3)) {
      const fallback = toMatrix(ctx, args[3])
      return fallback.rows * fallback.cols === 1 ? (fallback.data[0] ?? null) : fallback
    }
    return fail(Errors.NA)
  }
  if (vertical) {
    if (returnArray.cols === 1) return cell(returnArray, at, 0)
    return matrix(1, returnArray.cols, matrixRow(returnArray, at))
  }
  if (returnArray.rows === 1) return cell(returnArray, 0, at)
  return matrix(returnArray.rows, 1, matrixCol(returnArray, at))
}

function address(ctx: FunctionContext, args: Args): string {
  const row = int(args[0], ctx)
  const col = int(args[1], ctx)
  const absNum = defInt(args, 2, 1, ctx)
  const a1 = omitted(args, 3) ? true : bool(args[3], ctx)
  const sheet = omitted(args, 4) ? undefined : text(args[4], ctx)
  check(absNum >= 1 && absNum <= 4, Errors.VALUE)
  check(row >= 1 && row <= MAX_ROWS && col >= 1 && col <= MAX_COLS, Errors.VALUE)
  const absRow = absNum === 1 || absNum === 2
  const absCol = absNum === 1 || absNum === 3
  const ref = a1
    ? `${absCol ? '$' : ''}${columnName(col - 1)}${absRow ? '$' : ''}${row}`
    : `R${absRow ? row : `[${row}]`}C${absCol ? col : `[${col}]`}`
  if (sheet === undefined) return ref
  if (sheet === '') return `!${ref}`
  return `${quoteSheetName(sheet)}!${ref}`
}

export const LOOKUP_FUNCTIONS: FunctionSpec[] = [
  define({ name: 'VLOOKUP', min: 3, max: 4, args: ['scalar', 'any', 'scalar', 'scalar'], fn: (ctx, args) => vhlookup(ctx, args, false) }),
  define({ name: 'HLOOKUP', min: 3, max: 4, args: ['scalar', 'any', 'scalar', 'scalar'], fn: (ctx, args) => vhlookup(ctx, args, true) }),
  define({ name: 'LOOKUP', min: 2, max: 3, args: ['scalar', 'any', 'any'], fn: lookupFn }),
  define({
    name: 'MATCH',
    min: 2,
    max: 3,
    args: ['scalar', 'any', 'scalar'],
    fn: (ctx, args) => {
      const lookup = lookupValue(args[0], ctx)
      const { values } = vector(ctx, args[1])
      const at = find(values, lookup, matchType(ctx, args, 2))
      return at < 0 ? fail(Errors.NA) : at + 1
    },
  }),
  define({ name: 'XLOOKUP', min: 3, max: 6, args: ['scalar', 'any', 'any', 'any', 'scalar', 'scalar'], xlfn: true, fn: xlookup }),
  define({
    name: 'XMATCH',
    min: 2,
    max: 4,
    args: ['scalar', 'any', 'scalar', 'scalar'],
    xlfn: true,
    fn: (ctx, args) => {
      const lookup = lookupValue(args[0], ctx)
      const { values } = vector(ctx, args[1], Errors.VALUE)
      const matchMode = defInt(args, 2, 0, ctx)
      const searchMode = defInt(args, 3, 1, ctx)
      check([0, -1, 1, 2].includes(matchMode), Errors.VALUE)
      check([1, -1, 2, -2].includes(searchMode), Errors.VALUE)
      const at = xfind(values, lookup, matchMode, searchMode)
      return at < 0 ? fail(Errors.NA) : at + 1
    },
  }),
  define({ name: 'ADDRESS', min: 2, max: 5, fn: address }),
  define({
    name: 'HYPERLINK',
    min: 1,
    max: 2,
    fn: (ctx, args) => {
      if (args.length > 1 && args[1] !== undefined) {
        const friendly = scalarOf(args[1], ctx)
        if (isError(friendly)) return fail(friendly)
        return friendly
      }
      return text(args[0], ctx)
    },
  }),
]
