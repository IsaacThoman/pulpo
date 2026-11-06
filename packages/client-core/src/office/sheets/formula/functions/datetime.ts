/**
 * Date and time functions. Dates are serials in the workbook's date system (`ctx.date1904`); the
 * 1900 system keeps Excel's fake 1900-02-29 (serial 60), so DATE(1900,2,29) is 60 and weekdays
 * before March 1900 follow Excel rather than the real calendar.
 */

import { dateToSerial, serialToParts, type DateParts } from '../../dates.js'
import { Errors, isError, type FunctionContext, type FunctionSpec, type Value } from '../types.js'
import { bool, check, defInt, define, fail, int, num, omitted, optInt, text, toMatrix, type Args } from './coerce.js'

/** Calendar parts of a serial; negative or out-of-range serials are #NUM!. */
export function partsOf(ctx: FunctionContext, serial: number): DateParts {
  const parts = serialToParts(serial, ctx.date1904)
  return parts ?? fail(Errors.NUM)
}

/** A date argument as a whole-day serial (text dates parse; negatives are #NUM!). */
function dateArg(ctx: FunctionContext, value: Value | undefined): number {
  const serial = Math.floor(num(value, ctx))
  check(serial >= 0)
  partsOf(ctx, serial)
  return serial
}

/**
 * Excel's DATE: years 0–1899 are offsets from 1900, months and days overflow into neighbouring
 * months and years, and day offsets count from the 1st, which is what lands DATE(1900,2,29) on 60.
 */
export function excelDate(ctx: FunctionContext, year: number, month: number, day: number): number {
  check(year >= 0 && year < 10000)
  if (year < 1900) year += 1900
  const totalMonths = year * 12 + (month - 1)
  const y = Math.floor(totalMonths / 12)
  const m = totalMonths - y * 12 + 1
  check(y >= 0 && y < 10000)
  const serial = dateToSerial(y, m, 1, ctx.date1904) + day - 1
  check(serial >= 0 && serial <= (ctx.date1904 ? 2_957_003 : 2_958_465))
  return serial
}

/** Weekday of a whole-day serial, 0 = Sunday, following Excel in the 1900 system. */
export function weekdayOf(ctx: FunctionContext, serial: number): number {
  if (ctx.date1904) return (((serial + 5) % 7) + 7) % 7
  return (((serial - 1) % 7) + 7) % 7
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function timeParts(serial: number): { hours: number; minutes: number; seconds: number } {
  check(serial >= 0)
  const fraction = serial - Math.floor(serial)
  const total = Math.round(fraction * 86_400) % 86_400
  return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 }
}

function addMonths(ctx: FunctionContext, args: Args, endOfMonth: boolean): number {
  const start = dateArg(ctx, args[0])
  const months = int(args[1], ctx)
  const p = partsOf(ctx, start)
  // Serial 0 ("1900-01-00") and the fake leap day still move by whole months.
  const year = p.year
  const month = p.month + months
  const total = year * 12 + (month - 1)
  const y = Math.floor(total / 12)
  const m = total - y * 12 + 1
  check(y >= (ctx.date1904 ? 1904 : 1900) && y <= 9999)
  const last = daysInMonth(y, m)
  const day = endOfMonth ? last : Math.min(p.day === 0 ? 1 : p.day, last)
  const serial = dateToSerial(y, m, day, ctx.date1904)
  check(serial >= 0)
  return serial
}

const WEEKDAY_OFFSETS: Record<number, [number, number]> = {
  // return type → [weekday (0 = Sunday) that maps to the first value, first value]
  1: [0, 1],
  2: [1, 1],
  3: [1, 0],
  11: [1, 1],
  12: [2, 1],
  13: [3, 1],
  14: [4, 1],
  15: [5, 1],
  16: [6, 1],
  17: [0, 1],
}

function weekday(ctx: FunctionContext, args: Args): number {
  const serial = dateArg(ctx, args[0])
  const type = optInt(args, 1, 1, ctx)
  const spec = WEEKDAY_OFFSETS[type]
  if (!spec) return fail(Errors.NUM)
  const wd = weekdayOf(ctx, serial)
  return ((wd - spec[0] + 7) % 7) + spec[1]
}

