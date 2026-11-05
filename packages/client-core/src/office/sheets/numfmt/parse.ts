import { dateToSerial, liveCurrentYear, MAX_DATE_SERIAL_1900, MAX_DATE_SERIAL_1904 } from '../dates.js'
import { errorFromCode, type Scalar } from '../formula/types.js'

/**
 * Reading numbers out of text the way an en-US Excel does, both for typing into a cell and for
 * coercing text in formulas (arithmetic, VALUE, comparisons).
 *
 * Accepted forms, with optional surrounding spaces:
 * - Numbers: `12`, `-12`, `+12`, `1.5`, `.5`, `1.`, `1,234,567.89` (groups of three after the
 *   first), `1e3`, `1.5E-3`. Digits past the 15th significant one are dropped, as Excel does.
 * - Negatives in parentheses: `(12)`, `($1,234.50)`.
 * - Currency: `$12`, `-$12`, `$-12`.
 * - Percent: `50%`, `50 %`, `%50`, `12.5%`.
 * - Mixed fractions: `1 1/2`, `-2 3/4` (a bare `1/2` is a date, as in Excel).
 * - Dates: `1/31/2024`, `1-31-2024`, `1/31/24`, `2024-01-31`, `2024/1/31`, `1/31` (this year),
 *   `1/2024` and `1/32` (first of the month), `31-Jan-2024`, `31 Jan 2024`, `31-Jan` (this year),
 *   `Jan 31, 2024`, `January 31 2024`, `Jan-31-2024`, `Jan 31` (this year), `January 2024`,
 *   `Jan-24` (24 January this year; numbers past the month's length are years: `Jan-32` is 1932).
 *   Month names are full or three letters (`Sept` too). Two-digit years 00–29 are 2000–2029 and
 *   30–99 are 1930–1999. Years before 1900 (1904 in the 1904 system) are not dates.
 * - Times: `13:45`, `13:45:30`, `13:45:30.5`, `1:45 PM`, `1:45:30 pm`, `1 PM`, `1:45p`, `25:30`
 *   (elapsed hours, no date), `45:30.5` (minutes:seconds when there are decimals and one colon).
 * - A date followed by a time: `1/31/2024 13:45`, `2024-01-31 1:45 PM`.
 */

export interface ParseOptions {
  date1904?: boolean
  /** The year used for dates typed without one (`1/31`, `Jan 31`). Defaults to the current year. */
  currentYear?: number
}

export type ParsedKind = 'number' | 'percent' | 'currency' | 'scientific' | 'fraction' | 'date' | 'time' | 'datetime'

export interface ParsedNumber {
  value: number
  kind: ParsedKind
  /** The format Excel applies when this is typed into a General cell; undefined keeps General. */
  numFmt?: string
}

/**
 * Converts text to a number the way Excel coerces text in arithmetic and VALUE(): `1,234.5`,
 * `50%`, `$1,000`, `(12)`, `1e3`, dates (`2024-01-31`, `1/31/2024`), and times (`3:30 PM`).
 * Undefined when Excel would give #VALUE!.
 */
export function parseNumberText(text: string, options: ParseOptions = {}): number | undefined {
  return parseNumberDetailed(text, options)?.value
}

/**
 * What typing `text` into a cell stores: a number (with the format Excel would apply, e.g. `0%`
 * for `50%` or a date format for `1/31/2024`), a boolean, an error literal, or the text itself.
 */
export function parseInput(text: string, options: ParseOptions = {}): { value: Scalar; numFmt?: string } {
  if (text === '') return { value: null }
  if (text.startsWith("'")) return { value: text.slice(1) }
  const trimmed = text.trim()
  const upper = trimmed.toUpperCase()
  if (upper === 'TRUE' || upper === 'FALSE') return { value: upper === 'TRUE' }
  const error = trimmed.startsWith('#') ? errorFromCode(trimmed) : undefined
  if (error) return { value: error }
  const parsed = parseNumberDetailed(trimmed, options)
  if (!parsed) return { value: text }
  return parsed.numFmt ? { value: parsed.value, numFmt: parsed.numFmt } : { value: parsed.value }
}

/** `parseNumberText` with what kind of number the text was and the format typing it applies. */
export function parseNumberDetailed(text: string, options: ParseOptions = {}): ParsedNumber | undefined {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 255) return undefined
  return parsePlainNumber(trimmed) ?? parseFraction(trimmed) ?? parseDateTime(trimmed.replace(/\s+/g, ' '), options)
}

const NUMBER_BODY = /^(?:(\d{1,3}(?:,\d{3})+)|(\d*))(\.\d*)?(?:[eE]([+-]?\d+))?$/

