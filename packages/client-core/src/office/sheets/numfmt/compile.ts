import { type Condition, type RawSection, type Token, tokenize } from './tokenize.js'

/**
 * Turns tokenized sections into render plans, once per format code. Number sections become a list
 * of parts that say which placeholder each digit lands in; date sections resolve the `m`
 * month/minute ambiguity and the time precision up front.
 */

export type Placeholder = '0' | '#' | '?'

export type NumberPart =
  | { k: 'lit'; v: string }
  | { k: 'fill'; v: string }
  | { k: 'int'; i: number }
  | { k: 'point' }
  | { k: 'frac'; i: number }
  | { k: 'exp'; plus: boolean }
  | { k: 'expDigit'; i: number }
  | { k: 'num'; i: number }
  | { k: 'den'; i: number }
  | { k: 'general' }

export interface NumberLayout {
  mode: 'decimal' | 'scientific' | 'fraction'
  parts: NumberPart[]
  /** Power of ten applied before formatting: +2 per `%`, −3 per scaling comma. */
  scale: number
  grouping: boolean
  percent: boolean
  int: Placeholder[]
  frac: Placeholder[]
  exponent: Placeholder[]
  numerator: Placeholder[]
  denominator: Placeholder[]
  /** `?/8`: a written denominator instead of placeholders. */
  fixedDenominator?: number
  /** Index range of `parts` that make up `num/den`, blanked when the fraction is zero. */
  fractionStart: number
  fractionEnd: number
}

export type DatePart =
  | { k: 'lit'; v: string }
  | { k: 'fill'; v: string }
  | { k: 'year'; n: number }
  | { k: 'buddhistYear'; n: number }
  | { k: 'month'; n: number }
  | { k: 'day'; n: number }
  | { k: 'hour'; n: number }
  | { k: 'minute'; n: number }
  | { k: 'second'; n: number }
  | { k: 'subsecond'; n: number }
  | { k: 'ampm'; am: string; pm: string }
  | { k: 'elapsed'; unit: 'h' | 'm' | 's'; n: number }

export interface DateLayout {
  parts: DatePart[]
  twelveHour: boolean
  hasDate: boolean
  hasTime: boolean
  /** Digits of fractional seconds shown (0–3); times round to that precision. */
  subsecondDigits: number
}

export interface Section {
  kind: 'number' | 'date' | 'general' | 'text' | 'literal'
  tokens: Token[]
  color?: string
  condition?: Condition
  number?: NumberLayout
  date?: DateLayout
  hasFill: boolean
}

export interface CompiledFormat {
  /** Sections for numbers, in order (at most three). Empty: numbers show as General. */
  numeric: Section[]
  /** The section for text values (`@`), if the code has one. */
  text?: Section
  hasConditions: boolean
  /** The code was malformed and is treated as General. */
  error: boolean
}

const GENERAL_FORMAT: CompiledFormat = {
  numeric: [{ kind: 'general', tokens: [{ t: 'general', src: 'General' }], hasFill: false }],
  hasConditions: false,
  error: false,
}

const cache = new Map<string, CompiledFormat>()
/** Formats are shared by many cells, so few distinct codes exist; this only guards against floods. */
const CACHE_LIMIT = 5000

export function compileFormat(code: string): CompiledFormat {
  let compiled = cache.get(code)
  if (compiled) return compiled
  compiled = compileUncached(code)
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(code, compiled)
  return compiled
}

function compileUncached(code: string): CompiledFormat {
  if (!code || code.trim().toLowerCase() === 'general') return GENERAL_FORMAT
  const raw = tokenize(code)
  if (!raw) return { ...GENERAL_FORMAT, error: true }
  let textRaw: RawSection | undefined
  let numericRaw = raw
  const last = raw[raw.length - 1]!
  if (raw.length === 4) {
    textRaw = last
    numericRaw = raw.slice(0, 3)
  } else if (isTextSection(last)) {
    textRaw = last
    numericRaw = raw.slice(0, -1)
  }
  const numeric = numericRaw.map(compileSection)
  return {
    numeric,
    text: textRaw && { ...compileSection(textRaw), kind: 'text' },
    hasConditions: numeric.some((section) => section.condition),
    error: false,
  }
}

function isTextSection(section: RawSection): boolean {
  const types = new Set(section.tokens.map((token) => token.t))
  return types.has('at') && !types.has('digit') && !types.has('general')
}

function compileSection(raw: RawSection): Section {
  const { tokens } = raw
  const base = { tokens, color: raw.color, condition: raw.condition, hasFill: tokens.some((token) => token.t === 'fill') }
  if (tokens.some((token) => token.t === 'date' || token.t === 'ampm' || token.t === 'elapsed')) return { ...base, kind: 'date', date: compileDate(tokens) }
  if (tokens.some((token) => token.t === 'general')) return { ...base, kind: 'general' }
  if (tokens.some((token) => token.t === 'digit')) return { ...base, kind: 'number', number: compileNumber(tokens) }
  if (tokens.some((token) => token.t === 'at')) return { ...base, kind: 'text' }
  return { ...base, kind: 'literal' }
}

