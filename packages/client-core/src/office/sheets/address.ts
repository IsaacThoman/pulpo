/**
 * A1 addressing. Rows and columns are zero-based everywhere in code; only text uses Excel's
 * one-based rows and lettered columns.
 */

/** Excel's grid limits (Office 2007 and later). */
export const MAX_ROWS = 1_048_576
export const MAX_COLS = 16_384

export interface CellAddress {
  row: number
  col: number
}

/** An inclusive rectangle of cells. */
export interface CellRange {
  top: number
  left: number
  bottom: number
  right: number
}

/** `0` → `A`, `25` → `Z`, `26` → `AA`. */
export function columnName(col: number): string {
  let name = ''
  let n = col + 1
  while (n > 0) {
    const rest = (n - 1) % 26
    name = String.fromCharCode(65 + rest) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

/** `A` → `0`, `aa` → `26`; -1 for anything that is not a column name within the grid. */
export function columnIndex(name: string): number {
  if (!name || name.length > 3) return -1
  let n = 0
  for (const char of name.toUpperCase()) {
    const code = char.charCodeAt(0)
    if (code < 65 || code > 90) return -1
    n = n * 26 + (code - 64)
  }
  return n - 1 < MAX_COLS ? n - 1 : -1
}

export function cellName(row: number, col: number): string {
  return `${columnName(col)}${row + 1}`
}

const CELL_PATTERN = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/

/** Parses `B7` or `$B$7`; undefined for anything else or outside the grid. */
export function parseCellName(text: string): CellAddress | undefined {
  const match = CELL_PATTERN.exec(text.trim())
  if (!match) return undefined
  const col = columnIndex(match[1]!)
  const row = Number(match[2]) - 1
  if (col < 0 || row < 0 || row >= MAX_ROWS) return undefined
  return { row, col }
}

/** Parses `A1`, `A1:C3`, `A:C` (whole columns), or `2:5` (whole rows). */
export function parseRangeName(text: string): CellRange | undefined {
  const [first, second, ...rest] = text.trim().split(':')
  if (!first || rest.length) return undefined
  if (second === undefined) {
    const cell = parseCellName(first)
    return cell && { top: cell.row, left: cell.col, bottom: cell.row, right: cell.col }
  }
  const a = parseCellName(first)
  const b = parseCellName(second)
  if (a && b) return normalizeRange({ top: a.row, left: a.col, bottom: b.row, right: b.col })
  const colA = columnIndex(first.replace(/\$/g, ''))
  const colB = columnIndex(second.replace(/\$/g, ''))
  if (colA >= 0 && colB >= 0) return normalizeRange({ top: 0, left: colA, bottom: MAX_ROWS - 1, right: colB })
  const rowA = /^\$?\d{1,7}$/.test(first) ? Number(first.replace('$', '')) - 1 : -1
  const rowB = /^\$?\d{1,7}$/.test(second) ? Number(second.replace('$', '')) - 1 : -1
  if (rowA >= 0 && rowB >= 0 && rowA < MAX_ROWS && rowB < MAX_ROWS) return normalizeRange({ top: rowA, left: 0, bottom: rowB, right: MAX_COLS - 1 })
  return undefined
}

export function rangeName(range: CellRange): string {
  const start = cellName(range.top, range.left)
  if (range.top === range.bottom && range.left === range.right) return start
  return `${start}:${cellName(range.bottom, range.right)}`
}

/** A space-separated list of ranges, as in `sqref` attributes. */
export function parseRangeList(text: string): CellRange[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map(parseRangeName)
    .filter((range): range is CellRange => range !== undefined)
}

export function normalizeRange(range: CellRange): CellRange {
  return {
    top: Math.min(range.top, range.bottom),
    left: Math.min(range.left, range.right),
    bottom: Math.max(range.top, range.bottom),
    right: Math.max(range.left, range.right),
  }
}

export function rangeContains(range: CellRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right
}

export function rangesIntersect(a: CellRange, b: CellRange): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom
}

/** Quotes a sheet name for a formula when Excel would (`'My Sheet'!A1`). */
export function quoteSheetName(name: string): string {
  if (/^[A-Za-z_À-￿][\w.À-￿]*$/.test(name) && !parseCellName(name) && !/^R\d*C\d*$/i.test(name) && !/^(TRUE|FALSE)$/i.test(name)) return name
  return `'${name.replace(/'/g, "''")}'`
}
