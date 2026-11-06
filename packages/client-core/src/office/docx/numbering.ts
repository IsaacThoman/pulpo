import { jmlAttr, jmlChild, jmlElements, jmlNumber, jmlOn, unpackJml, type JmlElement } from './jsonml.js'
import { symbolText } from './schema.js'
import type { StyleSheet } from './styles.js'

/**
 * Word numbering: list definitions (`w:abstractNum`), instances (`w:num`) with level overrides,
 * and the counters that turn them into labels (`1.`, `a)`, `iii.`, `2.1.3`, bullets) in document
 * order, the way Word computes them.
 */

export interface LevelDef {
  ilvl: number
  start: number
  numFmt: string
  /** `w:numFmt w:format` for `custom` formats. */
  format?: string
  lvlText: string
  lvlJc: string
  suff: 'tab' | 'space' | 'nothing'
  isLgl: boolean
  /** 1-based level after which this one restarts; 0 never restarts; undefined after any higher level. */
  lvlRestart?: number
  pPr?: JmlElement
  rPr?: JmlElement
  pStyle?: string
  picBulletId?: string
}

export interface ListLabel {
  text: string
  level: LevelDef
  numId: string
  abstractId: string
}

const MAX_LEVELS = 9

function parseLevel(element: JmlElement): LevelDef {
  const numFmt = jmlChild(element, 'w:numFmt')
  const suff = jmlAttr(jmlChild(element, 'w:suff'), 'w:val')
  const restart = jmlChild(element, 'w:lvlRestart')
  return {
    ilvl: jmlNumber(element, 'w:ilvl') ?? 0,
    start: jmlNumber(jmlChild(element, 'w:start'), 'w:val') ?? 0,
    numFmt: jmlAttr(numFmt, 'w:val') ?? 'decimal',
    format: jmlAttr(numFmt, 'w:format'),
    lvlText: jmlAttr(jmlChild(element, 'w:lvlText'), 'w:val') ?? '',
    lvlJc: jmlAttr(jmlChild(element, 'w:lvlJc'), 'w:val') ?? 'left',
    suff: suff === 'space' || suff === 'nothing' ? suff : 'tab',
    isLgl: jmlOn(jmlChild(element, 'w:isLgl')) === true,
    lvlRestart: restart ? jmlNumber(restart, 'w:val') : undefined,
    pPr: jmlChild(element, 'w:pPr'),
    rPr: jmlChild(element, 'w:rPr'),
    pStyle: jmlAttr(jmlChild(element, 'w:pStyle'), 'w:val'),
    picBulletId: jmlAttr(jmlChild(element, 'w:lvlPicBulletId'), 'w:val'),
  }
}

const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]

function roman(value: number): string {
  if (value <= 0 || value >= 4000) return String(value)
  let rest = value
  let text = ''
  for (const [amount, letters] of ROMAN) while (rest >= amount) {
    text += letters
    rest -= amount
  }
  return text
}

/** Word's letters: a…z, then aa…zz, then aaa… (the letter repeats rather than counting on). */
/** Most times a letter or symbol repeats in a counter; larger counters (a hostile `w:start`) show as digits. */
const MAX_REPEAT = 30

