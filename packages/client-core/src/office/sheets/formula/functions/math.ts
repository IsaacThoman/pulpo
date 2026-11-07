/** Math and trigonometry functions. */

import { maxOf, minOf } from '../../../../collections.js'

import { consumeWork } from '../budget.js'
import { forEachLogical, alignedRanges, denseRange, rangeSlice } from '../ranges.js'
import { logicalSize } from '../types.js'
import { Errors, isError, isReference, matrix, type FunctionContext, type FunctionSpec, type Matrix, type Reference, type Scalar, type Value } from '../types.js'
import {
  check,
  checkArraySize,
  defBool,
  defNum,
  define,
  fail,
  int,
  liftOver,
  num,
  numericMatrix,
  optInt,
  optNum,
  scalarOf,
  text,
  toMatrix,
  type Args,
} from './coerce.js'
import { parseCriteria } from './criteria.js'
import { collectNumbers, numberSummary } from './iterate.js'
import { combin, factorial, gcd2, median, mean, modes, percentileExc, percentileInc, round15, roundDecimal, sorted, sum, variance } from './numeric.js'

/** A one-argument numeric function; `f` returning NaN or ±∞ becomes #NUM!. */
function unary(name: string, f: (x: number) => number, extra: { xlfn?: boolean } = {}): FunctionSpec {
  return define({ name, min: 1, max: 1, ...extra, fn: (ctx, args) => f(num(args[0], ctx)) })
}

/** Excel's trig functions refuse arguments of 2^27 and more. */
const TRIG_LIMIT = 2 ** 27

function trig(name: string, f: (x: number) => number, zeroError?: boolean, xlfn?: boolean): FunctionSpec {
  return unary(
    name,
    (x) => {
      if (Math.abs(x) >= TRIG_LIMIT) return fail(Errors.NUM)
      if (zeroError && x === 0) return fail(Errors.DIV0)
      return f(x)
    },
    { xlfn },
  )
}

// ---------------------------------------------------------------------------------------------
// Ranges for the *IF(S) functions

/** A reference resized to `rows`×`cols` from its top-left cell, as SUMIF does with its sum_range. */
function resizeReference(ref: Reference, rows: number, cols: number): Reference {
  const area = ref.areas[0]
  if (!area) return ref
  return { kind: 'ref', areas: [{ sheet: area.sheet, top: area.top, left: area.left, bottom: area.top + rows - 1, right: area.left + cols - 1 }] }
}

/** The cells of `range`, requiring a real range (references or arrays). */
export function criteriaRange(ctx: FunctionContext, value: Value | undefined): Matrix {
  return toMatrix(ctx, value)
}

/** The values `sum_range` covers when it is resized to `rows`×`cols`. */
export function sizedLike(ctx: FunctionContext, value: Value | undefined, rows: number, cols: number): Matrix {
  if (isReference(value)) return ctx.resolve(resizeReference(value, rows, cols))
  return rangeSlice(toMatrix(ctx, value), 0, 0, rows, cols)
}

/** Shared positional criteria driver; uniform tails are weighted instead of expanded. */
export function ifsAggregate(
  ctx: FunctionContext,
  target: Value | undefined,
  pairs: Args,
  reduce: (values: Scalar[], count: number, weights: number[]) => Scalar,
): Value {
  if (pairs.length < 2 || pairs.length % 2) return fail(Errors.VALUE)
  const ranges: Matrix[] = []
  const criteriaArgs: (Value | undefined)[] = []
  for (let i = 0; i < pairs.length; i += 2) {
    ranges.push(criteriaRange(ctx, pairs[i]))
    criteriaArgs.push(pairs[i + 1])
  }
  const targetMatrix = target === undefined ? undefined : toMatrix(ctx, target)
  return liftOver(ctx, criteriaArgs, (criteria) => {
    const predicates = criteria.map((criterion) => parseCriteria(criterion, ctx))
    const values: Scalar[] = []
    const weights: number[] = []
    let count = 0
    alignedRanges(targetMatrix ? [...ranges, targetMatrix] : ranges, (cells, weight) => {
      if (!predicates.every((predicate, i) => predicate(cells[i]!))) return
      count += weight
      if (targetMatrix) { values.push(cells[cells.length - 1]!); weights.push(weight) }
    })
    return reduce(values, count, weights)
  })
}

