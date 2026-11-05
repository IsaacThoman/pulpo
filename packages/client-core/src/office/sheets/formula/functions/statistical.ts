/** Statistical functions: aggregates, ranks, regressions, and probability distributions. */

import { Errors, isError, matrix, type FunctionContext, type FunctionSpec, type Scalar, type Value } from '../types.js'
import { bool, check, defNum, define, fail, int, num, optNum, scalarOf, toMatrix, type Args } from './coerce.js'
import { parseCriteria } from './criteria.js'
import { collectNumbers, numberPairs, type CollectOptions } from './iterate.js'
import { criteriaRange, ifsAggregate, invertMatrix, sizedLike } from './math.js'
import { combin, devsq, mean, median, modes, percentileExc, percentileInc, roundDecimal, sorted, sum, variance } from './numeric.js'
import {
  betaI,
  chisqCdf,
  chisqUpper,
  fCdf,
  fUpper,
  gamma,
  gammaP,
  gammaQ,
  lbeta,
  lgamma,
  normCdf,
  normInv,
  normPdf,
  solveMonotone,
  tCdf,
  tInv2,
  tPdf,
  tUpper,
} from './special.js'

const A_OPTIONS: CollectOptions = { referenceAll: true }

function aggregate(name: string, f: (values: number[]) => number, options: CollectOptions = {}, xlfn = false): FunctionSpec {
  return define({ name, min: 1, max: 255, args: ['any'], xlfn, fn: (ctx, args) => f(collectNumbers(ctx, args, options)) })
}

/** The numbers in a reference/array argument only (a direct scalar still coerces). */
function arrayNumbers(ctx: FunctionContext, value: Value | undefined): number[] {
  return collectNumbers(ctx, [value])
}

function stdev(values: number[], sample: boolean): number {
  return Math.sqrt(variance(values, sample))
}

function kth(values: number[], k: number, largest: boolean): number {
  const s = sorted(values)
  const i = Math.ceil(k)
  check(s.length > 0 && i >= 1 && i <= s.length)
  return largest ? s[s.length - i]! : s[i - 1]!
}

function rankOf(ctx: FunctionContext, args: Args, average: boolean): number {
  const x = num(args[0], ctx)
  const values = arrayNumbers(ctx, args[1])
  const ascending = optNum(args, 2, 0, ctx) !== 0
  let better = 0
  let equal = 0
  for (const v of values) {
    if (v === x) equal++
    else if (ascending ? v < x : v > x) better++
  }
  if (!equal) return fail(Errors.NA)
  return average ? better + (equal + 1) / 2 : better + 1
}

function percentRank(ctx: FunctionContext, args: Args, exclusive: boolean): number {
  const s = sorted(arrayNumbers(ctx, args[0]))
  const x = num(args[1], ctx)
  const significance = optNum(args, 2, 3, ctx)
  check(significance >= 1)
  const n = s.length
  if (!n) return fail(Errors.NUM)
  if (x < s[0]! || x > s[n - 1]!) return fail(Errors.NA)
  let position: number
  let i = s.findIndex((v) => v >= x)
  if (s[i] === x) position = i
  else {
    i -= 1
    position = i + (x - s[i]!) / (s[i + 1]! - s[i]!)
  }
  const result = exclusive ? (position + 1) / (n + 1) : n === 1 ? 1 : position / (n - 1)
  return roundDecimal(result, Math.trunc(significance), 'down')
}

function correl(xs: number[], ys: number[]): number {
  if (xs.length < 1) fail(Errors.DIV0)
  const mx = mean(xs)
  const my = mean(ys)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my)
    sxx += (xs[i]! - mx) ** 2
    syy += (ys[i]! - my) ** 2
  }
  if (sxx === 0 || syy === 0) fail(Errors.DIV0)
  return sxy / Math.sqrt(sxx * syy)
}

function covariance(xs: number[], ys: number[], sample: boolean): number {
  const n = xs.length
  if (n < (sample ? 2 : 1)) fail(Errors.DIV0)
  const mx = mean(xs)
  const my = mean(ys)
  let s = 0
  for (let i = 0; i < n; i++) s += (xs[i]! - mx) * (ys[i]! - my)
  return s / (sample ? n - 1 : n)
}

/** Simple regression of y on x: slope, intercept and the sums behind them. */
function regression(ctx: FunctionContext, yArg: Value | undefined, xArg: Value | undefined) {
  const [ys, xs] = numberPairs(ctx, yArg, xArg)
  const n = xs.length
  if (n < 1) fail(Errors.DIV0)
  const mx = mean(xs)
  const my = mean(ys)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my)
    sxx += (xs[i]! - mx) ** 2
    syy += (ys[i]! - my) ** 2
  }
  if (sxx === 0) fail(Errors.DIV0)
  const slope = sxy / sxx
  return { n, slope, intercept: my - slope * mx, sxx, sxy, syy }
}

// ---------------------------------------------------------------------------------------------
// Least squares (LINEST, LOGEST, TREND, GROWTH)

interface Fit {
  /** Coefficients for x1…xk, then the constant. */
  coefficients: number[]
  constant: number
  k: number
  n: number
  df: number
  ssreg: number
  ssresid: number
  r2: number
  sey: number
  se: number[]
  seConstant: number
  F: number
}

function numericCells(ctx: FunctionContext, value: Value | undefined): { rows: number; cols: number; data: number[] } {
  const m = toMatrix(ctx, value)
  const data = m.data.map((v) => {
    if (typeof v === 'number') return v
    if (isError(v)) return fail(v)
    return fail(Errors.VALUE)
  })
  return { rows: m.rows, cols: m.cols, data }
}

/** Rows are observations: `x[i]` is the predictor vector of observation i. */
function knownXs(ctx: FunctionContext, ys: { rows: number; cols: number; data: number[] }, xArg: Value | undefined): number[][] {
  const n = ys.data.length
  if (xArg === undefined) return ys.data.map((_, i) => [i + 1])
  const xs = numericCells(ctx, xArg)
  if (xs.data.length === n) {
    if (ys.rows === xs.rows && ys.cols === xs.cols) return xs.data.map((v) => [v])
    if (xs.rows === 1 || xs.cols === 1) return xs.data.map((v) => [v])
  }
  if (ys.cols === 1 && xs.rows === n) {
    return Array.from({ length: n }, (_, i) => Array.from({ length: xs.cols }, (_, j) => xs.data[i * xs.cols + j]!))
  }
  if (ys.rows === 1 && xs.cols === n) {
    return Array.from({ length: n }, (_, i) => Array.from({ length: xs.rows }, (_, j) => xs.data[j * xs.cols + i]!))
  }
  return fail(Errors.REF)
}

