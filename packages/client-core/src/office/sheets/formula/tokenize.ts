/**
 * Excel formula tokenizer. Works on formula text without the leading `=`, never throws, and keeps
 * exact `start`/`end` offsets so a formula bar can color references and the model layer can rewrite
 * them in place. Bad input becomes `invalid` tokens rather than an exception.
 */

import { MAX_COLS, MAX_ROWS, columnIndex } from '../address.js'
import type { ErrorCode } from './types.js'

export type TokenKind =
  | 'number'
  | 'string'
  | 'bool'
  | 'error'
  /** A cell, range, whole-column or whole-row reference, optionally sheet-qualified. */
  | 'ref'
  /** A defined name, table name, or LET/LAMBDA variable, optionally sheet-qualified. */
  | 'name'
  /** A function name; the next token is always `open`. */
  | 'function'
  | 'structured'
  /** A reference into another workbook, kept opaque (`[1]Sheet1!A1`, `'[Book.xlsx]Sheet'!A1`). */
  | 'external'
  | 'operator'
  | 'open'
  | 'close'
  | 'comma'
  /** Row separator inside array constants. */
  | 'semicolon'
  | 'array-open'
  | 'array-close'
  | 'whitespace'
  | 'invalid'

/** The sheet part of a qualified reference, unquoted. */
export interface SheetPrefix {
  sheet: string
  /** The last sheet of a 3D reference (`Sheet1:Sheet3!A1`). */
  lastSheet?: string
}

/**
 * A parsed A1 reference. Zero-based; whole columns span every row and whole rows every column. The
 * two corners are kept as written (`B2:A1` is not normalized).
 */
export interface RefParts {
  kind: 'cell' | 'range' | 'cols' | 'rows'
  sheet?: SheetPrefix
  row: number
  col: number
  row2: number
  col2: number
  rowAbs: boolean
  colAbs: boolean
  row2Abs: boolean
  col2Abs: boolean
}

export type StructuredItem = '#All' | '#Data' | '#Headers' | '#Totals' | '#This Row'

/** A structured (table) reference such as `Table1[[#Headers],[A]:[B]]` or `[@Amount]`. */
export interface StructuredRef {
  /** Undefined for references inside a table to the same table (`[@Col]`). */
  table?: string
  /** Special items, normalized. Empty means the data rows. `@` becomes `#This Row`. */
  items: StructuredItem[]
  /** Unescaped column names; `lastColumn` is set for column ranges. */
  firstColumn?: string
  lastColumn?: string
}

export interface Token {
  kind: TokenKind
  /** The exact source text of the token. */
  text: string
  start: number
  end: number
  /** For `ref`, `name`, `function`, and `error` tokens written with a sheet qualifier. */
  sheet?: SheetPrefix
  ref?: RefParts
  /** For `name` and `function`: the name as written, without any sheet qualifier. */
  name?: string
  structured?: StructuredRef
  /** Literal value of `number`, `string`, and `bool` tokens. */
  value?: number | string | boolean
  error?: ErrorCode
  /** Why an `invalid` token is invalid. */
  message?: string
}

const ERROR_CODES: ErrorCode[] = [
  '#GETTING_DATA',
  '#CONNECT!',
  '#BLOCKED!',
  '#UNKNOWN!',
  '#DIV/0!',
  '#VALUE!',
  '#SPILL!',
  '#FIELD!',
  '#NULL!',
  '#NAME?',
  '#CALC!',
  '#BUSY!',
  '#REF!',
  '#NUM!',
  '#N/A',
]

const WHITESPACE = /[ \t\r\n]+/y
const NUMBER = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y
const ROW_RANGE = /(\$?)(\d{1,7}):(\$?)(\d{1,7})/y
const CELL = /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/y
const COL_RANGE = /(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})/y
const IDENT = /[A-Za-z_\\¡-￿][\w.?\\¡-￿]*/y
const SHEET_NAME = '[A-Za-z_\\\\\\u00A1-\\uFFFF][\\w.\\\\\\u00A1-\\uFFFF]*'
const SHEET_PREFIX = new RegExp(`(${SHEET_NAME})(?::(${SHEET_NAME}))?!`, 'y')
const IDENT_CHAR = /[\w.?\\¡-￿]/

function stickyMatch(pattern: RegExp, text: string, at: number): RegExpExecArray | null {
  pattern.lastIndex = at
  return pattern.exec(text)
}

function isIdentChar(char: string | undefined): boolean {
  return char !== undefined && IDENT_CHAR.test(char)
}

