/**
 * Shared coercion rules for the function library. Functions throw `FormulaError`s through these
 * helpers (`fail`, `num`, `text`, …) and `define` turns a thrown error into the function's result,
 * which keeps Excel's "first error wins" propagation out of every function body.
 */

import { broadcastRanges, denseRange, shaped } from '../ranges.js'
import { logicalSize, matrixGet, omittedCells } from '../types.js'
import { consumeWork } from '../budget.js'
import { serialToParts } from '../../dates.js'
import { parseNumberText, type ParseOptions } from '../../numfmt/parse.js'
import {
  Errors,
  checkArraySize,
  FormulaError,
  isError,
  isLambda,
  isMatrix,
  isReference,
  matrix,
  type ArgKind,
  type FunctionContext,
  type FunctionSpec,
  type Matrix,
  type Scalar,
  type Value,
} from '../types.js'

export type Args = (Value | undefined)[]

/** Excel's cell text limit. Longer results are #VALUE!. */
export const MAX_TEXT_LENGTH = 32_767

export { MAX_ARRAY_CELLS, checkArraySize } from '../types.js'

/** Stops the current function with an Excel error. `define` catches it and returns it. */
export function fail(error: FormulaError): never {
  throw error
}

export interface FunctionDef {
  name: string
  min: number
  max: number
  args?: ArgKind[]
  volatile?: boolean
  xlfn?: boolean
  fn: (ctx: FunctionContext, args: Args) => Value
}

/** Builds a `FunctionSpec`, catching thrown errors and normalizing the result (NaN/∞ → #NUM!, -0 → 0, long text → #VALUE!). */
export function define(def: FunctionDef): FunctionSpec {
  const spec: FunctionSpec = {
    name: def.name,
    minArgs: def.min,
    maxArgs: def.max,
    fn: (ctx, args) => {
      try {
        for (const arg of args) if (isMatrix(arg)) consumeWork(arg.data.length)
        return normalizeResult(def.fn(ctx, args))
      } catch (error) {
        if (isError(error)) return error
        if (error instanceof RangeError) return Errors.VALUE
        throw error
      }
    },
  }
  if (def.args) spec.args = def.args
  if (def.volatile) spec.volatile = true
  if (def.xlfn) spec.xlfn = true
  return spec
}

function normalizeScalar(value: Scalar): Scalar {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return Errors.NUM
    return value === 0 ? 0 : value
  }
  if (typeof value === 'string' && value.length > MAX_TEXT_LENGTH) return Errors.VALUE
  return value
}

function normalizeResult(value: Value): Value {
  if (isMatrix(value)) {
    if (value.rows === 0 || value.cols === 0) return Errors.CALC
    return { ...value, data: value.data.map(normalizeScalar), ...(value.omittedValue !== undefined ? { omittedValue: normalizeScalar(value.omittedValue) } : {}) }
  }
  if (isReference(value) || isLambda(value)) return value
  return normalizeScalar(value)
}

// ---------------------------------------------------------------------------------------------
// Number → text

/** Pads an exponent to Excel's two digits minimum: `E+05`, `E-12`, `E+100`. */
function excelExponent(exp: number): string {
  const sign = exp < 0 ? '-' : '+'
  const digits = String(Math.abs(exp))
  return `E${sign}${digits.length < 2 ? `0${digits}` : digits}`
}

/**
 * Renders a number the way Excel converts numbers to text (`=""&A1`, CONCAT, string comparison):
 * the General format with no width limit, so up to 15 significant digits, no trailing zeros, and
 * scientific notation from 1E+15 up and below 1E-9 (`1/3` → `0.333333333333333`, `1e21` → `1E+21`,
 * `2^53` → `9.00719925474099E+15`).
 */
