/**
 * Formula text ↔ structure: AST serialization, reference rewriting (`mapReferences`), copy/fill
 * translation (`shiftFormula`), and R1C1 → A1 conversion.
 */

import { MAX_COLS, MAX_ROWS, columnName, quoteSheetName } from '../address.js'
import { FormulaError, type Scalar } from './types.js'
import type { Node } from './parse.js'
import { tokenize, type RefParts, type SheetPrefix } from './tokenize.js'

/** `Sheet1!`, `'My Sheet'!`, or `Sheet1:Sheet3!`. */
export function formatSheetPrefix(prefix: SheetPrefix): string {
  if (prefix.lastSheet === undefined) return `${quoteSheetName(prefix.sheet)}!`
  const plain = quoteSheetName(prefix.sheet) === prefix.sheet && quoteSheetName(prefix.lastSheet) === prefix.lastSheet
  if (plain) return `${prefix.sheet}:${prefix.lastSheet}!`
  return `'${`${prefix.sheet}:${prefix.lastSheet}`.replace(/'/g, "''")}'!`
}

function cellText(row: number, col: number, rowAbs: boolean, colAbs: boolean): string {
  return `${colAbs ? '$' : ''}${columnName(col)}${rowAbs ? '$' : ''}${row + 1}`
}

/** A1 text of a reference, including its sheet prefix if it has one. */
export function formatReference(ref: RefParts): string {
  const prefix = ref.sheet ? formatSheetPrefix(ref.sheet) : ''
  switch (ref.kind) {
    case 'cell':
      return prefix + cellText(ref.row, ref.col, ref.rowAbs, ref.colAbs)
    case 'range':
      return `${prefix}${cellText(ref.row, ref.col, ref.rowAbs, ref.colAbs)}:${cellText(ref.row2, ref.col2, ref.row2Abs, ref.col2Abs)}`
    case 'cols':
      return `${prefix}${ref.colAbs ? '$' : ''}${columnName(ref.col)}:${ref.col2Abs ? '$' : ''}${columnName(ref.col2)}`
    case 'rows':
      return `${prefix}${ref.rowAbs ? '$' : ''}${ref.row + 1}:${ref.row2Abs ? '$' : ''}${ref.row2 + 1}`
  }
}

/** A number as a formula literal (`1E-7`, not `1e-7`). */
export function formatNumberLiteral(value: number): string {
  return String(value).toUpperCase()
}

function formatArrayElement(value: Scalar): string {
  if (typeof value === 'number') return formatNumberLiteral(value)
  if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof FormulaError) return value.code
  return ''
}

/** Formula text (without `=`) for an AST. Whitespace is canonical; names keep their written case. */
export function serialize(node: Node): string {
  switch (node.type) {
    case 'number':
      return formatNumberLiteral(node.value)
    case 'string':
      return `"${node.value.replace(/"/g, '""')}"`
    case 'bool':
      return node.value ? 'TRUE' : 'FALSE'
    case 'error':
      return (node.sheet ? formatSheetPrefix(node.sheet) : '') + node.code
    case 'ref':
      return formatReference(node.ref)
    case 'name':
      return (node.sheet ? formatSheetPrefix(node.sheet) : '') + node.text
    case 'structured':
    case 'external':
      return node.text
    case 'array': {
      const rows: string[] = []
      for (let r = 0; r < node.rows; r++) {
        rows.push(node.data.slice(r * node.cols, (r + 1) * node.cols).map(formatArrayElement).join(','))
      }
      return `{${rows.join(';')}}`
    }
    case 'unary':
      return node.op + serialize(node.operand)
    case 'postfix':
      return serialize(node.operand) + node.op
    case 'binary': {
      // Left-deep chains (`1+2+3+…`) are serialized iteratively.
      const rights: string[] = []
      let left: Node = node
      while (left.type === 'binary') {
        rights.push(left.op + serialize(left.right))
        left = left.left
      }
      return serialize(left) + rights.reverse().join('')
    }
    case 'call':
      return `${node.sheet ? formatSheetPrefix(node.sheet) : ''}${node.text}(${node.args.map((arg) => (arg ? serialize(arg) : '')).join(',')})`
    case 'invoke':
      return `${serialize(node.callee)}(${node.args.map((arg) => (arg ? serialize(arg) : '')).join(',')})`
    case 'paren':
      return `(${serialize(node.expr)})`
  }
}

