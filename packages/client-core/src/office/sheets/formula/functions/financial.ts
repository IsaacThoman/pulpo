/** Financial functions: annuities, cash-flow analysis, depreciation, rates, and T-bills/bonds. */

import { consumeWork } from '../budget.js'
import { forEachLogical, denseRange } from '../ranges.js'


import { Errors, isError, type FunctionContext, type FunctionSpec, type Scalar, type Value } from '../types.js'
import { bool, check, defInt, defNum, define, fail, int, num, omitted, optNum, toMatrix, type Args } from './coerce.js'
import { partsOf, yearfrac } from './datetime.js'
import { dateToSerial, serialToEpochMs } from '../../dates.js'
import { collectNumbers } from './iterate.js'

// ---------------------------------------------------------------------------------------------
// Time value of money

export function fv(rate: number, nper: number, pmt: number, pv: number, type: number): number {
  if (rate === 0) return -(pv + pmt * nper)
  const t = (1 + rate) ** nper
  return -(pv * t + (pmt * (1 + rate * type) * (t - 1)) / rate)
}

export function pmt(rate: number, nper: number, pv: number, fvValue: number, type: number): number {
  if (nper === 0) return fail(Errors.NUM)
  if (rate === 0) return -(pv + fvValue) / nper
  const t = (1 + rate) ** nper
  return -(rate * (fvValue + pv * t)) / ((1 + rate * type) * (t - 1))
}

export function pv(rate: number, nper: number, pmtValue: number, fvValue: number, type: number): number {
  if (rate === 0) return -(fvValue + pmtValue * nper)
  const t = (1 + rate) ** nper
  return -(fvValue + (pmtValue * (1 + rate * type) * (t - 1)) / rate) / t
}

function ipmt(rate: number, per: number, nper: number, pvValue: number, fvValue: number, type: number): number {
  check(per >= 1 && per < nper + 1)
  const payment = pmt(rate, nper, pvValue, fvValue, type)
  if (per === 1) return type === 1 ? 0 : -pvValue * rate
  const balance = type === 1 ? fv(rate, per - 2, payment, pvValue, 1) - payment : fv(rate, per - 1, payment, pvValue, 0)
  return balance * rate
}

function typeArg(ctx: FunctionContext, args: Args, index: number): number {
  return defNum(args, index, 0, ctx) !== 0 ? 1 : 0
}

/** f(rate) = 0 for the annuity equation, and its derivative, for RATE. */
function annuity(rate: number, nper: number, pmtValue: number, pvValue: number, fvValue: number, type: number): [number, number] {
  if (Math.abs(rate) < 1e-12) {
    const f = pvValue + pmtValue * nper + fvValue
    const df = pvValue * nper + pmtValue * (type * nper + (nper * (nper - 1)) / 2)
    return [f, df]
  }
  const t = (1 + rate) ** nper
  const dt = nper * (1 + rate) ** (nper - 1)
  const f = pvValue * t + (pmtValue * (1 + rate * type) * (t - 1)) / rate + fvValue
  const df = pvValue * dt + pmtValue * type * ((t - 1) / rate) + pmtValue * (1 + rate * type) * ((dt * rate - (t - 1)) / (rate * rate))
  return [f, df]
}

function rate(ctx: FunctionContext, args: Args): number {
  const nper = num(args[0], ctx)
  const pmtValue = num(args[1], ctx)
  const pvValue = num(args[2], ctx)
  const fvValue = defNum(args, 3, 0, ctx)
  const type = typeArg(ctx, args, 4)
  let r = optNum(args, 5, 0.1, ctx)
  check(nper > 0)
  // Excel gives up when 20 Newton steps do not converge to 1e-7; once converged, polish a little.
  for (let i = 0; i < 20; i++) {
    consumeWork()
    const [f, df] = annuity(r, nper, pmtValue, pvValue, fvValue, type)
    if (df === 0 || !Number.isFinite(df)) return fail(Errors.NUM)
    const next = r - f / df
    if (!Number.isFinite(next) || next <= -1) return fail(Errors.NUM)
    const converged = Math.abs(next - r) < 1e-7
    r = next
    if (converged) {
      for (let k = 0; k < 5; k++) {
        consumeWork()
        const [f2, df2] = annuity(r, nper, pmtValue, pvValue, fvValue, type)
        if (!df2) break
        const polished = r - f2 / df2
        if (!Number.isFinite(polished)) break
        if (polished === r) break
        r = polished
      }
      return r
    }
  }
  return fail(Errors.NUM)
}

// ---------------------------------------------------------------------------------------------
// Cash flows

function npv(rateValue: number, values: number[]): number {
  if (rateValue === -1) return fail(Errors.DIV0)
  let total = 0
  for (let i = 0; i < values.length; i++) {
    consumeWork()
    total += values[i]! / (1 + rateValue) ** (i + 1)
  }
  return total
}