function isoWeek(ctx: FunctionContext, serial: number): number {
  const p = partsOf(ctx, serial)
  const date = new Date(Date.UTC(p.year, p.month - 1, Math.max(p.day, 1)))
  // The ISO week is the week of this week's Thursday, counted from that year's first Thursday.
  const mondayBased = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - mondayBased + 3)
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1)
  return 1 + Math.floor((date.getTime() - yearStart) / 86_400_000 / 7)
}

const WEEKNUM_START: Record<number, number> = { 1: 0, 2: 1, 11: 1, 12: 2, 13: 3, 14: 4, 15: 5, 16: 6, 17: 0 }

function weeknum(ctx: FunctionContext, args: Args): number {
  const serial = dateArg(ctx, args[0])
  const type = optInt(args, 1, 1, ctx)
  if (type === 21) return isoWeek(ctx, serial)
  const start = WEEKNUM_START[type]
  if (start === undefined) return fail(Errors.NUM)
  const p = partsOf(ctx, serial)
  const jan1 = excelDate(ctx, p.year, 1, 1)
  const offset = (weekdayOf(ctx, jan1) - start + 7) % 7
  return Math.floor((serial - jan1 + offset) / 7) + 1
}

// ---------------------------------------------------------------------------------------------
// Working days

/** Weekend mask indexed by weekday (0 = Sunday). */
function weekendMask(ctx: FunctionContext, value: Value | undefined, present: boolean): boolean[] {
  const mask = [false, false, false, false, false, false, false]
  if (!present) {
    mask[0] = mask[6] = true
    return mask
  }
  const v = toMatrix(ctx, value).data[0] ?? null
  if (isError(v)) return fail(v)
  if (typeof v === 'string') {
    // Text is always a Monday-first mask of seven 0/1 characters.
    if (!/^[01]{7}$/.test(v) || v === '1111111') return fail(Errors.VALUE)
    // Monday first.
    for (let i = 0; i < 7; i++) mask[(i + 1) % 7] = v[i] === '1'
    return mask
  }
  const code = v === null ? 1 : int(v, ctx)
  if (code >= 1 && code <= 7) {
    // 1 = Sat/Sun, 2 = Sun/Mon, …, 7 = Fri/Sat.
    mask[(code + 5) % 7] = true
    mask[(code + 6) % 7] = true
    return mask
  }
  if (code >= 11 && code <= 17) {
    mask[(code - 11) % 7] = true
    return mask
  }
  return fail(Errors.NUM)
}

function holidaySet(ctx: FunctionContext, value: Value | undefined): Set<number> {
  const out = new Set<number>()
  if (value === undefined) return out
  for (const v of toMatrix(ctx, value).data) {
    if (v === null) continue
    if (isError(v)) fail(v)
    const n = typeof v === 'number' ? v : num(v, ctx)
    check(n >= 0)
    out.add(Math.floor(n))
  }
  return out
}

function workday(ctx: FunctionContext, args: Args, intl: boolean): number {
  const start = dateArg(ctx, args[0])
  const days = int(args[1], ctx)
  const mask = intl ? weekendMask(ctx, args[2], !omitted(args, 2)) : weekendMask(ctx, undefined, false)
  const holidays = holidaySet(ctx, intl ? args[3] : args[2])
  if (mask.every(Boolean)) return fail(Errors.VALUE)
  // More working days than there are days in Excel's calendar can only land outside it.
  check(Math.abs(days) <= 3_000_000)
  let serial = start
  let remaining = Math.abs(days)
  const step = days < 0 ? -1 : 1
  while (remaining > 0) {
    serial += step
    check(serial >= 0)
    if (mask[weekdayOf(ctx, serial)] || holidays.has(serial)) continue
    remaining--
  }
  partsOf(ctx, serial)
  return serial
}

function networkdays(ctx: FunctionContext, args: Args, intl: boolean): number {
  const start = dateArg(ctx, args[0])
  const end = dateArg(ctx, args[1])
  const mask = intl ? weekendMask(ctx, args[2], !omitted(args, 2)) : weekendMask(ctx, undefined, false)
  const holidays = holidaySet(ctx, intl ? args[3] : args[2])
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  let count = 0
  for (let s = lo; s <= hi; s++) if (!mask[weekdayOf(ctx, s)] && !holidays.has(s)) count++
  return start <= end ? count : -count
}

// ---------------------------------------------------------------------------------------------
// Day counts

interface Ymd {
  y: number
  m: number
  d: number
}

function ymd(ctx: FunctionContext, serial: number): Ymd {
  const p = partsOf(ctx, serial)
  return { y: p.year, m: p.month, d: p.day }
}