function letters(value: number): string {
  if (value <= 0) return String(value)
  const index = (value - 1) % 26
  const repeat = Math.floor((value - 1) / 26) + 1
  if (repeat > MAX_REPEAT) return String(value)
  return String.fromCharCode(97 + index).repeat(repeat)
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function cardinal(value: number): string {
  if (value < 0) return String(value)
  if (value < 20) return ONES[value]!
  if (value < 100) return TENS[Math.floor(value / 10)]! + (value % 10 ? `-${ONES[value % 10]}` : '')
  if (value < 1000) return `${ONES[Math.floor(value / 100)]} hundred${value % 100 ? ` ${cardinal(value % 100)}` : ''}`
  if (value < 1_000_000) return `${cardinal(Math.floor(value / 1000))} thousand${value % 1000 ? ` ${cardinal(value % 1000)}` : ''}`
  return String(value)
}

const ORDINAL_WORDS: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' }

function ordinalText(value: number): string {
  const words = cardinal(value)
  return words.replace(/([a-z]+)$/, (last) => ORDINAL_WORDS[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`))
}

function ordinal(value: number): string {
  const tens = value % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'
  return `${value}${suffix}`
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** A counter in a Word number format. */
export function formatNumber(value: number, format: string): string {
  switch (format) {
    case 'decimal': return String(value)
    case 'decimalZero': return value < 10 && value >= 0 ? `0${value}` : String(value)
    case 'upperRoman': return roman(value).toUpperCase()
    case 'lowerRoman': return roman(value)
    case 'upperLetter': return letters(value).toUpperCase()
    case 'lowerLetter': return letters(value)
    case 'ordinal': return ordinal(value)
    case 'cardinalText': return capitalize(cardinal(value))
    case 'ordinalText': return capitalize(ordinalText(value))
    case 'hex': return value.toString(16).toUpperCase()
    case 'chicago': return value >= 1 && value <= MAX_REPEAT * 4 ? ['*', '†', '‡', '§'][(value - 1) % 4]!.repeat(Math.floor((value - 1) / 4) + 1) : String(value)
    case 'decimalEnclosedCircle':
    case 'decimalEnclosedCircleChinese': return value >= 1 && value <= 20 ? String.fromCodePoint(0x2460 + value - 1) : String(value)
    case 'decimalEnclosedParen': return value >= 1 && value <= 20 ? String.fromCodePoint(0x2474 + value - 1) : `(${value})`
    case 'decimalEnclosedFullstop': return value >= 1 && value <= 20 ? String.fromCodePoint(0x2488 + value - 1) : `${value}.`
    case 'decimalFullWidth':
    case 'decimalFullWidth2': return String(value).replace(/\d/g, (digit) => String.fromCodePoint(0xff10 + Number(digit)))
    case 'numberInDash': return `- ${value} -`
    case 'none': return ''
    case 'bullet': return ''
    default: return String(value)
  }
}

/** Bullet text as most fonts can draw it (Symbol and Wingdings put glyphs in private-use code points). */
export function bulletText(text: string, rPr: JmlElement | undefined): string {
  const font = jmlAttr(jmlChild(rPr, 'w:rFonts'), 'w:ascii') ?? jmlAttr(jmlChild(rPr, 'w:rFonts'), 'w:hAnsi')
  return Array.from(text, (char) => {
    const code = char.codePointAt(0)!
    if (code >= 0xf000 && code <= 0xf0ff) return symbolText(font ?? 'Symbol', code.toString(16))
    if (font && /symbol|wingdings/i.test(font) && code < 0x100) return symbolText(font, (0xf000 + code).toString(16))
    return char
  }).join('')
}

export class Numbering {
  private readonly abstracts = new Map<string, JmlElement>()
  private readonly nums = new Map<string, JmlElement>()
  private readonly levelCache = new Map<string, LevelDef | undefined>()

  constructor(entries: Iterable<[string, string]>, private readonly styles?: StyleSheet) {
    for (const [key, value] of entries) {
      const element = unpackJml<JmlElement>(value)
      if (!element) continue
      if (key.startsWith('abstract:')) this.abstracts.set(key.slice(9), element)
      else if (key.startsWith('num:')) this.nums.set(key.slice(4), element)
    }
  }

  hasNum(numId: string): boolean {
    return this.nums.has(numId)
  }

  /** The abstract definition behind a num, following `w:numStyleLink` through numbering styles. */
  abstractId(numId: string, depth = 0): string | undefined {
    const num = this.nums.get(numId)
    const id = jmlAttr(jmlChild(num, 'w:abstractNumId'), 'w:val')
    if (id === undefined || depth > 8) return id
    const abstract = this.abstracts.get(id)
    const link = jmlAttr(jmlChild(abstract, 'w:numStyleLink'), 'w:val')
    if (!link || !this.styles) return id
    const style = this.styles.get(link)
    const linkedNum = jmlAttr(jmlChild(jmlChild(style?.pPr, 'w:numPr'), 'w:numId'), 'w:val')
    return linkedNum && linkedNum !== numId ? (this.abstractId(linkedNum, depth + 1) ?? id) : id
  }

  /** Level `ilvl` of a num, with the num's overrides applied. */
  level(numId: string, ilvl: number): LevelDef | undefined {
    const key = `${numId}/${ilvl}`
    if (this.levelCache.has(key)) return this.levelCache.get(key)
    let result: LevelDef | undefined
    const num = this.nums.get(numId)
    const abstractId = this.abstractId(numId)
    const abstract = abstractId === undefined ? undefined : this.abstracts.get(abstractId)
    const levelElement = abstract && jmlElements(abstract).find((child) => child[0] === 'w:lvl' && (jmlNumber(child, 'w:ilvl') ?? 0) === ilvl)
    if (levelElement) result = parseLevel(levelElement)
    const override = num && jmlElements(num).find((child) => child[0] === 'w:lvlOverride' && (jmlNumber(child, 'w:ilvl') ?? 0) === ilvl)
    const overrideLevel = jmlChild(override, 'w:lvl')
    if (overrideLevel) result = parseLevel(overrideLevel)
    this.levelCache.set(key, result)
    return result
  }

  /** The `w:startOverride` a num sets for a level. */
  startOverride(numId: string, ilvl: number): number | undefined {
    const num = this.nums.get(numId)
    const override = num && jmlElements(num).find((child) => child[0] === 'w:lvlOverride' && (jmlNumber(child, 'w:ilvl') ?? 0) === ilvl)
    return jmlNumber(jmlChild(override, 'w:startOverride'), 'w:val')
  }

  /** Free ids for a new list definition and instance. */
  nextIds(): { abstractId: string; numId: string } {
    const next = (keys: Iterable<string>) => String(Math.max(0, ...[...keys].map(Number).filter(Number.isFinite)) + 1)
    return { abstractId: next(this.abstracts.keys()), numId: next(this.nums.keys()) }
  }
}

/** A paragraph's list membership: direct numbering, else its style's. */
export function effectiveNumPr(
  numPr: JmlElement | undefined,
  pStyle: string | null | undefined,
  styles: StyleSheet,
): { numId: string; ilvl: number } | undefined {
  const styleNumPr = styles.resolve(styles.paragraphStyle(pStyle)?.id).pPr.get('w:numPr')
  const numId = jmlAttr(jmlChild(numPr, 'w:numId'), 'w:val') ?? jmlAttr(jmlChild(styleNumPr, 'w:numId'), 'w:val')
  if (numId === undefined || numId === '0') return undefined
  const ilvl = jmlNumber(jmlChild(numPr, 'w:ilvl'), 'w:val') ?? jmlNumber(jmlChild(styleNumPr, 'w:ilvl'), 'w:val') ?? 0
  return { numId, ilvl: Math.max(0, Math.min(MAX_LEVELS - 1, ilvl)) }
}

/**
 * Computes list labels in document order. Counters belong to the abstract definition, so lists
 * that share one continue each other, unless a num restarts a level with `w:startOverride`.
 */
export class ListCounter {
  private readonly counters = new Map<string, (number | undefined)[]>()
  private readonly started = new Set<string>()

  constructor(private readonly numbering: Numbering) {}

  next(numId: string, ilvl: number): ListLabel | undefined {
    const level = this.numbering.level(numId, ilvl)
    const abstractId = this.numbering.abstractId(numId)
    if (!level || abstractId === undefined) return undefined
    const key = abstractId
    let counters = this.counters.get(key)
    if (!counters) {
      counters = Array.from({ length: MAX_LEVELS }, () => undefined)
      this.counters.set(key, counters)
    }
    const override = this.numbering.startOverride(numId, ilvl)
    const startKey = `${numId}/${ilvl}`
    if (override !== undefined && !this.started.has(startKey)) {
      this.started.add(startKey)
      counters[ilvl] = override - 1
    }
    counters[ilvl] = (counters[ilvl] ?? level.start - 1) + 1
    for (let deeper = ilvl + 1; deeper < MAX_LEVELS; deeper++) {
      const deeperLevel = this.numbering.level(numId, deeper)
      const restart = deeperLevel?.lvlRestart
      if (restart === 0) continue
      if (restart === undefined || ilvl <= restart - 1) counters[deeper] = undefined
    }
    const text = level.numFmt === 'bullet'
      ? bulletText(level.lvlText, level.rPr)
      : level.lvlText.replace(/%([1-9])/g, (_match, digit: string) => {
        const index = Number(digit) - 1
        const referenced = this.numbering.level(numId, index)
        const value = counters![index] ?? referenced?.start ?? 1
        const format = level.isLgl && index !== ilvl ? 'decimal' : (referenced?.numFmt ?? 'decimal')
        return formatNumber(value, level.isLgl ? (format === 'decimalZero' ? format : 'decimal') : format)
      })
    return { text, level, numId, abstractId }
  }
}