function compileNumber(tokens: Token[]): NumberLayout {
  const layout: NumberLayout = {
    mode: 'decimal',
    parts: [],
    scale: 0,
    grouping: false,
    percent: false,
    int: [],
    frac: [],
    exponent: [],
    numerator: [],
    denominator: [],
    fractionStart: 0,
    fractionEnd: 0,
  }
  const expIndex = tokens.findIndex((token, index) => token.t === 'exp' && tokens.slice(index + 1).some((after) => after.t === 'digit'))
  if (expIndex >= 0) layout.mode = 'scientific'
  else {
    const slash = fractionSlash(tokens)
    if (slash >= 0) {
      compileFraction(tokens, slash, layout)
      return layout
    }
  }
  const pointIndex = tokens.findIndex((token, index) => token.t === 'point' && (expIndex < 0 || index < expIndex))
  const mantissaEnd = expIndex >= 0 ? expIndex : tokens.length
  const intEnd = pointIndex >= 0 ? pointIndex : mantissaEnd
  let lastIntDigit = -1
  for (let i = 0; i < intEnd; i++) if (tokens[i]!.t === 'digit') lastIntDigit = i
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    switch (token.t) {
      case 'digit':
        if (expIndex >= 0 && i > expIndex) layout.parts.push({ k: 'expDigit', i: layout.exponent.push(token.v) - 1 })
        else if (i < intEnd) layout.parts.push({ k: 'int', i: layout.int.push(token.v) - 1 })
        else layout.parts.push({ k: 'frac', i: layout.frac.push(token.v) - 1 })
        break
      case 'point':
        layout.parts.push(i === pointIndex ? { k: 'point' } : { k: 'lit', v: '.' })
        break
      case 'percent':
        layout.scale += 2
        layout.percent = true
        layout.parts.push({ k: 'lit', v: '%' })
        break
      case 'comma': {
        // Between integer placeholders a comma groups thousands; right after the number's last
        // placeholder (or a scaling comma) each comma divides by 1000.
        const previous = tokens[i - 1]
        if (i < lastIntDigit && tokens.slice(0, i).some((before) => before.t === 'digit')) layout.grouping = true
        else if (i < mantissaEnd && (previous?.t === 'digit' || previous?.t === 'point' || previous?.t === 'comma') && !tokens.slice(i + 1, intEnd).some((after) => after.t === 'digit')) layout.scale -= 3
        break
      }
      case 'exp':
        layout.parts.push(i === expIndex ? { k: 'exp', plus: token.plus } : { k: 'lit', v: token.src })
        break
      case 'lit':
      case 'fill':
        layout.parts.push({ k: token.t, v: token.v })
        break
      default:
        layout.parts.push({ k: 'lit', v: token.t === 'at' ? '' : token.src })
    }
  }
  // Without integer placeholders before the point Excel still shows an integer part ('.5' for
  // `.0`), which the renderer handles by giving overflow digits nowhere to go but the point.
  return layout
}

/** The slash of a fraction (`# ?/?`, `?/8`), or -1. */
function fractionSlash(tokens: Token[]): number {
  for (let i = 1; i < tokens.length - 1; i++) {
    if (tokens[i]!.t !== 'slash' || tokens[i - 1]!.t !== 'digit') continue
    const next = tokens[i + 1]!
    if (next.t === 'digit' || (next.t === 'lit' && /^[1-9]/.test(next.v))) return i
  }
  return -1
}

function compileFraction(tokens: Token[], slash: number, layout: NumberLayout): void {
  layout.mode = 'fraction'
  let numeratorStart = slash
  while (numeratorStart > 0 && tokens[numeratorStart - 1]!.t === 'digit') numeratorStart--
  // A written denominator is literal digits, possibly continued by `0` placeholders (`/100`).
  let denominatorEnd = slash + 1
  let fixed = ''
  let rest = ''
  const first = tokens[slash + 1]!
  if (first.t === 'lit') {
    fixed = /^\d+/.exec(first.v)![0]
    rest = first.v.slice(fixed.length)
    denominatorEnd = slash + 2
    while (!rest && denominatorEnd < tokens.length) {
      const token = tokens[denominatorEnd]!
      if (token.t === 'digit' && token.v === '0') fixed += '0'
      else if (token.t === 'lit' && /^\d+$/.test(token.v)) fixed += token.v
      else break
      denominatorEnd++
    }
    layout.fixedDenominator = Number(fixed)
  } else {
    while (denominatorEnd < tokens.length && tokens[denominatorEnd]!.t === 'digit') denominatorEnd++
  }
  const mixed = tokens.slice(0, numeratorStart).some((token) => token.t === 'digit')
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (i === numeratorStart) layout.fractionStart = layout.parts.length
    if (i === slash) {
      layout.parts.push({ k: 'lit', v: '/' })
      if (fixed) {
        layout.parts.push({ k: 'lit', v: fixed })
        layout.fractionEnd = layout.parts.length
        if (rest) layout.parts.push({ k: 'lit', v: rest })
        i = denominatorEnd - 1
      }
      continue
    }
    switch (token.t) {
      case 'digit':
        if (i >= numeratorStart && i < slash) layout.parts.push({ k: 'num', i: layout.numerator.push(token.v) - 1 })
        else if (i > slash && i < denominatorEnd) layout.parts.push({ k: 'den', i: layout.denominator.push(token.v) - 1 })
        else if (mixed && i < numeratorStart) layout.parts.push({ k: 'int', i: layout.int.push(token.v) - 1 })
        else layout.parts.push({ k: 'lit', v: token.v })
        break
      case 'percent':
        layout.scale += 2
        layout.percent = true
        layout.parts.push({ k: 'lit', v: '%' })
        break
      case 'lit':
      case 'fill':
        layout.parts.push({ k: token.t, v: token.v })
        break
      case 'comma':
        break
      default:
        layout.parts.push({ k: 'lit', v: token.t === 'at' ? '' : token.src })
    }
    if (i === denominatorEnd - 1) layout.fractionEnd = layout.parts.length
  }
}

