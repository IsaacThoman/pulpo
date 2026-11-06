import { type Decimal, fixedParts, shift, toDecimal15 } from './decimal.js'

/** Characters Excel's General format fits a number into at the default column width. */
export const GENERAL_WIDTH = 11

/**
 * Excel's General format: the number in at most `width` characters (sign included), showing as
 * many decimals as fit and switching to scientific notation when the integer part doesn't fit or
 * the number is below 0.0001 (`1E-05`, like printf's %g). Never more than 15 significant digits.
 */
export function formatGeneral(value: number, width = GENERAL_WIDTH): string {
  if (!Number.isFinite(value)) return '#NUM!'
  if (value === 0) return '0'
  const sign = value < 0 ? '-' : ''
  const room = Math.max(1, Math.floor(width) - sign.length)
  const decimal = toDecimal15(value)
  if (decimal.exp >= -4) {
    const intLength = decimal.exp >= 0 ? decimal.exp + 1 : 1
    if (intLength <= room) {
      const { int, frac } = fixedParts(decimal, Math.max(0, room - intLength - 1))
      const trimmed = frac.replace(/0+$/, '')
      if ((int || trimmed) && Math.max(int.length, 1) <= room) return sign + (int || '0') + (trimmed ? '.' + trimmed : '')
    }
  }
  return sign + scientific(decimal, (exponentLength) => room - 2 - exponentLength)
}

/**
 * How Excel turns a number into text outside of a cell (`=A1&""`, VALUETOTEXT, a number passed to
 * a text function): up to 15 significant digits, scientific below 0.0001 and from 1E+15 on.
 */
export function numberToText(value: number): string {
  if (!Number.isFinite(value)) return '#NUM!'
  if (value === 0) return '0'
  const sign = value < 0 ? '-' : ''
  const decimal = toDecimal15(value)
  if (decimal.exp < -4 || decimal.exp >= 15) return sign + scientific(decimal, () => 14)
  const { int, frac } = fixedParts(decimal, Math.max(0, decimal.digits.length - decimal.exp - 1))
  const trimmed = frac.replace(/0+$/, '')
  return sign + (int || '0') + (trimmed ? '.' + trimmed : '')
}

/**
 * `d.dddE+XX` with trailing zeros dropped; `decimalsFor(exponentLength)` says how many mantissa
 * decimals fit next to an exponent of that many characters (`E+05` is 4).
 */
function scientific(decimal: Decimal, decimalsFor: (exponentLength: number) => number): string {
  let exp = decimal.exp
  for (;;) {
    const exponent = String(Math.abs(exp)).padStart(2, '0')
    const decimals = Math.max(0, decimalsFor(exponent.length + 2))
    const { int, frac } = fixedParts(shift(decimal, -exp), decimals)
    // 9.9999999 can round up to 10.0000; redo it one power higher.
    if (int.length > 1) {
      exp += 1
      continue
    }
    const trimmed = frac.replace(/0+$/, '')
    return `${int || '0'}${trimmed ? '.' + trimmed : ''}E${exp < 0 ? '-' : '+'}${exponent}`
  }
}