/** Newton from `guess`, then bisection over a wide bracket when Newton wanders off. */
function solveRate(f: (r: number) => number, df: (r: number) => number, guess: number): number {
  let r = guess
  for (let i = 0; i < 100; i++) {
    consumeWork()
    const value = f(r)
    const slope = df(r)
    if (!Number.isFinite(value) || !Number.isFinite(slope) || slope === 0) break
    const next = r - value / slope
    if (!Number.isFinite(next) || next <= -1) break
    if (Math.abs(next - r) <= 1e-12 * Math.max(1, Math.abs(r))) return next
    r = next
  }
  // Fallback: scan for a sign change and bisect.
  const grid = [-0.999999, -0.99, -0.9, -0.5, -0.2, -0.1, 0, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 100, 1000]
  for (let i = 0; i < grid.length - 1; i++) {
    consumeWork()
    let lo = grid[i]!
    let hi = grid[i + 1]!
    let flo = f(lo)
    const fhi = f(hi)
    if (!Number.isFinite(flo) || !Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)) continue
    for (let k = 0; k < 200; k++) {
      consumeWork()
      const mid = (lo + hi) / 2
      const fm = f(mid)
      if (Math.sign(fm) === Math.sign(flo)) {
        lo = mid
        flo = fm
      } else hi = mid
    }
    return (lo + hi) / 2
  }
  return fail(Errors.NUM)
}

function cashFlows(ctx: FunctionContext, value: Value | undefined): number[] {
  return collectNumbers(ctx, [value])
}

function irr(ctx: FunctionContext, args: Args): number {
  const values = cashFlows(ctx, args[0])
  const guess = defNum(args, 1, 0.1, ctx)
  check(values.some((v) => v > 0) && values.some((v) => v < 0))
  const f = (r: number): number => {
    consumeWork(values.length)
    return values.reduce((s, v, i) => s + v / (1 + r) ** i, 0)
  }
  const df = (r: number): number => {
    consumeWork(values.length)
    return values.reduce((s, v, i) => s - (i * v) / (1 + r) ** (i + 1), 0)
  }
  return solveRate(f, df, guess)
}

function strictNumbers(ctx: FunctionContext, value: Value | undefined): number[] {
  const source = toMatrix(ctx, value)
  forEachLogical(source, (v) => {
    if (typeof v !== 'number') fail(isError(v) ? v : Errors.VALUE)
  }, { weightedTail: true })
  return denseRange(source).data.map((v: Scalar) => {
    if (isError(v)) return fail(v)
    if (typeof v !== 'number') return fail(Errors.VALUE)
    return v
  })
}

function xflows(ctx: FunctionContext, valuesArg: Value | undefined, datesArg: Value | undefined): { values: number[]; years: number[] } {
  const values = strictNumbers(ctx, valuesArg)
  const dates = strictNumbers(ctx, datesArg).map(Math.trunc)
  for (const d of dates) check(d >= 0 && d <= (ctx.date1904 ? 2_957_003 : 2_958_465), Errors.VALUE)
  if (values.length !== dates.length) return fail(Errors.NUM)
  const d0 = dates[0]!
  // XIRR allows dates before the first cash flow (MS-OI29500 18.17.7.350).
  return { values, years: dates.map((d) => (d - d0) / 365) }
}

function xnpv(r: number, values: number[], years: number[]): number {
  consumeWork(values.length)
  return values.reduce((s, v, i) => s + v / (1 + r) ** years[i]!, 0)
}

function xirr(ctx: FunctionContext, args: Args): number {
  const { values, years } = xflows(ctx, args[0], args[1])
  const guess = defNum(args, 2, 0.1, ctx)
  check(guess > -1 && values.some((v) => v > 0) && values.some((v) => v < 0))
  const df = (r: number): number => {
    consumeWork(values.length)
    return values.reduce((s, v, i) => s - (years[i]! * v) / (1 + r) ** (years[i]! + 1), 0)
  }
  return solveRate((r) => xnpv(r, values, years), df, guess)
}

function mirr(ctx: FunctionContext, args: Args): number {
  const values = cashFlows(ctx, args[0])
  const financeRate = num(args[1], ctx)
  const reinvestRate = num(args[2], ctx)
  const n = values.length
  if (financeRate === -1 || reinvestRate === -1) return fail(Errors.DIV0)
  let positive = 0
  let negative = 0
  values.forEach((v, i) => {
    if (v > 0) positive += v * (1 + reinvestRate) ** (n - 1 - i)
    else if (v < 0) negative += v / (1 + financeRate) ** i
  })
  if (positive === 0 || negative === 0) return fail(Errors.DIV0)
  return (-positive / negative) ** (1 / (n - 1)) - 1
}

// ---------------------------------------------------------------------------------------------
// Depreciation

function db(ctx: FunctionContext, args: Args): number {
  const cost = num(args[0], ctx)
  const salvage = num(args[1], ctx)
  const life = num(args[2], ctx)
  const period = int(args[3], ctx)
  const month = args.length <= 4 ? 12 : int(args[4], ctx)
  check(cost >= 0 && salvage >= 0 && life > 0 && period >= 1 && month >= 1 && month <= 12)
  check(period <= (month === 12 ? life : life + 1))
  if (cost === 0) return 0
  // Excel rounds the rate to three decimals; after the first (partial) year the book value
  // declines geometrically, and the year after the life gets the rest of the last year.
  const rateValue = Math.round((1 - (salvage / cost) ** (1 / life)) * 1000) / 1000
  const first = (cost * rateValue * month) / 12
  if (period === 1) return first
  const afterFirst = cost - first
  if (period === Math.floor(life) + 1) return (afterFirst * (1 - rateValue) ** (period - 2) * rateValue * (12 - month)) / 12
  return afterFirst * (1 - rateValue) ** (period - 2) * rateValue
}