/** Tokenizes formula text (without the leading `=`). Never throws. */
export function tokenize(text: string): Token[] {
  return new Tokenizer(String(text)).run()
}

class Tokenizer {
  private tokens: Token[] = []
  private i = 0

  constructor(private readonly text: string) {}

  run(): Token[] {
    const { text } = this
    while (this.i < text.length) {
      const start = this.i
      try {
        this.step()
      } catch {
        this.push('invalid', start, text.length, { message: 'Unreadable formula' })
      }
      if (this.i <= start) this.push('invalid', start, start + 1, { message: 'Unexpected character' })
    }
    return this.tokens
  }

  private push(kind: TokenKind, start: number, end: number, extra: Partial<Token> = {}): Token {
    const token: Token = { kind, text: this.text.slice(start, end), start, end, ...extra }
    this.tokens.push(token)
    this.i = end
    return token
  }

  private lastSignificant(): Token | undefined {
    for (let k = this.tokens.length - 1; k >= 0; k--) if (this.tokens[k]!.kind !== 'whitespace') return this.tokens[k]
    return undefined
  }

  private step(): void {
    const { text } = this
    const start = this.i
    const char = text[start]!
    const ws = stickyMatch(WHITESPACE, text, start)
    if (ws) return void this.push('whitespace', start, start + ws[0].length)
    switch (char) {
      case '"':
        return this.string()
      case "'":
        return this.quotedPrefix()
      case '[':
        return this.bracketStart()
      case '{':
        return void this.push('array-open', start, start + 1)
      case '}':
        return void this.push('array-close', start, start + 1)
      case '(':
        return void this.push('open', start, start + 1)
      case ')':
        return void this.push('close', start, start + 1)
      case ',':
        return void this.push('comma', start, start + 1)
      case ';':
        return void this.push('semicolon', start, start + 1)
      case '#':
        return this.hash()
      case '<':
        if (text[start + 1] === '>' || text[start + 1] === '=') return void this.push('operator', start, start + 2)
        return void this.push('operator', start, start + 1)
      case '>':
        if (text[start + 1] === '=') return void this.push('operator', start, start + 2)
        return void this.push('operator', start, start + 1)
      case '=':
      case '+':
      case '-':
      case '*':
      case '/':
      case '^':
      case '&':
      case '%':
      case ':':
      case '@':
        return void this.push('operator', start, start + 1)
    }
    if (char === '$' || /[0-9.]/.test(char)) {
      if (this.rowRange(start, undefined, start)) return
      if (char !== '$') {
        const number = stickyMatch(NUMBER, text, start)
        if (number) return void this.push('number', start, start + number[0].length, { value: Number(number[0]) })
      }
      if (this.cellOrRange(start, undefined, start)) return
      if (this.colRange(start, undefined, start)) return
      return void this.push('invalid', start, start + 1, { message: 'Unexpected character' })
    }
    if (/[A-Za-z_\\¡-￿]/.test(char)) {
      const prefix = stickyMatch(SHEET_PREFIX, text, start)
      if (prefix) {
        const sheet: SheetPrefix = prefix[2] === undefined ? { sheet: prefix[1]! } : { sheet: prefix[1]!, lastSheet: prefix[2] }
        return this.refBody(start, start + prefix[0].length, sheet)
      }
      if (this.cellOrRange(start, undefined, start)) return
      if (this.colRange(start, undefined, start)) return
      return this.identifier(start, start, undefined)
    }
    this.push('invalid', start, start + 1, { message: 'Unexpected character' })
  }

  private string(): void {
    const { text } = this
    const start = this.i
    let value = ''
    let j = start + 1
    while (j < text.length) {
      const char = text[j]!
      if (char === '"') {
        if (text[j + 1] === '"') {
          value += '"'
          j += 2
          continue
        }
        return void this.push('string', start, j + 1, { value })
      }
      value += char
      j++
    }
    this.push('invalid', start, text.length, { message: 'Unterminated string' })
  }

  private hash(): void {
    const { text } = this
    const start = this.i
    const previous = this.tokens[this.tokens.length - 1]
    if (previous && previous.end === start && (previous.kind === 'ref' || previous.kind === 'name' || previous.kind === 'close')) {
      return void this.push('operator', start, start + 1)
    }
    const upper = text.slice(start, start + 14).toUpperCase()
    for (const code of ERROR_CODES) {
      if (upper.startsWith(code)) return void this.push('error', start, start + code.length, { error: code })
    }
    this.push('invalid', start, start + 1, { message: 'Unknown error value' })
  }