export function numberToText(value: number): string {
  if (!Number.isFinite(value)) return '#NUM!'
  if (value === 0) return '0'
  const negative = value < 0
  const [mantissa, expText] = Math.abs(value).toExponential(14).split('e') as [string, string]
  let exp = Number(expText)
  let digits = mantissa.replace('.', '')
  // toExponential already rounded to 15 significant digits; strip trailing zeros.
  digits = digits.replace(/0+$/, '')
  if (!digits) {
    digits = '0'
    exp = 0
  }
  let body: string
  if (exp >= 15 || exp < -9) {
    body = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}${excelExponent(exp)}` : `${digits}${excelExponent(exp)}`
  } else if (exp < 0) {
    body = `0.${'0'.repeat(-exp - 1)}${digits}`
  } else if (digits.length <= exp + 1) {
    body = digits + '0'.repeat(exp + 1 - digits.length)
  } else {
    body = `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`
  }
  return negative ? `-${body}` : body
}

// ---------------------------------------------------------------------------------------------
// Scalar coercion

/**
 * A scalar from an argument. Matrices and references (from `any` arguments) collapse to their only
 * cell; larger ones are #VALUE!. An empty or omitted argument is `null` (blank).
 */
export function scalarOf(value: Value | undefined, ctx?: FunctionContext): Scalar {
  if (value === undefined) return null
  if (isReference(value)) {
    if (!ctx) return fail(Errors.VALUE)
    return scalarOf(ctx.resolve(value))
  }
  if (isMatrix(value)) {
    if (logicalSize(value).rows === 1 && logicalSize(value).cols === 1) return matrixGet(value, 0, 0)
    return fail(Errors.VALUE)
  }
  if (isLambda(value)) return fail(Errors.CALC)
  return value
}

/** Yearless formula dates use the same local calendar year as NOW, never the parsing host’s year. */
export function dateParseOptions(ctx?: Pick<FunctionContext, 'date1904' | 'now'>): ParseOptions {
  return { date1904: ctx?.date1904 ?? false, currentYear: ctx ? serialToParts(ctx.now(), ctx.date1904)?.year ?? 2000 : 2000 }
}

/** Excel's text → number coercion (`"1,000"`, `"50%"`, `"1/2/2024"`), or undefined. */
export function parseNumber(text: string, ctx?: FunctionContext): number | undefined {
  return parseNumberText(text, dateParseOptions(ctx))
}

/** Coerces to a number: blanks are 0, booleans 1/0, numeric text parses, other text is #VALUE!. */
export function num(value: Value | undefined, ctx?: FunctionContext): number {
  const scalar = scalarOf(value, ctx)
  if (typeof scalar === 'number') return scalar
  if (scalar === null) return 0
  if (typeof scalar === 'boolean') return scalar ? 1 : 0
  if (typeof scalar === 'string') {
    const parsed = parseNumber(scalar, ctx)
    return parsed === undefined ? fail(Errors.VALUE) : parsed
  }
  return fail(scalar)
}

/** `num` truncated toward zero, as Excel does for integer arguments. */
export function int(value: Value | undefined, ctx?: FunctionContext): number {
  return Math.trunc(num(value, ctx))
}

/** Coerces to text: numbers use `numberToText`, booleans are `TRUE`/`FALSE`, blanks are "". */
export function text(value: Value | undefined, ctx?: FunctionContext): string {
  const scalar = scalarOf(value, ctx)
  if (typeof scalar === 'string') return scalar
  if (typeof scalar === 'number') return numberToText(scalar)
  if (typeof scalar === 'boolean') return scalar ? 'TRUE' : 'FALSE'
  if (scalar === null) return ''
  return fail(scalar)
}

/** Coerces to a logical: numbers are non-zero, text must be TRUE/FALSE, blanks are FALSE. */
export function bool(value: Value | undefined, ctx?: FunctionContext): boolean {
  const scalar = scalarOf(value, ctx)
  if (typeof scalar === 'boolean') return scalar
  if (typeof scalar === 'number') return scalar !== 0
  if (scalar === null) return false
  if (typeof scalar === 'string') {
    const upper = scalar.trim().toUpperCase()
    if (upper === 'TRUE') return true
    if (upper === 'FALSE') return false
    return fail(Errors.VALUE)
  }
  return fail(scalar)
}

/** True when the argument position was not written at all (or written empty). */
export function omitted(args: Args, index: number): boolean {
  return index >= args.length || args[index] === undefined
}

export function optNum(args: Args, index: number, fallback: number, ctx?: FunctionContext): number {
  return index >= args.length ? fallback : num(args[index], ctx)
}

export function optInt(args: Args, index: number, fallback: number, ctx?: FunctionContext): number {
  return index >= args.length ? fallback : int(args[index], ctx)
}

export function optBool(args: Args, index: number, fallback: boolean, ctx?: FunctionContext): boolean {
  return index >= args.length ? fallback : bool(args[index], ctx)
}

export function optText(args: Args, index: number, fallback: string, ctx?: FunctionContext): string {
  return index >= args.length ? fallback : text(args[index], ctx)
}

/** Like `optNum`, but an empty slot (`=F(1,,2)`) also takes the default. */
export function defNum(args: Args, index: number, fallback: number, ctx?: FunctionContext): number {
  return omitted(args, index) ? fallback : num(args[index], ctx)
}

export function defInt(args: Args, index: number, fallback: number, ctx?: FunctionContext): number {
  return omitted(args, index) ? fallback : int(args[index], ctx)
}

export function defBool(args: Args, index: number, fallback: boolean, ctx?: FunctionContext): boolean {
  return omitted(args, index) ? fallback : bool(args[index], ctx)
}

/** Fails with #NUM! unless the condition holds. */
export function check(condition: boolean, error: FormulaError = Errors.NUM): void {
  if (!condition) fail(error)
}

// ---------------------------------------------------------------------------------------------
// Matrices

/** Any argument as a matrix: references resolve, scalars become 1×1, blanks stay blank. */
export function toMatrix(ctx: FunctionContext, value: Value | undefined): Matrix {
  if (value === undefined) return matrix(1, 1, [null])
  if (isReference(value)) return ctx.resolve(value)
  if (isMatrix(value)) return value
  if (isLambda(value)) return fail(Errors.CALC)
  return matrix(1, 1, [value])
}

export function cell(m: Matrix, row: number, col: number): Scalar {
  return matrixGet(m, row, col)
}

/** Row `row` of a matrix as an array. */
export function matrixRow(m: Matrix, row: number): Scalar[] {
  const { cols } = logicalSize(m)
  checkArraySize(1, cols)
  return Array.from({ length: cols }, (_, col) => matrixGet(m, row, col))
}

export function matrixCol(m: Matrix, col: number): Scalar[] {
  const out: Scalar[] = []
  const { rows } = logicalSize(m)
  checkArraySize(rows, 1)
  for (let row = 0; row < rows; row++) out.push(matrixGet(m, row, col))
  return out
}

export function transpose(m: Matrix): Matrix {
  const data: Scalar[] = new Array(m.rows * m.cols)
  for (let row = 0; row < m.rows; row++) for (let col = 0; col < m.cols; col++) data[col * m.rows + row] = m.data[row * m.cols + col] ?? null
  const size = logicalSize(m)
  return shaped(matrix(m.cols, m.rows, data), size.cols, size.rows, m.omittedValue ?? null)
}

/** A matrix of numbers for linear algebra: every cell must be a number (blanks and text are #VALUE!). */
export function numericMatrix(ctx: FunctionContext, value: Value | undefined): { rows: number; cols: number; data: number[] } {
  const source = toMatrix(ctx, value)
  if (omittedCells(source) && typeof source.omittedValue !== 'number') fail(isError(source.omittedValue) ? source.omittedValue : Errors.VALUE)
  const m = denseRange(source)
  const data = m.data.map((v) => {
    if (typeof v === 'number') return v
    if (isError(v)) return fail(v)
    return fail(Errors.VALUE)
  })
  return { rows: m.rows, cols: m.cols, data }
}

// ---------------------------------------------------------------------------------------------
// Comparison

/** Excel's ordering of value types in sorts and lookups: numbers < text < logicals; errors last. */
export function typeRank(value: Scalar): number {
  if (typeof value === 'number') return 0
  if (typeof value === 'string') return 1
  if (typeof value === 'boolean') return 2
  if (value === null) return 4
  return 3
}

/** Case-insensitive text comparison in Excel's collation order (close enough: lower-cased code points). */
export function compareText(a: string, b: string): number {
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  return la < lb ? -1 : la > lb ? 1 : 0
}

/** Total order for SORT/UNIQUE-style comparisons: numbers, text, logicals, errors, blanks. */
export function compareScalars(a: Scalar, b: Scalar): number {
  const ra = typeRank(a)
  const rb = typeRank(b)
  if (ra !== rb) return ra - rb
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') return compareText(a, b)
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return 0
}

/** Equality used by UNIQUE, EXACT-insensitive lookups: case-insensitive text, same type. */
export function scalarsEqual(a: Scalar, b: Scalar): boolean {
  if (a === null || b === null) return a === b
  if (isError(a) || isError(b)) return isError(a) && isError(b) && a.code === b.code
  if (typeof a !== typeof b) return false
  if (typeof a === 'string') return compareText(a, b as string) === 0
  return a === b
}

/** Two values for EXACT-style matching keyed in a Map (UNIQUE): case-folded text with a type tag. */
export function scalarKey(value: Scalar): string {
  if (value === null) return 'b:'
  if (typeof value === 'number') return `n:${value}`
  if (typeof value === 'string') return `s:${value.toLowerCase()}`
  if (typeof value === 'boolean') return `l:${value}`
  return `e:${value.code}`
}

/** Runs `fn`, turning a thrown Excel error into the result. */
export function attempt<T extends Value>(fn: () => T): T | FormulaError {
  try {
    return fn()
  } catch (error) {
    if (isError(error)) return error
    throw error
  }
}

/** Picks the element of `m` at broadcast position (row, col), Excel style; outside → #N/A. */
export function broadcastAt(m: Matrix, row: number, col: number): Scalar {
  const size = logicalSize(m)
  const r = size.rows === 1 ? 0 : row
  const c = size.cols === 1 ? 0 : col
  if (r >= size.rows || c >= size.cols) return Errors.NA
  return matrixGet(m, r, c)
}

/**
 * Lifts a scalar computation over `any` arguments the same way the evaluator lifts `scalar`
 * arguments: if any of them is a multi-cell array or reference, `fn` runs per element and the
 * results form an array (used for criteria in SUMIFS/COUNTIFS, whose argument kinds alternate).
 */
export function liftOver(ctx: FunctionContext, values: (Value | undefined)[], fn: (scalars: Scalar[]) => Scalar): Value {
  const mats = values.map((v) => (v === undefined ? undefined : isReference(v) || isMatrix(v) ? toMatrix(ctx, v) : undefined))
  const result = broadcastRanges(mats.map((m) => m ?? null), (cells) => attempt(() => fn(values.map((v, i) => mats[i] ? cells[i]! : v === undefined ? null : scalarOf(v, ctx)))))
  const size = logicalSize(result)
  return size.rows === 1 && size.cols === 1 ? matrixGet(result, 0, 0) : result
}
