/**
 * Values that flow through the formula engine, and the contract between the evaluator and the
 * function library. Functions are pure: they get evaluated arguments and a small context, and
 * return a value. Control functions that must not evaluate every argument (IF, IFERROR, CHOOSE,
 * LET, LAMBDA, …) and functions that work on references (ROW, OFFSET, INDIRECT, INDEX, …) live in
 * the evaluator instead.
 */

export type ErrorCode =
  | '#NULL!'
  | '#DIV/0!'
  | '#VALUE!'
  | '#REF!'
  | '#NAME?'
  | '#NUM!'
  | '#N/A'
  | '#GETTING_DATA'
  | '#SPILL!'
  | '#CALC!'
  | '#FIELD!'
  | '#BLOCKED!'
  | '#CONNECT!'
  | '#UNKNOWN!'
  | '#BUSY!'

/** An Excel error value. Use the shared instances in `Errors`; compare with `isError` or `.code`. */
export class FormulaError {
  constructor(readonly code: ErrorCode) {}
  toString(): string {
    return this.code
  }
}

export const Errors = {
  NULL: new FormulaError('#NULL!'),
  DIV0: new FormulaError('#DIV/0!'),
  VALUE: new FormulaError('#VALUE!'),
  REF: new FormulaError('#REF!'),
  NAME: new FormulaError('#NAME?'),
  NUM: new FormulaError('#NUM!'),
  NA: new FormulaError('#N/A'),
  SPILL: new FormulaError('#SPILL!'),
  CALC: new FormulaError('#CALC!'),
  GETTING_DATA: new FormulaError('#GETTING_DATA'),
  FIELD: new FormulaError('#FIELD!'),
  BLOCKED: new FormulaError('#BLOCKED!'),
  CONNECT: new FormulaError('#CONNECT!'),
  UNKNOWN: new FormulaError('#UNKNOWN!'),
  BUSY: new FormulaError('#BUSY!'),
} as const

const ERRORS_BY_CODE = new Map<string, FormulaError>(Object.values(Errors).map((error) => [error.code, error]))

/** The shared error instance for `#N/A`-style text, or undefined. Case-insensitive. */
export function errorFromCode(code: string): FormulaError | undefined {
  return ERRORS_BY_CODE.get(code.toUpperCase())
}

/**
 * A single value. `null` is a blank cell (distinct from the empty string `""`, which a formula can
 * return). Dates are serial numbers; the number format decides how they look.
 */
export type Scalar = number | string | boolean | FormulaError | null

/** A rectangular array of scalars, row-major. Array constants, range contents, and spilled results. */
export interface Matrix {
  kind: 'matrix'
  rows: number
  cols: number
  /** `rows * cols` values, row-major. */
  data: Scalar[]
  /** Logical bounds of a reference whose blank tail was not materialized. */
  logicalRows?: number
  logicalCols?: number
  /** Operators can turn the omitted blanks into a different uniform value. */
  omittedValue?: Scalar
}

/** One rectangular area of one sheet, zero-based and inclusive. */
export interface Area {
  /** Index of the sheet in the workbook's current order. */
  sheet: number
  top: number
  left: number
  bottom: number
  right: number
}

/**
 * A reference argument: one or more areas (several after the union operator `,` inside
 * parentheses). Functions that want contents call `ctx.resolve(ref)`.
 */
export interface Reference {
  kind: 'ref'
  areas: Area[]
}

/** A LAMBDA value: something `ctx.call` can invoke. */
export interface LambdaValue {
  kind: 'lambda'
  params: string[]
  /** Opaque to the function library. */
  body: unknown
  /** Captured LET/LAMBDA bindings. Opaque to the function library. */
  closure: unknown
}

export type Value = Scalar | Matrix | Reference | LambdaValue

export function isError(value: unknown): value is FormulaError {
  return value instanceof FormulaError
}

