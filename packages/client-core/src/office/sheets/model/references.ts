import { MAX_COLS, MAX_ROWS, columnIndex, columnName, quoteSheetName } from '../address.js'

/**
 * Finds the cell, range, row, and column references in an Excel formula (A1 style, without the
 * leading `=`), so they can be rewritten: to the model's id form when stored, back to A1 when
 * shown, and shifted when copied. Everything else (strings, names, functions, structured
 * references, operators) is left as text.
 */

export interface SheetPrefix {
  /** First (or only) sheet name, unquoted. */
  first: string
  /** Last sheet of a 3D reference (`Sheet1:Sheet3!A1`). */
  last?: string
}

/** One end of a reference. Missing row: whole column(s). Missing col: whole row(s). */
export interface RefEnd {
  row?: number
  col?: number
  rowAbs?: boolean
  colAbs?: boolean
}

export interface A1Reference {
  kind: 'ref'
  start: number
  end: number
  sheet?: SheetPrefix
  /** A workbook-external prefix (`[1]`, `[Book.xlsx]`): never resolved or rewritten. */
  external?: boolean
  from: RefEnd
  /** The other corner of a range. */
  to?: RefEnd
}

export interface NameReference {
  kind: 'name'
  start: number
  end: number
  sheet?: SheetPrefix
  external?: boolean
  name: string
}

export type ScannedReference = A1Reference | NameReference

const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w.(])/
const COLS = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![\w.(])/
const ROWS = /^(\$?)(\d{1,7}):(\$?)(\d{1,7})(?![\w.(])/
const NAME = /^[A-Za-z_\\¡-￿][\w.\\?¡-￿]*/
const NUMBER = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/
const SHEET_UNQUOTED = /^([A-Za-z_¡-￿][\w.¡-￿]*)(?::([A-Za-z_¡-￿][\w.¡-￿]*))?!/
const EXTERNAL_UNQUOTED = /^\[[^\]]*\]([\w.\u00A1-\uFFFF]*)!/

function cellEnd(match: RegExpExecArray): RefEnd | undefined {
  const col = columnIndex(match[2]!)
  const row = Number(match[4]) - 1
  if (col < 0 || row < 0 || row >= MAX_ROWS) return undefined
  return { row, col, rowAbs: match[3] === '$', colAbs: match[1] === '$' }
}

/** Parses a quoted sheet prefix at `index` (`'My ''Sheet'''!`), returning names and the index after `!`. */
function quotedPrefix(formula: string, index: number): { sheet: SheetPrefix; external: boolean; next: number } | undefined {
  let cursor = index + 1
  let text = ''
  while (cursor < formula.length) {
    const char = formula[cursor]!
    if (char === "'") {
      if (formula[cursor + 1] === "'") {
        text += "'"
        cursor += 2
        continue
      }
      break
    }
    text += char
    cursor++
  }
  if (formula[cursor] !== "'" || formula[cursor + 1] !== '!') return undefined
  const external = /^\[[^\]]*\]/.test(text) || /^[A-Za-z]:\\|^\\\\|^https?:/i.test(text)
  const bare = text.replace(/^.*\[[^\]]*\]/, '')
  const colon = bare.indexOf(':')
  const sheet: SheetPrefix = colon > 0 ? { first: bare.slice(0, colon), last: bare.slice(colon + 1) } : { first: bare }
  return { sheet, external, next: cursor + 2 }
}

