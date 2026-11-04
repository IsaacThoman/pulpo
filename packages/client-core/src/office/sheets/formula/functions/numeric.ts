/**
 * Plain numeric helpers shared by the math, statistical, and financial functions: Excel's
 * decimal-correct rounding and the basic sample statistics.
 */

import { Errors } from '../types.js'
import { fail } from './coerce.js'

export type RoundMode = 'half' | 'up' | 'down'

/**
 * Rounds `x` to `digits` decimals the way Excel does: on the 15-significant-digit decimal value,
 * not the binary double, so `ROUND(2.675, 2)` is 2.68. `half` rounds half away from zero, `up`
 * away from zero, `down` toward zero.
 */
export function roundDecimal(x: number, digits: number, mode: RoundMode = 'half'): number {
  if (!Number.isFinite(x) || x === 0) return x
  digits = Math.trunc(digits)
  const negative = x < 0
  const [mantissa, expText] = Math.abs(x).toExponential(14).split('e') as [string, string]
  const all = mantissa.replace('.', '')
  const exp = Number(expText)
  const keep = exp + 1 + digits
  if (keep >= all.length) return x
  let n: bigint
  if (keep < 0) {
    n = mode === 'up' ? 1n : 0n
  } else {
    const kept = all.slice(0, keep)
    const rest = all.slice(keep)
    n = BigInt(kept || '0')
    if (mode === 'half' && rest[0]! >= '5') n += 1n
    else if (mode === 'up' && /[1-9]/.test(rest)) n += 1n
  }
  const result = Number(`${n}e${-digits}`)
  return negative ? -result : result
}

/** Rounds to 15 significant digits, which hides binary noise before floor/ceil (`CEILING(0.3/0.1)`). */
export function round15(x: number): number {
  if (!Number.isFinite(x) || x === 0) return x
  return Number(x.toPrecision(15))
}

export function sum(values: readonly number[]): number {
  // Neumaier summation keeps long sums of decimals closer to Excel's results.
  let total = 0
  let compensation = 0
  for (const v of values) {
    const t = total + v
    if (Math.abs(total) >= Math.abs(v)) compensation += total - t + v
    else compensation += v - t + total
    total = t
  }
  return total + compensation
}

export function mean(values: readonly number[]): number {
  if (!values.length) fail(Errors.DIV0)
  return sum(values) / values.length
}

/** Sum of squared deviations from the mean. */
export function devsq(values: readonly number[]): number {
  if (!values.length) return 0
  const m = sum(values) / values.length
  return sum(values.map((v) => (v - m) * (v - m)))
}

export function variance(values: readonly number[], sample: boolean): number {
  const n = values.length
  if (n < (sample ? 2 : 1)) fail(Errors.DIV0)
  return devsq(values) / (sample ? n - 1 : n)
}

export function sorted(values: readonly number[]): number[] {
  return values.slice().sort((a, b) => a - b)
}

export function median(values: readonly number[]): number {
  if (!values.length) fail(Errors.NUM)
  const s = sorted(values)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** PERCENTILE.INC on sorted values. */
export function percentileInc(s: readonly number[], k: number): number {
  if (!s.length || k < 0 || k > 1) fail(Errors.NUM)
  const pos = k * (s.length - 1)
  const lo = Math.floor(pos)
  const frac = pos - lo
  if (lo + 1 >= s.length) return s[lo]!
  return s[lo]! + frac * (s[lo + 1]! - s[lo]!)
}

/** PERCENTILE.EXC on sorted values. */
export function percentileExc(s: readonly number[], k: number): number {
  const n = s.length
  if (!n || k <= 0 || k >= 1) fail(Errors.NUM)
  const pos = k * (n + 1)
  if (pos < 1 || pos > n) fail(Errors.NUM)
  const lo = Math.floor(pos)
  const frac = pos - lo
  if (lo >= n) return s[n - 1]!
  return s[lo - 1]! + frac * (s[lo]! - s[lo - 1]!)
}

/** The most frequent values, in order of first appearance; empty when every value is unique. */
export function modes(values: readonly number[]): number[] {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = 1
  for (const c of counts.values()) best = Math.max(best, c)
  if (best < 2) return []
  const out: number[] = []
  const seen = new Set<number>()
  for (const v of values) {
    if (!seen.has(v) && counts.get(v) === best) out.push(v)
    seen.add(v)
  }
  return out
}

/** Greatest common divisor of two non-negative integers. */
export function gcd2(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a
}

/** n! for small integer n (exact up to 170!). */
export function factorial(n: number): number {
  if (n < 0) return NaN
  let result = 1
  for (let i = 2; i <= n; i++) result *= i
  return result
}

/** Binomial coefficient, rounded to an integer when it is exactly representable. */
export function combin(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  k = Math.min(k, n - k)
  let result = 1
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i
  return Math.round(result) === result || result > 1e15 ? Math.round(result) : result
}