  /** `'Sheet name'!…`, `'Sheet 1:Sheet 3'!…`, or `'[Book.xlsx]Sheet'!…` (external). */
  private quotedPrefix(): void {
    const { text } = this
    const start = this.i
    let name = ''
    let j = start + 1
    for (;;) {
      if (j >= text.length) return void this.push('invalid', start, text.length, { message: 'Unterminated sheet name' })
      const char = text[j]!
      if (char === "'") {
        if (text[j + 1] === "'") {
          name += "'"
          j += 2
          continue
        }
        j++
        break
      }
      name += char
      j++
    }
    if (text[j] !== '!') return void this.push('invalid', start, j, { message: 'Expected ! after sheet name' })
    if (name.includes('[')) return this.externalBody(start, j + 1)
    const colon = name.indexOf(':')
    const sheet: SheetPrefix = colon >= 0 ? { sheet: name.slice(0, colon), lastSheet: name.slice(colon + 1) } : { sheet: name }
    if (!sheet.sheet || sheet.lastSheet === '') return void this.push('invalid', start, j + 1, { message: 'Empty sheet name' })
    this.refBody(start, j + 1, sheet)
  }

  /** After `[`: a structured reference without a table name, or an external workbook reference. */
  private bracketStart(): void {
    const { text } = this
    const start = this.i
    const end = scanBrackets(text, start)
    if (end < 0) return void this.push('invalid', start, text.length, { message: 'Unterminated [' })
    const prefix = stickyMatch(SHEET_PREFIX, text, end)
    if (prefix) return this.externalBody(start, end + prefix[0].length)
    if (text[end] === '!') return this.externalBody(start, end + 1)
    const structured = parseStructured(text.slice(start + 1, end - 1))
    if (!structured) return void this.push('invalid', start, end, { message: 'Bad structured reference' })
    this.push('structured', start, end, { structured })
  }

  /** Consumes whatever follows `!` in an external reference and emits one opaque token. */
  private externalBody(start: number, bodyStart: number): void {
    const { text } = this
    let end = bodyStart
    const patterns = [ROW_RANGE, CELL, COL_RANGE, IDENT]
    for (const pattern of patterns) {
      const match = stickyMatch(pattern, text, bodyStart)
      if (match) {
        end = bodyStart + match[0].length
        if (pattern === CELL && text[end] === ':') {
          const second = stickyMatch(CELL, text, end + 1)
          if (second) end = end + 1 + second[0].length
        }
        break
      }
    }
    if (text.slice(bodyStart, bodyStart + 5).toUpperCase() === '#REF!') end = bodyStart + 5
    if (end === bodyStart) return void this.push('invalid', start, bodyStart, { message: 'Bad external reference' })
    this.push('external', start, end)
  }

  /** What follows `Sheet!`: a reference, a name, a function, or `#REF!`. */
  private refBody(start: number, bodyStart: number, sheet: SheetPrefix): void {
    const { text } = this
    if (text.slice(bodyStart, bodyStart + 5).toUpperCase() === '#REF!') {
      return void this.push('error', start, bodyStart + 5, { error: '#REF!', sheet })
    }
    if (this.rowRange(bodyStart, sheet, start)) return
    if (this.cellOrRange(bodyStart, sheet, start)) return
    if (this.colRange(bodyStart, sheet, start)) return
    const ident = stickyMatch(IDENT, text, bodyStart)
    if (ident) return this.identifier(start, bodyStart, sheet)
    this.push('invalid', start, bodyStart, { message: 'Expected a reference after the sheet name' })
  }

  private rowRange(at: number, sheet: SheetPrefix | undefined, start: number): boolean {
    const { text } = this
    const match = stickyMatch(ROW_RANGE, text, at)
    if (!match) return false
    const end = at + match[0].length
    if (isIdentChar(text[end]) || text[end] === '(') return false
    const row = Number(match[2]) - 1
    const row2 = Number(match[4]) - 1
    if (row < 0 || row2 < 0 || row >= MAX_ROWS || row2 >= MAX_ROWS) return false
    const ref: RefParts = {
      kind: 'rows',
      row,
      col: 0,
      row2,
      col2: MAX_COLS - 1,
      rowAbs: match[1] === '$',
      colAbs: false,
      row2Abs: match[3] === '$',
      col2Abs: false,
    }
    if (sheet) ref.sheet = sheet
    this.push('ref', start, end, sheet ? { ref, sheet } : { ref })
    return true
  }