export function isMatrix(value: unknown): value is Matrix {
  return typeof value === 'object' && value !== null && (value as Matrix).kind === 'matrix'
}

export function isReference(value: unknown): value is Reference {
  return typeof value === 'object' && value !== null && (value as Reference).kind === 'ref'
}

export function isLambda(value: unknown): value is LambdaValue {
  return typeof value === 'object' && value !== null && (value as LambdaValue).kind === 'lambda'
}

export function matrix(rows: number, cols: number, data: Scalar[]): Matrix {
  return { kind: 'matrix', rows, cols, data }
}

export function matrixFromRows(rows: Scalar[][]): Matrix {
  const cols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const data: Scalar[] = []
  for (const row of rows) for (let col = 0; col < cols; col++) data.push(col < row.length ? row[col]! : Errors.NA)
  return { kind: 'matrix', rows: rows.length, cols, data }
}

export function matrixGet(value: Matrix, row: number, col: number): Scalar {
  if (row >= value.rows || col >= value.cols) return value.omittedValue ?? null
  return value.data[row * value.cols + col] ?? null
}

/** Whatever the evaluator offers a function besides its arguments. */
export interface FunctionContext {
  /** True for workbooks using the 1904 date system (serial 0 is 1904-01-01). */
  readonly date1904: boolean
  /** The cell being calculated (for functions like ROW() without arguments). */
  readonly sheet: number
  readonly row: number
  readonly col: number
  /** Current time as an Excel serial in the workbook's date system (NOW, TODAY). Stable within one recalculation. */
  now(): number
  /** A random number in [0, 1). Deterministic under test. */
  random(): number
  /** The values a reference covers. Multi-area references resolve to their first area. */
  resolve(ref: Reference): Matrix
  /** Every area of a reference, resolved, for functions that accept unions (SUM((A1:A2,C1:C2))). */
  resolveAreas(ref: Reference): Matrix[]
  /** Calls a LAMBDA with arguments (MAP, REDUCE, BYROW, …). */
  call(lambda: LambdaValue, args: Value[]): Value
}

/**
 * How the evaluator passes one argument:
 * - `scalar`: a single value. Arrays and references passed here are lifted: the function runs once
 *   per element and its results form an array (=ABS(A1:A3) spills three values). References to a
 *   single cell arrive as that cell's value.
 * - `any`: whatever the argument evaluated to, unchanged (Matrix, Reference, Scalar, Lambda), for
 *   aggregates (SUM), lookups, and array functions.
 */
export type ArgKind = 'scalar' | 'any'

export interface FunctionSpec {
  /** Upper-case name without the `_xlfn.`/`_xlws.` prefix, e.g. `XLOOKUP`. */
  name: string
  minArgs: number
  /** `Infinity` for variadic functions. */
  maxArgs: number
  /**
   * Argument kinds by position. Positions past the end repeat the last entry, so variadic
   * functions list one kind for all their repeated arguments. Default: every argument `scalar`.
   */
  args?: ArgKind[]
  /** Recalculated on every recalculation (NOW, RAND, …). */
  volatile?: boolean
  /** Excel writes this function with the `_xlfn.` prefix in files (functions added after 2007). */
  xlfn?: boolean
  /**
   * `args.length` is the number of arguments written, so omitted trailing arguments are absent.
   * An empty argument slot that is written (`=ROUND(1.5,)`, `=IF(A1,,1)`) arrives as `undefined`;
   * Excel treats it as 0, "" or FALSE for most functions and as "use the default" for some.
   */
  fn: (ctx: FunctionContext, args: (Value | undefined)[]) => Value
}

/** Dimensions before the engine trimmed a reference to the used rectangle. */
export function logicalSize(value: Matrix): { rows: number; cols: number } {
  return { rows: value.logicalRows ?? value.rows, cols: value.logicalCols ?? value.cols }
}

export function omittedCells(value: Matrix): number {
  const size = logicalSize(value)
  return size.rows * size.cols - value.rows * value.cols
}
