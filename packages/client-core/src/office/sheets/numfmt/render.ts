import { MAX_DATE_SERIAL_1900, MAX_DATE_SERIAL_1904, serialToParts } from '../dates.js'
import type { DateLayout, NumberLayout, Placeholder } from './compile.js'
import { decimalToNumber, fixedParts, shift, toDecimal15 } from './decimal.js'
import { formatGeneral } from './general.js'
import type { Token } from './tokenize.js'

/** Text plus where a `*x` repeat goes, if the section has one. */
export interface Rendered {
  text: string
  fill?: { char: string; position: number }
}

class Output {
  text = ''
  fill?: { char: string; position: number }
  add(text: string): void {
    this.text += text
  }
  addFill(char: string): void {
    this.fill ??= { char, position: this.text.length }
  }
  done(): Rendered {
    return this.fill ? { text: this.text, fill: this.fill } : { text: this.text }
  }
}

const FILL: Record<Placeholder, string> = { '0': '0', '#': '', '?': ' ' }

/**
 * Spreads integer digits right-aligned over placeholders (one string per placeholder); the first
 * placeholder takes any digits that don't fit. Unused `0` shows 0, `?` a space, `#` nothing.
 * Grouping commas go between digits; next to `?` padding they become spaces so columns align.
 */
export function layoutInteger(digits: string, placeholders: Placeholder[], grouping: boolean): string[] {
  const count = placeholders.length
  const out = new Array<string>(count).fill('')
  if (count === 0) return out
  const cells = Math.max(count, digits.length)
  for (let k = 0; k < cells; k++) {
    const slot = k < count ? count - 1 - k : 0
    const char = k < digits.length ? digits[digits.length - 1 - k]! : FILL[placeholders[slot]!]
    let separator = ''
    if (grouping && k > 0 && k % 3 === 0 && char) separator = char === ' ' ? ' ' : ','
    out[slot] = char + separator + out[slot]
  }
  return out
}

/** Fraction digits, with trailing zeros under `#` dropped and under `?` turned into spaces. */
function layoutDecimals(digits: string, placeholders: Placeholder[]): string[] {
  const out = placeholders.map((_, i) => digits[i] ?? '0')
  for (let i = out.length - 1; i >= 0; i--) {
    const placeholder = placeholders[i]!
    if (out[i] !== '0' || placeholder === '0') break
    out[i] = FILL[placeholder]
  }
  return out
}

export function renderNumber(layout: NumberLayout, value: number): Rendered {
  if (layout.mode === 'fraction') return renderFraction(layout, value)
  const scaled = shift(toDecimal15(value), layout.scale)
  let mantissa = scaled
  let exponent = 0
  if (layout.mode === 'scientific' && scaled.digits) {
    // `##0.0E+0` shows engineering notation: the exponent is a multiple of the integer
    // placeholder count. With no integer placeholders the mantissa is below 1.
    const step = Math.max(1, layout.int.length)
    exponent = layout.int.length === 0 ? scaled.exp + 1 : Math.floor(scaled.exp / step) * step
    for (;;) {
      mantissa = shift(scaled, -exponent)
      if (fixedParts(mantissa, layout.frac.length).int.length <= layout.int.length) break
      exponent += step
    }
  }
  const { int, frac } = fixedParts(mantissa, layout.frac.length)
  const intOut = layoutInteger(int, layout.int, layout.grouping && layout.mode === 'decimal')
  const fracOut = layoutDecimals(frac, layout.frac)
  const expOut = layoutInteger(exponent ? String(Math.abs(exponent)) : '', layout.exponent, false)
  const out = new Output()
  // Without integer placeholders (`.00`) the integer part still shows, right before the point.
  let pendingInt = layout.int.length === 0 && layout.mode === 'decimal' ? int : ''
  for (const part of layout.parts) {
    switch (part.k) {
      case 'lit':
        out.add(part.v)
        break
      case 'fill':
        out.addFill(part.v)
        break
      case 'int':
        out.add(intOut[part.i]!)
        break
      case 'point':
        out.add(pendingInt + '.')
        pendingInt = ''
        break
      case 'frac':
        out.add(pendingInt + fracOut[part.i]!)
        pendingInt = ''
        break
      case 'exp':
        out.add(exponent < 0 ? 'E-' : part.plus ? 'E+' : 'E')
        break
      case 'expDigit':
        out.add(expOut[part.i]!)
        break
      default:
        break
    }
  }
  return out.done()
}

function renderFraction(layout: NumberLayout, value: number): Rendered {
  const number = decimalToNumber(shift(toDecimal15(value), layout.scale))
  const mixed = layout.int.length > 0
  let whole = mixed ? Math.floor(number) : 0
  const rest = number - whole
  let numerator: number
  let denominator: number
  if (layout.fixedDenominator !== undefined) {
    denominator = layout.fixedDenominator
    numerator = Math.round(rest * denominator)
  } else {
    ;[numerator, denominator] = approximate(rest, 10 ** Math.min(layout.denominator.length, 7) - 1)
  }
  if (mixed && numerator >= denominator && denominator > 0) {
    whole += Math.floor(numerator / denominator)
    numerator %= denominator
  }
  const blank = mixed && numerator === 0
  // A zero whole part still shows as 0 when there's no fraction to show either.
  const intOut = layoutInteger(whole ? String(whole) : blank ? '0' : '', layout.int, false)
  const numOut = layoutInteger(numerator ? String(numerator) : mixed ? '' : '0', layout.numerator, false)
  const denDigits = String(denominator)
  const denOut = layout.denominator.map((placeholder, i) => {
    if (i === layout.denominator.length - 1) return denDigits.slice(i) || FILL[placeholder]
    return denDigits[i] ?? FILL[placeholder]
  })
  const out = new Output()
  layout.parts.forEach((part, index) => {
    if (blank && index >= layout.fractionStart && index < layout.fractionEnd) {
      out.add(' '.repeat(part.k === 'lit' ? part.v.length : part.k === 'fill' ? 0 : 1))
      return
    }
    switch (part.k) {
      case 'lit':
        out.add(part.v)
        break
      case 'fill':
        out.addFill(part.v)
        break
      case 'int':
        out.add(intOut[part.i]!)
        break
      case 'num':
        out.add(numOut[part.i]!)
        break
      case 'den':
        out.add(denOut[part.i]!)
        break
      default:
        break
    }
  })
  return out.done()
}

