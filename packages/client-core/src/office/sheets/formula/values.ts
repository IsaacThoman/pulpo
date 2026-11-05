/**
 * Excel's scalar semantics: coercion, comparison, and the arithmetic, text, and comparison
 * operators. Shared by the evaluator and available to the function library.
 */

import { parseNumberText } from '../numfmt/parse.js'
import { consumeWork } from './budget.js'
import { checkArraySize, Errors, FormulaError, isError, logicalSize, matrix, matrixGet, type Matrix, type Scalar } from './types.js'

/** Longest text a cell can hold. */
export const MAX_TEXT_LENGTH = 32_767

/**
 * A number as General formatting writes it when Excel turns it into text (`=1/3&""`): at most 15
 * significant digits, scientific notation from 1E+15 up and below 1E-9.
 */
export function numberToText(value: number): string {
  if (!Number.isFinite(value)) return '#NUM!'
  if (value === 0) return '0'
  const negative = value < 0
  const exponential = Math.abs(value).toExponential(14)
  const [mantissa, exponentText] = exponential.split('e') as [string, string]
  const exponent = Number(exponentText)
  const digits = mantissa.replace('.', '').replace(/0+$/, '') || '0'
  let text: string
  if (exponent >= 15 || exponent < -9) {
    const rest = digits.slice(1)
    const size = Math.abs(exponent)
    text = `${digits[0]}${rest ? `.${rest}` : ''}E${exponent < 0 ? '-' : '+'}${size < 10 ? `0${size}` : size}`
  } else if (exponent >= 0) {
    const whole = digits.slice(0, exponent + 1).padEnd(exponent + 1, '0')
    const fraction = digits.slice(exponent + 1)
    text = fraction ? `${whole}.${fraction}` : whole
  } else {
    text = `0.${'0'.repeat(-exponent - 1)}${digits}`
  }
  return negative ? `-${text}` : text
}

/** Arithmetic coercion: booleans are 1/0, blanks 0, numeric text is parsed, other text is #VALUE!. */
export function toNumber(value: Scalar, date1904 = false, currentYear = 2000): number | FormulaError {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value === null) return 0
  if (typeof value === 'string') return parseNumberText(value, { date1904, currentYear }) ?? Errors.VALUE
  return value
}

/** Text coercion: numbers in General format, booleans as TRUE/FALSE, blanks as "". */
export function toText(value: Scalar): string | FormulaError {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return numberToText(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value === null) return ''
  return value
}

/** Logical coercion: nonzero numbers are TRUE, "TRUE"/"FALSE" text converts, other text is #VALUE!. */
export function toBoolean(value: Scalar): boolean | FormulaError {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (value === null) return false
  if (typeof value === 'string') {
    const upper = value.toUpperCase()
    if (upper === 'TRUE') return true
    if (upper === 'FALSE') return false
    return Errors.VALUE
  }
  return value
}

/** Rounds to Excel's 15 significant digits, the precision Excel compares at. */
export function round15(value: number): number {
  if (value === 0 || !Number.isFinite(value)) return value
  return Number(value.toPrecision(15))
}

function typeRank(value: Exclude<Scalar, null | FormulaError>): number {
  return typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : 2
}

/**
 * Orders two non-error values the way Excel's comparison operators do: numbers < text <
 * booleans, text case-insensitively, numbers equal within 15 significant digits, and a blank
 * compares as 0, "" or FALSE depending on the other side. Returns -1, 0, or 1.
 */
export function compareScalars(a: Exclude<Scalar, FormulaError>, b: Exclude<Scalar, FormulaError>): number {
  if (a === null && b === null) return 0
  if (a === null) a = typeof b === 'number' ? 0 : typeof b === 'string' ? '' : false
  if (b === null) b = typeof a === 'number' ? 0 : typeof a === 'string' ? '' : false
  const rankA = typeRank(a)
  const rankB = typeRank(b)
  if (rankA !== rankB) return rankA < rankB ? -1 : 1
  if (typeof a === 'number') {
    const x = round15(a)
    const y = round15(b as number)
    return x === y ? 0 : x < y ? -1 : 1
  }
  if (typeof a === 'string') {
    const x = a.toLowerCase()
    const y = (b as string).toLowerCase()
    return x === y ? 0 : x < y ? -1 : 1
  }
  return a === b ? 0 : a ? 1 : -1
}

/** Excel `=` semantics for two scalars (errors are never equal to anything). */
export function scalarsEqual(a: Scalar, b: Scalar): boolean {
  if (isError(a) || isError(b)) return false
  return compareScalars(a, b) === 0
}

/** Exactly the same value (for change detection), unlike Excel's case-insensitive `=`. */
export function sameScalar(a: Scalar, b: Scalar): boolean {
  if (a === b) return true
  if (isError(a) && isError(b)) return a.code === b.code
  return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)
}

function finite(value: number): number | FormulaError {
  if (!Number.isFinite(value)) return Errors.NUM
  return value === 0 ? 0 : value
}

export type ScalarOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>='

/**
 * Applies a binary operator to two scalars. `snapToZero` turns on Excel's rule for the outermost
 * `+`/`-` of a formula: a result that is zero to within 15 digits of the operands becomes 0, so
 * `=0.5-0.4-0.1` shows 0 while `=(0.5-0.4-0.1)*1` shows -2.78E-17.
 */
