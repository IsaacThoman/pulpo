/**
 * COUNTIF-style criteria and wildcard matching.
 *
 * A criterion is a value or text with an optional leading operator (`=`, `<>`, `<`, `<=`, `>`,
 * `>=`). The operand decides what it compares against:
 * - a number (or text Excel reads as a number, such as `"10"`, `"1/1/2024"`, `"50%"`): equality also
 *   matches cells holding text that reads as the same number; `<`/`>` only consider number cells.
 * - `TRUE`/`FALSE`: logical cells.
 * - an error literal (`"#N/A"`) or an error value: cells with that error.
 * - other text: case-insensitive, with `*`, `?` and `~` wildcards for `=` and `<>`; `<`/`>` compare
 *   text cells alphabetically.
 * - `""` (no operator) matches blank cells and empty text, `"="` only truly blank cells, `"<>"` any
 *   non-blank cell. `<>` with any operand matches everything the operand does not, blanks included.
 */

import { errorFromCode, isError, type FunctionContext, type Scalar } from '../types.js'
import { compareText, numberToText, parseNumber } from './coerce.js'

export type Predicate = (value: Scalar) => boolean

const wildcardCache = new Map<string, RegExp>()

/** True when the pattern has an unescaped `*` or `?`, or a `~` escape. */
export function hasWildcards(pattern: string): boolean {
  return /[*?~]/.test(pattern)
}

/** Compiles an Excel wildcard pattern (`*`, `?`, `~*`, `~?`, `~~`) to an anchored, case-insensitive regex. */
export function wildcardRegex(pattern: string, anchored: 'full' | 'start' | 'none' = 'full'): RegExp {
  const key = `${anchored}:${pattern}`
  const cached = wildcardCache.get(key)
  if (cached) return cached
  let source = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!
    if (char === '~' && i + 1 < pattern.length && '*?~'.includes(pattern[i + 1]!)) {
      source += escapeRegex(pattern[i + 1]!)
      i++
    } else if (char === '*') source += '[\\s\\S]*'
    else if (char === '?') source += '[\\s\\S]'
    else source += escapeRegex(char)
  }
  const full = anchored === 'full' ? `^${source}$` : anchored === 'start' ? `^${source}` : source
  const regex = new RegExp(full, 'iu')
  if (wildcardCache.size > 500) wildcardCache.clear()
  wildcardCache.set(key, regex)
  return regex
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** Case-insensitive whole-text match of `text` against an Excel wildcard pattern. */
export function wildcardMatch(pattern: string, text: string): boolean {
  if (!hasWildcards(pattern)) return compareText(pattern, text) === 0
  return wildcardRegex(pattern).test(text)
}

type Op = '=' | '<>' | '<' | '<=' | '>' | '>='

function splitOperator(criterion: string): { op: Op; operand: string; explicit: boolean } {
  for (const op of ['<=', '>=', '<>', '<', '>', '='] as const) {
    if (criterion.startsWith(op)) return { op, operand: criterion.slice(op.length), explicit: true }
  }
  return { op: '=', operand: criterion, explicit: false }
}

function compareNumbers(op: Op, a: number, b: number): boolean {
  switch (op) {
    case '=':
      return a === b
    case '<>':
      return a !== b
    case '<':
      return a < b
    case '<=':
      return a <= b
    case '>':
      return a > b
    case '>=':
      return a >= b
  }
}

export interface CriteriaOptions {
  /** Database functions treat plain text criteria as "begins with". */
  prefixText?: boolean
}

/** Builds a predicate for a SUMIF/COUNTIF/… criterion. */
export function parseCriteria(criterion: Scalar, ctx?: FunctionContext, options: CriteriaOptions = {}): Predicate {
  if (criterion === null) criterion = 0
  if (typeof criterion === 'number') {
    const target = criterion
    return (value) => numericEquals(value, target, ctx)
  }
  if (typeof criterion === 'boolean') {
    const target = criterion
    return (value) => value === target
  }
  if (isError(criterion)) {
    const code = criterion.code
    return (value) => isError(value) && value.code === code
  }
  const { op, operand, explicit } = splitOperator(criterion)

  if (operand === '') {
    if (!explicit) return (value) => value === null || value === ''
    if (op === '=') return (value) => value === null
    if (op === '<>') return (value) => value !== null
    // `<` / `>` with nothing to compare matches nothing useful in Excel except text comparisons with "".
    return (value) => typeof value === 'string' && compareTextOp(op, value, '')
  }

  const number = parseNumber(operand, ctx)
  if (number !== undefined) {
    if (op === '=') return (value) => numericEquals(value, number, ctx)
    if (op === '<>') return (value) => !numericEquals(value, number, ctx)
    return (value) => typeof value === 'number' && compareNumbers(op, value, number)
  }

  const upper = operand.toUpperCase()
  if (upper === 'TRUE' || upper === 'FALSE') {
    const target = upper === 'TRUE'
    if (op === '=') return (value) => value === target
    if (op === '<>') return (value) => value !== target
    return (value) => typeof value === 'boolean' && compareNumbers(op, Number(value), Number(target))
  }

  const error = errorFromCode(operand)
  if (error) {
    if (op === '=') return (value) => isError(value) && value.code === error.code
    if (op === '<>') return (value) => !(isError(value) && value.code === error.code)
    return () => false
  }

  if (op === '=' || op === '<>') {
    const pattern = options.prefixText && !explicit ? `${operand}*` : operand
    const matches = (value: Scalar): boolean => typeof value === 'string' && wildcardMatch(pattern, value)
    return op === '=' ? matches : (value) => !matches(value)
  }
  return (value) => typeof value === 'string' && compareTextOp(op, value, operand)
}

function compareTextOp(op: Op, value: string, operand: string): boolean {
  return compareNumbers(op, compareText(value, operand), 0)
}

function numericEquals(value: Scalar, target: number, ctx?: FunctionContext): boolean {
  if (typeof value === 'number') return value === target
  if (typeof value === 'string') {
    const parsed = parseNumber(value, ctx)
    return parsed !== undefined && parsed === target
  }
  return false
}

/** Renders a criterion back to text, for messages and tests. */
export function criterionText(criterion: Scalar): string {
  if (typeof criterion === 'number') return numberToText(criterion)
  if (criterion === null) return ''
  return String(criterion)
}
