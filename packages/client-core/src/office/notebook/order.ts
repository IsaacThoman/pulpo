/**
 * Cell positions as fractional keys: strings that sort in notebook order, with room between any
 * two. A cell moves by taking a new key between its new neighbours, so it stays the same Y.Map
 * and edits made to it meanwhile (on any replica) are kept, which moving within a Y.Array (a
 * delete and an insert of a copy) would lose.
 *
 * Keys are base-62 fractions (`0.k₁k₂…`) that never end in the lowest digit, so another always
 * fits between two. Each new key ends in random digits: two people inserting at the same place at
 * once get different keys, and cells with equal keys still sort by id.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length
/** Random digits appended to a new key; 62³ ≈ 238,000 ways for concurrent inserts to differ. */
const JITTER_DIGITS = 3

function digit(key: string, index: number): number {
  const value = DIGITS.indexOf(key[index] ?? '0')
  return value < 0 ? 0 : value
}

export function isOrderKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-Za-z]*[1-9A-Za-z]$/.test(value)
}

/**
 * A key strictly between `before` and `after` (null for the start or end of the notebook).
 * `random` returns a number in [0, 1), so tests can make keys predictable.
 */
export function orderKeyBetween(before: string | null, after: string | null, random: () => number = Math.random): string {
  const low = before ?? ''
  let high = after
  // A key that does not sort after `before` cannot bound anything: place after `before` instead.
  if (high !== null && !(high > low)) high = null
  const pick = (from: number, to: number) => from + Math.floor(random() * (to - from + 1))
  let key = ''
  let fits = true
  for (let index = 0; ; index += 1) {
    // Only a malformed `after` (one ending in the lowest digit, written by another client) runs out
    // while still bounding: nothing fits below it, so the key goes after `before` instead.
    if (high !== null && index >= high.length) {
      fits = false
      break
    }
    const lowDigit = digit(low, index)
    const highDigit = high === null ? BASE : digit(high, index)
    if (highDigit - lowDigit >= 2) {
      // Without an upper bound (appending), take a small step, so cells added one after another
      // lengthen keys by a digit every few dozen rather than every few.
      key += DIGITS[high === null ? pick(lowDigit + 1, Math.min(lowDigit + 2, BASE - 1)) : pick(lowDigit + 1, Math.min(highDigit - 1, BASE - 1))]
      break
    }
    key += DIGITS[lowDigit]
    // A lower digit here makes every later one free of the upper bound.
    if (highDigit - lowDigit === 1) high = null
  }
  let jitter = ''
  for (let index = 0; index < JITTER_DIGITS; index += 1) jitter += DIGITS[pick(index === JITTER_DIGITS - 1 ? 1 : 0, BASE - 1)]
  key += jitter
  // Keys written by another client may hold other characters; never return one before `before`.
  if (!fits || !(key > low)) return `${low}V${jitter}`
  return key
}

/** `count` keys in order after `before` and before `after`, e.g. for cells pasted together. */
export function orderKeysBetween(before: string | null, after: string | null, count: number, random: () => number = Math.random): string[] {
  const keys: string[] = []
  let previous = before
  for (let index = 0; index < count; index += 1) {
    previous = orderKeyBetween(previous, after, random)
    keys.push(previous)
  }
  return keys
}

/** Keys for a notebook's cells in order, spread evenly so later inserts stay short. */
export function initialOrderKeys(count: number, random: () => number = Math.random): string[] {
  if (count === 0) return []
  // Two digits hold 3,844 slots; longer notebooks get longer keys.
  let width = 1
  while (BASE ** width < (count + 1) * 4) width += 1
  const span = BASE ** width
  const keys: string[] = []
  for (let index = 0; index < count; index += 1) {
    let value = Math.floor(((index + 1) * span) / (count + 1))
    let text = ''
    for (let place = 0; place < width; place += 1) {
      text = DIGITS[value % BASE] + text
      value = Math.floor(value / BASE)
    }
    // Same width throughout, so the keys sort as their values; the last digit is never 0.
    keys.push(text + DIGITS[1 + Math.floor(random() * (BASE - 1))])
  }
  return keys
}
