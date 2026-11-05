import { formatValue, numberToText, roundNumber } from '../../numfmt/index.js'
import { parseNumberDetailed, parseNumberText } from '../../numfmt/parse.js'
import { Errors, type FormulaError, type FunctionSpec, isError, type Scalar, type Value } from '../types.js'

/**
 * Functions that turn numbers into formatted text and text back into numbers: TEXT, VALUE,
 * NUMBERVALUE, DATEVALUE, TIMEVALUE, DOLLAR, FIXED, VALUETOTEXT. Arguments are scalars (the
 * evaluator lifts arrays); an error argument is returned as is, except by VALUETOTEXT.
 */

/** Excel's limit on DOLLAR/FIXED decimals. */
const MAX_DECIMALS = 127

function scalar(value: Value | undefined): Scalar | undefined {
  if (value === undefined || value === null) return value
  return typeof value === 'object' && !isError(value) ? Errors.VALUE : value
}

function toNumber(value: Value | undefined, date1904 = false): number | FormulaError {
  const v = scalar(value)
  if (v === undefined || v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (isError(v)) return v
  return parseNumberText(v, { date1904 }) ?? Errors.VALUE
}

function toText(value: Value | undefined): string | FormulaError {
  const v = scalar(value)
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return numberToText(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return v
}

function toBoolean(value: Value | undefined): boolean | FormulaError {
  const v = scalar(value)
  if (v === undefined || v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (isError(v)) return v
  const upper = v.trim().toUpperCase()
  if (upper === 'TRUE' || upper === 'FALSE') return upper === 'TRUE'
  return Errors.VALUE
}

/** Decimals for DOLLAR/FIXED: truncated toward zero, at most 127. */
function toDecimals(value: Value | undefined, fallback: number): number | FormulaError {
  if (value === undefined) return fallback
  const n = toNumber(value)
  if (isError(n)) return n
  const decimals = Math.trunc(n)
  return decimals > MAX_DECIMALS ? Errors.VALUE : Math.max(decimals, -308)
}

function TEXT(ctx: { date1904: boolean }, args: (Value | undefined)[]): Value {
  const raw = scalar(args[0])
  if (isError(raw)) return raw
  const code = toText(args[1])
  if (isError(code)) return code
  let value: Scalar = raw ?? 0
  if (typeof value === 'string') value = parseNumberText(value, { date1904: ctx.date1904 }) ?? value
  if (code === '') return ''
  if (typeof value === 'number' && code === '@') return numberToText(value)
  const result = formatValue(value, code, { date1904: ctx.date1904 })
  if (result.formatError || result.overflow) return Errors.VALUE
  return result.text
}

function VALUE(ctx: { date1904: boolean }, args: (Value | undefined)[]): Value {
  const v = scalar(args[0])
  if (v === undefined || v === null) return 0
  if (typeof v === 'number' || isError(v)) return v
  if (typeof v === 'boolean') return Errors.VALUE
  return parseNumberText(v, { date1904: ctx.date1904 }) ?? Errors.VALUE
}

/** First character of a separator argument, or #VALUE! for an empty one. */
function separator(value: Value | undefined, fallback: string): string | FormulaError {
  if (value === undefined) return fallback
  const text = toText(value)
  if (isError(text)) return text
  return text ? text[0]! : Errors.VALUE
}

function NUMBERVALUE(_ctx: unknown, args: (Value | undefined)[]): Value {
  const v = scalar(args[0])
  if (isError(v)) return v
  if (typeof v === 'boolean') return Errors.VALUE
  let decimal = separator(args[1], '.')
  if (isError(decimal)) return decimal
  let group = separator(args[2], ',')
  if (isError(group)) return group
  // A defaulted separator gives way to an explicit one (NUMBERVALUE("1,5", ",") is 1.5).
  if (decimal === group && args[2] === undefined) group = decimal === '.' ? ',' : '.'
  else if (decimal === group && args[1] === undefined) decimal = group === ',' ? '.' : ','
  if (decimal === group) return Errors.VALUE
  if (typeof v === 'number') return v
  // Spaces are ignored anywhere, group separators before the decimal one, and each trailing %
  // divides by 100.
  let text = (v ?? '').replace(/\s+/g, '')
  if (!text) return 0
  let percents = 0
  while (text.endsWith('%')) {
    text = text.slice(0, -1)
    percents++
  }
  const pieces = text.split(decimal)
  if (pieces.length > 2) return Errors.VALUE
  const [intPart = '', fracPart] = pieces
  if (fracPart?.includes(group)) return Errors.VALUE
  const normalized = intPart.split(group).join('') + (fracPart === undefined ? '' : '.' + fracPart)
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return Errors.VALUE
  const value = Number(normalized) / 100 ** percents
  return Number.isFinite(value) ? value : Errors.NUM
}

function DATEVALUE(ctx: { date1904: boolean }, args: (Value | undefined)[]): Value {
  const v = scalar(args[0])
  if (isError(v)) return v
  if (typeof v !== 'string') return Errors.VALUE
  const parsed = parseNumberDetailed(v, { date1904: ctx.date1904 })
  if (!parsed || (parsed.kind !== 'date' && parsed.kind !== 'datetime')) return Errors.VALUE
  return Math.floor(parsed.value)
}

function TIMEVALUE(ctx: { date1904: boolean }, args: (Value | undefined)[]): Value {
  const v = scalar(args[0])
  if (isError(v)) return v
  if (typeof v !== 'string') return Errors.VALUE
  const parsed = parseNumberDetailed(v, { date1904: ctx.date1904 })
  if (!parsed || (parsed.kind !== 'time' && parsed.kind !== 'datetime' && parsed.kind !== 'date')) return Errors.VALUE
  return parsed.value - Math.floor(parsed.value)
}

/** `#,##0.00`-style code with `decimals` zeros. */
function numberCode(decimals: number, grouping: boolean): string {
  return (grouping ? '#,##0' : '0') + (decimals > 0 ? '.' + '0'.repeat(decimals) : '')
}

function DOLLAR(ctx: { date1904: boolean }, args: (Value | undefined)[]): Value {
  const n = toNumber(args[0], ctx.date1904)
  if (isError(n)) return n
  const decimals = toDecimals(args[1], 2)
  if (isError(decimals)) return decimals
  const code = `"$"${numberCode(decimals, true)}`
  return formatValue(roundNumber(n, decimals), `${code};(${code})`).text
}

function FIXED(ctx: { date1904: boolean }, args: (Value | undefined)[]): Value {
  const n = toNumber(args[0], ctx.date1904)
  if (isError(n)) return n
  const decimals = toDecimals(args[1], 2)
  if (isError(decimals)) return decimals
  const noCommas = toBoolean(args[2])
  if (isError(noCommas)) return noCommas
  return formatValue(roundNumber(n, decimals), numberCode(decimals, !noCommas)).text
}

function VALUETOTEXT(_ctx: unknown, args: (Value | undefined)[]): Value {
  const format = args[1] === undefined ? 0 : toNumber(args[1])
  if (isError(format)) return format
  const strict = Math.trunc(format)
  if (strict !== 0 && strict !== 1) return Errors.VALUE
  const v = scalar(args[0])
  if (v === undefined || v === null) return ''
  if (isError(v)) return v.code
  if (typeof v === 'string') return strict ? `"${v.replace(/"/g, '""')}"` : v
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return numberToText(v)
}

export const TEXT_FORMAT_FUNCTIONS: FunctionSpec[] = [
  { name: 'TEXT', minArgs: 2, maxArgs: 2, fn: TEXT },
  { name: 'VALUE', minArgs: 1, maxArgs: 1, fn: VALUE },
  { name: 'NUMBERVALUE', minArgs: 1, maxArgs: 3, xlfn: true, fn: NUMBERVALUE },
  { name: 'DATEVALUE', minArgs: 1, maxArgs: 1, fn: DATEVALUE },
  { name: 'TIMEVALUE', minArgs: 1, maxArgs: 1, fn: TIMEVALUE },
  { name: 'DOLLAR', minArgs: 1, maxArgs: 2, fn: DOLLAR },
  { name: 'FIXED', minArgs: 1, maxArgs: 3, fn: FIXED },
  { name: 'VALUETOTEXT', minArgs: 1, maxArgs: 2, xlfn: true, fn: VALUETOTEXT },
]