function parsePlainNumber(text: string): ParsedNumber | undefined {
  let rest = text
  let negative = false
  if (rest.startsWith('(') && rest.endsWith(')')) {
    negative = true
    rest = rest.slice(1, -1).trim()
  }
  let currency = false
  let percent = false
  let signed = negative
  const takeSign = () => {
    if (!signed && (rest[0] === '-' || rest[0] === '+')) {
      negative = rest[0] === '-'
      signed = true
      rest = rest.slice(1)
    }
  }
  takeSign()
  if (rest[0] === '$') {
    currency = true
    rest = rest.slice(1)
    takeSign()
  }
  if (rest[0] === '%') {
    percent = true
    rest = rest.slice(1).trimStart()
  } else if (rest.endsWith('%')) {
    percent = true
    rest = rest.slice(0, -1).trimEnd()
  }
  if (currency && percent) return undefined
  const match = NUMBER_BODY.exec(rest)
  if (!match) return undefined
  const [, grouped, plain, fraction = '', exponent] = match
  const intDigits = grouped ? grouped.replace(/,/g, '') : plain!
  if (!intDigits && fraction.length < 2) return undefined
  let value = truncateTo15Digits(intDigits || '0', fraction.slice(1), exponent ? Number(exponent) : 0)
  if (!Number.isFinite(value)) return undefined
  if (percent) value /= 100
  if (negative) value = -value
  const decimals = fraction.length > 1
  if (percent) return { value, kind: 'percent', numFmt: decimals ? '0.00%' : '0%' }
  if (currency) return { value, kind: 'currency', numFmt: decimals ? '"$"#,##0.00' : '"$"#,##0' }
  if (exponent !== undefined) return { value, kind: 'scientific', numFmt: '0.00E+00' }
  if (grouped) return { value, kind: 'number', numFmt: decimals ? '#,##0.00' : '#,##0' }
  return { value, kind: 'number' }
}

/** Excel keeps 15 significant digits of what is typed and drops (not rounds) the rest. */
function truncateTo15Digits(int: string, fraction: string, exponent: number): number {
  const digits = (int + fraction).replace(/^0+/, '')
  if (digits.length <= 15) return Number(`${int}.${fraction || '0'}e${exponent}`)
  const leadingZeros = (int + fraction).length - digits.length
  const pointAt = int.length - leadingZeros
  const kept = digits.slice(0, 15)
  return Number(`${kept}e${exponent + pointAt - 15}`)
}