  private colRange(at: number, sheet: SheetPrefix | undefined, start: number): boolean {
    const { text } = this
    const match = stickyMatch(COL_RANGE, text, at)
    if (!match) return false
    const end = at + match[0].length
    if (isIdentChar(text[end]) || text[end] === '(' || text[end] === '[') return false
    const col = columnIndex(match[2]!)
    const col2 = columnIndex(match[4]!)
    if (col < 0 || col2 < 0) return false
    const ref: RefParts = {
      kind: 'cols',
      row: 0,
      col,
      row2: MAX_ROWS - 1,
      col2,
      rowAbs: false,
      colAbs: match[1] === '$',
      row2Abs: false,
      col2Abs: match[3] === '$',
    }
    if (sheet) ref.sheet = sheet
    this.push('ref', start, end, sheet ? { ref, sheet } : { ref })
    return true
  }

  private cellOrRange(at: number, sheet: SheetPrefix | undefined, start: number): boolean {
    const { text } = this
    const first = readCell(text, at)
    if (!first) return false
    if (text[first.end] === ':') {
      const second = readCell(text, first.end + 1)
      if (second && cellEndsCleanly(text, second.end)) {
        const ref: RefParts = {
          kind: 'range',
          row: first.row,
          col: first.col,
          row2: second.row,
          col2: second.col,
          rowAbs: first.rowAbs,
          colAbs: first.colAbs,
          row2Abs: second.rowAbs,
          col2Abs: second.colAbs,
        }
        if (sheet) ref.sheet = sheet
        this.push('ref', start, second.end, sheet ? { ref, sheet } : { ref })
        return true
      }
    }
    if (!cellEndsCleanly(text, first.end)) return false
    const ref: RefParts = {
      kind: 'cell',
      row: first.row,
      col: first.col,
      row2: first.row,
      col2: first.col,
      rowAbs: first.rowAbs,
      colAbs: first.colAbs,
      row2Abs: first.rowAbs,
      col2Abs: first.colAbs,
    }
    if (sheet) ref.sheet = sheet
    this.push('ref', start, first.end, sheet ? { ref, sheet } : { ref })
    return true
  }

  /** A name, function, boolean, or `Table[...]` structured reference starting at `at`. */
  private identifier(start: number, at: number, sheet: SheetPrefix | undefined): void {
    const { text } = this
    const match = stickyMatch(IDENT, text, at)
    if (!match) return void this.push('invalid', start, at + 1, { message: 'Unexpected character' })
    const name = match[0]
    const end = at + name.length
    const extra: Partial<Token> = sheet ? { name, sheet } : { name }
    if (text[end] === '(') return void this.push('function', start, end, extra)
    if (text[end] === '[' && !sheet) {
      const close = scanBrackets(text, end)
      if (close < 0) return void this.push('invalid', start, text.length, { message: 'Unterminated [' })
      const structured = parseStructured(text.slice(end + 1, close - 1))
      if (!structured) return void this.push('invalid', start, close, { message: 'Bad structured reference' })
      structured.table = name
      return void this.push('structured', start, close, { structured })
    }
    const upper = name.toUpperCase()
    if (!sheet && (upper === 'TRUE' || upper === 'FALSE')) return void this.push('bool', start, end, { value: upper === 'TRUE' })
    this.push('name', start, end, extra)
  }
}

interface CellMatch {
  row: number
  col: number
  rowAbs: boolean
  colAbs: boolean
  end: number
}

function readCell(text: string, at: number): CellMatch | undefined {
  const match = stickyMatch(CELL, text, at)
  if (!match) return undefined
  const col = columnIndex(match[2]!)
  const row = Number(match[4]) - 1
  if (col < 0 || row < 0 || row >= MAX_ROWS) return undefined
  return { row, col, colAbs: match[1] === '$', rowAbs: match[3] === '$', end: at + match[0].length }
}

function cellEndsCleanly(text: string, end: number): boolean {
  const next = text[end]
  return !isIdentChar(next) && next !== '(' && next !== '[' && next !== '!' && next !== '$'
}

/**
 * Index just past the `]` that closes the `[` at `start`, honoring nested brackets and the `'`
 * escape of structured references; -1 when unterminated.
 */
