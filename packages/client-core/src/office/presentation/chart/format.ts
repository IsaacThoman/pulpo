/**
 * Excel number format codes, the subset charts use for axis and data labels: General, fixed
 * decimals, thousands separators, percentages, currency and other literals, scientific notation,
 * sign sections, and simple dates. Anything fancier degrades to a readable number, never an error.
 */

export interface NumberFormatOptions {
  /** The workbook counts dates from 1904-01-01 instead of 1900 (`c:date1904`). */
  date1904?: boolean
}

const MS_PER_DAY = 86_400_000
/** Excel's day zero in the 1900 system, after its fictional 29 Feb 1900 is accounted for. */
const EPOCH_1900 = Date.UTC(1899, 11, 30)
const EPOCH_1904 = Date.UTC(1904, 0, 1)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function formatNumber(value: number, formatCode: string | undefined, options: NumberFormatOptions = {}): string {
  if (!Number.isFinite(value)) return ''
  const code = formatCode?.trim()
  if (!code || /^general$/i.test(code)) return formatGeneral(value)
  const sections = splitSections(code)
  let section = sections[0] ?? ''
  let magnitude = value
  let sign = ''
  if (value < 0 && sections.length >= 2) {
    // The negative section shows the magnitude; it brings its own minus sign or parentheses.
    section = sections[1] ?? ''
    magnitude = -value
  } else if (value === 0 && sections.length >= 3) {
    section = sections[2] ?? ''
  } else if (value < 0) {
    sign = '-'
    magnitude = -value
  }
  const tokens = tokenize(section)
  if (tokens.some((token) => token.kind === 'date')) return sign + formatDate(value, tokens, options)
  const formatted = formatWithTokens(magnitude, tokens)
  // "-0" reads badly when a small negative rounds away entirely.
  return sign && /[1-9]/.test(formatted) ? sign + formatted : formatted
}

/** Excel's General format: up to 10 significant digits, scientific for very large or small values. */
export function formatGeneral(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (value === 0) return '0'
  const magnitude = Math.abs(value)
  if (magnitude >= 1e11 || magnitude < 1e-9) return formatScientific(value, 2)
  const rounded = Number(value.toPrecision(10))
  if (Math.abs(rounded) < 1e-6) return formatScientific(value, 2)
  const text = String(rounded)
  return text.includes('e') ? rounded.toFixed(10).replace(/\.?0+$/, '') : text
}

function formatScientific(value: number, decimals: number): string {
  const [mantissa = '0', exponent = '0'] = value.toExponential(decimals).split('e')
  const power = Number(exponent)
  return `${mantissa}E${power < 0 ? '-' : '+'}${String(Math.abs(power)).padStart(2, '0')}`
}

function splitSections(code: string): string[] {
  const sections: string[] = []
  let current = ''
  let quoted = false
  let bracket = false
  for (let index = 0; index < code.length; index++) {
    const char = code[index]!
    if (char === '\\' && !quoted) {
      current += char + (code[index + 1] ?? '')
      index++
      continue
    }
    if (char === '"') quoted = !quoted
    else if (!quoted && char === '[') bracket = true
    else if (!quoted && char === ']') bracket = false
    if (char === ';' && !quoted && !bracket) {
      sections.push(current)
      current = ''
    } else {
      current += char
    }
  }
  sections.push(current)
  return sections
}

type Token =
  | { kind: 'literal'; text: string }
  | { kind: 'digit'; char: '0' | '#' | '?' }
  | { kind: 'point' }
  | { kind: 'comma' }
  | { kind: 'percent' }
  | { kind: 'exponent'; sign: '+' | '-' }
  | { kind: 'general' }
  | { kind: 'text' }
  | { kind: 'date'; code: string }

const DATE_PATTERN = /^(yyyy|yy|y|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|am\/pm|a\/p)/i