function ddbPeriod(cost: number, salvage: number, life: number, period: number, factor: number): number {
  const r = factor / life
  if (r >= 1) return period <= 1 ? Math.max(0, cost - salvage) : 0
  if (period < 1) return Math.max(0, cost - Math.max(salvage, cost * (1 - r) ** period))
  const prior = cost * (1 - (1 - r) ** (period - 1))
  const dep = cost * r * (1 - r) ** (period - 1)
  return Math.max(0, Math.min(dep, cost - salvage - prior))
}

/** VDB: cumulative depreciation up to time `t` (in periods), interpolating inside a period. */
function vdbCumulative(cost: number, salvage: number, life: number, t: number, factor: number, noSwitch: boolean): number {
  let book = cost
  let total = 0
  let straight = false
  let slAmount = 0
  const periods = Math.ceil(life)
  for (let p = 1; p <= periods && p - 1 < t; p++) {
    consumeWork()
    let dep: number
    if (straight) dep = slAmount
    else {
      const ddb = Math.min(book * (factor / life), Math.max(0, book - salvage))
      const remaining = life - (p - 1)
      const sl = remaining > 0 ? (book - salvage) / remaining : 0
      if (!noSwitch && sl > ddb) {
        straight = true
        slAmount = sl
        dep = sl
      } else dep = ddb
    }
    dep = Math.max(0, Math.min(dep, book - salvage))
    const portion = Math.min(1, t - (p - 1))
    total += dep * portion
    book -= dep
  }
  return total
}

// ---------------------------------------------------------------------------------------------
// Securities

function settlementMaturity(ctx: FunctionContext, args: Args): [number, number] {
  const settlement = financialDate(ctx, args[0])
  const maturity = financialDate(ctx, args[1])
  partsOf(ctx, settlement)
  partsOf(ctx, maturity)
  check(settlement < maturity)
  return [settlement, maturity]
}

function tbill(ctx: FunctionContext, args: Args): [number, number] {
  const [settlement, maturity] = settlementMaturity(ctx, args)
  const s = partsOf(ctx, settlement)
  // At most one year apart.
  const last = new Date(Date.UTC(s.year + 1, s.month, 0)).getUTCDate()
  const limit = dateToSerial(s.year + 1, s.month, Math.min(s.day, last), ctx.date1904)
  check(maturity <= limit)
  return [settlement, maturity]
}

interface Coupons {
  previous: number
  next: number
  count: number
}

/** Coupon dates around settlement, stepping back from maturity in 12/frequency month steps. */
function coupons(ctx: FunctionContext, settlement: number, maturity: number, frequency: number): Coupons {
  const m = partsOf(ctx, maturity)
  const months = 12 / frequency
  const endOfMonth = m.day === new Date(Date.UTC(m.year, m.month, 0)).getUTCDate()
  const couponDate = (k: number): number => {
    const total = m.year * 12 + (m.month - 1) - k * months
    const y = Math.floor(total / 12)
    const mo = total - y * 12 + 1
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
    return dateToSerial(y, mo, endOfMonth ? last : Math.min(m.day, last), ctx.date1904)
  }
  let k = 0
  while (couponDate(k + 1) > settlement) {
    consumeWork()
    k++
  }
  return { previous: couponDate(k + 1), next: couponDate(k), count: k + 1 }
}

function couponDays(ctx: FunctionContext, previous: number, next: number, basis: number, frequency: number): number {
  if (basis === 1) return next - previous
  if (basis === 3) return 365 / frequency
  return 360 / frequency
}

function dayCount(ctx: FunctionContext, from: number, to: number, basis: number): number {
  if (from === to) return 0
  if (basis !== 0 && basis !== 4) return to - from
  // A previous quasi-coupon may precede the date system's epoch. Only inputs,
  // not internal schedule boundaries, are restricted to nonnegative serials.
  const parts = (serial: number) => {
    if (serial >= 0) return partsOf(ctx, serial)
    const d = new Date(serialToEpochMs(serial, ctx.date1904))
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
  }
  const a = parts(from), b = parts(to)
  let d1 = a.day, d2 = b.day
  const feb = (p: typeof a) => p.month === 2 && p.day === new Date(Date.UTC(p.year, 2, 0)).getUTCDate()
  if (basis === 4) { d1 = Math.min(d1, 30); d2 = Math.min(d2, 30) }
  else if (d1 === 31 && d2 === 31) { d1 = 30; d2 = 30 }
  else if (d1 === 31) d1 = 30
  else if (d1 === 30 && d2 === 31) d2 = 30
  else if (feb(a) && feb(b)) { d1 = 30; d2 = 30 }
  else if (feb(a)) d1 = 30
  return (b.year - a.year) * 360 + (b.month - a.month) * 30 + d2 - d1
}