function leastSquares(x: number[][], y: number[], withConstant: boolean): Fit {
  const n = y.length
  const k = x[0]?.length ?? 0
  const p = k + (withConstant ? 1 : 0)
  const design = x.map((row) => (withConstant ? [...row, 1] : row))
  const xtx = new Array<number>(p * p).fill(0)
  const xty = new Array<number>(p).fill(0)
  for (let i = 0; i < n; i++) {
    const row = design[i]!
    for (let a = 0; a < p; a++) {
      xty[a] = xty[a]! + row[a]! * y[i]!
      for (let b = 0; b < p; b++) xtx[a * p + b] = xtx[a * p + b]! + row[a]! * row[b]!
    }
  }
  const inv = invertMatrix(p, xtx)
  if (!inv) return fail(Errors.NUM)
  const beta = new Array<number>(p).fill(0)
  for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) beta[a] = beta[a]! + inv[a * p + b]! * xty[b]!
  const coefficients = beta.slice(0, k)
  const constant = withConstant ? beta[k]! : 0
  let ssresid = 0
  const my = withConstant ? mean(y) : 0
  let sstot = 0
  for (let i = 0; i < n; i++) {
    let fitted = constant
    for (let j = 0; j < k; j++) fitted += coefficients[j]! * x[i]![j]!
    ssresid += (y[i]! - fitted) ** 2
    sstot += (y[i]! - my) ** 2
  }
  const ssreg = sstot - ssresid
  const df = n - p
  const r2 = sstot === 0 ? 1 : ssreg / sstot
  const sey = df > 0 ? Math.sqrt(ssresid / df) : 0
  const se = beta.map((_, a) => (df > 0 ? Math.sqrt(Math.max(0, inv[a * p + a]! * (ssresid / df))) : 0))
  const F = df > 0 && ssresid > 0 ? ssreg / k / (ssresid / df) : Infinity
  return { coefficients, constant, k, n, df, ssreg, ssresid, r2, sey, se: se.slice(0, k), seConstant: withConstant ? se[k]! : 0, F }
}

function fitArgs(ctx: FunctionContext, args: Args, log: boolean) {
  const ys = numericCells(ctx, args[0])
  const y = ys.data.map((v) => {
    if (!log) return v
    check(v > 0)
    return Math.log(v)
  })
  const x = knownXs(ctx, ys, args.length > 1 ? args[1] : undefined)
  const withConstant = args.length > 2 && args[2] !== undefined ? bool(args[2], ctx) : true
  return { ys, x, y, withConstant }
}

function linest(ctx: FunctionContext, args: Args, log: boolean): Value {
  const { x, y, withConstant } = fitArgs(ctx, args, log)
  const stats = args.length > 3 && args[3] !== undefined ? bool(args[3], ctx) : false
  const fit = leastSquares(x, y, withConstant)
  const k = fit.k
  const transform = (v: number): number => (log ? Math.exp(v) : v)
  const first = [...fit.coefficients.slice().reverse().map(transform), transform(fit.constant)]
  if (!stats) return matrix(1, k + 1, first)
  const width = k + 1
  const rows: Scalar[][] = [
    first,
    [...fit.se.slice().reverse(), withConstant ? fit.seConstant : Errors.NA],
    [fit.r2, fit.sey],
    [fit.F, fit.df],
    [fit.ssreg, fit.ssresid],
  ]
  const data: Scalar[] = []
  for (const row of rows) for (let c = 0; c < width; c++) data.push(c < row.length ? row[c]! : Errors.NA)
  return matrix(5, width, data)
}

function trend(ctx: FunctionContext, args: Args, log: boolean): Value {
  const { ys, x, y, withConstant } = fitArgs(ctx, [args[0], args[1], args[3]], log)
  const fit = leastSquares(x, y, withConstant)
  let newX: number[][]
  let rows: number
  let cols: number
  if (args.length > 2 && args[2] !== undefined) {
    const nx = numericCells(ctx, args[2])
    if (fit.k === 1) {
      newX = nx.data.map((v) => [v])
      rows = nx.rows
      cols = nx.cols
    } else if (ys.cols === 1) {
      check(nx.cols === fit.k, Errors.REF)
      newX = Array.from({ length: nx.rows }, (_, i) => nx.data.slice(i * nx.cols, (i + 1) * nx.cols))
      rows = nx.rows
      cols = 1
    } else {
      check(nx.rows === fit.k, Errors.REF)
      newX = Array.from({ length: nx.cols }, (_, i) => Array.from({ length: nx.rows }, (_, j) => nx.data[j * nx.cols + i]!))
      rows = 1
      cols = nx.cols
    }
  } else {
    newX = x
    rows = ys.rows
    cols = ys.cols
  }
  const data = newX.map((row) => {
    let v = fit.constant
    for (let j = 0; j < fit.k; j++) v += fit.coefficients[j]! * row[j]!
    return log ? Math.exp(v) : v
  })
  return matrix(rows, cols, data)
}

// ---------------------------------------------------------------------------------------------
// Distributions

function inv(name: string, minArgs: number, maxArgs: number, f: (ctx: FunctionContext, args: Args) => number, xlfn = false): FunctionSpec {
  return define({ name, min: minArgs, max: maxArgs, xlfn, fn: f })
}

function prob(p: number, openLow = true, openHigh = true): void {
  check((openLow ? p > 0 : p >= 0) && (openHigh ? p < 1 : p <= 1))
}

function normDist(x: number, mu: number, sigma: number, cumulative: boolean): number {
  check(sigma > 0)
  const z = (x - mu) / sigma
  return cumulative ? normCdf(z) : normPdf(z) / sigma
}

function lognormDist(x: number, mu: number, sigma: number, cumulative: boolean): number {
  check(x > 0 && sigma > 0)
  const z = (Math.log(x) - mu) / sigma
  return cumulative ? normCdf(z) : normPdf(z) / (sigma * x)
}

function binomPmf(k: number, n: number, p: number): number {
  if (p === 0) return k === 0 ? 1 : 0
  if (p === 1) return k === n ? 1 : 0
  const c = n <= 1030 ? combin(n, k) : Infinity
  if (Number.isFinite(c) && c < 1e15) {
    const direct = c * p ** k * (1 - p) ** (n - k)
    if (direct > 1e-300) return direct
  }
  return Math.exp(lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log1p(-p))
}

function binomCdf(k: number, n: number, p: number): number {
  if (k >= n) return 1
  if (n <= 1000) {
    let total = 0
    for (let i = 0; i <= k; i++) total += binomPmf(i, n, p)
    return Math.min(1, total)
  }
  return betaI(1 - p, n - k, k + 1)
}

