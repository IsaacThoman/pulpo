import { MAX_COLS, MAX_ROWS } from '../address.js'
import { formatA1Reference, formatSheetPrefix, rewriteReferences, type RefEnd } from './references.js'
import type { SheetModel, WorkbookModel } from './workbook.js'

/**
 * Formulas are stored in "id form": every reference to a cell, range, row, or column is a token
 * naming rows, columns, and sheets by id, so inserting, deleting, or moving rows and sheets and
 * renaming sheets never rewrites a stored formula, even when it happens concurrently with the
 * formula being typed elsewhere. The token is
 *
 *   ⟦s:<sheet>;r:<row>;c:<col>;R:<row>;C:<col>⟧
 *
 * where `s` is present when the formula named a sheet, `R`/`C` give a range's far corner, a
 * missing `r`/`R` means whole columns and a missing `c`/`C` whole rows, and a `$` after the key
 * (`r$:`) marks an absolute part. `⟦s:<sheet>;n:<name>⟧` is a sheet-scoped defined name. The
 * brackets (U+27E6/U+27E7) cannot appear in a formula outside string literals.
 */

export const ID_OPEN = '⟦'
export const ID_CLOSE = '⟧'

export interface IdEnd {
  row?: string
  col?: string
  rowAbs?: boolean
  colAbs?: boolean
}

export interface IdToken {
  sheet?: string
  /** Sheet-scoped defined name. */
  name?: string
  from: IdEnd
  to?: IdEnd
}

export function formatIdToken(token: IdToken): string {
  const fields: string[] = []
  if (token.sheet) fields.push(`s:${token.sheet}`)
  if (token.name !== undefined) fields.push(`n:${token.name}`)
  const end = (value: IdEnd, rowKey: string, colKey: string) => {
    if (value.row !== undefined) fields.push(`${rowKey}${value.rowAbs ? '$' : ''}:${value.row}`)
    if (value.col !== undefined) fields.push(`${colKey}${value.colAbs ? '$' : ''}:${value.col}`)
  }
  if (token.name === undefined) {
    end(token.from, 'r', 'c')
    if (token.to) end(token.to, 'R', 'C')
  }
  return ID_OPEN + fields.join(';') + ID_CLOSE
}

export function parseIdToken(body: string): IdToken {
  const token: IdToken = { from: {} }
  for (const field of body.split(';')) {
    const colon = field.indexOf(':')
    if (colon < 1) continue
    const key = field.slice(0, colon)
    const value = field.slice(colon + 1)
    const abs = key.endsWith('$')
    switch (key[0]) {
      case 's':
        token.sheet = value
        break
      case 'n':
        token.name = value
        break
      case 'r':
        token.from.row = value
        token.from.rowAbs = abs
        break
      case 'c':
        token.from.col = value
        token.from.colAbs = abs
        break
      case 'R':
        token.to ??= {}
        token.to.row = value
        token.to.rowAbs = abs
        break
      case 'C':
        token.to ??= {}
        token.to.col = value
        token.to.colAbs = abs
        break
    }
  }
  return token
}

/** Rewrites every id token outside string literals with `replace(token)`. */
export function mapIdTokens(formula: string, replace: (token: IdToken, text: string) => string): string {
  if (!formula.includes(ID_OPEN)) return formula
  let out = ''
  let index = 0
  while (index < formula.length) {
    const char = formula[index]!
    if (char === '"') {
      const end = stringEnd(formula, index)
      out += formula.slice(index, end)
      index = end
      continue
    }
    if (char === ID_OPEN) {
      const close = formula.indexOf(ID_CLOSE, index)
      if (close < 0) break
      const text = formula.slice(index, close + 1)
      out += replace(parseIdToken(formula.slice(index + 1, close)), text)
      index = close + 1
      continue
    }
    out += char
    index++
  }
  return out + formula.slice(index)
}

function stringEnd(formula: string, start: number): number {
  let index = start + 1
  while (index < formula.length) {
    if (formula[index] === '"') {
      if (formula[index + 1] === '"') index += 2
      else return index + 1
    } else index++
  }
  return index
}

/** Every id token of a formula. */
export function idTokens(formula: string): IdToken[] {
  const tokens: IdToken[] = []
  mapIdTokens(formula, (token, text) => {
    tokens.push(token)
    return text
  })
  return tokens
}

/**
 * Converts an A1 formula typed or read in `sheet` to id form. References to sheets that don't
 * exist, 3D references, and external references stay as text (they can't follow structure).
 */