/** A reference token handed to a `mapReferences` callback. */
export interface ReferenceToken extends RefParts {
  /** The token's source text, including any sheet prefix. */
  text: string
  start: number
  end: number
}

/**
 * Rewrites every cell, range, whole-row, and whole-column reference in a formula. `fn` returns the
 * replacement text, or undefined to keep the token. Everything else (whitespace included) is kept
 * byte for byte. Never throws on malformed formulas; unreadable parts are left alone.
 */
export function mapReferences(formula: string, fn: (ref: ReferenceToken) => string | undefined): string {
  const tokens = tokenize(formula)
  let out = ''
  let last = 0
  for (const token of tokens) {
    if (token.kind !== 'ref' || !token.ref) continue
    const replacement = fn({ ...token.ref, text: token.text, start: token.start, end: token.end })
    if (replacement === undefined) continue
    out += formula.slice(last, token.start) + replacement
    last = token.end
  }
  return last === 0 ? formula : out + formula.slice(last)
}

/**
 * Moves a reference the way copy/fill does: relative parts shift, absolute parts stay. Undefined
 * when the result falls off the grid.
 */
export function shiftReference(ref: RefParts, dRow: number, dCol: number): RefParts | undefined {
  const shifted = { ...ref }
  if (ref.kind !== 'cols') {
    if (!ref.rowAbs) shifted.row = ref.row + dRow
    if (!ref.row2Abs) shifted.row2 = ref.row2 + dRow
  }
  if (ref.kind !== 'rows') {
    if (!ref.colAbs) shifted.col = ref.col + dCol
    if (!ref.col2Abs) shifted.col2 = ref.col2 + dCol
  }
  const inGrid = (row: number, col: number) => row >= 0 && row < MAX_ROWS && col >= 0 && col < MAX_COLS
  if (!inGrid(shifted.row, shifted.col) || !inGrid(shifted.row2, shifted.col2)) return undefined
  return shifted
}

/**
 * Translates a formula copied `dRow` rows down and `dCol` columns right. References pushed off the
 * grid become `#REF!` (keeping their sheet prefix, as Excel does).
 */
export function shiftFormula(formula: string, dRow: number, dCol: number): string {
  if (!dRow && !dCol) return formula
  return mapReferences(formula, (ref) => {
    const shifted = shiftReference(ref, dRow, dCol)
    if (!shifted) return `${ref.sheet ? formatSheetPrefix(ref.sheet) : ''}#REF!`
    return formatReference(shifted)
  })
}

const R1C1_PART = String.raw`(?:\[(-?\d+)\]|(\d+))?`
const R1C1_CELL = new RegExp(`R${R1C1_PART}C${R1C1_PART}`, 'iy')
const R1C1_ROW = new RegExp(`R${R1C1_PART}`, 'iy')
const R1C1_COL = new RegExp(`C${R1C1_PART}`, 'iy')
const NAME_CHAR = /[\w.?\\¡-￿]/

interface R1C1Part {
  index: number
  absolute: boolean
}

function r1c1Part(bracket: string | undefined, plain: string | undefined, current: number): R1C1Part | undefined {
  if (plain !== undefined) {
    const n = Number(plain)
    return n >= 1 ? { index: n - 1, absolute: true } : undefined
  }
  return { index: current + (bracket === undefined ? 0 : Number(bracket)), absolute: false }
}

interface R1C1Match {
  end: number
  text: string
}