function bondArgs(ctx: FunctionContext, args: Args, frequencyIndex: number) {
  const [settlement, maturity] = settlementMaturity(ctx, args)
  const frequency = int(args[frequencyIndex], ctx)
  const basis = defInt(args, frequencyIndex + 1, 0, ctx)
  check([1, 2, 4].includes(frequency))
  check(basis >= 0 && basis <= 4)
  const c = coupons(ctx, settlement, maturity, frequency)
  const E = couponDays(ctx, c.previous, c.next, basis, frequency)
  const A = dayCount(ctx, c.previous, settlement, basis)
  const DSC = basis === 0 || basis === 4 ? E - A : c.next - settlement
  return { settlement, maturity, frequency, basis, previous: c.previous, next: c.next, N: c.count, E, A, DSC }
}

function bondPrice(rateValue: number, yld: number, redemption: number, b: ReturnType<typeof bondArgs>): number {
  const { frequency: f, N, E, A, DSC } = b
  const coupon = (100 * rateValue) / f
  if (N === 1) {
    const t = DSC / E
    return (redemption + coupon) / (1 + (t * yld) / f) - (A / E) * coupon
  }
  let price = redemption / (1 + yld / f) ** (N - 1 + DSC / E)
  for (let k = 1; k <= N; k++) {
    consumeWork()
    price += coupon / (1 + yld / f) ** (k - 1 + DSC / E)
  }
  return price - coupon * (A / E)
}

function price(ctx: FunctionContext, args: Args): number {
  const rateValue = num(args[2], ctx)
  const yld = num(args[3], ctx)
  const redemption = num(args[4], ctx)
  check(rateValue >= 0 && yld >= 0 && redemption > 0)
  return bondPrice(rateValue, yld, redemption, bondArgs(ctx, args, 5))
}

function yieldFn(ctx: FunctionContext, args: Args): number {
  const rateValue = num(args[2], ctx)
  const pr = num(args[3], ctx)
  const redemption = num(args[4], ctx)
  check(rateValue >= 0 && pr > 0 && redemption > 0)
  const b = bondArgs(ctx, args, 5)
  if (b.N === 1) {
    const coupon = (100 * rateValue) / b.frequency
    const dirty = pr + (b.A / b.E) * coupon
    return ((redemption + coupon - dirty) / dirty) * ((b.frequency * b.E) / b.DSC)
  }
  return securityYield((yld) => bondPrice(rateValue, yld, redemption, b), pr, b.frequency)
}

function accrint(ctx: FunctionContext, args: Args): number {
  const issue = financialDate(ctx, args[0])
  const first = financialDate(ctx, args[1])
  const settlement = financialDate(ctx, args[2])
  const method = omitted(args, 7) ? true : bool(args[7], ctx)
  const rateValue = num(args[3], ctx)
  // MS-OI29500 18.17.7.2(c) specifies Office's 0.001 default, unlike the
  // ISO standard and Support page (1000). Explicit par is unaffected.
  const par = defNum(args, 4, 0.001, ctx)
  const frequency = int(args[5], ctx)
  const basis = defInt(args, 6, 0, ctx)
  partsOf(ctx, issue)
  partsOf(ctx, settlement)
  check(rateValue > 0 && par > 0 && [1, 2, 4].includes(frequency) && basis >= 0 && basis <= 4 && issue < settlement)
  const start = !method && settlement > first ? first : issue
  return par * rateValue / frequency * couponFraction(ctx, start, settlement, first, frequency, basis)
}

/** Validate even dates that affect only a coupon schedule, not the selected interval. */
function financialDate(ctx: FunctionContext, value: Value | undefined): number {
  const serial = int(value, ctx)
  partsOf(ctx, serial)
  check(serial >= 0)
  return serial
}

function basisArg(ctx: FunctionContext, args: Args, index: number): number {
  const basis = defInt(args, index, 0, ctx)
  check(basis >= 0 && basis <= 4)
  return basis
}

/** Dates stay anchored to the original day (including end-of-month), never a clamped intermediate. */
function couponShift(ctx: FunctionContext, anchor: number, months: number): number {
  const p = partsOf(ctx, anchor)
  const total = p.year * 12 + p.month - 1 + months
  const year = Math.floor(total / 12), month = total - year * 12 + 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const eom = p.day === new Date(Date.UTC(p.year, p.month, 0)).getUTCDate()
  return dateToSerial(year, month, eom ? last : Math.min(last, p.day), ctx.date1904)
}

/** Sum Ai/NLi on the quasi-coupon grid. Actual/actual uses each period's actual length. */
function couponFraction(ctx: FunctionContext, from: number, to: number, anchor: number, frequency: number, basis: number): number {
  if (from === to) return 0
  if (from > to) return -couponFraction(ctx, to, from, anchor, frequency, basis)
  const p = partsOf(ctx, from), a = partsOf(ctx, anchor)
  const months = 12 / frequency
  let k = Math.floor(((p.year - a.year) * 12 + p.month - a.month) / months)
  while (couponShift(ctx, anchor, k * months) > from) { consumeWork(); k-- }
  let result = 0
  let previous = couponShift(ctx, anchor, k * months)
  while (previous < to) {
    consumeWork()
    const next = couponShift(ctx, anchor, ++k * months)
    const start = Math.max(previous, from), end = Math.min(next, to)
    result += dayCount(ctx, start, end, basis) / couponDays(ctx, previous, next, basis, frequency)
    previous = next
  }
  return result
}