/** Scans the reference body (cell, range, rows, columns, or a name) at `index`. */
function scanBody(formula: string, index: number): { from: RefEnd; to?: RefEnd; next: number } | { name: string; next: number } | undefined {
  const rest = formula.slice(index)
  const range = /^(\$?[A-Za-z]{1,3}\$?\d{1,7}):(\$?[A-Za-z]{1,3}\$?\d{1,7})(?![\w.(])/.exec(rest)
  if (range) {
    const a = CELL.exec(range[1]!)
    const b = CELL.exec(range[2]!)
    const from = a && cellEnd(a)
    const to = b && cellEnd(b)
    if (from && to) return { from, to, next: index + range[0].length }
  }
  const cell = CELL.exec(rest)
  if (cell) {
    const from = cellEnd(cell)
    if (from) return { from, next: index + cell[0].length }
  }
  const cols = COLS.exec(rest)
  if (cols) {
    const a = columnIndex(cols[2]!)
    const b = columnIndex(cols[4]!)
    if (a >= 0 && b >= 0) return { from: { col: a, colAbs: cols[1] === '$' }, to: { col: b, colAbs: cols[3] === '$' }, next: index + cols[0].length }
  }
  const rows = ROWS.exec(rest)
  if (rows) {
    const a = Number(rows[2]) - 1
    const b = Number(rows[4]) - 1
    if (a >= 0 && b >= 0 && a < MAX_ROWS && b < MAX_ROWS) {
      return { from: { row: a, rowAbs: rows[1] === '$' }, to: { row: b, rowAbs: rows[3] === '$' }, next: index + rows[0].length }
    }
  }
  const name = NAME.exec(rest)
  if (name && rest[name[0].length] !== '(') return { name: name[0], next: index + name[0].length }
  return undefined
}

/** Every reference in a formula, in order. Never throws; unrecognized text is skipped. */
export function scanReferences(formula: string): ScannedReference[] {
  const found: ScannedReference[] = []
  let index = 0
  // Whether the previous significant token ends an operand, so `A1` after it can't start a reference.
  while (index < formula.length) {
    const char = formula[index]!
    if (char === '"') {
      // A string literal; `""` is an escaped quote.
      index++
      while (index < formula.length) {
        if (formula[index] === '"') {
          if (formula[index + 1] === '"') index += 2
          else break
        } else index++
      }
      index++
      continue
    }
    if (char === '[') {
      // Structured reference (`Table1[Col]`, `[@Col]`) or an external prefix (`[1]Sheet1!A1`).
      const external = EXTERNAL_UNQUOTED.exec(formula.slice(index))
      if (external) {
        const body = scanBody(formula, index + external[0].length)
        const end = body?.next ?? index + external[0].length
        const sheet: SheetPrefix = { first: external[1]! }
        if (body && 'name' in body) found.push({ kind: 'name', start: index, end, sheet, external: true, name: body.name })
        else if (body) found.push({ kind: 'ref', start: index, end, sheet, external: true, from: body.from, ...(body.to ? { to: body.to } : {}) })
        index = end
        continue
      }
      index = skipBrackets(formula, index)
      continue
    }
    if (char === '#') {
      // Error literals (`#REF!`, `#N/A`), and the spill operator after a reference.
      const error = /^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA|SPILL!|CALC!|FIELD!|BLOCKED!|CONNECT!|UNKNOWN!|BUSY!)/i.exec(formula.slice(index))
      index += error ? error[0].length : 1
      continue
    }
    if (char === "'") {
      const prefix = quotedPrefix(formula, index)
      if (!prefix) {
        index++
        continue
      }
      const body = scanBody(formula, prefix.next)
      if (!body) {
        // `'Sheet'!#REF!` and the like: nothing to rewrite.
        index = prefix.next
        continue
      }
      if ('name' in body) found.push({ kind: 'name', start: index, end: body.next, sheet: prefix.sheet, ...(prefix.external ? { external: true } : {}), name: body.name })
      else found.push({ kind: 'ref', start: index, end: body.next, sheet: prefix.sheet, ...(prefix.external ? { external: true } : {}), from: body.from, ...(body.to ? { to: body.to } : {}) })
      index = body.next
      continue
    }
    if (/\d/.test(char) || (char === '.' && /\d/.test(formula[index + 1] ?? ''))) {
      // A number, unless it starts a row range (`1:3`) — which Excel only allows as a reference.
      const rows = ROWS.exec(formula.slice(index))
      if (rows && !precededByName(formula, index)) {
        const body = scanBody(formula, index)
        if (body && !('name' in body)) {
          found.push({ kind: 'ref', start: index, end: body.next, from: body.from, ...(body.to ? { to: body.to } : {}) })
          index = body.next
          continue
        }
      }
      const number = NUMBER.exec(formula.slice(index))
      index += number ? number[0].length : 1
      continue
    }
    if (/[A-Za-z_\\$¡-￿]/.test(char)) {
      const rest = formula.slice(index)
      const sheet = SHEET_UNQUOTED.exec(rest)
      if (sheet && !/^(TRUE|FALSE)$/i.test(sheet[1]!)) {
        const body = scanBody(formula, index + sheet[0].length)
        const prefix: SheetPrefix = sheet[2] ? { first: sheet[1]!, last: sheet[2] } : { first: sheet[1]! }
        if (body && 'name' in body) {
          found.push({ kind: 'name', start: index, end: body.next, sheet: prefix, name: body.name })
          index = body.next
          continue
        }
        if (body) {
          found.push({ kind: 'ref', start: index, end: body.next, sheet: prefix, from: body.from, ...(body.to ? { to: body.to } : {}) })
          index = body.next
          continue
        }
        index += sheet[0].length
        continue
      }
      const body = scanBody(formula, index)
      if (body && !('name' in body)) {
        found.push({ kind: 'ref', start: index, end: body.next, from: body.from, ...(body.to ? { to: body.to } : {}) })
        index = body.next
        continue
      }
      // A function name, a defined name, TRUE/FALSE, or a table name; skip the whole word (and a
      // table's brackets) so its tail is never mistaken for a reference.
      const word = /^[\w.\\?$¡-￿]+/.exec(rest)
      index += word ? word[0].length : 1
      if (formula[index] === '[') index = skipBrackets(formula, index)
      continue
    }
    index++
  }
  return found
}

