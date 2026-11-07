/**
 * Special functions behind the statistical distributions: log-gamma (Lanczos), regularized
 * incomplete gamma (series + Lentz continued fraction), regularized incomplete beta (continued
 * fraction), the normal distribution (via the incomplete gamma, accurate in the tails), Acklam's
 * inverse normal refined with Halley steps, and a bracketing root finder for the other inverses.
 */

import { consumeWork } from '../budget.js'

const LANCZOS_G = 7
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
]

const LN_SQRT_2PI = 0.9189385332046727

/** ln Γ(x) for x > 0. */
export function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x)
  if (Number.isInteger(x) && x <= 171) return Math.log(gammaInteger(x))
  // Stirling's series is more accurate than Lanczos far from the origin.
  if (x > 15) {
    const inv = 1 / x
    const inv2 = inv * inv
    const series = inv * (1 / 12 - inv2 * (1 / 360 - inv2 * (1 / 1260 - inv2 * (1 / 1680 - inv2 / 1188))))
    return (x - 0.5) * Math.log(x) - x + LN_SQRT_2PI + series
  }
  x -= 1
  let a = LANCZOS[0]!
  const t = x + LANCZOS_G + 0.5
  for (let i = 1; i < LANCZOS.length; i++) {
    consumeWork()
    a += LANCZOS[i]! / (x + i)
  }
  return LN_SQRT_2PI + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

function gammaInteger(n: number): number {
  let r = 1
  for (let i = 2; i < n; i++) {
    consumeWork()
    r *= i
  }
  return r
}

/** Γ(x); NaN at zero and negative integers. */
export function gamma(x: number): number {
  if (x === 0 || (x < 0 && Number.isInteger(x))) return NaN
  if (Number.isInteger(x) && x > 0 && x <= 171) return gammaInteger(x)
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x))
  if (x > 171.7) return Infinity
  if (x < 15) {
    x -= 1
    let a = LANCZOS[0]!
    const t = x + LANCZOS_G + 0.5
    for (let i = 1; i < LANCZOS.length; i++) {
      consumeWork()
      a += LANCZOS[i]! / (x + i)
    }
    return Math.sqrt(2 * Math.PI) * t ** (x + 0.5) * Math.exp(-t) * a
  }
  return Math.exp(lgamma(x))
}

/** ln B(a, b). */
export function lbeta(a: number, b: number): number {
  return lgamma(a) + lgamma(b) - lgamma(a + b)
}

const EPS = 1e-16
const TINY = 1e-300

/** Regularized lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0
  if (x < a + 1) return gammaSeries(a, x)
  return 1 - gammaContinuedFraction(a, x)
}

/** Regularized upper incomplete gamma Q(a, x) = 1 − P(a, x), accurate when it is tiny. */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1
  if (x < a + 1) return 1 - gammaSeries(a, x)
  return gammaContinuedFraction(a, x)
}

function gammaSeries(a: number, x: number): number {
  let sum = 1 / a
  let term = sum
  let ap = a
  for (let n = 0; n < 10_000; n++) {
    consumeWork()
    ap += 1
    term *= x / ap
    sum += term
    if (Math.abs(term) < Math.abs(sum) * EPS) break
  }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma(a))
}

function gammaContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a
  let c = 1 / TINY
  let d = 1 / b
  let h = d
  for (let i = 1; i < 10_000; i++) {
    consumeWork()
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < TINY) d = TINY
    c = b + an / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < EPS) break
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h
}

/** Regularized incomplete beta I_x(a, b). */
export function betaI(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(a * Math.log(x) + b * Math.log1p(-x) - lbeta(a, b))
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(x, a, b)) / a
  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < TINY) d = TINY
  d = 1 / d
  let h = d
  for (let m = 1; m <= 10_000; m++) {
    consumeWork()
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < EPS) break
  }
  return h
}