function duration(ctx: FunctionContext, args: Args, modified: boolean): number {
  const coupon = num(args[2], ctx), yld = num(args[3], ctx)
  check(coupon >= 0 && yld >= 0)
  const b = bondArgs(ctx, args, 4)
  const maturityTime = (b.N - 1 + b.DSC / b.E) / b.frequency
  if (coupon === 0) return modified ? maturityTime / (1 + yld / b.frequency) : maturityTime
  let weighted = 0, total = 0
  for (let k = 0; k < b.N; k++) {
    consumeWork()
    const t = k + b.DSC / b.E
    // The fractional discount is common to all cash flows and cancels.
    const amount = (100 * coupon / b.frequency + (k === b.N - 1 ? 100 : 0)) / (1 + yld / b.frequency) ** k
    total += amount
    weighted += t * amount
  }
  const result = weighted / total / b.frequency
  return modified ? result / (1 + yld / b.frequency) : result
}

function discountSecurity(ctx: FunctionContext, args: Args, name: string): number {
  const [settlement, maturity] = settlementMaturity(ctx, args)
  const value = num(args[2], ctx), redemption = num(args[3], ctx)
  const basis = basisArg(ctx, args, 4)
  check(value > 0 && redemption > 0)
  const fraction = yearfrac(ctx, settlement, maturity, basis)
  if (name === 'PRICEDISC') return redemption * (1 - value * fraction)
  if (name === 'YIELDDISC') return (redemption / value - 1) / fraction
  if (name === 'DISC') return (1 - value / redemption) / fraction
  if (name === 'INTRATE') return (redemption / value - 1) / fraction
  check(redemption * fraction < 1)
  return value / (1 - redemption * fraction)
}

function maturitySecurity(ctx: FunctionContext, args: Args, yieldValue: boolean): number {
  const [settlement, maturity] = settlementMaturity(ctx, args)
  const issue = financialDate(ctx, args[2])
  const rateValue = num(args[3], ctx), value = num(args[4], ctx)
  const basis = basisArg(ctx, args, 5)
  check(issue < settlement && rateValue >= 0 && (yieldValue ? value > 0 : value >= 0))
  const DIM = yearfrac(ctx, issue, maturity, basis)
  const DSM = yearfrac(ctx, settlement, maturity, basis)
  const A = yearfrac(ctx, issue, settlement, basis)
  if (yieldValue) return ((1 + rateValue * DIM) / (value / 100 + rateValue * A) - 1) / DSM
  return 100 * ((1 + rateValue * DIM) / (1 + value * DSM) - rateValue * A)
}

/** Odd last periods use simple interest; odd first periods discount quasi-coupon cash flows. */
function oddSecurity(ctx: FunctionContext, args: Args, first: boolean, yieldValue: boolean): number {
  const [settlement, maturity] = settlementMaturity(ctx, args)
  const anchor = financialDate(ctx, args[2])
  const firstCoupon = first ? financialDate(ctx, args[3]) : 0
  const i = first ? 4 : 3
  const rateValue = num(args[i], ctx), value = num(args[i + 1], ctx), redemption = num(args[i + 2], ctx)
  const frequency = int(args[i + 3], ctx), basis = basisArg(ctx, args, i + 4)
  check([1, 2, 4].includes(frequency) && rateValue >= 0 && redemption > 0 && (yieldValue ? value > 0 : value >= 0))
  check(first ? anchor < settlement && settlement < firstCoupon && firstCoupon < maturity : anchor < settlement)
  const coupon = 100 * rateValue / frequency
  if (!first) {
    const DC = couponFraction(ctx, anchor, maturity, anchor, frequency, basis)
    const A = couponFraction(ctx, anchor, settlement, anchor, frequency, basis)
    const DSC = couponFraction(ctx, settlement, maturity, anchor, frequency, basis)
    return yieldValue ? (redemption + coupon * DC - value - coupon * A) / (value + coupon * A) * frequency / DSC
      : (redemption + coupon * DC) / (1 + value * DSC / frequency) - coupon * A
  }
  const schedule = coupons(ctx, firstCoupon, maturity, frequency)
  check(schedule.previous === firstCoupon)
  const N = schedule.count + 1
  const A = couponFraction(ctx, anchor, settlement, firstCoupon, frequency, basis)
  const DFC = couponFraction(ctx, anchor, firstCoupon, firstCoupon, frequency, basis)
  const DSC = couponFraction(ctx, settlement, firstCoupon, firstCoupon, frequency, basis)
  const calculate = (yld: number): number => {
    const q = 1 + yld / frequency
    let result = coupon * DFC / q ** DSC + redemption / q ** (N - 1 + DSC)
    for (let k = 1; k < N; k++) { consumeWork(); result += coupon / q ** (k + DSC) }
    return result - coupon * A
  }
  return yieldValue ? securityYield(calculate, value, frequency) : calculate(value)
}