function poissonPmf(k: number, lambda: number): number {
  if (lambda === 0) return k === 0 ? 1 : 0
  return Math.exp(k * Math.log(lambda) - lambda - lgamma(k + 1))
}

function poissonCdf(k: number, lambda: number): number {
  if (lambda === 0) return 1
  return gammaQ(k + 1, lambda)
}

function gammaDist(x: number, alpha: number, beta: number, cumulative: boolean): number {
  check(x >= 0 && alpha > 0 && beta > 0)
  if (cumulative) return gammaP(alpha, x / beta)
  if (x === 0) return alpha < 1 ? fail(Errors.NUM) : alpha === 1 ? 1 / beta : 0
  return Math.exp((alpha - 1) * Math.log(x) - x / beta - lgamma(alpha) - alpha * Math.log(beta))
}

function betaDist(x: number, alpha: number, beta: number, cumulative: boolean, lo: number, hi: number): number {
  check(alpha > 0 && beta > 0 && lo < hi && x >= lo && x <= hi)
  const t = (x - lo) / (hi - lo)
  if (cumulative) return betaI(t, alpha, beta)
  if (t === 0 || t === 1) {
    if ((t === 0 && alpha < 1) || (t === 1 && beta < 1)) return fail(Errors.NUM)
    if ((t === 0 && alpha > 1) || (t === 1 && beta > 1)) return 0
  }
  return Math.exp((alpha - 1) * Math.log(t) + (beta - 1) * Math.log1p(-t) - lbeta(alpha, beta)) / (hi - lo)
}

function hypgeomPmf(k: number, n: number, K: number, N: number): number {
  return Math.exp(lnCombin(K, k) + lnCombin(N - K, n - k) - lnCombin(N, n))
}

function lnCombin(n: number, k: number): number {
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1)
}

function hypgeom(ctx: FunctionContext, args: Args, cumulativeIndex: number | undefined): number {
  const k = int(args[0], ctx)
  const n = int(args[1], ctx)
  const K = int(args[2], ctx)
  const N = int(args[3], ctx)
  check(k >= 0 && n >= 0 && K >= 0 && N >= 0 && k <= n && k <= K && n <= N && K <= N && n - k <= N - K && N < 2 ** 31)
  const cumulative = cumulativeIndex === undefined ? false : bool(args[cumulativeIndex], ctx)
  if (!cumulative) return roundTiny(hypgeomPmf(k, n, K, N))
  const first = Math.max(0, n - (N - K))
  check(k - first <= 10_000_000)
  let total = 0
  for (let i = first; i <= k; i++) total += hypgeomPmf(i, n, K, N)
  return Math.min(1, total)
}

/** Hides log/exp round-trip noise in probabilities that are exact rationals. */
function roundTiny(x: number): number {
  return Number(x.toPrecision(15))
}

function negbinom(ctx: FunctionContext, args: Args, cumulative: boolean): number {
  const f = int(args[0], ctx)
  const s = int(args[1], ctx)
  const p = num(args[2], ctx)
  check(f >= 0 && s >= 1 && p >= 0 && p <= 1)
  const pmf = (i: number): number => Math.exp(lnCombin(i + s - 1, s - 1) + s * Math.log(p) + i * Math.log1p(-p))
  if (!cumulative) return pmf(f)
  return Math.min(1, betaI(p, s, f + 1))
}

function weibull(x: number, alpha: number, beta: number, cumulative: boolean): number {
  check(x >= 0 && alpha > 0 && beta > 0)
  const r = (x / beta) ** alpha
  return cumulative ? 1 - Math.exp(-r) : (alpha / beta ** alpha) * x ** (alpha - 1) * Math.exp(-r)
}

function df(value: number, min = 1, max = 1e10): number {
  const d = Math.trunc(value)
  check(d >= min && d <= max)
  return d
}

function tTest(ctx: FunctionContext, args: Args): number {
  const tails = int(args[2], ctx)
  const type = int(args[3], ctx)
  check(tails === 1 || tails === 2)
  check(type >= 1 && type <= 3)
  let t: number
  let dof: number
  if (type === 1) {
    const [a, b] = numberPairs(ctx, args[0], args[1])
    const m1 = toMatrix(ctx, args[0])
    const m2 = toMatrix(ctx, args[1])
    if (m1.data.length !== m2.data.length) return fail(Errors.NA)
    const diffs = a.map((v, i) => v - b[i]!)
    const n = diffs.length
    if (n < 2) return fail(Errors.DIV0)
    const sd = stdev(diffs, true)
    if (sd === 0) return fail(Errors.DIV0)
    t = mean(diffs) / (sd / Math.sqrt(n))
    dof = n - 1
  } else {
    const a = arrayNumbers(ctx, args[0])
    const b = arrayNumbers(ctx, args[1])
    const n1 = a.length
    const n2 = b.length
    if (n1 < 2 || n2 < 2) return fail(Errors.DIV0)
    const v1 = variance(a, true)
    const v2 = variance(b, true)
    if (type === 2) {
      dof = n1 + n2 - 2
      const pooled = ((n1 - 1) * v1 + (n2 - 1) * v2) / dof
      t = (mean(a) - mean(b)) / Math.sqrt(pooled * (1 / n1 + 1 / n2))
    } else {
      const s1 = v1 / n1
      const s2 = v2 / n2
      t = (mean(a) - mean(b)) / Math.sqrt(s1 + s2)
      dof = (s1 + s2) ** 2 / (s1 ** 2 / (n1 - 1) + s2 ** 2 / (n2 - 1))
    }
    if (!Number.isFinite(t)) return fail(Errors.DIV0)
  }
  return tails * tUpper(Math.abs(t), dof)
}

function zTest(ctx: FunctionContext, args: Args): number {
  const values = arrayNumbers(ctx, args[0])
  const x = num(args[1], ctx)
  const n = values.length
  if (!n) return fail(Errors.NA)
  const sigma = args.length > 2 && args[2] !== undefined ? num(args[2], ctx) : stdev(values, true)
  if (sigma === 0) return fail(Errors.DIV0)
  return 1 - normCdf((mean(values) - x) / (sigma / Math.sqrt(n)))
}

function chisqTest(ctx: FunctionContext, args: Args): number {
  const actual = toMatrix(ctx, args[0])
  const expected = toMatrix(ctx, args[1])
  if (actual.rows !== expected.rows || actual.cols !== expected.cols) return fail(Errors.NA)
  let chi = 0
  for (let i = 0; i < actual.data.length; i++) {
    const a = actual.data[i] ?? null
    const e = expected.data[i] ?? null
    if (isError(a)) return fail(a)
    if (isError(e)) return fail(e)
    if (typeof a !== 'number' || typeof e !== 'number') continue
    if (e === 0) return fail(Errors.DIV0)
    chi += (a - e) ** 2 / e
  }
  const r = actual.rows
  const c = actual.cols
  const dof = r > 1 && c > 1 ? (r - 1) * (c - 1) : r > 1 ? r - 1 : c - 1
  if (dof < 1) return fail(Errors.NA)
  return chisqUpper(chi, dof)
}