function tokenize(section: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < section.length) {
    const char = section[index]!
    const rest = section.slice(index)
    if (char === '"') {
      const end = section.indexOf('"', index + 1)
      const stop = end < 0 ? section.length : end
      tokens.push({ kind: 'literal', text: section.slice(index + 1, stop) })
      index = stop + 1
    } else if (char === '\\') {
      tokens.push({ kind: 'literal', text: section[index + 1] ?? '' })
      index += 2
    } else if (char === '_') {
      // `_x` pads with the width of x; a space is close enough.
      tokens.push({ kind: 'literal', text: ' ' })
      index += 2
    } else if (char === '*') {
      // `*x` repeats x to fill the cell, which a label has no room for.
      index += 2
    } else if (char === '[') {
      const end = section.indexOf(']', index)
      const stop = end < 0 ? section.length : end
      const inner = section.slice(index + 1, stop)
      if (inner.startsWith('$')) {
        // `[$€-407]` is a currency symbol with a locale; `[$-409]` is just a locale.
        const symbol = inner.slice(1).split('-')[0] ?? ''
        if (symbol) tokens.push({ kind: 'literal', text: symbol })
      } else if (/^(h+|m+|s+)$/i.test(inner)) {
        tokens.push({ kind: 'date', code: inner.toLowerCase() })
      }
      // Colors and conditions change nothing in the text.
      index = stop + 1
    } else if (/^general/i.test(rest)) {
      tokens.push({ kind: 'general' })
      index += 7
    } else if (char === '0' || char === '#' || char === '?') {
      tokens.push({ kind: 'digit', char })
      index++
    } else if (char === '.') {
      tokens.push({ kind: 'point' })
      index++
    } else if (char === ',') {
      tokens.push({ kind: 'comma' })
      index++
    } else if (char === '%') {
      tokens.push({ kind: 'percent' })
      index++
    } else if ((char === 'E' || char === 'e') && (rest[1] === '+' || rest[1] === '-')) {
      tokens.push({ kind: 'exponent', sign: rest[1] })
      index += 2
    } else if (char === '@') {
      tokens.push({ kind: 'text' })
      index++
    } else {
      const date = DATE_PATTERN.exec(rest)
      if (date) {
        tokens.push({ kind: 'date', code: date[0].toLowerCase() })
        index += date[0].length
      } else {
        tokens.push({ kind: 'literal', text: char })
        index++
      }
    }
  }
  return tokens
}

function formatWithTokens(magnitude: number, tokens: Token[]): string {
  const digitIndexes = tokens.flatMap((token, index) => (token.kind === 'digit' ? [index] : []))
  if (!digitIndexes.length) {
    const hasGeneral = tokens.some((token) => token.kind === 'general' || token.kind === 'text')
    const number = hasGeneral ? formatGeneral(magnitude) : ''
    return tokens.map((token) => (token.kind === 'literal' ? token.text : token.kind === 'general' || token.kind === 'text' ? number : token.kind === 'percent' ? '%' : '')).join('')
  }
  const firstDigit = digitIndexes[0]!
  const lastDigit = digitIndexes[digitIndexes.length - 1]!
  const pointIndex = tokens.findIndex((token, index) => token.kind === 'point' && index > firstDigit && index <= lastDigit + 1)
  const exponentIndex = tokens.findIndex((token) => token.kind === 'exponent')
  const mantissaEnd = exponentIndex >= 0 ? exponentIndex : tokens.length
  let integerZeros = 0
  let decimalZeros = 0
  let decimalPlaces = 0
  let grouping = false
  let scaleCommas = 0
  for (let index = firstDigit; index < mantissaEnd; index++) {
    const token = tokens[index]!
    const afterPoint = pointIndex >= 0 && index > pointIndex
    if (token.kind === 'digit') {
      if (afterPoint) {
        decimalPlaces++
        if (token.char !== '#') decimalZeros = decimalPlaces
      } else if (token.char === '0') {
        integerZeros++
      }
    } else if (token.kind === 'comma' && !afterPoint) {
      const nextIsDigit = tokens.slice(index + 1, mantissaEnd).some((next) => next.kind === 'digit' && (pointIndex < 0 || tokens.indexOf(next) < pointIndex))
      if (nextIsDigit) grouping = true
      else scaleCommas++
    }
  }
  const percents = tokens.filter((token) => token.kind === 'percent').length
  let scaled = magnitude * 100 ** percents / 1000 ** scaleCommas
  let exponentText = ''
  if (exponentIndex >= 0) {
    const exponentToken = tokens[exponentIndex] as { kind: 'exponent'; sign: '+' | '-' }
    const exponentDigits = tokens.slice(exponentIndex + 1).filter((token) => token.kind === 'digit').length
    const power = scaled === 0 ? 0 : Math.floor(Math.log10(scaled))
    scaled = scaled / 10 ** power
    const powerSign = power < 0 ? '-' : exponentToken.sign === '+' ? '+' : ''
    exponentText = `E${powerSign}${String(Math.abs(power)).padStart(Math.max(1, exponentDigits), '0')}`
  }
  const number = formatDigits(scaled, { decimalPlaces, decimalZeros, integerZeros, grouping })
  const parts: string[] = []
  tokens.forEach((token, index) => {
    if (index === firstDigit) parts.push(number + exponentText)
    else if (token.kind === 'literal') parts.push(token.text)
    else if (token.kind === 'percent') parts.push('%')
    else if (token.kind === 'general' || token.kind === 'text') parts.push(formatGeneral(magnitude))
    else if (token.kind === 'point' && (pointIndex < 0 || index !== pointIndex) && !(index > firstDigit && index <= lastDigit)) parts.push('.')
    else if (token.kind === 'comma' && (index < firstDigit || index > mantissaEnd)) parts.push(',')
  })
  return parts.join('')
}