function securityYield(calculate: (yld: number) => number, priceValue: number, frequency: number): number {
  let lo = -frequency + 1e-10, hi = 1
  while (calculate(hi) > priceValue) { consumeWork(); hi *= 2; check(Number.isFinite(hi)) }
  for (let k = 0; k < 200; k++) {
    consumeWork()
    const mid = (lo + hi) / 2
    if (calculate(mid) > priceValue) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

function amortization(ctx: FunctionContext, args: Args, declining: boolean): number {
  const cost = num(args[0], ctx), purchased = financialDate(ctx, args[1]), first = financialDate(ctx, args[2])
  const salvage = num(args[3], ctx), period = int(args[4], ctx), rateValue = num(args[5], ctx)
  const basis = basisArg(ctx, args, 6)
  check(cost >= 0 && salvage >= 0 && salvage < cost && period >= 0 && rateValue > 0 && purchased <= first && basis !== 2)
  const life = 1 / rateValue
  const fraction = yearfrac(ctx, purchased, first, basis)
  if (!declining) {
    const initial = cost * rateValue * fraction
    return period === 0 ? initial : Math.max(0, Math.min(cost * rateValue, cost - salvage - initial - (period - 1) * cost * rateValue))
  }
  check(life >= 3 && !(life > 4 && life < 5))
  const coefficient = life < 5 ? 1.5 : life <= 6 ? 2 : 2.5
  const r = rateValue * coefficient
  let depreciation = Math.round(cost * r * fraction), book = cost - depreciation
  if (period === 0) return depreciation
  for (let p = 1; p <= period; p++) {
    consumeWork()
    depreciation = Math.round(book * r)
    if (book - depreciation < salvage) return p === period ? Math.round(book / 2) : 0
    book -= depreciation
  }
  return depreciation
}

function dollarFraction(ctx: FunctionContext, args: Args, toDecimal: boolean): number {
  const value = num(args[0], ctx)
  const fraction = Math.trunc(num(args[1], ctx))
  check(fraction >= 0)
  if (fraction === 0) return fail(Errors.DIV0)
  const whole = Math.trunc(value)
  const part = value - whole
  const scale = 10 ** Math.ceil(Math.log10(fraction))
  return toDecimal ? whole + (part * scale) / fraction : whole + (part * fraction) / scale
}

export const FINANCIAL_FUNCTIONS: FunctionSpec[] = [
  define({ name: 'PMT', min: 3, max: 5, fn: (ctx, args) => pmt(num(args[0], ctx), num(args[1], ctx), num(args[2], ctx), defNum(args, 3, 0, ctx), typeArg(ctx, args, 4)) }),
  define({
    name: 'IPMT',
    min: 4,
    max: 6,
    fn: (ctx, args) => ipmt(num(args[0], ctx), num(args[1], ctx), num(args[2], ctx), num(args[3], ctx), defNum(args, 4, 0, ctx), typeArg(ctx, args, 5)),
  }),
  define({
    name: 'PPMT',
    min: 4,
    max: 6,
    fn: (ctx, args) => {
      const r = num(args[0], ctx)
      const per = num(args[1], ctx)
      const nper = num(args[2], ctx)
      const pvValue = num(args[3], ctx)
      const fvValue = defNum(args, 4, 0, ctx)
      const type = typeArg(ctx, args, 5)
      check(per >= 1 && per <= nper)
      return pmt(r, nper, pvValue, fvValue, type) - ipmt(r, per, nper, pvValue, fvValue, type)
    },
  }),
  ...(['CUMIPMT', 'CUMPRINC'] as const).map((name) =>
    define({
      name,
      min: 6,
      max: 6,
      fn: (ctx, args) => {
        const r = num(args[0], ctx)
        const nper = num(args[1], ctx)
        const pvValue = num(args[2], ctx)
        const start = int(args[3], ctx)
        const end = int(args[4], ctx)
        const type = num(args[5], ctx)
        check(r > 0 && nper > 0 && pvValue > 0 && start >= 1 && end >= start && end <= nper && (type === 0 || type === 1))
        check(end - start <= 1_000_000 && end < 2 ** 31)
        const payment = pmt(r, nper, pvValue, 0, type)
        let total = 0
        for (let per = start; per <= end; per++) {
          consumeWork()
          const interest = ipmt(r, per, nper, pvValue, 0, type)
          total += name === 'CUMIPMT' ? interest : payment - interest
        }
        return total
      },
    }),
  ),
  define({ name: 'FV', min: 3, max: 5, fn: (ctx, args) => fv(num(args[0], ctx), num(args[1], ctx), num(args[2], ctx), defNum(args, 3, 0, ctx), typeArg(ctx, args, 4)) }),
  define({ name: 'PV', min: 3, max: 5, fn: (ctx, args) => pv(num(args[0], ctx), num(args[1], ctx), num(args[2], ctx), defNum(args, 3, 0, ctx), typeArg(ctx, args, 4)) }),
  define({
    name: 'NPER',
    min: 3,
    max: 5,
    fn: (ctx, args) => {
      const r = num(args[0], ctx)
      const p = num(args[1], ctx)
      const pvValue = num(args[2], ctx)
      const fvValue = defNum(args, 3, 0, ctx)
      const type = typeArg(ctx, args, 4)
      if (r === 0) {
        if (p === 0) return fail(Errors.NUM)
        return -(pvValue + fvValue) / p
      }
      const a = p * (1 + r * type) - fvValue * r
      const b = p * (1 + r * type) + pvValue * r
      check(a / b > 0)
      return Math.log(a / b) / Math.log(1 + r)
    },
  }),
  define({ name: 'RATE', min: 3, max: 6, fn: rate }),
  define({
    name: 'NPV',
    min: 2,
    max: 255,
    args: ['scalar', 'any'],
    fn: (ctx, args) => npv(num(args[0], ctx), collectNumbers(ctx, args.slice(1))),
  }),
  define({
    name: 'XNPV',
    min: 3,
    max: 3,
    args: ['scalar', 'any', 'any'],
    fn: (ctx, args) => {
      const r = num(args[0], ctx)
      const { values, years } = xflows(ctx, args[1], args[2])
      // MS-OI29500 18.17.7.351 adds the Office restriction rate > 0.
      check(r > 0)
      check(years.every((y) => y >= 0))
      return xnpv(r, values, years)
    },
  }),
  define({ name: 'IRR', min: 1, max: 2, args: ['any', 'scalar'], fn: irr }),
  define({ name: 'XIRR', min: 2, max: 3, args: ['any', 'any', 'scalar'], fn: xirr }),
  define({ name: 'MIRR', min: 3, max: 3, args: ['any', 'scalar', 'scalar'], fn: mirr }),
  define({
    name: 'SLN',
    min: 3,
    max: 3,
    fn: (ctx, args) => {
      const life = num(args[2], ctx)
      if (life === 0) return fail(Errors.DIV0)
      return (num(args[0], ctx) - num(args[1], ctx)) / life
    },
  }),
  define({
    name: 'SYD',
    min: 4,
    max: 4,
    fn: (ctx, args) => {
      const cost = num(args[0], ctx)
      const salvage = num(args[1], ctx)
      const life = num(args[2], ctx)
      const per = num(args[3], ctx)
      check(life > 0 && per > 0 && per <= life)
      return ((cost - salvage) * (life - per + 1) * 2) / (life * (life + 1))
    },
  }),
  define({ name: 'DB', min: 4, max: 5, fn: db }),
  define({
    name: 'DDB',
    min: 4,
    max: 5,
    fn: (ctx, args) => {
      const cost = num(args[0], ctx)
      const salvage = num(args[1], ctx)
      const life = num(args[2], ctx)
      const period = num(args[3], ctx)
      const factor = optNum(args, 4, 2, ctx)
      check(cost >= 0 && salvage >= 0 && life > 0 && period > 0 && period <= life && factor > 0)
      return ddbPeriod(cost, salvage, life, period, factor)
    },
  }),
  define({
    name: 'VDB',
    min: 5,
    max: 7,
    fn: (ctx, args) => {
      const cost = num(args[0], ctx)
      const salvage = num(args[1], ctx)
      const life = num(args[2], ctx)
      const start = num(args[3], ctx)
      const end = num(args[4], ctx)
      const factor = optNum(args, 5, 2, ctx)
      const noSwitch = omitted(args, 6) ? false : bool(args[6], ctx)
      check(cost >= 0 && salvage >= 0 && life > 0 && start >= 0 && end >= start && end <= life && factor > 0)
      check(end <= 1_000_000)
      return vdbCumulative(cost, salvage, life, end, factor, noSwitch) - vdbCumulative(cost, salvage, life, start, factor, noSwitch)
    },
  }),
  define({
    name: 'EFFECT',
    min: 2,
    max: 2,
    fn: (ctx, args) => {
      const nominal = num(args[0], ctx)
      const n = Math.trunc(num(args[1], ctx))
      check(nominal > 0 && n >= 1)
      return (1 + nominal / n) ** n - 1
    },
  }),
  define({
    name: 'NOMINAL',
    min: 2,
    max: 2,
    fn: (ctx, args) => {
      const effect = num(args[0], ctx)
      const n = Math.trunc(num(args[1], ctx))
      check(effect > 0 && n >= 1)
      return n * ((1 + effect) ** (1 / n) - 1)
    },
  }),
  define({
    name: 'FVSCHEDULE',
    min: 2,
    max: 2,
    args: ['scalar', 'any'],
    fn: (ctx, args) => {
      let value = num(args[0], ctx)
      forEachLogical(toMatrix(ctx, args[1]), (r, count) => {
        if (isError(r)) return fail(r)
        if (r !== null && typeof r !== 'number') return fail(Errors.VALUE)
        value *= (1 + (r ?? 0)) ** count
      }, { weightedTail: true })
      return value
    },
  }),
  define({
    name: 'PDURATION',
    min: 3,
    max: 3,
    xlfn: true,
    fn: (ctx, args) => {
      const r = num(args[0], ctx)
      const pvValue = num(args[1], ctx)
      const fvValue = num(args[2], ctx)
      check(r > 0 && pvValue > 0 && fvValue > 0)
      return (Math.log(fvValue) - Math.log(pvValue)) / Math.log1p(r)
    },
  }),
  define({
    name: 'RRI',
    min: 3,
    max: 3,
    xlfn: true,
    fn: (ctx, args) => {
      const n = num(args[0], ctx)
      const pvValue = num(args[1], ctx)
      const fvValue = num(args[2], ctx)
      check(n > 0 && pvValue !== 0)
      return (fvValue / pvValue) ** (1 / n) - 1
    },
  }),
  define({
    name: 'ISPMT',
    min: 4,
    max: 4,
    fn: (ctx, args) => {
      const r = num(args[0], ctx)
      const per = num(args[1], ctx)
      const nper = num(args[2], ctx)
      const pvValue = num(args[3], ctx)
      if (nper === 0) return fail(Errors.DIV0)
      return pvValue * r * (per / nper - 1)
    },
  }),
  define({ name: 'DOLLARDE', min: 2, max: 2, fn: (ctx, args) => dollarFraction(ctx, args, true) }),
  define({ name: 'DOLLARFR', min: 2, max: 2, fn: (ctx, args) => dollarFraction(ctx, args, false) }),
  define({
    name: 'TBILLPRICE',
    min: 3,
    max: 3,
    fn: (ctx, args) => {
      const [settlement, maturity] = tbill(ctx, args)
      const discount = num(args[2], ctx)
      check(discount > 0)
      const result = 100 * (1 - (discount * (maturity - settlement)) / 360)
      check(result > 0)
      return result
    },
  }),
  define({
    name: 'TBILLYIELD',
    min: 3,
    max: 3,
    fn: (ctx, args) => {
      const [settlement, maturity] = tbill(ctx, args)
      const pr = num(args[2], ctx)
      check(pr > 0)
      return ((100 - pr) / pr) * (360 / (maturity - settlement))
    },
  }),
  define({
    name: 'TBILLEQ',
    min: 3,
    max: 3,
    fn: (ctx, args) => {
      const [settlement, maturity] = tbill(ctx, args)
      const discount = num(args[2], ctx)
      check(discount > 0)
      const dsm = maturity - settlement
      // Microsoft Support publishes this equation for the entire accepted term.
      // Calc uses a different long-bill/day-count convention; see the oracle fixture.
      return (365 * discount) / (360 - discount * dsm)
    },
  }),
  define({ name: 'PRICE', min: 6, max: 7, fn: price }),
  define({ name: 'YIELD', min: 6, max: 7, fn: yieldFn }),
  define({ name: 'ACCRINT', min: 6, max: 8, fn: accrint }),
  ...(['COUPDAYBS', 'COUPDAYS', 'COUPDAYSNC', 'COUPNCD', 'COUPNUM', 'COUPPCD'] as const).map((name) => define({
    name, min: 3, max: 4, fn: (ctx, args) => {
      const b = bondArgs(ctx, args, 2)
      return ({ COUPDAYBS: b.A, COUPDAYS: b.E, COUPDAYSNC: b.DSC, COUPNCD: b.next, COUPNUM: b.N, COUPPCD: b.previous })[name]
    },
  })),
  define({ name: 'DURATION', min: 5, max: 6, fn: (ctx, args) => duration(ctx, args, false) }),
  define({ name: 'MDURATION', min: 5, max: 6, fn: (ctx, args) => duration(ctx, args, true) }),
  ...(['PRICEDISC', 'YIELDDISC', 'DISC', 'INTRATE', 'RECEIVED'] as const).map((name) => define({ name, min: 4, max: 5, fn: (ctx, args) => discountSecurity(ctx, args, name) })),
  define({ name: 'PRICEMAT', min: 5, max: 6, fn: (ctx, args) => maturitySecurity(ctx, args, false) }),
  define({ name: 'YIELDMAT', min: 5, max: 6, fn: (ctx, args) => maturitySecurity(ctx, args, true) }),
  define({ name: 'ACCRINTM', min: 3, max: 5, fn: (ctx, args) => {
    const [issue, settlement] = settlementMaturity(ctx, args)
    const rateValue = num(args[2], ctx), par = defNum(args, 3, 0.001, ctx), basis = basisArg(ctx, args, 4)
    check(rateValue > 0 && par > 0)
    return par * rateValue * yearfrac(ctx, issue, settlement, basis)
  } }),
  ...(['ODDFPRICE', 'ODDFYIELD', 'ODDLPRICE', 'ODDLYIELD'] as const).map((name) => define({
    name, min: name.startsWith('ODDF') ? 8 : 7, max: name.startsWith('ODDF') ? 9 : 8,
    fn: (ctx, args) => oddSecurity(ctx, args, name.startsWith('ODDF'), name.endsWith('YIELD')),
  })),
  define({ name: 'AMORLINC', min: 6, max: 7, fn: (ctx, args) => amortization(ctx, args, false) }),
  define({ name: 'AMORDEGRC', min: 6, max: 7, fn: (ctx, args) => amortization(ctx, args, true) }),

]
