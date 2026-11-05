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

export interface A1FormOptions {
  /** Rule formulas follow a deleted relative origin to its next surviving neighbor. */
  followDeletedRelative?: boolean
}

/** Converts an id-form formula stored in `sheet` back to A1 text. */
export function toA1Form(formula: string, sheet: SheetModel | undefined, workbook: WorkbookModel = sheet!.workbook, options: A1FormOptions = {}): string {
  return mapIdTokens(formula, (token) => idTokenToA1(token, sheet, workbook, options))
}

export function idTokenToA1(token: IdToken, sheet: SheetModel | undefined, workbook: WorkbookModel = sheet!.workbook, options: A1FormOptions = {}): string {
  const target = token.sheet ? workbook.sheet(token.sheet) : sheet
  if (!target) return '#REF!'
  const prefix = token.sheet ? { first: target.name } : undefined
  if (token.name !== undefined) return (prefix ? formatSheetPrefix(prefix) : '') + token.name
  const resolved = resolveToken(target, token, options)
  if (!resolved) return (prefix ? formatSheetPrefix(prefix) : '') + '#REF!'
  return formatA1Reference({ ...(prefix ? { sheet: prefix } : {}), ...resolved })
}

/**
 * Where a reference's ends are now, or undefined for `#REF!`. Each axis of a range resolves its
 * two ends together: a deleted end takes the surviving neighbor on the range's side of it, found
 * through the neighbors its tombstone recorded, and never through indexes recorded when it was
 * deleted (deletions elsewhere since then make those meaningless).
 */
function resolveToken(sheet: SheetModel, token: IdToken, options: A1FormOptions): { from: RefEnd; to?: RefEnd } | undefined {
  const from: RefEnd = {}
  const to: RefEnd | undefined = token.to ? {} : undefined
  for (const kind of ['row', 'col'] as const) {
    const axis = kind === 'row' ? sheet.rows : sheet.cols
    const limit = kind === 'row' ? MAX_ROWS : MAX_COLS
    const first = token.from[kind]
    const second = token.to?.[kind]
    if (first === undefined) continue
    let positions: [number, number] | undefined
    if (second === undefined) {
      let index = axis.indexOf(first)
      const absolute = kind === 'row' ? token.from.rowAbs : token.from.colAbs
      // Only rule single-cell references rebase relative axes; cell formulas and ranges retain
      // their usual deleted-reference behavior, and absolute axes must still become #REF!.
      if (index < 0 && !token.to && options.followDeletedRelative && !absolute) index = axis.deletedPosition(first, 'start') ?? -1
      if (index < 0) return undefined
      positions = [index, index]
    } else positions = resolveAxisRange(axis, first, second)
    if (!positions || positions.some((position) => position < 0 || position >= limit)) return undefined
    const absolute = kind === 'row' ? 'rowAbs' : 'colAbs'
    Object.assign(from, { [kind]: positions[0], [absolute]: !!token.from[absolute] })
    if (to && second !== undefined) Object.assign(to, { [kind]: positions[1], [absolute]: !!token.to![absolute] })
  }
  return to ? { from, to } : { from }
}

/** The current positions of a range's two ends on one axis, in the order written. */
function resolveAxisRange(axis: SheetModel['rows'], first: string, second: string): [number, number] | undefined {
  const a = axis.indexOf(first)
  const b = axis.indexOf(second)
  if (a >= 0 && b >= 0) return [a, b]
  if (a >= 0) return [a, inward(axis, second, a)]
  if (b >= 0) return [inward(axis, first, b), b]
  // Both ends deleted: what survives is strictly between them. Written top to bottom, that runs
  // from the survivor after the first to the survivor before the second; written bottom to top,
  // the other way round. At most one of the two can be non-empty; neither means nothing survives.
  const valid = (start: number | undefined, end: number | undefined): start is number => start !== undefined && end !== undefined && start >= 0 && end >= 0 && start <= end
  const top = axis.deletedPosition(first, 'start')
  const bottom = axis.deletedPosition(second, 'end')
  if (valid(top, bottom)) return [top, bottom!]
  const reversedTop = axis.deletedPosition(second, 'start')
  const reversedBottom = axis.deletedPosition(first, 'end')
  if (valid(reversedTop, reversedBottom)) return [reversedBottom!, reversedTop]
  return undefined
}

/**
 * A deleted end of a range whose other end survives at `live`: the survivor after it if that lies
 * toward `live`, else the survivor before it. When neither does, a move since then carried the
 * neighbor past `live`; the end follows it, as references follow moved cells.
 */
function inward(axis: SheetModel['rows'], deleted: string, live: number): number {
  const next = axis.deletedPosition(deleted, 'start')
  if (next !== undefined && next >= 0 && next <= live) return next
  const previous = axis.deletedPosition(deleted, 'end')
  if (previous !== undefined && previous >= 0 && previous >= live) return previous
  if (next !== undefined && next >= 0) return next
  if (previous !== undefined && previous >= 0) return previous
  return live
}