export function conditionalTotal(values: Scalar[], weights: number[], average = false): number {
  const totals: number[] = []
  let count = 0
  values.forEach((value, i) => {
    if (isError(value)) fail(value)
    if (typeof value === 'number') { totals.push(value * weights[i]!); count += weights[i]! }
  })
  if (average && !count) fail(Errors.DIV0)
  const total = sum(totals)
  return average ? total / count : total
}

// ---------------------------------------------------------------------------------------------
// Aggregates with function numbers

type AggregateFn = (values: number[], k?: number) => number

const STAT_BY_NUMBER: Record<number, AggregateFn> = {
  1: (v) => mean(v),
  2: (v) => v.length,
  3: (v) => v.length,
  4: (v) => (v.length ? maxOf(v) : 0),
  5: (v) => (v.length ? minOf(v) : 0),
  6: (v) => (v.length ? v.reduce((a, b) => a * b, 1) : 0),
  7: (v) => Math.sqrt(variance(v, true)),
  8: (v) => Math.sqrt(variance(v, false)),
  9: (v) => sum(v),
  10: (v) => variance(v, true),
  11: (v) => variance(v, false),
  12: (v) => median(v),
  13: (v) => {
    const m = modes(v)
    return m.length ? m[0]! : fail(Errors.NA)
  },
  14: (v, k = 0) => {
    const s = sorted(v)
    const i = Math.ceil(k)
    check(i >= 1 && i <= s.length)
    return s[s.length - i]!
  },
  15: (v, k = 0) => {
    const s = sorted(v)
    const i = Math.ceil(k)
    check(i >= 1 && i <= s.length)
    return s[i - 1]!
  },
  16: (v, k = 0) => percentileInc(sorted(v), k),
  17: (v, k = 0) => {
    const q = Math.trunc(k)
    check(q >= 0 && q <= 4)
    return percentileInc(sorted(v), q / 4)
  },
  18: (v, k = 0) => percentileExc(sorted(v), k),
  19: (v, k = 0) => {
    const q = Math.trunc(k)
    check(q >= 1 && q <= 3)
    return percentileExc(sorted(v), q / 4)
  },
}

/** Counts for COUNTA-style function numbers (3 and 103): every non-blank value, errors included unless skipped. */
function countA(ctx: FunctionContext, args: Args, skipErrors: boolean): number {
  let count = 0
  for (const arg of args) {
    const m = toMatrix(ctx, arg)
    forEachLogical(m, (v, weight) => {
      if (v !== null && !(isError(v) && skipErrors)) count += weight
    }, { weightedTail: true })
  }
  return count
}

function aggregateValues(ctx: FunctionContext, fnNum: number, args: Args, skipErrors: boolean): number {
  const base = fnNum > 100 ? fnNum - 100 : fnNum
  const stat = STAT_BY_NUMBER[base]
  if (!stat) return fail(Errors.VALUE)
  if (base === 3) return countA(ctx, args, skipErrors)
  // COUNT always skips errors; the others propagate unless the options say to ignore them.
  const values = collectNumbers(ctx, args, { skipErrors: skipErrors || base === 2, directText: 'skip' })
  return stat(values)
}

// ---------------------------------------------------------------------------------------------
// Rounding

function ceilingSig(x: number, sig: number): number {
  if (sig === 0 || x === 0) return 0
  return round15(Math.ceil(round15(x / sig)) * sig)
}

function floorSig(x: number, sig: number): number {
  if (sig === 0 || x === 0) return 0
  return round15(Math.floor(round15(x / sig)) * sig)
}

function mathRound(name: string, mode: 'half' | 'up' | 'down'): FunctionSpec {
  return define({ name, min: 2, max: 2, fn: (ctx, args) => roundDecimal(num(args[0], ctx), int(args[1], ctx), mode) })
}

// ---------------------------------------------------------------------------------------------
// Roman numerals

const ROMAN_TABLES: [number, string][][] = (() => {
  const base: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  const extras: [number, string][][] = [
    [],
    [[950, 'LM'], [450, 'LD'], [95, 'VC'], [45, 'VL']],
    [[990, 'XM'], [490, 'XD'], [99, 'IC'], [49, 'IL']],
    [[995, 'VM'], [495, 'VD']],
    [[999, 'IM'], [499, 'ID']],
  ]
  const tables: [number, string][][] = []
  let acc = base
  for (const extra of extras) {
    acc = [...acc, ...extra].sort((a, b) => b[0] - a[0])
    tables.push(acc)
  }
  return tables
})()