/** One R1C1 reference (or range) at `at`, converted to A1 text, for the cell at (row, col). */
function readR1C1(text: string, at: number, row: number, col: number): R1C1Match | undefined {
  const one = (start: number): { end: number; ref: RefParts } | undefined => {
    for (const [pattern, kind] of [
      [R1C1_CELL, 'cell'],
      [R1C1_ROW, 'rows'],
      [R1C1_COL, 'cols'],
    ] as const) {
      pattern.lastIndex = start
      const match = pattern.exec(text)
      if (!match) continue
      const end = start + match[0].length
      if (NAME_CHAR.test(text[end] ?? '') || text[end] === '(' || text[end] === '[') continue
      if (kind === 'cell') {
        const r = r1c1Part(match[1], match[2], row)
        const c = r1c1Part(match[3], match[4], col)
        if (!r || !c) return undefined
        return { end, ref: { kind: 'cell', row: r.index, col: c.index, row2: r.index, col2: c.index, rowAbs: r.absolute, colAbs: c.absolute, row2Abs: r.absolute, col2Abs: c.absolute } }
      }
      if (kind === 'rows') {
        const r = r1c1Part(match[1], match[2], row)
        if (!r) return undefined
        return { end, ref: { kind: 'rows', row: r.index, col: 0, row2: r.index, col2: MAX_COLS - 1, rowAbs: r.absolute, colAbs: false, row2Abs: r.absolute, col2Abs: false } }
      }
      const c = r1c1Part(match[1], match[2], col)
      if (!c) return undefined
      return { end, ref: { kind: 'cols', row: 0, col: c.index, row2: MAX_ROWS - 1, col2: c.index, rowAbs: false, colAbs: c.absolute, row2Abs: false, col2Abs: c.absolute } }
    }
    return undefined
  }
  const first = one(at)
  if (!first) return undefined
  let { ref } = first
  let { end } = first
  if (text[end] === ':') {
    const second = one(end + 1)
    if (second && second.ref.kind === ref.kind) {
      ref = { ...ref, row2: second.ref.row2, col2: second.ref.col2, row2Abs: second.ref.row2Abs, col2Abs: second.ref.col2Abs }
      if (ref.kind === 'cell') ref.kind = 'range'
      end = second.end
    }
  }
  const inGrid = (r: number, c: number) => r >= 0 && r < MAX_ROWS && c >= 0 && c < MAX_COLS
  if (!inGrid(ref.row, ref.col) || !inGrid(ref.row2, ref.col2)) return { end, text: '#REF!' }
  return { end, text: formatReference(ref) }
}

/**
 * Converts the R1C1 references in a formula to A1 for the cell at zero-based (row, col):
 * `R1C1` → `$A$1`, `R[1]C[-1]` → relative, `RC` → the cell itself, `R2` / `C3` → whole row/column.
 * Strings and quoted sheet names are left alone.
 */
export function r1c1ToA1(formula: string, row: number, col: number): string {
  let out = ''
  let i = 0
  while (i < formula.length) {
    const char = formula[i]!
    if (char === '"' || char === "'") {
      let j = i + 1
      while (j < formula.length) {
        if (formula[j] === char) {
          if (formula[j + 1] === char) {
            j += 2
            continue
          }
          break
        }
        j++
      }
      out += formula.slice(i, j + 1)
      i = j + 1
      continue
    }
    const previous = formula[i - 1]
    if ((char === 'R' || char === 'r' || char === 'C' || char === 'c') && !(previous && NAME_CHAR.test(previous))) {
      const match = readR1C1(formula, i, row, col)
      if (match) {
        out += match.text
        i = match.end
        continue
      }
    }
    if (NAME_CHAR.test(char)) {
      let j = i
      while (j < formula.length && NAME_CHAR.test(formula[j]!)) j++
      out += formula.slice(i, j)
      i = j
      continue
    }
    out += char
    i++
  }
  return out
}
