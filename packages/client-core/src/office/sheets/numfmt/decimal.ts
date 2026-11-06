/**
 * Exact decimal arithmetic on Excel's 15 significant digits. Excel never shows more than 15
 * significant digits of a double, so it rounds there first (0.1+0.2 is 0.3, 1.005 rounds to 1.01).
 * Working on the decimal digit string afterwards keeps binary noise out of every later step.
 */

/**
 * A non-negative decimal: the first digit of `digits` sits at 10^`exp`. `digits` has no leading or
 * trailing zeros; zero is the empty string.
 */
export interface Decimal {
  digits: string
  exp: number
}

export const ZERO: Decimal = { digits: '', exp: 0 }

/** |value| rounded to 15 significant digits. */
export function toDecimal15(value: number): Decimal {
  if (value === 0 || !Number.isFinite(value)) return ZERO
  const text = Math.abs(value).toExponential(14)
  const e = text.indexOf('e')
  const digits = (text[0]! + text.slice(2, e)).replace(/0+$/, '')
  return { digits, exp: Number(text.slice(e + 1)) }
}

/** Multiplies by 10^`places`. */
export function shift(value: Decimal, places: number): Decimal {
  return value.digits ? { digits: value.digits, exp: value.exp + places } : value
}

/** Adds one unit in the last place of a digit string ('' → '1', '199' → '200'). */
function increment(digits: string): string {
  let i = digits.length - 1
  while (i >= 0 && digits[i] === '9') i--
  if (i < 0) return '1' + '0'.repeat(digits.length)
  return digits.slice(0, i) + String.fromCharCode(digits.charCodeAt(i) + 1) + '0'.repeat(digits.length - i - 1)
}

/** Rounds half away from zero to `decimals` places (negative rounds left of the point). */
export function roundDecimal(value: Decimal, decimals: number): Decimal {
  if (!value.digits) return value
  const keep = value.exp + 1 + decimals
  if (keep >= value.digits.length) return value
  if (keep < 0) return ZERO
  const roundUp = value.digits.charCodeAt(keep) >= 53 /* '5' */
  let digits = value.digits.slice(0, keep)
  let exp = value.exp
  if (roundUp) {
    const bigger = increment(digits)
    if (bigger.length > digits.length) exp += 1
    digits = bigger
  }
  digits = digits.replace(/0+$/, '')
  return digits ? { digits, exp } : ZERO
}

/**
 * Splits into integer digits (no leading zeros, '' for zero) and exactly `decimals` fraction
 * digits, rounding half away from zero.
 */
export function fixedParts(value: Decimal, decimals: number): { int: string; frac: string } {
  const { digits, exp } = roundDecimal(value, decimals)
  if (!digits) return { int: '', frac: '0'.repeat(decimals) }
  if (exp >= 0) {
    const int = digits.length > exp + 1 ? digits.slice(0, exp + 1) : digits + '0'.repeat(exp + 1 - digits.length)
    return { int, frac: digits.slice(exp + 1).padEnd(decimals, '0') }
  }
  return { int: '', frac: ('0'.repeat(-exp - 1) + digits).padEnd(decimals, '0') }
}

/** The value as a JavaScript number. */
export function decimalToNumber(value: Decimal): number {
  return value.digits ? Number(`${value.digits[0]}.${value.digits.slice(1)}e${value.exp}`) : 0
}

/** Rounds a number half away from zero at 15 significant digits, like Excel's ROUND. */
export function roundNumber(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value
  const rounded = decimalToNumber(roundDecimal(toDecimal15(value), decimals))
  // No negative zero: Excel has none.
  return value < 0 && rounded ? -rounded : rounded
}