function scanBrackets(text: string, start: number): number {
  let depth = 0
  for (let j = start; j < text.length; j++) {
    const char = text[j]
    if (char === "'") {
      j++
      continue
    }
    if (char === '[') depth++
    else if (char === ']') {
      depth--
      if (depth === 0) return j + 1
    }
  }
  return -1
}

const ITEMS: Record<string, StructuredItem> = {
  '#all': '#All',
  '#data': '#Data',
  '#headers': '#Headers',
  '#totals': '#Totals',
  '#this row': '#This Row',
}

function unescapeColumn(name: string): string {
  return name.replace(/'(.)/g, '$1')
}

function specialItem(text: string): StructuredItem | undefined {
  return ITEMS[text.trim().toLowerCase().replace(/\s+/g, ' ')]
}

/** Parses the inside of `Table[...]`. Undefined when malformed. */
export function parseStructured(inner: string): StructuredRef | undefined {
  const s = inner.trim()
  if (!s) return { items: [] }
  if (s.startsWith('@')) {
    const rest = s.slice(1).trim()
    if (!rest) return { items: ['#This Row'] }
    if (rest.startsWith('[')) {
      const parts = splitBracketList(rest)
      if (!parts || parts.length !== 1 || parts[0]!.item) return undefined
      return { items: ['#This Row'], ...columnsOf(parts[0]!) }
    }
    if (/[[\]]/.test(rest.replace(/'./g, ''))) return undefined
    return { items: ['#This Row'], firstColumn: unescapeColumn(rest) }
  }
  if (s.startsWith('#')) {
    const item = specialItem(s)
    return item ? { items: [item] } : undefined
  }
  if (s.startsWith('[')) {
    const parts = splitBracketList(s)
    if (!parts) return undefined
    const result: StructuredRef = { items: [] }
    for (const part of parts) {
      if (part.item) {
        result.items.push(part.item)
        continue
      }
      if (result.firstColumn !== undefined) return undefined
      Object.assign(result, columnsOf(part))
    }
    return result
  }
  if (/[[\]]/.test(s.replace(/'./g, ''))) return undefined
  return { items: [], firstColumn: unescapeColumn(s) }
}

interface BracketPart {
  item?: StructuredItem
  first?: string
  last?: string
}

function columnsOf(part: BracketPart): Pick<StructuredRef, 'firstColumn' | 'lastColumn'> {
  return part.last === undefined ? { firstColumn: part.first! } : { firstColumn: part.first!, lastColumn: part.last }
}

/** `[#Headers],[A]:[B]` → parts. Items may also be written `[@]`-free `#This Row`. */
function splitBracketList(s: string): BracketPart[] | undefined {
  const parts: BracketPart[] = []
  let j = 0
  const skipSpaces = () => {
    while (j < s.length && /\s/.test(s[j]!)) j++
  }
  const readOne = (): string | undefined => {
    if (s[j] !== '[') return undefined
    const end = scanBrackets(s, j)
    if (end < 0) return undefined
    const content = s.slice(j + 1, end - 1)
    j = end
    return content
  }
  for (;;) {
    skipSpaces()
    const first = readOne()
    if (first === undefined) return undefined
    skipSpaces()
    if (first.trim().startsWith('#')) {
      const item = specialItem(first)
      if (!item) return undefined
      parts.push({ item })
    } else if (first.trim() === '@') {
      parts.push({ item: '#This Row' })
    } else {
      if (/[[\]]/.test(first.replace(/'./g, ''))) return undefined
      const part: BracketPart = { first: unescapeColumn(first) }
      if (s[j] === ':') {
        j++
        skipSpaces()
        const last = readOne()
        if (last === undefined || /[[\]]/.test(last.replace(/'./g, ''))) return undefined
        part.last = unescapeColumn(last)
        skipSpaces()
      }
      parts.push(part)
    }
    if (j >= s.length) return parts
    if (s[j] !== ',') return undefined
    j++
  }
}

/** Upper-case function name without `_xlfn.` / `_xlws.` prefixes. */
export function normalizeFunctionName(name: string): string {
  let upper = name.toUpperCase()
  for (;;) {
    if (upper.startsWith('_XLFN.')) upper = upper.slice(6)
    else if (upper.startsWith('_XLWS.')) upper = upper.slice(6)
    else return upper
  }
}

/** Upper-case defined name or LAMBDA/LET variable, without the `_xlpm.` parameter prefix. */
export function normalizeName(name: string): string {
  const upper = name.toUpperCase()
  return upper.startsWith('_XLPM.') ? upper.slice(6) : upper
}
