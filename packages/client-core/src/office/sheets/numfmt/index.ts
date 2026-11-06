import { isError, type Scalar } from '../formula/types.js'
import { type CompiledFormat, compileFormat, type Section } from './compile.js'
import { formatGeneral, GENERAL_WIDTH } from './general.js'
import { type Rendered, renderDate, renderNumber, renderTokens } from './render.js'
import type { Condition } from './tokenize.js'

/**
 * Excel number formats: `formatValue` shows a cell value with a format code the way Excel does
 * (sections, conditions, colors, digit placeholders, fractions, scientific, dates and times,
 * General). Codes are compiled once and cached, since a workbook has few distinct formats shared
 * by many cells.
 */

export { builtinFormatCode } from './builtin.js'
export { formatGeneral, numberToText } from './general.js'
export { roundNumber } from './decimal.js'

export interface FormatOptions {
  /** The workbook uses the 1904 date system. */
  date1904?: boolean
  /**
   * How many characters the General format may use; Excel fits General numbers to the column
   * (about 11 characters at the default width) by dropping decimals or switching to scientific.
   */
  generalWidth?: number
}

export interface FormattedValue {
  /** The text to show. */
  text: string
  /** A CSS color from a `[Red]`/`[Color10]` section, if the matching section has one. */
  color?: string
  /**
   * A `*x` repeat: the character to repeat to fill the cell width, inserted at `position` in
   * `text` (Excel's accounting formats pad between the currency symbol and the number).
   */
  fill?: { char: string; position: number }
  /** The code was malformed (Excel would reject it), so the value was shown as General. */
  formatError?: true
  /**
   * The value can't be shown with the matched section (a negative date, or one past 9999-12-31).
   * `text` is `#######`, as in Excel.
   */
  overflow?: true
}

/** What Excel shows when a date is out of range (it fills the cell with #). */
export const OVERFLOW_TEXT = '#######'

/** Formats any cell value with a format code (`General`, `0.00`, `m/d/yyyy`, `@`, …). */
export function formatValue(value: Scalar, code: string, options: FormatOptions = {}): FormattedValue {
  if (value === null) return { text: '' }
  if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE' }
  if (isError(value)) return { text: value.code }
  const format = compileFormat(code)
  const result = typeof value === 'string' ? formatText(format, value) : formatNumber(format, value, options)
  if (format.error) result.formatError = true
  return result
}

function formatText(format: CompiledFormat, value: string): FormattedValue {
  const section = format.text
  if (!section) {
    // A single-section format colors text too ([Red]General shows typed text in red).
    const color = format.numeric.length === 1 ? format.numeric[0]!.color : undefined
    return color ? { text: value, color } : { text: value }
  }
  return withColor(renderTokens(section.tokens, value), section.color)
}

function formatNumber(format: CompiledFormat, value: number, options: FormatOptions): FormattedValue {
  if (!Number.isFinite(value)) return { text: '#NUM!' }
  const width = options.generalWidth ?? GENERAL_WIDTH
  const choice = chooseSection(format, value)
  if (!choice) return { text: formatGeneral(value, width) }
  const { section } = choice
  const shown = choice.dropSign ? Math.abs(value) : value
  const sign = shown < 0 ? '-' : ''
  const magnitude = Math.abs(shown)
  let rendered: Rendered
  switch (section.kind) {
    case 'date': {
      const date = sign ? undefined : renderDate(section.date!, magnitude, options.date1904 ?? false)
      if (!date) return withColor({ text: OVERFLOW_TEXT }, section.color, true)
      return withColor(date, section.color)
    }
    case 'number':
      rendered = renderNumber(section.number!, magnitude)
      break
    case 'general':
      rendered = renderTokens(section.tokens, '', magnitude, width - sign.length)
      break
    default:
      rendered = renderTokens(section.tokens, '')
  }
  if (sign) {
    rendered.text = sign + rendered.text
    if (rendered.fill) rendered.fill.position += sign.length
  }
  return withColor(rendered, section.color)
}

function withColor(rendered: Rendered, color: string | undefined, overflow = false): FormattedValue {
  const result: FormattedValue = rendered
  if (color) result.color = color
  if (overflow) result.overflow = true
  return result
}

/**
 * Picks the section for a number. Without conditions: one section for all, two for
 * non-negative/negative, three for positive/negative/zero. With conditions: the first section
 * whose condition holds among the first two, else the third; a second section without a
 * condition takes everything else (or the negatives, when there is a third). Undefined means
 * General: no sections, or no condition matches.
 */
function chooseSection(format: CompiledFormat, value: number): { section: Section; dropSign: boolean } | undefined {
  const [first, second, third] = format.numeric
  if (!first) return undefined
  if (!format.hasConditions) {
    if (value < 0 && second) return { section: second, dropSign: true }
    if (value === 0 && third) return { section: third, dropSign: false }
    return { section: first, dropSign: false }
  }
  const firstMatches = first.condition ? test(first.condition, value) : second ? (third ? value > 0 : value >= 0) : true
  if (firstMatches) return { section: first, dropSign: negativeOnly(first.condition) }
  if (second) {
    const secondMatches = second.condition ? test(second.condition, value) : third ? value < 0 : true
    if (secondMatches) return { section: second, dropSign: true }
  }
  if (third) return { section: third, dropSign: negativeOnly(third.condition) }
  return undefined
}

function test(condition: Condition, value: number): boolean {
  switch (condition.op) {
    case '<':
      return value < condition.value
    case '<=':
      return value <= condition.value
    case '>':
      return value > condition.value
    case '>=':
      return value >= condition.value
    case '=':
      return value === condition.value
    case '<>':
      return value !== condition.value
  }
}

/**
 * A `[<0]` section is the negative section written out, so it drops the sign like the usual second
 * section; other conditions that admit negatives (`[<-100]`) keep it.
 */
function negativeOnly(condition: Condition | undefined): boolean {
  return condition !== undefined && (condition.op === '<' || condition.op === '<=') && condition.value === 0
}

/** True when the format shows numbers as a date or time. */
export function isDateFormat(code: string): boolean {
  const format = compileFormat(code)
  return format.numeric.length > 0 && format.numeric[0]!.kind === 'date'
}

export type NumberFormatKind = 'general' | 'number' | 'percent' | 'currency' | 'accounting' | 'date' | 'time' | 'datetime' | 'scientific' | 'fraction' | 'text'

const CURRENCY = /[$€£¥₹₩₽¢₪₫₺₴₦₱฿]|\b(?:USD|EUR|GBP|JPY|CHF|CNY|CAD|AUD)\b/

/** Which kind of format a code is, judged by its first section (for toolbars and pickers). */
export function numberFormatKind(code: string): NumberFormatKind {
  const format = compileFormat(code)
  const section = format.numeric[0]
  if (!section) return format.text ? 'text' : 'general'
  switch (section.kind) {
    case 'date': {
      const { hasDate, hasTime } = section.date!
      return hasDate && hasTime ? 'datetime' : hasDate ? 'date' : 'time'
    }
    case 'number': {
      const layout = section.number!
      if (layout.mode === 'scientific') return 'scientific'
      if (layout.mode === 'fraction') return 'fraction'
      if (layout.percent) return 'percent'
      if (section.hasFill) return 'accounting'
      const literals = section.tokens.map((token) => (token.t === 'lit' ? token.v : '')).join('')
      return CURRENCY.test(literals) ? 'currency' : 'number'
    }
    case 'text':
      return 'text'
    default:
      return 'general'
  }
}