function fTest(ctx: FunctionContext, args: Args): number {
  const a = arrayNumbers(ctx, args[0])
  const b = arrayNumbers(ctx, args[1])
  if (a.length < 2 || b.length < 2) return fail(Errors.DIV0)
  const v1 = variance(a, true)
  const v2 = variance(b, true)
  if (v1 === 0 || v2 === 0) return fail(Errors.DIV0)
  const f = v1 / v2
  const p = fCdf(f, a.length - 1, b.length - 1)
  return 2 * Math.min(p, 1 - p)
}

function probRange(ctx: FunctionContext, args: Args): number {
  const xs = toMatrix(ctx, args[0])
  const ps = toMatrix(ctx, args[1])
  if (xs.data.length !== ps.data.length) return fail(Errors.NA)
  const lower = num(args[2], ctx)
  const upper = args.length > 3 && args[3] !== undefined ? num(args[3], ctx) : lower
  let total = 0
  let result = 0
  for (let i = 0; i < xs.data.length; i++) {
    const x = xs.data[i] ?? null
    const p = ps.data[i] ?? null
    if (isError(x)) return fail(x)
    if (isError(p)) return fail(p)
    if (typeof p !== 'number') continue
    check(p >= 0 && p <= 1)
    total += p
    if (typeof x === 'number' && x >= lower && x <= upper) result += p
  }
  check(Math.abs(total - 1) < 1e-6)
  return result
}

function frequency(ctx: FunctionContext, args: Args): Value {
  const data = arrayNumbers(ctx, args[0])
  const bins = arrayNumbers(ctx, args[1])
  const order = bins.map((b, i) => ({ b, i })).sort((x, y) => x.b - y.b)
  const counts = new Array<number>(bins.length + 1).fill(0)
  for (const v of data) {
    const slot = order.find((o) => v <= o.b)
    if (slot) counts[slot.i] = counts[slot.i]! + 1
    else counts[bins.length] = counts[bins.length]! + 1
  }
  return matrix(counts.length, 1, counts)
}

function kurt(values: number[]): number {
  const n = values.length
  if (n < 4) return fail(Errors.DIV0)
  const m = mean(values)
  const s = stdev(values, true)
  if (s === 0) return fail(Errors.DIV0)
  const s4 = sum(values.map((v) => ((v - m) / s) ** 4))
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * s4 - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
}

function skew(values: number[], population: boolean): number {
  const n = values.length
  if (n < (population ? 1 : 3)) return fail(Errors.DIV0)
  const m = mean(values)
  const s = stdev(values, !population)
  if (s === 0) return fail(Errors.DIV0)
  const s3 = sum(values.map((v) => ((v - m) / s) ** 3))
  return population ? s3 / n : (n / ((n - 1) * (n - 2))) * s3
}

function ifCount(ctx: FunctionContext, args: Args): number {
  const range = criteriaRange(ctx, args[0])
  const predicate = parseCriteria(scalarOf(args[1]), ctx)
  let count = 0
  for (const v of range.data) if (predicate(v)) count++
  return count
}

function numericValues(values: Scalar[]): number[] {
  const out: number[] = []
  for (const v of values) {
    if (typeof v === 'number') out.push(v)
    else if (isError(v)) fail(v)
  }
  return out
}

function quartile(values: number[], q: number, exclusive: boolean): number {
  const quart = Math.trunc(q)
  if (exclusive) check(quart >= 1 && quart <= 3)
  else check(quart >= 0 && quart <= 4)
  const s = sorted(values)
  return exclusive ? percentileExc(s, quart / 4) : percentileInc(s, quart / 4)
}

const ALIAS_NAMES = {
  stdevS: ['STDEV', 'STDEV.S'],
  stdevP: ['STDEVP', 'STDEV.P'],
  varS: ['VAR', 'VAR.S'],
  varP: ['VARP', 'VAR.P'],
}

const isNew = (name: string): boolean => name.includes('.')