function precededByName(formula: string, index: number): boolean {
  return index > 0 && /[\w.$]/.test(formula[index - 1]!)
}

/** Skips a bracketed structured-reference group, honoring nesting and `'` escapes. */
function skipBrackets(formula: string, index: number): number {
  let depth = 0
  while (index < formula.length) {
    const char = formula[index]!
    if (char === "'") {
      index += 2
      continue
    }
    if (char === '[') depth++
    else if (char === ']') {
      depth--
      if (depth === 0) return index + 1
    }
    index++
  }
  return index
}

/** Replaces each scanned reference with `replace(ref)` (undefined keeps the original text). */
export function rewriteReferences(formula: string, replace: (ref: ScannedReference) => string | undefined): string {
  const refs = scanReferences(formula)
  if (!refs.length) return formula
  let out = ''
  let cursor = 0
  for (const ref of refs) {
    const replacement = replace(ref)
    if (replacement === undefined) continue
    out += formula.slice(cursor, ref.start) + replacement
    cursor = ref.end
  }
  return out + formula.slice(cursor)
}

/** True for an end that names a full column (no row). */
export function isWholeColumn(ref: A1Reference): boolean {
  return ref.from.row === undefined
}

export function isWholeRow(ref: A1Reference): boolean {
  return ref.from.col === undefined
}

/** Shifts relative parts of every reference (copy/fill). Ends pushed off the grid become `#REF!`. */
export function shiftFormula(formula: string, dRow: number, dCol: number): string {
  if (!dRow && !dCol) return formula
  return rewriteReferences(formula, (ref) => {
    if (ref.kind !== 'ref' || ref.external) return undefined
    const from = shiftEnd(ref.from, dRow, dCol)
    const to = ref.to && shiftEnd(ref.to, dRow, dCol)
    if (!from || (ref.to && !to)) return (ref.sheet ? formatSheetPrefix(ref.sheet) : '') + '#REF!'
    return formatA1Reference({ ...ref, from, ...(to ? { to } : {}) })
  })
}

function shiftEnd(end: RefEnd, dRow: number, dCol: number): RefEnd | undefined {
  const shifted = { ...end }
  if (end.row !== undefined && !end.rowAbs) shifted.row = end.row + dRow
  if (end.col !== undefined && !end.colAbs) shifted.col = end.col + dCol
  if (shifted.row !== undefined && (shifted.row < 0 || shifted.row >= MAX_ROWS)) return undefined
  if (shifted.col !== undefined && (shifted.col < 0 || shifted.col >= MAX_COLS)) return undefined
  return shifted
}

export function formatSheetPrefix(sheet: SheetPrefix): string {
  if (sheet.last) {
    const both = `${sheet.first}:${sheet.last}`
    const plain = quoteSheetName(sheet.first) === sheet.first && quoteSheetName(sheet.last) === sheet.last
    return plain ? `${both}!` : `'${both.replace(/'/g, "''")}'!`
  }
  return `${quoteSheetName(sheet.first)}!`
}

export function formatRefEnd(end: RefEnd): string {
  const col = end.col === undefined ? '' : `${end.colAbs ? '$' : ''}${columnName(end.col)}`
  const row = end.row === undefined ? '' : `${end.rowAbs ? '$' : ''}${end.row + 1}`
  return col + row
}

export function formatA1Reference(ref: Pick<A1Reference, 'sheet' | 'from' | 'to'>): string {
  const prefix = ref.sheet ? formatSheetPrefix(ref.sheet) : ''
  const from = formatRefEnd(ref.from)
  return prefix + (ref.to ? `${from}:${formatRefEnd(ref.to)}` : from)
}