export function toIdForm(formula: string, sheet: SheetModel | undefined, workbook: WorkbookModel = sheet!.workbook): string {
  return rewriteReferences(formula, (ref) => {
    if (ref.external || ref.sheet?.last) return undefined
    // Defined names have no sheet of their own: their unqualified references stay as text.
    const target = ref.sheet ? workbook.sheetByName(ref.sheet.first) : sheet
    if (!target) return undefined
    const sheetId = ref.sheet ? target.id : undefined
    if (ref.kind === 'name') return formatIdToken({ sheet: sheetId, name: ref.name, from: {} })
    const end = (value: RefEnd): IdEnd => ({
      ...(value.row !== undefined ? { row: target.rows.idAt(value.row), rowAbs: !!value.rowAbs } : {}),
      ...(value.col !== undefined ? { col: target.cols.idAt(value.col), colAbs: !!value.colAbs } : {}),
    })
    return formatIdToken({ ...(sheetId ? { sheet: sheetId } : {}), from: end(ref.from), ...(ref.to ? { to: end(ref.to) } : {}) })
  })
}

/** Converts an id-form formula stored in `sheet` back to A1 text. */
export function toA1Form(formula: string, sheet: SheetModel | undefined, workbook: WorkbookModel = sheet!.workbook): string {
  return mapIdTokens(formula, (token) => idTokenToA1(token, sheet, workbook))
}

export function idTokenToA1(token: IdToken, sheet: SheetModel | undefined, workbook: WorkbookModel = sheet!.workbook): string {
  const target = token.sheet ? workbook.sheet(token.sheet) : sheet
  if (!target) return '#REF!'
  const prefix = token.sheet ? { first: target.name } : undefined
  if (token.name !== undefined) return (prefix ? formatSheetPrefix(prefix) : '') + token.name
  const isRange = token.to !== undefined
  const from = resolveEnd(target, token.from, isRange ? 'start' : 'single')
  const to = token.to && resolveEnd(target, token.to, 'end')
  if (!from || (token.to && !to)) return (prefix ? formatSheetPrefix(prefix) : '') + '#REF!'
  if (to && collapsed(target, token)) {
    // A range whose rows or columns were all deleted concurrently.
    return (prefix ? formatSheetPrefix(prefix) : '') + '#REF!'
  }
  return formatA1Reference({ ...(prefix ? { sheet: prefix } : {}), from, ...(to ? { to } : {}) })
}

/** A range whose edges were deleted and resolved past each other (reversed ranges as written are fine). */
function collapsed(sheet: SheetModel, token: IdToken): boolean {
  const gone = (axis: SheetModel['rows'], id: string | undefined) => id !== undefined && axis.indexOf(id) < 0
  const rowsGone = gone(sheet.rows, token.from.row) || gone(sheet.rows, token.to?.row)
  const colsGone = gone(sheet.cols, token.from.col) || gone(sheet.cols, token.to?.col)
  if (!rowsGone && !colsGone) return false
  const from = resolveEnd(sheet, token.from, 'start')
  const to = token.to && resolveEnd(sheet, token.to, 'end')
  if (!from || !to) return true
  return (rowsGone && from.row !== undefined && to.row !== undefined && to.row < from.row) || (colsGone && from.col !== undefined && to.col !== undefined && to.col < from.col)
}

function resolveEnd(sheet: SheetModel, end: IdEnd, side: 'start' | 'end' | 'single'): RefEnd | undefined {
  const resolved: RefEnd = {}
  if (end.row !== undefined) {
    const row = resolveIndex(sheet.rows.indexOf(end.row), () => sheet.rows.deletedPosition(end.row!, side === 'end' ? 'end' : 'start'), side)
    if (row === undefined || row >= MAX_ROWS) return undefined
    resolved.row = row
    resolved.rowAbs = !!end.rowAbs
  }
  if (end.col !== undefined) {
    const col = resolveIndex(sheet.cols.indexOf(end.col), () => sheet.cols.deletedPosition(end.col!, side === 'end' ? 'end' : 'start'), side)
    if (col === undefined || col >= MAX_COLS) return undefined
    resolved.col = col
    resolved.colAbs = !!end.colAbs
  }
  return resolved
}

function resolveIndex(index: number, deleted: () => number | undefined, side: 'start' | 'end' | 'single'): number | undefined {
  if (index >= 0) return index
  // A range edge deleted by someone else while this formula was written: Excel shrinks the
  // range, so take the neighbor that moved into its place.
  if (side === 'single') return undefined
  return deleted()
}