function parseFraction(text: string): ParsedNumber | undefined {
  const match = /^([+-]?)(\d+) (\d+)\/(\d+)$/.exec(text)
  if (!match) return undefined
  const [, sign, whole, numerator, denominator] = match
  const den = Number(denominator)
  if (!den || Number(numerator) >= den) return undefined
  const value = Number(whole) + Number(numerator) / den
  return { value: sign === '-' ? -value : value, kind: 'fraction', numFmt: denominator!.length > 1 ? '# ??/??' : '# ?/?' }
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

function monthFromName(name: string): number | undefined {
  const lower = name.toLowerCase().replace(/\.$/, '')
  if (lower === 'sept') return 9
  const index = MONTH_NAMES.findIndex((month) => month === lower || (lower.length === 3 && month.startsWith(lower)))
  return index < 0 ? undefined : index + 1
}

interface DatePart {
  serial: number
  numFmt: string
}

interface TimePart {
  fraction: number
  numFmt: string
  /** Over 24 hours: only valid on its own. */
  elapsed: boolean
}

function parseDateTime(text: string, options: ParseOptions): ParsedNumber | undefined {
  const time = parseTime(text)
  if (time) return { value: time.fraction, kind: 'time', numFmt: time.numFmt }
  // Split a trailing time off at the first word with a colon, or a trailing `3 PM`.
  const words = text.split(' ')
  let split = words.findIndex((word) => word.includes(':'))
  if (split < 0 && words.length > 2 && /^[ap]m?$/i.test(words[words.length - 1]!)) split = words.length - 2
  if (split < 0 && words.length > 1 && /^\d{1,2}[ap]m?$/i.test(words[words.length - 1]!)) split = words.length - 1
  if (split <= 0) {
    const date = parseDate(text, options)
    return date && { value: date.serial, kind: 'date', numFmt: date.numFmt }
  }
  const date = parseDate(words.slice(0, split).join(' '), options)
  const clock = parseTime(words.slice(split).join(' '))
  if (!date || !clock || clock.elapsed) return undefined
  return { value: date.serial + clock.fraction, kind: 'datetime', numFmt: 'm/d/yyyy h:mm' }
}

function parseTime(text: string): TimePart | undefined {
  const minutesSeconds = /^(\d{1,4}):(\d{1,2}\.\d*)$/.exec(text)
  if (minutesSeconds) {
    const seconds = Number(minutesSeconds[2])
    if (seconds >= 60) return undefined
    return { fraction: (Number(minutesSeconds[1]) * 60 + seconds) / 86_400, numFmt: 'mm:ss.0', elapsed: false }
  }
  const match = /^(\d{1,4})(?::(\d{1,2})(?::(\d{1,2}(?:\.\d*)?))?)?\s?([ap]m?)?$/i.exec(text)
  if (!match) return undefined
  const [, h, m, s, ampm] = match
  if (m === undefined && !ampm) return undefined
  let hours = Number(h)
  const minutes = m === undefined ? 0 : Number(m)
  const seconds = s === undefined ? 0 : Number(s)
  if (minutes >= 60 || seconds >= 60) return undefined
  if (ampm) {
    if (hours > 12) return undefined
    hours = (hours % 12) + (ampm[0]!.toLowerCase() === 'p' ? 12 : 0)
  } else if (hours > 9999) return undefined
  const fraction = (hours * 3600 + minutes * 60 + seconds) / 86_400
  const elapsed = hours >= 24
  const decimals = s?.includes('.') && s.length > s.indexOf('.') + 1
  let numFmt = elapsed ? '[h]:mm:ss' : s === undefined ? 'h:mm' : 'h:mm:ss'
  if (decimals) numFmt = 'mm:ss.0'
  else if (ampm) numFmt += ' AM/PM'
  return { fraction, numFmt, elapsed }
}

function parseDate(text: string, options: ParseOptions): DatePart | undefined {
  const currentYear = options.currentYear ?? liveCurrentYear()
  const make = (year: number, month: number, day: number, numFmt: string): DatePart | undefined => {
    const serial = validDate(year, month, day, options.date1904 ?? false)
    return serial === undefined ? undefined : { serial, numFmt }
  }
  let match = /^(\d{1,2})([/-])(\d{1,2})\2(\d{1,4})$/.exec(text)
  if (match) return make(fullYear(match[4]!), Number(match[1]), Number(match[3]), 'm/d/yyyy')
  match = /^(\d{4})([/-])(\d{1,2})\2(\d{1,2})$/.exec(text)
  if (match) return make(Number(match[1]), Number(match[3]), Number(match[4]), 'm/d/yyyy')
  match = /^(\d{1,2})[/-](\d{1,4})$/.exec(text)
  if (match) {
    const month = Number(match[1])
    const second = match[2]!
    // `1/31` is a day this year; `1/32` and `1/2024` can only be a month and year.
    if (second.length <= 2) {
      const day = make(currentYear, month, Number(second), 'd-mmm')
      if (day) return day
    }
    return make(fullYear(second), month, 1, 'mmm-yy')
  }
  match = /^(\d{1,2})[ /-]([a-z]+\.?)(?:[ /-](\d{1,4}))?$/i.exec(text)
  if (match) {
    const month = monthFromName(match[2]!)
    if (!month) return undefined
    if (match[3] === undefined) return make(currentYear, month, Number(match[1]), 'd-mmm')
    return make(fullYear(match[3]), month, Number(match[1]), 'd-mmm-yy')
  }
  match = /^([a-z]+\.?)[ /-](\d{1,2})(?:, ?| |[/-])(\d{1,4})$/i.exec(text)
  if (match) {
    const month = monthFromName(match[1]!)
    return month ? make(fullYear(match[3]!), month, Number(match[2]), 'd-mmm-yy') : undefined
  }
  match = /^([a-z]+\.?)(?:[ /-]|, ?)(\d{1,4})$/i.exec(text)
  if (match) {
    const month = monthFromName(match[1]!)
    if (!month) return undefined
    const number = match[2]!
    if (number.length <= 2) {
      const day = make(currentYear, month, Number(number), 'd-mmm')
      if (day) return day
    }
    return make(fullYear(number), month, 1, 'mmm-yy')
  }
  return undefined
}

/** Two-digit years 00–29 are 2000–2029 and 30–99 are 1930–1999; three digits are no year. */
function fullYear(text: string): number {
  const year = Number(text)
  if (text.length <= 2) return year < 30 ? 2000 + year : 1900 + year
  return text.length === 3 ? -1 : year
}

function validDate(year: number, month: number, day: number, date1904: boolean): number | undefined {
  if (year < (date1904 ? 1904 : 1900) || year > 9999 || month < 1 || month > 12 || day < 1) return undefined
  // 1900-02-29 is a real day in Excel's 1900 calendar.
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 || (year === 1900 && !date1904)
  const length = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31
  if (day > length) return undefined
  const serial = dateToSerial(year, month, day, date1904)
  return serial <= (date1904 ? MAX_DATE_SERIAL_1904 : MAX_DATE_SERIAL_1900) ? serial : undefined
}