export function binaryScalar(op: ScalarOp, a: Scalar, b: Scalar, date1904 = false, snapToZero = false, currentYear = 2000): Scalar {
  consumeWork()
  switch (op) {
    case '&': {
      const x = toText(a)
      if (isError(x)) return x
      const y = toText(b)
      if (isError(y)) return y
      if (x.length + y.length > MAX_TEXT_LENGTH) return Errors.VALUE
      return x + y
    }
    case '=':
    case '<>':
    case '<':
    case '>':
    case '<=':
    case '>=': {
      if (isError(a)) return a
      if (isError(b)) return b
      const order = compareScalars(a, b)
      switch (op) {
        case '=':
          return order === 0
        case '<>':
          return order !== 0
        case '<':
          return order < 0
        case '>':
          return order > 0
        case '<=':
          return order <= 0
        default:
          return order >= 0
      }
    }
  }
  const x = toNumber(a, date1904, currentYear)
  if (isError(x)) return x
  const y = toNumber(b, date1904, currentYear)
  if (isError(y)) return y
  switch (op) {
    case '+':
    case '-': {
      const result = op === '+' ? x + y : x - y
      if (snapToZero && result !== 0 && Math.abs(result) <= Math.max(Math.abs(x), Math.abs(y)) * 2 ** -49) return 0
      return finite(result)
    }
    case '*':
      return finite(x * y)
    case '/':
      return y === 0 ? Errors.DIV0 : finite(x / y)
    case '^':
      return power(x, y)
  }
}

/** Excel's `^`: 0^0 is #NUM!, 0 to a negative power is #DIV/0!, roots of negatives are #NUM!. */
export function power(base: number, exponent: number): number | FormulaError {
  if (base === 0) {
    if (exponent === 0) return Errors.NUM
    if (exponent < 0) return Errors.DIV0
  }
  const result = Math.pow(base, exponent)
  if (Number.isNaN(result)) return Errors.NUM
  return finite(result)
}

export function negate(value: Scalar, date1904 = false, currentYear = 2000): Scalar {
  consumeWork()
  const x = toNumber(value, date1904, currentYear)
  return isError(x) ? x : x === 0 ? 0 : -x
}

export function percent(value: Scalar, date1904 = false, currentYear = 2000): Scalar {
  consumeWork()
  const x = toNumber(value, date1904, currentYear)
  return isError(x) ? x : x / 100
}

/**
 * Combines two operands element by element. Arrays broadcast like Excel: a single row or column
 * stretches to the other's size, and cells beyond a smaller array's edge are #N/A.
 */
export function elementwise(a: Scalar | Matrix, b: Scalar | Matrix, fn: (x: Scalar, y: Scalar) => Scalar): Scalar | Matrix {
  if (!isMatrixValue(a) && !isMatrixValue(b)) return fn(a, b)
  const rows = Math.max(isMatrixValue(a) ? a.rows : 1, isMatrixValue(b) ? b.rows : 1)
  const cols = Math.max(isMatrixValue(a) ? a.cols : 1, isMatrixValue(b) ? b.cols : 1)
  checkArraySize(rows, cols)
  const data: Scalar[] = new Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = broadcastAt(a, r, c)
      const y = broadcastAt(b, r, c)
      data[r * cols + c] = x === undefined || y === undefined ? Errors.NA : fn(x, y)
    }
  }
  const result = matrix(rows, cols, data)
  const sizeA = isMatrixValue(a) ? logicalSize(a) : { rows: 1, cols: 1 }
  const sizeB = isMatrixValue(b) ? logicalSize(b) : { rows: 1, cols: 1 }
  const logicalRows = Math.max(sizeA.rows, sizeB.rows)
  const logicalCols = Math.max(sizeA.cols, sizeB.cols)
  if (logicalRows !== rows || logicalCols !== cols) {
    result.logicalRows = logicalRows
    result.logicalCols = logicalCols
    result.omittedValue = fn(isMatrixValue(a) ? a.omittedValue ?? null : a, isMatrixValue(b) ? b.omittedValue ?? null : b)
  }
  return result
}

/** Maps a scalar function over an operand. */
export function mapValue(a: Scalar | Matrix, fn: (x: Scalar) => Scalar): Scalar | Matrix {
  if (!isMatrixValue(a)) return fn(a)
  return { ...a, data: a.data.map(fn), ...(a.logicalRows !== undefined || a.logicalCols !== undefined ? { omittedValue: fn(a.omittedValue ?? null) } : {}) }
}

function isMatrixValue(value: Scalar | Matrix): value is Matrix {
  return typeof value === 'object' && value !== null && !(value instanceof FormulaError)
}

/** The element of a broadcast operand at (row, col); undefined past the edge of a smaller array. */
export function broadcastAt(value: Scalar | Matrix, row: number, col: number): Scalar | undefined {
  if (!isMatrixValue(value)) return value
  const size = logicalSize(value)
  const r = size.rows === 1 ? 0 : row
  const c = size.cols === 1 ? 0 : col
  if (r >= size.rows || c >= size.cols) return undefined
  return matrixGet(value, r, c)
}
