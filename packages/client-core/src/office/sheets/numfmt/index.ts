import type { Scalar } from '../formula/types.js'

/**
 * Excel number formats. PLACEHOLDER API: the signatures here are the contract; the implementation
 * is being written separately and replaces this file.
 */

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
}

/** Formats any cell value with a format code (`General`, `0.00`, `m/d/yyyy`, `@`, …). */
export function formatValue(value: Scalar, code: string, options: FormatOptions = {}): FormattedValue {
  void options
  if (value === null) return { text: '' }
  if (typeof value === 'number') return { text: code === 'General' || !code ? String(value) : String(value) }
  if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE' }
  return { text: String(value) }
}

/** The code of a built-in number format id (0–49 and the locale-independent extras), if any. */
export function builtinFormatCode(id: number): string | undefined {
  return id === 0 ? 'General' : undefined
}

/** True when the format shows numbers as a date or time. */
export function isDateFormat(code: string): boolean {
  return /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''))
}