function isLastDayOfFeb(date: Ymd): boolean {
  return date.m === 2 && date.d >= (isLeap(date.y) ? 29 : 28)
}

/** DAYS360: Excel's US method (FALSE) or the European method (TRUE). */
export function days360(start: Ymd, end: Ymd, european: boolean): number {
  let d1 = start.d
  let d2 = end.d
  if (european) {
    if (d1 === 31) d1 = 30
    if (d2 === 31) d2 = 30
  } else {
    if (isLastDayOfFeb(start)) d1 = 30
    if (d1 === 31) d1 = 30
    if (d2 === 31 && d1 >= 30) d2 = 30
  }
  return (end.y - start.y) * 360 + (end.m - start.m) * 30 + (d2 - d1)
}

/** YEARFRAC's 30/360 US (NASD) day count as Excel implements it. */
function days360Nasd(start: Ymd, end: Ymd): number {
  let d1 = start.d
  let d2 = end.d
  if (d1 === 31 && d2 === 31) {
    d1 = 30
    d2 = 30
  } else if (d1 === 31) d1 = 30
  else if (d1 === 30 && d2 === 31) d2 = 30
  else if (isLastDayOfFeb(start) && isLastDayOfFeb(end)) {
    d1 = 30
    d2 = 30
  } else if (isLastDayOfFeb(start)) d1 = 30
  return (end.y - start.y) * 360 + (end.m - start.m) * 30 + (d2 - d1)
}

function feb29Between(start: Ymd, end: Ymd, startSerial: number, endSerial: number, ctx: FunctionContext): boolean {
  for (let y = start.y; y <= end.y; y++) {
    if (!isLeap(y)) continue
    const feb29 = dateToSerial(y, 2, 29, ctx.date1904)
    if (feb29 >= startSerial && feb29 <= endSerial) return true
  }
  return false
}

export function yearfrac(ctx: FunctionContext, startSerial: number, endSerial: number, basis: number): number {
  if (startSerial > endSerial) [startSerial, endSerial] = [endSerial, startSerial]
  const start = ymd(ctx, startSerial)
  const end = ymd(ctx, endSerial)
  switch (basis) {
    case 0:
      return days360Nasd(start, end) / 360
    case 1: {
      const days = endSerial - startSerial
      const withinYear = end.y === start.y || (end.y === start.y + 1 && (start.m > end.m || (start.m === end.m && start.d >= end.d)))
      if (withinYear) {
        let denominator = 365
        if (start.y === end.y && isLeap(start.y)) denominator = 366
        else if (feb29Between(start, end, startSerial, endSerial, ctx) || (end.m === 2 && end.d === 29)) denominator = 366
        return days / denominator
      }
      const first = dateToSerial(start.y, 1, 1, ctx.date1904)
      const last = dateToSerial(end.y + 1, 1, 1, ctx.date1904)
      return days / ((last - first) / (end.y - start.y + 1))
    }
    case 2:
      return (endSerial - startSerial) / 360
    case 3:
      return (endSerial - startSerial) / 365
    case 4:
      return days360(start, end, true) / 360
    default:
      return fail(Errors.NUM)
  }
}

function datedif(ctx: FunctionContext, args: Args): number {
  const startSerial = dateArg(ctx, args[0])
  const endSerial = dateArg(ctx, args[1])
  const unit = text(args[2], ctx).toUpperCase()
  check(startSerial <= endSerial)
  const s = ymd(ctx, startSerial)
  const e = ymd(ctx, endSerial)
  let months = (e.y - s.y) * 12 + (e.m - s.m)
  if (e.d < s.d) months--
  switch (unit) {
    case 'D':
      return endSerial - startSerial
    case 'M':
      return months
    case 'Y':
      return Math.floor(months / 12)
    case 'YM':
      return months % 12
    case 'MD': {
      if (e.d >= s.d) return e.d - s.d
      const prevMonth = e.m === 1 ? 12 : e.m - 1
      const prevYear = e.m === 1 ? e.y - 1 : e.y
      return daysInMonth(prevYear, prevMonth) - s.d + e.d
    }
    case 'YD': {
      let anniversary = dateToSerial(e.y, s.m, Math.min(s.d, daysInMonth(e.y, s.m)), ctx.date1904)
      if (anniversary > endSerial) anniversary = dateToSerial(e.y - 1, s.m, Math.min(s.d, daysInMonth(e.y - 1, s.m)), ctx.date1904)
      return endSerial - anniversary
    }
    default:
      return fail(Errors.NUM)
  }
}