function toRoman(n: number, form: number): string {
  let out = ''
  for (const [value, symbol] of ROMAN_TABLES[form]!) {
    while (n >= value) {
      consumeWork()
      out += symbol
      n -= value
    }
  }
  return out
}

const ROMAN_VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }

function fromRoman(textValue: string): number {
  let s = textValue.trim().toUpperCase()
  if (s.length > 255) fail(Errors.VALUE)
  let sign = 1
  if (s.startsWith('-')) {
    sign = -1
    s = s.slice(1)
  }
  let total = 0
  for (let i = 0; i < s.length; i++) {
    consumeWork()
    const value = ROMAN_VALUES[s[i]!]
    if (value === undefined) fail(Errors.VALUE)
    const next = i + 1 < s.length ? (ROMAN_VALUES[s[i + 1]!] ?? 0) : 0
    total += value < next ? -value : value
  }
  return sign * total
}

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// ---------------------------------------------------------------------------------------------
// Linear algebra

export function luDeterminant(n: number, a: number[]): number {
  const m = a.slice()
  let det = 1
  for (let col = 0; col < n; col++) {
    consumeWork(n * n)
    let pivot = col
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row * n + col]!) > Math.abs(m[pivot * n + col]!)) pivot = row
    if (m[pivot * n + col] === 0) return 0
    if (pivot !== col) {
      for (let k = 0; k < n; k++) [m[col * n + k], m[pivot * n + k]] = [m[pivot * n + k]!, m[col * n + k]!]
      det = -det
    }
    const p = m[col * n + col]!
    det *= p
    for (let row = col + 1; row < n; row++) {
      const factor = m[row * n + col]! / p
      if (!factor) continue
      for (let k = col; k < n; k++) m[row * n + k] = m[row * n + k]! - factor * m[col * n + k]!
    }
  }
  return det
}

/** Gauss-Jordan inverse; undefined for singular matrices. */
export function invertMatrix(n: number, a: number[]): number[] | undefined {
  const m = a.slice()
  checkArraySize(n, n)
  consumeWork(n * n * n)
  const inv = new Array<number>(n * n).fill(0)
  for (let i = 0; i < n; i++) inv[i * n + i] = 1
  for (let col = 0; col < n; col++) {
    consumeWork(n * n)
    let pivot = col
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row * n + col]!) > Math.abs(m[pivot * n + col]!)) pivot = row
    const p = m[pivot * n + col]!
    if (Math.abs(p) < 1e-300) return undefined
    if (pivot !== col) {
      for (let k = 0; k < n; k++) {
        ;[m[col * n + k], m[pivot * n + k]] = [m[pivot * n + k]!, m[col * n + k]!]
        ;[inv[col * n + k], inv[pivot * n + k]] = [inv[pivot * n + k]!, inv[col * n + k]!]
      }
    }
    for (let k = 0; k < n; k++) {
      m[col * n + k] = m[col * n + k]! / p
      inv[col * n + k] = inv[col * n + k]! / p
    }
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = m[row * n + col]!
      if (!factor) continue
      for (let k = 0; k < n; k++) {
        m[row * n + k] = m[row * n + k]! - factor * m[col * n + k]!
        inv[row * n + k] = inv[row * n + k]! - factor * inv[col * n + k]!
      }
    }
  }
  return inv
}

export function multiply(a: { rows: number; cols: number; data: number[] }, b: { rows: number; cols: number; data: number[] }): number[] {
  checkArraySize(a.rows, b.cols)
  consumeWork(a.rows * a.cols * b.cols)
  const out = new Array<number>(a.rows * b.cols).fill(0)
  for (let i = 0; i < a.rows; i++)
    for (let k = 0; k < a.cols; k++) {
      const aik = a.data[i * a.cols + k]!
      if (!aik) continue
      for (let j = 0; j < b.cols; j++) out[i * b.cols + j] = out[i * b.cols + j]! + aik * b.data[k * b.cols + j]!
    }
  return out
}

