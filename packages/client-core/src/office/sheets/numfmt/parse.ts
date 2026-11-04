import type { Scalar } from '../formula/types.js'

/** PLACEHOLDER API: the signatures are the contract; the implementation replaces this file. */

export interface ParseOptions {
  date1904?: boolean
}

/**
 * Converts text to a number the way Excel coerces text in arithmetic and VALUE(): `1,234.5`,
 * `50%`, `$1,000`, `(12)`, `1e3`, dates (`2024-01-31`, `1/31/2024`), and times (`3:30 PM`).
 * Undefined when Excel would give #VALUE!.
 */
export function parseNumberText(text: string, options: ParseOptions = {}): number | undefined {
  void options
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : undefined
}

/**
 * What typing `text` into a cell stores: a number (with the format Excel would apply, e.g. `0%`
 * for `50%` or a date format for `1/31/2024`), a boolean, an error literal, or the text itself.
 */
export function parseInput(text: string, options: ParseOptions = {}): { value: Scalar; numFmt?: string } {
  const n = parseNumberText(text, options)
  if (n !== undefined) return { value: n }
  if (/^(true|false)$/i.test(text.trim())) return { value: text.trim().toUpperCase() === 'TRUE' }
  return { value: text }
}