export const DATETIME_FUNCTIONS: FunctionSpec[] = [
  define({
    name: 'DATE',
    min: 3,
    max: 3,
    fn: (ctx, args) => excelDate(ctx, int(args[0], ctx), int(args[1], ctx), int(args[2], ctx)),
  }),
  define({ name: 'DATEDIF', min: 3, max: 3, fn: datedif }),
  define({ name: 'DAY', min: 1, max: 1, fn: (ctx, args) => partsOf(ctx, Math.floor(num(args[0], ctx))).day }),
  define({ name: 'MONTH', min: 1, max: 1, fn: (ctx, args) => partsOf(ctx, Math.floor(num(args[0], ctx))).month }),
  define({ name: 'YEAR', min: 1, max: 1, fn: (ctx, args) => partsOf(ctx, Math.floor(num(args[0], ctx))).year }),
  define({ name: 'HOUR', min: 1, max: 1, fn: (ctx, args) => timeParts(num(args[0], ctx)).hours }),
  define({ name: 'MINUTE', min: 1, max: 1, fn: (ctx, args) => timeParts(num(args[0], ctx)).minutes }),
  define({ name: 'SECOND', min: 1, max: 1, fn: (ctx, args) => timeParts(num(args[0], ctx)).seconds }),
  define({
    name: 'TIME',
    min: 3,
    max: 3,
    fn: (ctx, args) => {
      const h = int(args[0], ctx)
      const m = int(args[1], ctx)
      const s = int(args[2], ctx)
      check(h < 32768 && m < 32768 && s < 32768)
      const total = h * 3600 + m * 60 + s
      check(total >= 0)
      return (total % 86_400) / 86_400
    },
  }),
  define({ name: 'NOW', min: 0, max: 0, volatile: true, fn: (ctx) => ctx.now() }),
  define({ name: 'TODAY', min: 0, max: 0, volatile: true, fn: (ctx) => Math.floor(ctx.now()) }),
  define({ name: 'DAYS', min: 2, max: 2, xlfn: true, fn: (ctx, args) => dateArg(ctx, args[0]) - dateArg(ctx, args[1]) }),
  define({
    name: 'DAYS360',
    min: 2,
    max: 3,
    fn: (ctx, args) => days360(ymd(ctx, dateArg(ctx, args[0])), ymd(ctx, dateArg(ctx, args[1])), args.length > 2 ? bool(args[2], ctx) : false),
  }),
  define({ name: 'EDATE', min: 2, max: 2, fn: (ctx, args) => addMonths(ctx, args, false) }),
  define({ name: 'EOMONTH', min: 2, max: 2, fn: (ctx, args) => addMonths(ctx, args, true) }),
  define({ name: 'WEEKDAY', min: 1, max: 2, fn: weekday }),
  define({ name: 'WEEKNUM', min: 1, max: 2, fn: weeknum }),
  define({ name: 'ISOWEEKNUM', min: 1, max: 1, xlfn: true, fn: (ctx, args) => isoWeek(ctx, dateArg(ctx, args[0])) }),
  define({ name: 'WORKDAY', min: 2, max: 3, args: ['scalar', 'scalar', 'any'], fn: (ctx, args) => workday(ctx, args, false) }),
  define({ name: 'WORKDAY.INTL', min: 2, max: 4, args: ['scalar', 'scalar', 'scalar', 'any'], xlfn: true, fn: (ctx, args) => workday(ctx, args, true) }),
  define({ name: 'NETWORKDAYS', min: 2, max: 3, args: ['scalar', 'scalar', 'any'], fn: (ctx, args) => networkdays(ctx, args, false) }),
  define({ name: 'NETWORKDAYS.INTL', min: 2, max: 4, args: ['scalar', 'scalar', 'scalar', 'any'], xlfn: true, fn: (ctx, args) => networkdays(ctx, args, true) }),
  define({
    name: 'YEARFRAC',
    min: 2,
    max: 3,
    fn: (ctx, args) => {
      const basis = defInt(args, 2, 0, ctx)
      check(basis >= 0 && basis <= 4)
      return yearfrac(ctx, dateArg(ctx, args[0]), dateArg(ctx, args[1]), basis)
    },
  }),
]