/** erfc(x) via Q(1/2, x²), accurate for large x. */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x)
  if (x === 0) return 1
  return gammaQ(0.5, x * x)
}

export function erf(x: number): number {
  if (x < 0) return -erf(-x)
  if (x === 0) return 0
  return gammaP(0.5, x * x)
}

/** Standard normal CDF Φ(z). */
export function normCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2)
}

export function normPdf(z: number): number {
  return Math.exp(-0.5 * z * z - LN_SQRT_2PI)
}

const ACKLAM_A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
const ACKLAM_B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
const ACKLAM_C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
const ACKLAM_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]

/** Inverse standard normal CDF for 0 < p < 1 (Acklam's approximation plus Halley refinement). */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) return NaN
  const a = ACKLAM_A
  const b = ACKLAM_B
  const c = ACKLAM_C
  const d = ACKLAM_D
  const low = 0.02425
  let x: number
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p))
    x = (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  } else if (p <= 1 - low) {
    const q = p - 0.5
    const r = q * q
    x =
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  } else {
    const q = Math.sqrt(-2 * Math.log1p(-p))
    x = -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  }
  // Halley steps against the accurate CDF; work on the smaller tail for precision.
  for (let i = 0; i < 3; i++) {
    consumeWork()
    const e = p < 0.5 ? normCdf(x) - p : 1 - p - normCdf(-x)
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2)
    const next = x - u / (1 + (x * u) / 2)
    if (!Number.isFinite(next)) break
    if (Math.abs(next - x) <= 1e-16 * Math.abs(x)) {
      x = next
      break
    }
    x = next
  }
  return x
}

/**
 * Solves `f(x) = target` for a monotone `f` on [lo, hi]. `hi` may be Infinity, in which case the
 * bracket grows from `start`. Bisection to full precision, which is robust for every CDF here.
 */
export function solveMonotone(f: (x: number) => number, target: number, lo: number, hi: number, increasing: boolean, start = 1): number {
  const below = (x: number): boolean => (increasing ? f(x) < target : f(x) > target)
  if (!Number.isFinite(hi)) {
    hi = Math.max(start, lo + 1)
    let guard = 0
    while (below(hi) && guard++ < 2000) {
      consumeWork()
      lo = hi
      hi *= 2
    }
  }
  for (let i = 0; i < 400; i++) {
    consumeWork()
    const mid = (lo + hi) / 2
    if (mid === lo || mid === hi) break
    if (below(mid)) lo = mid
    else hi = mid
    if (hi - lo <= 1e-16 * Math.max(Math.abs(mid), 1e-300)) break
  }
  return (lo + hi) / 2
}

// ---------------------------------------------------------------------------------------------
// Distribution CDFs used by several functions

/** Student's t CDF. */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t)
  const tail = 0.5 * betaI(x, df / 2, 0.5)
  return t > 0 ? 1 - tail : tail
}

/** Upper tail of Student's t, P(T > t), accurate for large t. */
export function tUpper(t: number, df: number): number {
  const x = df / (df + t * t)
  const tail = 0.5 * betaI(x, df / 2, 0.5)
  return t > 0 ? tail : 1 - tail
}

export function tPdf(t: number, df: number): number {
  return Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log1p((t * t) / df))
}

export function chisqCdf(x: number, df: number): number {
  return gammaP(df / 2, x / 2)
}

export function chisqUpper(x: number, df: number): number {
  return gammaQ(df / 2, x / 2)
}

export function fCdf(x: number, d1: number, d2: number): number {
  if (x <= 0) return 0
  return betaI((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2)
}

export function fUpper(x: number, d1: number, d2: number): number {
  if (x <= 0) return 1
  return betaI(d2 / (d2 + d1 * x), d2 / 2, d1 / 2)
}

/** Two-sided inverse of Student's t: the t with P(|T| > t) = p. */
export function tInv2(p: number, df: number): number {
  return solveMonotone((t) => 2 * tUpper(t, df), p, 0, Infinity, false, 1)
}