// ---------------------------------------------------------------------------------------------
// Pairwise sums

function pairSum(name: string, f: (x: number, y: number) => number): FunctionSpec {
  return define({
    name,
    min: 2,
    max: 2,
    args: ['any'],
    fn: (ctx, args) => {
      const a = toMatrix(ctx, args[0])
      const b = toMatrix(ctx, args[1])
      let total = 0
      alignedRanges([a, b], ([x, y], count) => {
        if (isError(x)) fail(x)
        if (isError(y)) fail(y)
        if (typeof x === 'number' && typeof y === 'number') total += count * f(x, y)
      }, Errors.NA, true)
      return total
    },
  })
}

function integerArgs(ctx: FunctionContext, args: Args): number[] {
  const values = collectNumbers(ctx, args)
  return values.map((v) => {
    check(v >= 0 && v < 2 ** 53)
    return Math.trunc(v)
  })
}

export const MATH_FUNCTIONS: FunctionSpec[] = [
  define({ name: 'SUM', min: 1, max: 255, args: ['any'], fn: (ctx, args) => numberSummary(ctx, args).total }),
  define({ name: 'SUMSQ', min: 1, max: 255, args: ['any'], fn: (ctx, args) => numberSummary(ctx, args).squares }),
  define({
    name: 'PRODUCT',
    min: 1,
    max: 255,
    args: ['any'],
    fn: (ctx, args) => {
      return numberSummary(ctx, args).product
    },
  }),
  define({
    name: 'SUMPRODUCT',
    min: 1,
    max: 255,
    args: ['any'],
    fn: (ctx, args) => {
      const mats = args.map((a) => toMatrix(ctx, a))
      let total = 0
      alignedRanges(mats, (cells, count) => {
        let product = 1
        for (const value of cells) {
          if (isError(value)) fail(value)
          product *= typeof value === 'number' ? value : 0
        }
        total += count * product
      })
      return total
    },
  }),
  pairSum('SUMX2MY2', (x, y) => x * x - y * y),
  pairSum('SUMX2PY2', (x, y) => x * x + y * y),
  pairSum('SUMXMY2', (x, y) => (x - y) * (x - y)),
  define({
    name: 'QUOTIENT',
    min: 2,
    max: 2,
    fn: (ctx, args) => {
      const n = num(args[0], ctx)
      const d = num(args[1], ctx)
      if (d === 0) return fail(Errors.DIV0)
      return Math.trunc(round15(n / d))
    },
  }),
  define({
    name: 'MOD',
    min: 2,
    max: 2,
    fn: (ctx, args) => {
      const n = num(args[0], ctx)
      const d = num(args[1], ctx)
      if (d === 0) return fail(Errors.DIV0)
      let r = n % d
      if (r !== 0 && Math.sign(r) !== Math.sign(d)) r += d
      // Snap binary noise (MOD(1.1, 0.1)) to the 15-digit result Excel shows.
      const snapped = round15(r)
      return Math.abs(snapped - d) < Math.abs(d) * 1e-14 ? 0 : snapped
    },
  }),
  unary('ABS', Math.abs),
  unary('SIGN', Math.sign),
  unary('INT', Math.floor),
  define({ name: 'TRUNC', min: 1, max: 2, fn: (ctx, args) => roundDecimal(num(args[0], ctx), optInt(args, 1, 0, ctx), 'down') }),
  mathRound('ROUND', 'half'),
  mathRound('ROUNDUP', 'up'),
  mathRound('ROUNDDOWN', 'down'),
  define({
    name: 'MROUND',
    min: 2,
    max: 2,
    fn: (ctx, args) => {
      const n = num(args[0], ctx)
      const m = num(args[1], ctx)
      if (m === 0 || n === 0) return 0
      check(Math.sign(n) === Math.sign(m))
      return round15(roundDecimal(round15(n / m), 0, 'half') * m)
    },
  }),
  define({
    name: 'CEILING',
    min: 2,
    max: 2,
    fn: (ctx, args) => {
      const n = num(args[0], ctx)
      const s = num(args[1], ctx)
      if (s === 0) return 0
      check(!(n > 0 && s < 0))
      // Negative numbers with a negative significance round away from zero.
      if (n < 0 && s < 0) return -ceilingSig(-n, -s)
      return ceilingSig(n, s)
    },
  }),
  define({
    name: 'FLOOR',
    min: 2,
    max: 2,
    fn: (ctx, args) => {
      const n = num(args[0], ctx)
      const s = num(args[1], ctx)
      if (s === 0) return n === 0 ? 0 : fail(Errors.DIV0)
      check(!(n > 0 && s < 0))
      if (n < 0 && s < 0) return -floorSig(-n, -s)
      return floorSig(n, s)
    },
  }),
  define({
    name: 'CEILING.MATH',
    min: 1,
    max: 3,
    xlfn: true,
    fn: (ctx, args) => {
      const n = num(args[0], ctx)
      const s = Math.abs(defNum(args, 1, 1, ctx))
      const mode = defNum(args, 2, 0, ctx)
      if (s === 0) return 0
      if (n < 0 && mode !== 0) return -ceilingSig(-n, s)
      return ceilingSig(n, s)
    },
  }),
  define({
    name: 'FLOOR.MATH',
    min: 1,
    max: 3,
    xlfn: true,
    fn: (ctx, args) => {
      const n = num(args[0], ctx)
      const s = Math.abs(defNum(args, 1, 1, ctx))
      const mode = defNum(args, 2, 0, ctx)
      if (s === 0) return 0
      if (n < 0 && mode !== 0) return -floorSig(-n, s)
      return floorSig(n, s)
    },
  }),
  ...['CEILING.PRECISE', 'ISO.CEILING'].map((name) =>
    define({ name, min: 1, max: 2, xlfn: true, fn: (ctx, args) => ceilingSig(num(args[0], ctx), Math.abs(defNum(args, 1, 1, ctx))) }),
  ),
  define({ name: 'FLOOR.PRECISE', min: 1, max: 2, xlfn: true, fn: (ctx, args) => floorSig(num(args[0], ctx), Math.abs(defNum(args, 1, 1, ctx))) }),
  unary('EVEN', (x) => {
    const r = Math.ceil(round15(Math.abs(x)) / 2) * 2
    return x < 0 ? -r : r
  }),
  unary('ODD', (x) => {
    let r = Math.ceil(round15(Math.abs(x)))
    if (r % 2 === 0) r += 1
    return x < 0 ? -r : r
  }),
  unary('SQRT', (x) => (x < 0 ? fail(Errors.NUM) : Math.sqrt(x))),
  unary('SQRTPI', (x) => (x < 0 ? fail(Errors.NUM) : Math.sqrt(x * Math.PI))),
  define({
    name: 'POWER',
    min: 2,
    max: 2,
    fn: (ctx, args) => power(num(args[0], ctx), num(args[1], ctx)),
  }),
  unary('EXP', Math.exp),
  unary('LN', (x) => (x <= 0 ? fail(Errors.NUM) : Math.log(x))),
  unary('LOG10', (x) => (x <= 0 ? fail(Errors.NUM) : Math.log10(x))),
  define({
    name: 'LOG',
    min: 1,
    max: 2,
    fn: (ctx, args) => {
      const n = num(args[0], ctx)
      const base = optNum(args, 1, 10, ctx)
      check(n > 0 && base > 0)
      if (base === 1) return fail(Errors.DIV0)
      if (base === 10) return Math.log10(n)
      if (base === 2) return Math.log2(n)
      return Math.log(n) / Math.log(base)
    },
  }),
  define({ name: 'PI', min: 0, max: 0, fn: () => Math.PI }),
  define({ name: 'RAND', min: 0, max: 0, volatile: true, fn: (ctx) => ctx.random() }),
  define({
    name: 'RANDBETWEEN',
    min: 2,
    max: 2,
    volatile: true,
    fn: (ctx, args) => {
      const bottom = Math.ceil(num(args[0], ctx))
      const top = Math.floor(num(args[1], ctx))
      check(bottom <= top)
      return bottom + Math.floor(ctx.random() * (top - bottom + 1))
    },
  }),
  define({
    name: 'RANDARRAY',
    min: 0,
    max: 5,
    volatile: true,
    xlfn: true,
    fn: (ctx, args) => {
      const rows = defNum(args, 0, 1, ctx)
      const cols = defNum(args, 1, 1, ctx)
      const lo = defNum(args, 2, 0, ctx)
      const hi = defNum(args, 3, 1, ctx)
      const whole = defBool(args, 4, false, ctx)
      check(rows >= 1 && cols >= 1, Errors.VALUE)
      check(lo <= hi, Errors.VALUE)
      const r = Math.trunc(rows)
      const c = Math.trunc(cols)
      checkArraySize(r, c)
      const data: Scalar[] = []
      for (let i = 0; i < r * c; i++) {
        if (whole) {
          const a = Math.ceil(lo)
          const b = Math.floor(hi)
          check(a <= b, Errors.VALUE)
          data.push(a + Math.floor(ctx.random() * (b - a + 1)))
        } else data.push(lo + ctx.random() * (hi - lo))
      }
      return matrix(r, c, data)
    },
  }),
  unary('FACT', (x) => {
    check(x >= 0)
    const n = Math.trunc(x)
    check(n <= 170)
    return factorial(n)
  }),
  unary('FACTDOUBLE', (x) => {
    const n = Math.trunc(x)
    check(n >= -1 && n <= 300)
    let r = 1
    for (let i = n; i > 1; i -= 2) {
      consumeWork()
      r *= i
    }
    return r
  }),
  define({
    name: 'COMBIN',
    min: 2,
    max: 2,
    fn: (ctx, args) => {
      const n = int(args[0], ctx)
      const k = int(args[1], ctx)
      check(n >= 0 && k >= 0 && n >= k)
      return combin(n, k)
    },
  }),
  define({
    name: 'COMBINA',
    min: 2,
    max: 2,
    xlfn: true,
    fn: (ctx, args) => {
      const n = int(args[0], ctx)
      const k = int(args[1], ctx)
      check(n >= 0 && k >= 0 && n >= k)
      if (n === 0 && k === 0) return 1
      return combin(n + k - 1, k)
    },
  }),
  define({
    name: 'PERMUT',
    min: 2,
    max: 2,
    fn: (ctx, args) => {
      const n = int(args[0], ctx)
      const k = int(args[1], ctx)
      check(n > 0 && k >= 0 && n >= k)
      let r = 1
      for (let i = n - k + 1; i <= n; i++) {
        consumeWork()
        r *= i
        if (!Number.isFinite(r)) return fail(Errors.NUM)
      }
      return r
    },
  }),
  define({
    name: 'PERMUTATIONA',
    min: 2,
    max: 2,
    xlfn: true,
    fn: (ctx, args) => {
      const n = int(args[0], ctx)
      const k = int(args[1], ctx)
      check(n >= 0 && k >= 0)
      return n ** k
    },
  }),
  define({
    name: 'GCD',
    min: 1,
    max: 255,
    args: ['any'],
    fn: (ctx, args) => integerArgs(ctx, args).reduce((a, b) => gcd2(a, b), 0),
  }),
  define({
    name: 'LCM',
    min: 1,
    max: 255,
    args: ['any'],
    fn: (ctx, args) => {
      const values = integerArgs(ctx, args)
      let result = 1
      for (const v of values) {
        if (v === 0) return 0
        result = (result / gcd2(result, v)) * v
      }
      return result
    },
  }),
  define({
    name: 'MULTINOMIAL',
    min: 1,
    max: 255,
    args: ['any'],
    fn: (ctx, args) => {
      const values = collectNumbers(ctx, args).map((v) => {
        check(v >= 0)
        return Math.trunc(v)
      })
      let total = 0
      let result = 1
      for (const v of values) {
        total += v
        result *= combin(total, v)
      }
      return result
    },
  }),
  trig('SIN', Math.sin),
  trig('COS', Math.cos),
  trig('TAN', Math.tan),
  trig('SEC', (x) => 1 / Math.cos(x), false, true),
  trig('CSC', (x) => 1 / Math.sin(x), true, true),
  trig('COT', (x) => 1 / Math.tan(x), true, true),
  unary('ASIN', (x) => (Math.abs(x) > 1 ? fail(Errors.NUM) : Math.asin(x))),
  unary('ACOS', (x) => (Math.abs(x) > 1 ? fail(Errors.NUM) : Math.acos(x))),
  unary('ATAN', Math.atan),
  unary('ACOT', (x) => Math.PI / 2 - Math.atan(x), { xlfn: true }),
  unary('SINH', Math.sinh),
  unary('COSH', Math.cosh),
  unary('TANH', Math.tanh),
  unary('SECH', (x) => 1 / Math.cosh(x), { xlfn: true }),
  unary('CSCH', (x) => (x === 0 ? fail(Errors.DIV0) : 1 / Math.sinh(x)), { xlfn: true }),
  unary('COTH', (x) => (x === 0 ? fail(Errors.DIV0) : 1 / Math.tanh(x)), { xlfn: true }),
  unary('ASINH', Math.asinh),
  unary('ACOSH', (x) => (x < 1 ? fail(Errors.NUM) : Math.acosh(x))),
  unary('ATANH', (x) => (Math.abs(x) >= 1 ? fail(Errors.NUM) : Math.atanh(x))),
  unary('ACOTH', (x) => (Math.abs(x) <= 1 ? fail(Errors.NUM) : 0.5 * Math.log((x + 1) / (x - 1))), { xlfn: true }),
  define({
    name: 'ATAN2',
    min: 2,
    max: 2,
    fn: (ctx, args) => {
      const x = num(args[0], ctx)
      const y = num(args[1], ctx)
      if (x === 0 && y === 0) return fail(Errors.DIV0)
      return Math.atan2(y, x)
    },
  }),
  unary('DEGREES', (x) => (x * 180) / Math.PI),
  unary('RADIANS', (x) => (x * Math.PI) / 180),
  define({
    name: 'SUMIF',
    min: 2,
    max: 3,
    args: ['any', 'scalar', 'any'],
    fn: (ctx, args) => {
      const range = criteriaRange(ctx, args[0])
      const size = logicalSize(range)
      const target = args[2] === undefined ? range : sizedLike(ctx, args[2], size.rows, size.cols)
      return ifsAggregate(ctx, target, [range, args[1]], (values, _count, weights) => conditionalTotal(values, weights))
    },
  }),
  define({
    name: 'SUMIFS',
    min: 3,
    max: 255,
    args: ['any'],
    fn: (ctx, args) => ifsAggregate(ctx, args[0], args.slice(1), (values, _count, weights) => conditionalTotal(values, weights)),
  }),
  // SUBTOTAL and AGGREGATE see values, not rows: the evaluator has no row visibility, so the
  // "ignore hidden rows" variants (101–111, AGGREGATE options 1/3/5/7) behave like their plain
  // forms, and nested SUBTOTAL/AGGREGATE results inside the ranges are not skipped.
  define({
    name: 'SUBTOTAL',
    min: 2,
    max: 255,
    args: ['scalar', 'any'],
    fn: (ctx, args) => {
      const fnNum = int(args[0], ctx)
      const base = fnNum > 100 ? fnNum - 100 : fnNum
      if (base < 1 || base > 11) return fail(Errors.VALUE)
      return aggregateValues(ctx, fnNum, args.slice(1), false)
    },
  }),
  define({
    name: 'AGGREGATE',
    min: 3,
    max: 255,
    xlfn: true,
    args: ['scalar', 'scalar', 'any'],
    fn: (ctx, args) => {
      const fnNum = int(args[0], ctx)
      const options = defNum(args, 1, 0, ctx)
      check(options >= 0 && options <= 7, Errors.VALUE)
      if (fnNum < 1 || fnNum > 19) return fail(Errors.VALUE)
      const skipErrors = [2, 3, 6, 7].includes(Math.trunc(options))
      if (fnNum <= 13) return aggregateValues(ctx, fnNum, args.slice(2), skipErrors)
      if (args.length < 4) return fail(Errors.VALUE)
      const k = num(scalarOf(args[3], ctx), ctx)
      const values = collectNumbers(ctx, [args[2]], { skipErrors })
      return STAT_BY_NUMBER[fnNum]!(values, k)
    },
  }),
  define({
    name: 'ROMAN',
    min: 1,
    max: 2,
    fn: (ctx, args) => {
      const n = int(args[0], ctx)
      let form = 0
      if (args.length > 1 && args[1] !== undefined) {
        const f = scalarOf(args[1])
        form = typeof f === 'boolean' ? (f ? 0 : 4) : int(f, ctx)
      }
      check(n >= 0 && n <= 3999, Errors.VALUE)
      check(form >= 0 && form <= 4, Errors.VALUE)
      return toRoman(n, form)
    },
  }),
  define({ name: 'ARABIC', min: 1, max: 1, xlfn: true, fn: (ctx, args) => fromRoman(text(args[0], ctx)) }),
  define({
    name: 'BASE',
    min: 2,
    max: 3,
    xlfn: true,
    fn: (ctx, args) => {
      const n = int(args[0], ctx)
      const radix = int(args[1], ctx)
      const minLength = optInt(args, 2, 0, ctx)
      check(n >= 0 && n < 2 ** 53)
      check(radix >= 2 && radix <= 36)
      check(minLength >= 0 && minLength <= 255)
      return n.toString(radix).toUpperCase().padStart(minLength, '0')
    },
  }),
  define({
    name: 'DECIMAL',
    min: 2,
    max: 2,
    xlfn: true,
    fn: (ctx, args) => {
      const s = text(args[0], ctx).trim().toUpperCase()
      const radix = int(args[1], ctx)
      check(radix >= 2 && radix <= 36)
      check(s.length <= 255, Errors.VALUE)
      let value = 0
      for (const ch of s) {
        consumeWork()
        const d = DIGITS.indexOf(ch)
        check(d >= 0 && d < radix)
        value = value * radix + d
      }
      return value
    },
  }),
  define({
    name: 'MMULT',
    min: 2,
    max: 2,
    args: ['any'],
    fn: (ctx, args) => {
      const a = numericMatrix(ctx, args[0])
      const b = numericMatrix(ctx, args[1])
      if (a.cols !== b.rows) return fail(Errors.VALUE)
      return matrix(a.rows, b.cols, multiply(a, b))
    },
  }),
  define({
    name: 'MDETERM',
    min: 1,
    max: 1,
    args: ['any'],
    fn: (ctx, args) => {
      const a = numericMatrix(ctx, args[0])
      if (a.rows !== a.cols) return fail(Errors.VALUE)
      return round15(luDeterminant(a.rows, a.data))
    },
  }),
  define({
    name: 'MINVERSE',
    min: 1,
    max: 1,
    args: ['any'],
    fn: (ctx, args) => {
      const a = numericMatrix(ctx, args[0])
      if (a.rows !== a.cols) return fail(Errors.VALUE)
      const inv = invertMatrix(a.rows, a.data)
      if (!inv || luDeterminant(a.rows, a.data) === 0) return fail(Errors.NUM)
      return matrix(a.rows, a.rows, inv)
    },
  }),
  define({
    name: 'MUNIT',
    min: 1,
    max: 1,
    xlfn: true,
    fn: (ctx, args) => {
      const n = int(args[0], ctx)
      check(n >= 1, Errors.VALUE)
      checkArraySize(n, n)
      const data: number[] = []
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) data.push(i === j ? 1 : 0)
      return matrix(n, n, data)
    },
  }),
  define({
    name: 'SERIESSUM',
    min: 4,
    max: 4,
    args: ['scalar', 'scalar', 'scalar', 'any'],
    fn: (ctx, args) => {
      const x = num(args[0], ctx)
      const n = num(args[1], ctx)
      const m = num(args[2], ctx)
      const source = toMatrix(ctx, args[3])
      forEachLogical(source, (v) => { if (typeof v !== 'number') fail(isError(v) ? v : Errors.VALUE) }, { weightedTail: true })
      const coefficients = denseRange(source).data
      let total = 0
      coefficients.forEach((c, i) => {
        if (isError(c)) fail(c)
        if (typeof c !== 'number') fail(Errors.VALUE)
        total += c * x ** (n + i * m)
      })
      return total
    },
  }),
]

/** Excel's `^` and POWER: 0^0 and roots of negatives are #NUM!, 0^-n is #DIV/0!. */
export function power(base: number, exponent: number): number {
  if (base === 0 && exponent === 0) return fail(Errors.NUM)
  if (base === 0 && exponent < 0) return fail(Errors.DIV0)
  const r = base ** exponent
  if (Number.isNaN(r)) {
    // Odd integer roots of negatives (-8^(1/3)) are still #NUM! in Excel.
    return fail(Errors.NUM)
  }
  return r
}