export const STATISTICAL_FUNCTIONS: FunctionSpec[] = [
  aggregate('AVERAGE', mean),
  aggregate('AVERAGEA', mean, A_OPTIONS),
  define({
    name: 'COUNT',
    min: 1,
    max: 255,
    args: ['any'],
    fn: (ctx, args) => collectNumbers(ctx, args, { directText: 'skip', skipErrors: true }).length,
  }),
  define({
    name: 'COUNTA',
    min: 1,
    max: 255,
    args: ['any'],
    fn: (ctx, args) => {
      let count = 0
      for (const arg of args) {
        if (arg === undefined) {
          count++
          continue
        }
        for (const v of toMatrix(ctx, arg).data) if (v !== null) count++
      }
      return count
    },
  }),
  define({
    name: 'COUNTBLANK',
    min: 1,
    max: 1,
    args: ['any'],
    fn: (ctx, args) => toMatrix(ctx, args[0]).data.filter((v) => v === null || v === '').length,
  }),
  define({ name: 'COUNTIF', min: 2, max: 2, args: ['any', 'scalar'], fn: ifCount }),
  define({ name: 'COUNTIFS', min: 2, max: 255, args: ['any'], fn: (ctx, args) => ifsAggregate(ctx, undefined, args, (_, count) => count) }),
  define({
    name: 'AVERAGEIF',
    min: 2,
    max: 3,
    args: ['any', 'scalar', 'any'],
    fn: (ctx, args) => {
      const range = criteriaRange(ctx, args[0])
      const predicate = parseCriteria(scalarOf(args[1]), ctx)
      const values = args.length > 2 && args[2] !== undefined ? sizedLike(ctx, args[2], range.rows, range.cols) : range.data
      const picked: Scalar[] = []
      for (let i = 0; i < range.data.length; i++) if (predicate(range.data[i] ?? null)) picked.push(values[i] ?? null)
      return mean(numericValues(picked))
    },
  }),
  define({ name: 'AVERAGEIFS', min: 3, max: 255, args: ['any'], fn: (ctx, args) => ifsAggregate(ctx, args[0], args.slice(1), (values) => mean(numericValues(values))) }),
  define({
    name: 'MAXIFS',
    min: 3,
    max: 255,
    args: ['any'],
    xlfn: true,
    fn: (ctx, args) =>
      ifsAggregate(ctx, args[0], args.slice(1), (values) => {
        const v = numericValues(values)
        return v.length ? Math.max(...v) : 0
      }),
  }),
  define({
    name: 'MINIFS',
    min: 3,
    max: 255,
    args: ['any'],
    xlfn: true,
    fn: (ctx, args) =>
      ifsAggregate(ctx, args[0], args.slice(1), (values) => {
        const v = numericValues(values)
        return v.length ? Math.min(...v) : 0
      }),
  }),
  aggregate('MAX', (v) => (v.length ? v.reduce((a, b) => Math.max(a, b)) : 0)),
  aggregate('MAXA', (v) => (v.length ? v.reduce((a, b) => Math.max(a, b)) : 0), A_OPTIONS),
  aggregate('MIN', (v) => (v.length ? v.reduce((a, b) => Math.min(a, b)) : 0)),
  aggregate('MINA', (v) => (v.length ? v.reduce((a, b) => Math.min(a, b)) : 0), A_OPTIONS),
  aggregate('MEDIAN', median),
  ...['MODE', 'MODE.SNGL'].map((name) =>
    aggregate(
      name,
      (v) => {
        const m = modes(v)
        return m.length ? m[0]! : fail(Errors.NA)
      },
      {},
      isNew(name),
    ),
  ),
  define({
    name: 'MODE.MULT',
    min: 1,
    max: 255,
    args: ['any'],
    xlfn: true,
    fn: (ctx, args) => {
      const m = modes(collectNumbers(ctx, args))
      if (!m.length) return fail(Errors.NA)
      return matrix(m.length, 1, m)
    },
  }),
  define({ name: 'LARGE', min: 2, max: 2, args: ['any', 'scalar'], fn: (ctx, args) => kth(arrayNumbers(ctx, args[0]), num(args[1], ctx), true) }),
  define({ name: 'SMALL', min: 2, max: 2, args: ['any', 'scalar'], fn: (ctx, args) => kth(arrayNumbers(ctx, args[0]), num(args[1], ctx), false) }),
  ...['RANK', 'RANK.EQ'].map((name) => define({ name, min: 2, max: 3, xlfn: isNew(name), args: ['scalar', 'any', 'scalar'], fn: (ctx, args) => rankOf(ctx, args, false) })),
  define({ name: 'RANK.AVG', min: 2, max: 3, xlfn: true, args: ['scalar', 'any', 'scalar'], fn: (ctx, args) => rankOf(ctx, args, true) }),
  ...['PERCENTILE', 'PERCENTILE.INC'].map((name) =>
    define({ name, min: 2, max: 2, xlfn: isNew(name), args: ['any', 'scalar'], fn: (ctx, args) => percentileInc(sorted(arrayNumbers(ctx, args[0])), num(args[1], ctx)) }),
  ),
  define({ name: 'PERCENTILE.EXC', min: 2, max: 2, xlfn: true, args: ['any', 'scalar'], fn: (ctx, args) => percentileExc(sorted(arrayNumbers(ctx, args[0])), num(args[1], ctx)) }),
  ...['QUARTILE', 'QUARTILE.INC'].map((name) =>
    define({ name, min: 2, max: 2, xlfn: isNew(name), args: ['any', 'scalar'], fn: (ctx, args) => quartile(arrayNumbers(ctx, args[0]), num(args[1], ctx), false) }),
  ),
  define({ name: 'QUARTILE.EXC', min: 2, max: 2, xlfn: true, args: ['any', 'scalar'], fn: (ctx, args) => quartile(arrayNumbers(ctx, args[0]), num(args[1], ctx), true) }),
  ...['PERCENTRANK', 'PERCENTRANK.INC'].map((name) =>
    define({ name, min: 2, max: 3, xlfn: isNew(name), args: ['any', 'scalar'], fn: (ctx, args) => percentRank(ctx, args, false) }),
  ),
  define({ name: 'PERCENTRANK.EXC', min: 2, max: 3, xlfn: true, args: ['any', 'scalar'], fn: (ctx, args) => percentRank(ctx, args, true) }),
  ...ALIAS_NAMES.stdevS.map((name) => aggregate(name, (v) => stdev(v, true), {}, isNew(name))),
  ...ALIAS_NAMES.stdevP.map((name) => aggregate(name, (v) => stdev(v, false), {}, isNew(name))),
  ...ALIAS_NAMES.varS.map((name) => aggregate(name, (v) => variance(v, true), {}, isNew(name))),
  ...ALIAS_NAMES.varP.map((name) => aggregate(name, (v) => variance(v, false), {}, isNew(name))),
  aggregate('STDEVA', (v) => stdev(v, true), A_OPTIONS),
  aggregate('STDEVPA', (v) => stdev(v, false), A_OPTIONS),
  aggregate('VARA', (v) => variance(v, true), A_OPTIONS),
  aggregate('VARPA', (v) => variance(v, false), A_OPTIONS),
  aggregate('AVEDEV', (v) => {
    const m = mean(v)
    return sum(v.map((x) => Math.abs(x - m))) / v.length
  }),
  aggregate('DEVSQ', devsq),
  aggregate('GEOMEAN', (v) => {
    check(v.length > 0 && v.every((x) => x > 0))
    return Math.exp(sum(v.map(Math.log)) / v.length)
  }),
  aggregate('HARMEAN', (v) => {
    check(v.length > 0 && v.every((x) => x > 0))
    return v.length / sum(v.map((x) => 1 / x))
  }),
  define({
    name: 'TRIMMEAN',
    min: 2,
    max: 2,
    args: ['any', 'scalar'],
    fn: (ctx, args) => {
      const s = sorted(arrayNumbers(ctx, args[0]))
      const percent = num(args[1], ctx)
      check(percent >= 0 && percent < 1 && s.length > 0)
      const k = Math.floor((s.length * percent) / 2)
      return mean(s.slice(k, s.length - k))
    },
  }),
  aggregate('KURT', kurt),
  aggregate('SKEW', (v) => skew(v, false)),
  aggregate('SKEW.P', (v) => skew(v, true), {}, true),
  ...['CORREL', 'PEARSON'].map((name) =>
    define({ name, min: 2, max: 2, args: ['any'], fn: (ctx, args) => correl(...numberPairs(ctx, args[0], args[1])) }),
  ),
  ...['COVAR', 'COVARIANCE.P'].map((name) =>
    define({ name, min: 2, max: 2, xlfn: isNew(name), args: ['any'], fn: (ctx, args) => covariance(...numberPairs(ctx, args[0], args[1]), false) }),
  ),
  define({ name: 'COVARIANCE.S', min: 2, max: 2, xlfn: true, args: ['any'], fn: (ctx, args) => covariance(...numberPairs(ctx, args[0], args[1]), true) }),
  define({ name: 'SLOPE', min: 2, max: 2, args: ['any'], fn: (ctx, args) => regression(ctx, args[0], args[1]).slope }),
  define({ name: 'INTERCEPT', min: 2, max: 2, args: ['any'], fn: (ctx, args) => regression(ctx, args[0], args[1]).intercept }),
  define({
    name: 'RSQ',
    min: 2,
    max: 2,
    args: ['any'],
    fn: (ctx, args) => correl(...numberPairs(ctx, args[0], args[1])) ** 2,
  }),
  define({
    name: 'STEYX',
    min: 2,
    max: 2,
    args: ['any'],
    fn: (ctx, args) => {
      const r = regression(ctx, args[0], args[1])
      if (r.n < 3) return fail(Errors.DIV0)
      return Math.sqrt((r.syy - (r.sxy * r.sxy) / r.sxx) / (r.n - 2))
    },
  }),
  ...['FORECAST', 'FORECAST.LINEAR'].map((name) =>
    define({
      name,
      min: 3,
      max: 3,
      xlfn: isNew(name),
      args: ['scalar', 'any', 'any'],
      fn: (ctx, args) => {
        const x = num(args[0], ctx)
        const r = regression(ctx, args[1], args[2])
        return r.intercept + r.slope * x
      },
    }),
  ),
  define({ name: 'TREND', min: 1, max: 4, args: ['any', 'any', 'any', 'scalar'], fn: (ctx, args) => trend(ctx, args, false) }),
  define({ name: 'GROWTH', min: 1, max: 4, args: ['any', 'any', 'any', 'scalar'], fn: (ctx, args) => trend(ctx, args, true) }),
  define({ name: 'LINEST', min: 1, max: 4, args: ['any', 'any', 'scalar', 'scalar'], fn: (ctx, args) => linest(ctx, args, false) }),
  define({ name: 'LOGEST', min: 1, max: 4, args: ['any', 'any', 'scalar', 'scalar'], fn: (ctx, args) => linest(ctx, args, true) }),
  define({ name: 'FREQUENCY', min: 2, max: 2, args: ['any'], fn: frequency }),
  define({
    name: 'STANDARDIZE',
    min: 3,
    max: 3,
    fn: (ctx, args) => {
      const sd = num(args[2], ctx)
      check(sd > 0)
      return (num(args[0], ctx) - num(args[1], ctx)) / sd
    },
  }),
  // Normal family
  define({ name: 'NORM.DIST', min: 4, max: 4, xlfn: true, fn: (ctx, args) => normDist(num(args[0], ctx), num(args[1], ctx), num(args[2], ctx), bool(args[3], ctx)) }),
  define({ name: 'NORMDIST', min: 4, max: 4, fn: (ctx, args) => normDist(num(args[0], ctx), num(args[1], ctx), num(args[2], ctx), bool(args[3], ctx)) }),
  define({
    name: 'NORM.S.DIST',
    min: 2,
    max: 2,
    xlfn: true,
    fn: (ctx, args) => {
      const z = num(args[0], ctx)
      return bool(args[1], ctx) ? normCdf(z) : normPdf(z)
    },
  }),
  define({ name: 'NORMSDIST', min: 1, max: 1, fn: (ctx, args) => normCdf(num(args[0], ctx)) }),
  ...['NORM.INV', 'NORMINV'].map((name) =>
    inv(
      name,
      3,
      3,
      (ctx, args) => {
        const p = num(args[0], ctx)
        const mu = num(args[1], ctx)
        const sigma = num(args[2], ctx)
        prob(p)
        check(sigma > 0)
        return mu + sigma * normInv(p)
      },
      isNew(name),
    ),
  ),
  ...['NORM.S.INV', 'NORMSINV'].map((name) =>
    inv(
      name,
      1,
      1,
      (ctx, args) => {
        const p = num(args[0], ctx)
        prob(p)
        return normInv(p)
      },
      isNew(name),
    ),
  ),
  define({ name: 'PHI', min: 1, max: 1, xlfn: true, fn: (ctx, args) => normPdf(num(args[0], ctx)) }),
  define({ name: 'GAUSS', min: 1, max: 1, xlfn: true, fn: (ctx, args) => normCdf(num(args[0], ctx)) - 0.5 }),
  define({ name: 'LOGNORM.DIST', min: 4, max: 4, xlfn: true, fn: (ctx, args) => lognormDist(num(args[0], ctx), num(args[1], ctx), num(args[2], ctx), bool(args[3], ctx)) }),
  define({ name: 'LOGNORMDIST', min: 3, max: 3, fn: (ctx, args) => lognormDist(num(args[0], ctx), num(args[1], ctx), num(args[2], ctx), true) }),
  ...['LOGNORM.INV', 'LOGINV'].map((name) =>
    inv(
      name,
      3,
      3,
      (ctx, args) => {
        const p = num(args[0], ctx)
        const sigma = num(args[2], ctx)
        prob(p)
        check(sigma > 0)
        return Math.exp(num(args[1], ctx) + sigma * normInv(p))
      },
      isNew(name),
    ),
  ),
  ...['EXPON.DIST', 'EXPONDIST'].map((name) =>
    define({
      name,
      min: 3,
      max: 3,
      xlfn: isNew(name),
      fn: (ctx, args) => {
        const x = num(args[0], ctx)
        const lambda = num(args[1], ctx)
        check(x >= 0 && lambda > 0)
        return bool(args[2], ctx) ? -Math.expm1(-lambda * x) : lambda * Math.exp(-lambda * x)
      },
    }),
  ),
  // Binomial family
  ...['BINOM.DIST', 'BINOMDIST'].map((name) =>
    define({
      name,
      min: 4,
      max: 4,
      xlfn: isNew(name),
      fn: (ctx, args) => {
        const k = int(args[0], ctx)
        const n = int(args[1], ctx)
        const p = num(args[2], ctx)
        check(k >= 0 && k <= n && p >= 0 && p <= 1)
        return bool(args[3], ctx) ? binomCdf(k, n, p) : binomPmf(k, n, p)
      },
    }),
  ),
  define({
    name: 'BINOM.DIST.RANGE',
    min: 3,
    max: 4,
    xlfn: true,
    fn: (ctx, args) => {
      const n = int(args[0], ctx)
      const p = num(args[1], ctx)
      const s1 = int(args[2], ctx)
      const s2 = args.length > 3 && args[3] !== undefined ? int(args[3], ctx) : s1
      check(n >= 0 && p >= 0 && p <= 1 && s1 >= 0 && s1 <= n && s2 >= s1 && s2 <= n)
      if (s2 - s1 > 1000) return binomCdf(s2, n, p) - (s1 > 0 ? binomCdf(s1 - 1, n, p) : 0)
      let total = 0
      for (let k = s1; k <= s2; k++) total += binomPmf(k, n, p)
      return total
    },
  }),
  ...['BINOM.INV', 'CRITBINOM'].map((name) =>
    define({
      name,
      min: 3,
      max: 3,
      xlfn: isNew(name),
      fn: (ctx, args) => {
        const n = int(args[0], ctx)
        const p = num(args[1], ctx)
        const alpha = num(args[2], ctx)
        check(n >= 0 && p >= 0 && p <= 1 && alpha >= 0 && alpha <= 1)
        if (n > 1000) {
          // Bisect on the CDF (an incomplete beta) instead of summing terms.
          let lo = 0
          let hi = n
          while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2)
            if (binomCdf(mid, n, p) >= alpha) hi = mid
            else lo = mid + 1
          }
          return lo
        }
        let total = 0
        for (let k = 0; k <= n; k++) {
          total += binomPmf(k, n, p)
          if (total >= alpha * (1 - 1e-14)) return k
        }
        return n
      },
    }),
  ),
  ...['NEGBINOM.DIST'].map((name) => define({ name, min: 4, max: 4, xlfn: true, fn: (ctx, args) => negbinom(ctx, args, bool(args[3], ctx)) })),
  define({ name: 'NEGBINOMDIST', min: 3, max: 3, fn: (ctx, args) => negbinom(ctx, args, false) }),
  define({ name: 'HYPGEOM.DIST', min: 5, max: 5, xlfn: true, fn: (ctx, args) => hypgeom(ctx, args, 4) }),
  define({ name: 'HYPGEOMDIST', min: 4, max: 4, fn: (ctx, args) => hypgeom(ctx, args, undefined) }),
  ...['POISSON.DIST', 'POISSON'].map((name) =>
    define({
      name,
      min: 3,
      max: 3,
      xlfn: isNew(name),
      fn: (ctx, args) => {
        const k = int(args[0], ctx)
        const lambda = num(args[1], ctx)
        check(k >= 0 && lambda >= 0)
        return bool(args[2], ctx) ? poissonCdf(k, lambda) : poissonPmf(k, lambda)
      },
    }),
  ),
  // Student's t
  define({
    name: 'T.DIST',
    min: 3,
    max: 3,
    xlfn: true,
    fn: (ctx, args) => {
      const t = num(args[0], ctx)
      const d = df(num(args[1], ctx))
      return bool(args[2], ctx) ? tCdf(t, d) : tPdf(t, d)
    },
  }),
  define({
    name: 'T.DIST.2T',
    min: 2,
    max: 2,
    xlfn: true,
    fn: (ctx, args) => {
      const t = num(args[0], ctx)
      check(t >= 0)
      return 2 * tUpper(t, df(num(args[1], ctx)))
    },
  }),
  define({ name: 'T.DIST.RT', min: 2, max: 2, xlfn: true, fn: (ctx, args) => tUpper(num(args[0], ctx), df(num(args[1], ctx))) }),
  define({
    name: 'TDIST',
    min: 3,
    max: 3,
    fn: (ctx, args) => {
      const t = num(args[0], ctx)
      const d = df(num(args[1], ctx))
      const tails = int(args[2], ctx)
      check(t >= 0 && (tails === 1 || tails === 2))
      return tails * tUpper(t, d)
    },
  }),
  define({
    name: 'T.INV',
    min: 2,
    max: 2,
    xlfn: true,
    fn: (ctx, args) => {
      const p = num(args[0], ctx)
      prob(p)
      const d = df(num(args[1], ctx))
      if (p === 0.5) return 0
      return p < 0.5 ? -tInv2(2 * p, d) : tInv2(2 * (1 - p), d)
    },
  }),
  ...['T.INV.2T', 'TINV'].map((name) =>
    define({
      name,
      min: 2,
      max: 2,
      xlfn: isNew(name),
      fn: (ctx, args) => {
        const p = num(args[0], ctx)
        prob(p, true, false)
        return tInv2(p, df(num(args[1], ctx)))
      },
    }),
  ),
  ...['T.TEST', 'TTEST'].map((name) => define({ name, min: 4, max: 4, xlfn: isNew(name), args: ['any', 'any', 'scalar', 'scalar'], fn: tTest })),
  // Chi-squared
  define({
    name: 'CHISQ.DIST',
    min: 3,
    max: 3,
    xlfn: true,
    fn: (ctx, args) => {
      const x = num(args[0], ctx)
      const d = df(num(args[1], ctx))
      check(x >= 0)
      if (bool(args[2], ctx)) return chisqCdf(x, d)
      if (x === 0) return d === 2 ? 0.5 : d < 2 ? fail(Errors.NUM) : 0
      return Math.exp((d / 2 - 1) * Math.log(x) - x / 2 - (d / 2) * Math.LN2 - lgamma(d / 2))
    },
  }),
  ...['CHISQ.DIST.RT', 'CHIDIST'].map((name) =>
    define({
      name,
      min: 2,
      max: 2,
      xlfn: isNew(name),
      fn: (ctx, args) => {
        const x = num(args[0], ctx)
        check(x >= 0)
        return chisqUpper(x, df(num(args[1], ctx)))
      },
    }),
  ),
  define({
    name: 'CHISQ.INV',
    min: 2,
    max: 2,
    xlfn: true,
    fn: (ctx, args) => {
      const p = num(args[0], ctx)
      prob(p, false, true)
      const d = df(num(args[1], ctx))
      if (p === 0) return 0
      return solveMonotone((x) => chisqCdf(x, d), p, 0, Infinity, true, d)
    },
  }),
  ...['CHISQ.INV.RT', 'CHIINV'].map((name) =>
    define({
      name,
      min: 2,
      max: 2,
      xlfn: isNew(name),
      fn: (ctx, args) => {
        const p = num(args[0], ctx)
        prob(p, true, false)
        const d = df(num(args[1], ctx))
        if (p === 1) return 0
        return solveMonotone((x) => chisqUpper(x, d), p, 0, Infinity, false, d)
      },
    }),
  ),
  ...['CHISQ.TEST', 'CHITEST'].map((name) => define({ name, min: 2, max: 2, xlfn: isNew(name), args: ['any'], fn: chisqTest })),
  // F
  define({
    name: 'F.DIST',
    min: 4,
    max: 4,
    xlfn: true,
    fn: (ctx, args) => {
      const x = num(args[0], ctx)
      const d1 = df(num(args[1], ctx))
      const d2 = df(num(args[2], ctx))
      check(x >= 0)
      if (bool(args[3], ctx)) return fCdf(x, d1, d2)
      if (x === 0) return d1 === 2 ? 1 : d1 < 2 ? fail(Errors.NUM) : 0
      return Math.exp(0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) - Math.log(x) - lbeta(d1 / 2, d2 / 2))
    },
  }),
  ...['F.DIST.RT', 'FDIST'].map((name) =>
    define({
      name,
      min: 3,
      max: 3,
      xlfn: isNew(name),
      fn: (ctx, args) => {
        const x = num(args[0], ctx)
        check(x >= 0)
        return fUpper(x, df(num(args[1], ctx)), df(num(args[2], ctx)))
      },
    }),
  ),
  define({
    name: 'F.INV',
    min: 3,
    max: 3,
    xlfn: true,
    fn: (ctx, args) => {
      const p = num(args[0], ctx)
      prob(p, false, true)
      const d1 = df(num(args[1], ctx))
      const d2 = df(num(args[2], ctx))
      if (p === 0) return 0
      return solveMonotone((x) => fCdf(x, d1, d2), p, 0, Infinity, true, 1)
    },
  }),
  ...['F.INV.RT', 'FINV'].map((name) =>
    define({
      name,
      min: 3,
      max: 3,
      xlfn: isNew(name),
      fn: (ctx, args) => {
        const p = num(args[0], ctx)
        prob(p, true, false)
        const d1 = df(num(args[1], ctx))
        const d2 = df(num(args[2], ctx))
        if (p === 1) return 0
        return solveMonotone((x) => fUpper(x, d1, d2), p, 0, Infinity, false, 1)
      },
    }),
  ),
  ...['F.TEST', 'FTEST'].map((name) => define({ name, min: 2, max: 2, xlfn: isNew(name), args: ['any'], fn: fTest })),
  // Gamma and beta
  define({
    name: 'GAMMA',
    min: 1,
    max: 1,
    xlfn: true,
    fn: (ctx, args) => {
      const x = num(args[0], ctx)
      check(!(x === 0 || (x < 0 && Number.isInteger(x))))
      return gamma(x)
    },
  }),
  ...['GAMMALN', 'GAMMALN.PRECISE'].map((name) =>
    define({
      name,
      min: 1,
      max: 1,
      xlfn: isNew(name),
      fn: (ctx, args) => {
        const x = num(args[0], ctx)
        check(x > 0)
        return lgamma(x)
      },
    }),
  ),
  ...['GAMMA.DIST', 'GAMMADIST'].map((name) =>
    define({ name, min: 4, max: 4, xlfn: isNew(name), fn: (ctx, args) => gammaDist(num(args[0], ctx), num(args[1], ctx), num(args[2], ctx), bool(args[3], ctx)) }),
  ),
  ...['GAMMA.INV', 'GAMMAINV'].map((name) =>
    define({
      name,
      min: 3,
      max: 3,
      xlfn: isNew(name),
      fn: (ctx, args) => {
        const p = num(args[0], ctx)
        const alpha = num(args[1], ctx)
        const beta = num(args[2], ctx)
        prob(p, false, true)
        check(alpha > 0 && beta > 0)
        if (p === 0) return 0
        return beta * solveMonotone((x) => gammaP(alpha, x), p, 0, Infinity, true, alpha)
      },
    }),
  ),
  define({
    name: 'BETA.DIST',
    min: 4,
    max: 6,
    xlfn: true,
    fn: (ctx, args) => betaDist(num(args[0], ctx), num(args[1], ctx), num(args[2], ctx), bool(args[3], ctx), defNum(args, 4, 0, ctx), defNum(args, 5, 1, ctx)),
  }),
  define({
    name: 'BETADIST',
    min: 3,
    max: 5,
    fn: (ctx, args) => betaDist(num(args[0], ctx), num(args[1], ctx), num(args[2], ctx), true, defNum(args, 3, 0, ctx), defNum(args, 4, 1, ctx)),
  }),
  ...['BETA.INV', 'BETAINV'].map((name) =>
    define({
      name,
      min: 3,
      max: 5,
      xlfn: isNew(name),
      fn: (ctx, args) => {
        const p = num(args[0], ctx)
        const alpha = num(args[1], ctx)
        const beta = num(args[2], ctx)
        const lo = defNum(args, 3, 0, ctx)
        const hi = defNum(args, 4, 1, ctx)
        prob(p, false, false)
        check(alpha > 0 && beta > 0 && lo < hi)
        const t = p === 0 ? 0 : p === 1 ? 1 : solveMonotone((x) => betaI(x, alpha, beta), p, 0, 1, true)
        return lo + t * (hi - lo)
      },
    }),
  ),
  ...['WEIBULL.DIST', 'WEIBULL'].map((name) =>
    define({ name, min: 4, max: 4, xlfn: isNew(name), fn: (ctx, args) => weibull(num(args[0], ctx), num(args[1], ctx), num(args[2], ctx), bool(args[3], ctx)) }),
  ),
  // Inference
  ...['CONFIDENCE', 'CONFIDENCE.NORM'].map((name) =>
    define({
      name,
      min: 3,
      max: 3,
      xlfn: isNew(name),
      fn: (ctx, args) => {
        const alpha = num(args[0], ctx)
        const sd = num(args[1], ctx)
        const n = int(args[2], ctx)
        prob(alpha)
        check(sd > 0 && n >= 1)
        return (normInv(1 - alpha / 2) * sd) / Math.sqrt(n)
      },
    }),
  ),
  define({
    name: 'CONFIDENCE.T',
    min: 3,
    max: 3,
    xlfn: true,
    fn: (ctx, args) => {
      const alpha = num(args[0], ctx)
      const sd = num(args[1], ctx)
      const n = int(args[2], ctx)
      prob(alpha)
      check(sd > 0 && n >= 1)
      if (n === 1) return fail(Errors.DIV0)
      return (tInv2(alpha, n - 1) * sd) / Math.sqrt(n)
    },
  }),
  ...['Z.TEST', 'ZTEST'].map((name) => define({ name, min: 2, max: 3, xlfn: isNew(name), args: ['any', 'scalar', 'scalar'], fn: zTest })),
  define({ name: 'PROB', min: 3, max: 4, args: ['any', 'any', 'scalar', 'scalar'], fn: probRange }),
  define({
    name: 'FISHER',
    min: 1,
    max: 1,
    fn: (ctx, args) => {
      const x = num(args[0], ctx)
      check(Math.abs(x) < 1)
      return Math.atanh(x)
    },
  }),
  define({ name: 'FISHERINV', min: 1, max: 1, fn: (ctx, args) => Math.tanh(num(args[0], ctx)) }),
]