function compileDate(tokens: Token[]): DateLayout {
  const parts: DatePart[] = []
  let subsecondDigits = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    switch (token.t) {
      case 'date': {
        const { letter, n } = token
        if (letter === 'y' || letter === 'e') parts.push({ k: 'year', n: letter === 'e' || n > 2 ? 4 : 2 })
        else if (letter === 'b') parts.push({ k: 'buddhistYear', n: n > 2 ? 4 : 2 })
        else if (letter === 'm') parts.push({ k: 'month', n: n > 5 ? 4 : n })
        else if (letter === 'd') parts.push({ k: 'day', n: Math.min(n, 4) })
        else if (letter === 'a') parts.push({ k: 'day', n: n > 3 ? 4 : 3 })
        else if (letter === 'h') parts.push({ k: 'hour', n: Math.min(n, 2) })
        else if (letter === 's') parts.push({ k: 'second', n: Math.min(n, 2) })
        // `g` era names only exist in Japanese/Chinese/Korean calendars; en-US shows nothing.
        break
      }
      case 'ampm':
        parts.push({ k: 'ampm', am: token.am, pm: token.pm })
        break
      case 'elapsed':
        parts.push({ k: 'elapsed', unit: token.unit, n: token.n })
        break
      case 'point': {
        let zeros = 0
        while (tokens[i + 1 + zeros]?.t === 'digit' && (tokens[i + 1 + zeros] as { v: string }).v === '0') zeros++
        if (zeros === 0) {
          parts.push({ k: 'lit', v: '.' })
          break
        }
        const shown = Math.min(zeros, 3)
        parts.push({ k: 'lit', v: '.' }, { k: 'subsecond', n: shown })
        if (zeros > shown) parts.push({ k: 'lit', v: '0'.repeat(zeros - shown) })
        subsecondDigits = Math.max(subsecondDigits, shown)
        i += zeros
        break
      }
      case 'lit':
      case 'fill':
        parts.push({ k: token.t, v: token.v })
        break
      case 'digit':
        parts.push({ k: 'lit', v: token.v })
        break
      default:
        parts.push({ k: 'lit', v: token.t === 'at' ? '' : token.src })
    }
  }
  resolveMinutes(parts)
  const has = (k: DatePart['k']) => parts.some((part) => part.k === k)
  return {
    parts,
    twelveHour: has('ampm'),
    hasDate: has('year') || has('buddhistYear') || has('month') || has('day'),
    hasTime: has('hour') || has('minute') || has('second') || has('subsecond') || has('ampm') || has('elapsed'),
    subsecondDigits,
  }
}

const TIME_NEIGHBORS = new Set(['hour', 'second', 'elapsed', 'month', 'day', 'year', 'buddhistYear', 'ampm', 'minute', 'subsecond'])

/**
 * `m`/`mm` means minutes right after an hour or right before a second (literals in between don't
 * count), and month otherwise. `mmm` and longer are always months.
 */
function resolveMinutes(parts: DatePart[]): void {
  const neighbor = (from: number, step: number): DatePart | undefined => {
    for (let i = from + step; i >= 0 && i < parts.length; i += step) if (TIME_NEIGHBORS.has(parts[i]!.k)) return parts[i]
    return undefined
  }
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (part.k !== 'month' || part.n > 2) continue
    const before = neighbor(i, -1)
    const after = neighbor(i, 1)
    const afterHour = before?.k === 'hour' || (before?.k === 'elapsed' && before.unit === 'h')
    const beforeSecond = after?.k === 'second' || (after?.k === 'elapsed' && after.unit === 's')
    if (afterHour || beforeSecond) parts[i] = { k: 'minute', n: part.n }
  }
}