/** The closest fraction to `x` (≥ 0) with a denominator up to `maxDenominator` (continued fractions). */
export function approximate(x: number, maxDenominator: number): [number, number] {
  let [p0, q0, p1, q1] = [0, 1, 1, 0]
  let remainder = x
  for (let step = 0; step < 64; step++) {
    const a = Math.floor(remainder)
    const p2 = a * p1 + p0
    const q2 = a * q1 + q0
    if (q2 > maxDenominator) {
      // The best approximation is either the last convergent or the largest semiconvergent that fits.
      const k = Math.floor((maxDenominator - q0) / q1)
      const ps = k * p1 + p0
      const qs = k * q1 + q0
      return Math.abs(x - ps / qs) < Math.abs(x - p1 / q1) ? [ps, qs] : [p1, q1]
    }
    ;[p0, q0, p1, q1] = [p1, q1, p2, q2]
    const fraction = remainder - a
    if (fraction < 1e-10 || Math.abs(x - p1 / q1) < 1e-14) break
    remainder = 1 / fraction
  }
  return [p1, q1]
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const pad2 = (n: number) => (n < 10 ? '0' + n : String(n))

/** Undefined when the serial can't be a date (negative or past 9999-12-31): Excel shows ####. */
export function renderDate(layout: DateLayout, value: number, date1904: boolean): Rendered | undefined {
  if (!(value >= 0)) return undefined
  let days = Math.floor(value)
  let ticks = 0
  const unit = 10 ** layout.subsecondDigits
  if (layout.hasTime) {
    // Round to the shown precision (a whole second without `.0`), carrying into the day, so
    // 23:59:59.9995 with `ss.000` is the next day's 00:00:00.000. Snapping first stops binary
    // noise like 59999.4999999 from deciding a half.
    const perDay = 86_400 * unit
    ticks = Math.round(Number(((value - days) * perDay).toPrecision(12)))
    if (ticks >= perDay) {
      days += 1
      ticks -= perDay
    }
  }
  if (days > (date1904 ? MAX_DATE_SERIAL_1904 : MAX_DATE_SERIAL_1900)) return undefined
  const date = layout.hasDate ? serialToParts(days, date1904) : undefined
  if (layout.hasDate && !date) return undefined
  const seconds = Math.floor(ticks / unit)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const out = new Output()
  for (const part of layout.parts) {
    switch (part.k) {
      case 'lit':
        out.add(part.v)
        break
      case 'fill':
        out.addFill(part.v)
        break
      case 'year':
        out.add(part.n === 2 ? pad2(date!.year % 100) : String(date!.year))
        break
      case 'buddhistYear':
        out.add(part.n === 2 ? pad2((date!.year + 543) % 100) : String(date!.year + 543))
        break
      case 'month': {
        const month = date!.month
        const name = MONTHS[month - 1]!
        out.add(part.n === 1 ? String(month) : part.n === 2 ? pad2(month) : part.n === 3 ? name.slice(0, 3) : part.n === 4 ? name : name[0]!)
        break
      }
      case 'day':
        if (part.n <= 2) out.add(part.n === 1 ? String(date!.day) : pad2(date!.day))
        else out.add(part.n === 3 ? WEEKDAYS[date!.weekday]!.slice(0, 3) : WEEKDAYS[date!.weekday]!)
        break
      case 'hour': {
        const hour = layout.twelveHour ? hours % 12 || 12 : hours
        out.add(part.n === 1 ? String(hour) : pad2(hour))
        break
      }
      case 'minute':
        out.add(part.n === 1 ? String(minutes) : pad2(minutes))
        break
      case 'second':
        out.add(part.n === 1 ? String(seconds % 60) : pad2(seconds % 60))
        break
      case 'subsecond':
        out.add(String(ticks % unit).padStart(layout.subsecondDigits, '0').slice(0, part.n))
        break
      case 'ampm':
        out.add(hours < 12 ? part.am : part.pm)
        break
      case 'elapsed': {
        const total = part.unit === 'h' ? days * 24 + hours : part.unit === 'm' ? days * 1440 + Math.floor(seconds / 60) : days * 86_400 + seconds
        out.add(String(total).padStart(part.n, '0'))
        break
      }
    }
  }
  return out.done()
}

/** Text sections and sections without placeholders: literals, with `@` replaced by `text`. */
export function renderTokens(tokens: Token[], text: string, generalValue?: number, generalWidth?: number): Rendered {
  const out = new Output()
  for (const token of tokens) {
    if (token.t === 'lit') out.add(token.v)
    else if (token.t === 'fill') out.addFill(token.v)
    else if (token.t === 'at') out.add(text)
    else if (token.t === 'general' && generalValue !== undefined) out.add(formatGeneral(generalValue, generalWidth))
    else out.add(token.src)
  }
  return out.done()
}