function formatDigits(value: number, layout: { decimalPlaces: number; decimalZeros: number; integerZeros: number; grouping: boolean }): string {
  const fixed = value.toFixed(Math.min(layout.decimalPlaces, 20))
  let [integer = '0', fraction = ''] = fixed.split('.')
  // `#` decimals drop trailing zeros; `0` decimals keep them.
  while (fraction.length > layout.decimalZeros && fraction.endsWith('0')) fraction = fraction.slice(0, -1)
  if (integer === '0' && layout.integerZeros === 0) integer = ''
  else integer = integer.padStart(layout.integerZeros, '0')
  if (layout.grouping) integer = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction ? `${integer}.${fraction}` : integer || (layout.decimalPlaces ? '' : '0')
}

function formatDate(serial: number, tokens: Token[], options: NumberFormatOptions): string {
  const epoch = options.date1904 ? EPOCH_1904 : EPOCH_1900
  const date = new Date(epoch + Math.round(serial * MS_PER_DAY))
  if (Number.isNaN(date.getTime())) return formatGeneral(serial)
  const twelveHour = tokens.some((token) => token.kind === 'date' && (token.code === 'am/pm' || token.code === 'a/p'))
  const hours = date.getUTCHours()
  return tokens
    .map((token, index) => {
      if (token.kind === 'literal') return token.text
      if (token.kind === 'point') return '.'
      if (token.kind === 'comma') return ','
      if (token.kind !== 'date') return ''
      switch (token.code) {
        case 'yyyy':
        case 'y':
          return String(date.getUTCFullYear())
        case 'yy':
          return String(date.getUTCFullYear() % 100).padStart(2, '0')
        case 'mmmmm':
          return (MONTHS[date.getUTCMonth()] ?? '').slice(0, 1)
        case 'mmmm':
          return MONTHS[date.getUTCMonth()] ?? ''
        case 'mmm':
          return (MONTHS[date.getUTCMonth()] ?? '').slice(0, 3)
        case 'mm':
        case 'm':
          return isMinuteToken(tokens, index)
            ? String(date.getUTCMinutes()).padStart(token.code.length, '0')
            : String(date.getUTCMonth() + 1).padStart(token.code.length, '0')
        case 'dddd':
          return WEEKDAYS[date.getUTCDay()] ?? ''
        case 'ddd':
          return (WEEKDAYS[date.getUTCDay()] ?? '').slice(0, 3)
        case 'dd':
        case 'd':
          return String(date.getUTCDate()).padStart(token.code.length, '0')
        case 'hh':
        case 'h': {
          const shown = twelveHour ? (hours % 12 || 12) : hours
          return String(shown).padStart(token.code.length, '0')
        }
        case 'ss':
        case 's':
          return String(date.getUTCSeconds()).padStart(token.code.length, '0')
        case 'am/pm':
          return hours < 12 ? 'AM' : 'PM'
        case 'a/p':
          return hours < 12 ? 'A' : 'P'
        default:
          // Elapsed time ([h], [mm]): whole units since day zero.
          if (token.code.startsWith('h')) return String(Math.floor(serial * 24))
          if (token.code.startsWith('m')) return String(Math.floor(serial * 1440))
          return String(Math.floor(serial * 86_400))
      }
    })
    .join('')
}

/** `m` means minutes right after an hour or right before a second, months otherwise. */
function isMinuteToken(tokens: Token[], index: number): boolean {
  const previous = tokens.slice(0, index).reverse().find((token) => token.kind === 'date')
  const next = tokens.slice(index + 1).find((token) => token.kind === 'date')
  return (previous?.kind === 'date' && previous.code.startsWith('h')) || (next?.kind === 'date' && next.code.startsWith('s'))
}

/** True when a format code shows a percentage (so axis math can treat 1 as 100%). */
export function isPercentFormat(formatCode: string | undefined): boolean {
  return !!formatCode && tokenize(splitSections(formatCode)[0] ?? '').some((token) => token.kind === 'percent')
}
