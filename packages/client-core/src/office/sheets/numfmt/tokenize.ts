import { NAMED_COLORS, PALETTE } from './builtin.js'

/**
 * Splits a format code into sections and tokens. Tokens keep their source text (`src`) so a
 * section that turns out to be text, or a token that means nothing where it sits, can be shown
 * the way it was written.
 */

export type DateLetter = 'y' | 'm' | 'd' | 'h' | 's' | 'e' | 'b' | 'g' | 'a'

export type Token = { src: string } & (
  | { t: 'lit'; v: string }
  | { t: 'fill'; v: string }
  | { t: 'digit'; v: '0' | '#' | '?' }
  | { t: 'point' }
  | { t: 'comma' }
  | { t: 'percent' }
  | { t: 'slash' }
  | { t: 'exp'; plus: boolean }
  | { t: 'at' }
  | { t: 'general' }
  /** A run of one date letter, e.g. `mmm` is `{ letter: 'm', n: 3 }`. */
  | { t: 'date'; letter: DateLetter; n: number }
  | { t: 'ampm'; am: string; pm: string }
  | { t: 'elapsed'; unit: 'h' | 'm' | 's'; n: number }
)

export type ConditionOp = '<' | '<=' | '>' | '>=' | '=' | '<>'

export interface Condition {
  op: ConditionOp
  value: number
}

export interface RawSection {
  tokens: Token[]
  color?: string
  condition?: Condition
}

/** Excel stops at 255 characters; anything far beyond is hostile, not a format. */
export const MAX_CODE_LENGTH = 2048

const DATE_LETTERS: Record<string, DateLetter> = { y: 'y', m: 'm', d: 'd', h: 'h', s: 's', b: 'b' }

/** The sections of a code, or undefined when the code is malformed (Excel would reject it). */
export function tokenize(code: string): RawSection[] | undefined {
  if (code.length > MAX_CODE_LENGTH) return undefined
  const sections: RawSection[] = []
  let section: RawSection = { tokens: [] }
  const push = (token: Token) => {
    const last = section.tokens[section.tokens.length - 1]
    // Merging literals keeps rendering to one string append per run of text.
    if (token.t === 'lit' && last?.t === 'lit') section.tokens[section.tokens.length - 1] = { t: 'lit', v: last.v + token.v, src: last.src + token.src }
    else section.tokens.push(token)
  }
  let i = 0
  while (i < code.length) {
    const c = code[i]!
    const lower = c.toLowerCase()
    if (c === ';') {
      sections.push(section)
      if (sections.length > 4) return undefined
      section = { tokens: [] }
      i++
    } else if (c === '"') {
      const end = code.indexOf('"', i + 1)
      if (end < 0) return undefined
      push({ t: 'lit', v: code.slice(i + 1, end), src: code.slice(i, end + 1) })
      i = end + 1
    } else if (c === '\\' || c === '_' || c === '*') {
      if (i + 1 >= code.length) return undefined
      const next = code[i + 1]!
      const src = c + next
      if (c === '\\') push({ t: 'lit', v: next, src })
      // `_x` leaves room the width of x; one space is the closest plain-text equivalent.
      else if (c === '_') push({ t: 'lit', v: ' ', src })
      else if (section.tokens.some((token) => token.t === 'fill')) push({ t: 'lit', v: '', src })
      else push({ t: 'fill', v: next, src })
      i += 2
    } else if (c === '[') {
      const end = code.indexOf(']', i + 1)
      if (end < 0) return undefined
      const content = code.slice(i + 1, end)
      const src = code.slice(i, end + 1)
      i = end + 1
      const elapsed = /^(h+|m+|s+)$/i.exec(content)
      if (elapsed) {
        push({ t: 'elapsed', unit: content[0]!.toLowerCase() as 'h' | 'm' | 's', n: content.length, src })
        continue
      }
      const color = bracketColor(content)
      if (color) {
        section.color ??= color
        continue
      }
      const condition = /^\s*(<=|>=|<>|<|>|=)\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*$/i.exec(content)
      if (condition) {
        section.condition = { op: condition[1] as ConditionOp, value: Number(condition[2]) }
        continue
      }
      // `[$€-407]`: the symbol before the dash is shown; the locale id after it (which can also pick
      // a calendar or digit system) is ignored. Other tags (`[DBNum1]`, `[NatNum1]`, …) are ignored.
      if (content.startsWith('$')) {
        const dash = content.indexOf('-', 1)
        const symbol = dash < 0 ? content.slice(1) : content.slice(1, dash)
        if (symbol) push({ t: 'lit', v: symbol, src })
      }
    } else if (c === '0' || c === '#' || c === '?') {
      push({ t: 'digit', v: c, src: c })
      i++
    } else if (c === '.') {
      push({ t: 'point', src: c })
      i++
    } else if (c === ',') {
      push({ t: 'comma', src: c })
      i++
    } else if (c === '%') {
      push({ t: 'percent', src: c })
      i++
    } else if (c === '/') {
      push({ t: 'slash', src: c })
      i++
    } else if (c === '@') {
      push({ t: 'at', src: c })
      i++
    } else if (lower === 'e' && (code[i + 1] === '+' || code[i + 1] === '-')) {
      push({ t: 'exp', plus: code[i + 1] === '+', src: code.slice(i, i + 2) })
      i += 2
    } else if (lower === 'g' && code.slice(i, i + 7).toLowerCase() === 'general') {
      push({ t: 'general', src: code.slice(i, i + 7) })
      i += 7
    } else if (lower === 'a' && code.slice(i, i + 5).toUpperCase() === 'AM/PM') {
      push({ t: 'ampm', am: 'AM', pm: 'PM', src: code.slice(i, i + 5) })
      i += 5
    } else if (lower === 'a' && code[i + 1] === '/' && code[i + 2]?.toLowerCase() === 'p') {
      push({ t: 'ampm', am: c, pm: code[i + 2]!, src: code.slice(i, i + 3) })
      i += 3
    } else if (DATE_LETTERS[lower] || lower === 'e' || lower === 'g' || lower === 'a') {
      let end = i + 1
      while (end < code.length && code[end]!.toLowerCase() === lower) end++
      const n = end - i
      const src = code.slice(i, end)
      i = end
      // `aaa`/`aaaa` are day names in some locales; a lone `a` is just a letter.
      if (lower === 'a' && n < 3) push({ t: 'lit', v: src, src })
      else push({ t: 'date', letter: (DATE_LETTERS[lower] ?? lower) as DateLetter, n, src })
    } else {
      push({ t: 'lit', v: c, src: c })
      i++
    }
  }
  sections.push(section)
  return sections.length > 4 ? undefined : sections
}

function bracketColor(content: string): string | undefined {
  const named = NAMED_COLORS[content.toLowerCase()]
  if (named) return named
  const indexed = /^color\s*(\d{1,2})$/i.exec(content)
  return indexed ? PALETTE[Number(indexed[1]) - 1] : undefined
}
