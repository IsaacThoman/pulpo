import { MAX_COLS, MAX_ROWS, rangeContains, type CellRange } from '../address.js'
import { randomId } from '../model/axis.js'
import { toA1Form, toIdForm } from '../model/formula-ids.js'
import { shiftFormula } from '../model/references.js'
import type { AutoFilter, BorderEdge, BorderStyle, CellData, DataValidation, Hyperlink, Note, SheetColor, StyleProp, StyleProps } from '../model/schema.js'
import { deleteAxis, insertAxis, type AxisKind } from '../model/structure.js'
import type { SheetModel } from '../model/workbook.js'
import { parseInput } from '../numfmt/parse.js'
import { isErrorValue, type CellValue } from '../values.js'

/**
 * Editing commands on a sheet, as the toolbar, keyboard, and menus call them. Each runs in one
 * transaction (one undo step) through the sheet's workbook, whose origin the undo manager tracks.
 */

export type StylePatch = Partial<{ [K in StyleProp]: StyleProps[K] | undefined }>

export function isWholeColumns(range: CellRange): boolean {
  return range.top === 0 && range.bottom >= MAX_ROWS - 1
}

export function isWholeRows(range: CellRange): boolean {
  return range.left === 0 && range.right >= MAX_COLS - 1
}

/** Clamps whole-row/column ranges to the used area (plus the range itself when smaller). */
export function clampToUsed(sheet: SheetModel, range: CellRange): CellRange {
  const used = sheet.usedRange()
  const bottom = isWholeColumns(range) ? Math.min(range.bottom, used ? Math.max(used.bottom, range.top) : range.top) : range.bottom
  const right = isWholeRows(range) ? Math.min(range.right, used ? Math.max(used.right, range.left) : range.left) : range.right
  return { ...range, bottom, right }
}

export interface InputOptions {
  /** Values-only workbooks (CSV) store formulas as text. */
  valuesOnly?: boolean
  date1904?: boolean
}

/** What typing `text` into a cell stores; undefined clears it. */
export function contentFromInput(sheet: SheetModel, text: string, options: InputOptions = {}): { data: CellData | undefined; numFmt?: string } {
  if (text === '') return { data: undefined }
  if (text.startsWith("'")) return { data: { v: text.slice(1), t: 's' } }
  if (text.startsWith('=') && text.length > 1 && !options.valuesOnly) return { data: { f: toIdForm(text.slice(1), sheet) } }
  if (options.valuesOnly) {
    // CSV keeps exactly what was typed; numbers still count as numbers.
    const n = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text.trim()) ? Number(text) : NaN
    return { data: Number.isFinite(n) ? { v: n, ...(String(n) !== text ? { raw: text } : {}) } : { v: text } }
  }
  const parsed = parseInput(text, { date1904: !!options.date1904 })
  const value = parsed.value
  if (value !== null && typeof value === 'object') return { data: { v: value.code, t: 'e' }, ...(parsed.numFmt ? { numFmt: parsed.numFmt } : {}) }
  return { data: { v: value as CellData['v'] }, ...(parsed.numFmt ? { numFmt: parsed.numFmt } : {}) }
}

/** Types into one cell (the formula bar's Enter). Applies an inferred number format to General cells. */
export function setCellInput(sheet: SheetModel, row: number, col: number, text: string, options: InputOptions & { currentFormat?: string } = {}): void {
  const { data, numFmt } = contentFromInput(sheet, text, options)
  sheet.workbook.transact(() => {
    sheet.setCell(row, col, data)
    if (numFmt && (options.currentFormat ?? 'General') === 'General') sheet.setStyle({ top: row, left: col, bottom: row, right: col }, { numFmt })
  })
}

/** Fills every cell of the ranges with the same input (Ctrl+Enter). Relative references move. */
export function fillInput(sheet: SheetModel, ranges: CellRange[], origin: { row: number; col: number }, text: string, options: InputOptions = {}): void {
  sheet.workbook.transact(() => {
    for (const range of ranges) {
      for (let row = range.top; row <= range.bottom; row++) {
        for (let col = range.left; col <= range.right; col++) {
          const shifted = text.startsWith('=') && !options.valuesOnly ? `=${shiftFormula(text.slice(1), row - origin.row, col - origin.col)}` : text
          setCellInput(sheet, row, col, shifted, options)
        }
      }
    }
  })
}

export function clearContents(sheet: SheetModel, ranges: CellRange[]): void {
  sheet.workbook.transact(() => {
    for (const raw of ranges) {
      const range = clampToUsed(sheet, raw)
      for (const [key] of [...sheet.cells]) {
        const position = sheet.position(key)
        if (position && rangeContains(range, position.row, position.col)) sheet.cells.delete(key)
      }
    }
  })
}

export function clearFormats(sheet: SheetModel, ranges: CellRange[]): void {
  sheet.workbook.transact(() => {
    for (const raw of ranges) {
      const range = clampToUsed(sheet, raw)
      for (const map of [sheet.xf, sheet.fmt] as const) {
        for (const key of [...map.keys()]) {
          const owner = map === sheet.fmt ? key.slice(0, key.lastIndexOf('|')) : key
          const position = sheet.position(owner)
          if (position && rangeContains(range, position.row, position.col)) map.delete(key)
        }
      }
    }
  })
}

/** Applies style properties to ranges; whole rows/columns style the row/column and their cells. */
export function applyStyle(sheet: SheetModel, ranges: CellRange[], patch: StylePatch): void {
  sheet.workbook.transact(() => {
    for (const range of ranges) {
      if (isWholeColumns(range) || isWholeRows(range)) {
        const kind = isWholeColumns(range) && !isWholeRows(range) ? 'col' : 'row'
        if (isWholeColumns(range) && isWholeRows(range)) {
          // Select all: style every used column (and their cells).
          const used = sheet.usedRange()
          const cols = Array.from({ length: (used?.right ?? 0) + 1 }, (_, index) => index)
          sheet.setAxisStyle('col', cols, patch)
        } else {
          const positions = kind === 'col' ? span(range.left, range.right) : span(range.top, range.bottom)
          sheet.setAxisStyle(kind, positions, patch)
        }
        // Cells with formats of their own get the change too (Excel does the same).
        const used = clampToUsed(sheet, range)
        const owners = new Set<string>([...sheet.xf.keys(), ...[...sheet.fmt.keys()].map((key) => key.slice(0, key.lastIndexOf('|'))), ...sheet.cells.keys()])
        for (const key of owners) {
          const position = sheet.position(key)
          if (!position || !rangeContains(used, position.row, position.col)) continue
          sheet.setStyle({ top: position.row, left: position.col, bottom: position.row, right: position.col }, patch)
        }
        continue
      }
      sheet.setStyle(range, patch)
    }
  })
}

function span(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index)
}

export type BorderPreset = 'all' | 'outer' | 'inner' | 'horizontal' | 'vertical' | 'top' | 'bottom' | 'left' | 'right' | 'none' | 'thickOuter' | 'bottomDouble'

/** Applies a border preset like Excel's borders menu. */
export function applyBorders(sheet: SheetModel, ranges: CellRange[], preset: BorderPreset, style: BorderStyle = 'thin', color?: SheetColor): void {
  const edge = (edgeStyle: BorderStyle = style): BorderEdge => (color ? { style: edgeStyle, color } : { style: edgeStyle })
  sheet.workbook.transact(() => {
    for (const raw of ranges) {
      const range = clampToUsed(sheet, raw)
      for (let row = range.top; row <= range.bottom; row++) {
        for (let col = range.left; col <= range.right; col++) {
          const patch: StylePatch = {}
          const top = row === range.top
          const bottom = row === range.bottom
          const left = col === range.left
          const right = col === range.right
          switch (preset) {
            case 'all':
              Object.assign(patch, { borderTop: edge(), borderBottom: edge(), borderLeft: edge(), borderRight: edge() })
              break
            case 'outer':
            case 'thickOuter': {
              const outer = edge(preset === 'thickOuter' ? 'thick' : style)
              if (top) patch.borderTop = outer
              if (bottom) patch.borderBottom = outer
              if (left) patch.borderLeft = outer
              if (right) patch.borderRight = outer
              break
            }
            case 'inner':
              if (!bottom) patch.borderBottom = edge()
              if (!right) patch.borderRight = edge()
              break
            case 'horizontal':
              if (!bottom) patch.borderBottom = edge()
              break
            case 'vertical':
              if (!right) patch.borderRight = edge()
              break
            case 'top':
              if (top) patch.borderTop = edge()
              break
            case 'bottom':
              if (bottom) patch.borderBottom = edge()
              break
            case 'bottomDouble':
              if (bottom) patch.borderBottom = edge('double')
              break
            case 'left':
              if (left) patch.borderLeft = edge()
              break
            case 'right':
              if (right) patch.borderRight = edge()
              break
            case 'none':
              Object.assign(patch, { borderTop: null, borderBottom: null, borderLeft: null, borderRight: null })
              break
          }
          if (Object.keys(patch).length) sheet.setStyle({ top: row, left: col, bottom: row, right: col }, patch)
        }
      }
    }
  })
}

/** Number of decimals a format code shows (first section), for increase/decrease decimal. */
export function adjustDecimals(code: string, delta: 1 | -1, value?: CellValue): string {
  if (code === 'General') {
    const decimals = typeof value === 'number' ? Math.min(10, (String(value).split('.')[1] ?? '').length) : 0
    const next = Math.max(0, decimals + delta)
    return next ? `0.${'0'.repeat(next)}` : '0'
  }
  const sections = code.split(';')
  return sections
    .map((section) => {
      if (/[dmyhs]/i.test(section.replace(/"[^"]*"|\[[^\]]*\]/g, ''))) return section
      // The integer digits (with grouping) and the decimals after them.
      const match = /([#0,]*[0#])(\.([0#]+))?/.exec(section.replace(/"[^"]*"/g, (quoted) => ' '.repeat(quoted.length)))
      if (!match) return section
      const decimals = match[3]?.length ?? 0
      const next = Math.max(0, decimals + delta)
      const replacement = `${match[1]}${next ? `.${'0'.repeat(next)}` : ''}`
      return section.slice(0, match.index) + replacement + section.slice(match.index + match[0].length)
    })
    .join(';')
}

// ── Merges ─────────────────────────────────────────────────────────────────

export type MergeMode = 'all' | 'across' | 'center'

/** Merges each range (or each row of it, `across`); keeps the top-left content like Excel. */
export function mergeRanges(sheet: SheetModel, ranges: CellRange[], mode: MergeMode = 'all'): void {
  sheet.workbook.transact(() => {
    for (const range of ranges) {
      const targets = mode === 'across' ? span(range.top, range.bottom).map((row) => ({ ...range, top: row, bottom: row })) : [range]
      for (const target of targets) {
        if (target.top === target.bottom && target.left === target.right) continue
        // Existing merges inside go; contents other than the first go.
        for (const merge of sheet.mergedRanges()) if (intersects(merge.range, target)) sheet.merges.delete(merge.id)
        for (let row = target.top; row <= target.bottom; row++) {
          for (let col = target.left; col <= target.right; col++) {
            if (row !== target.top || col !== target.left) sheet.cells.delete(sheet.keyAt(row, col))
          }
        }
        sheet.merges.set(randomId(), { range: sheet.rangeIds(target) })
        if (mode === 'center') sheet.setStyle({ top: target.top, left: target.left, bottom: target.top, right: target.left }, { hAlign: 'center' })
      }
    }
  })
}

export function unmergeRanges(sheet: SheetModel, ranges: CellRange[]): void {
  sheet.workbook.transact(() => {
    for (const merge of sheet.mergedRanges()) if (ranges.some((range) => intersects(merge.range, range))) sheet.merges.delete(merge.id)
  })
}

function intersects(a: CellRange, b: CellRange): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom
}

/** Grows a range to cover every merge it touches (selections snap to merged cells). */
export function expandToMerges(range: CellRange, merges: CellRange[]): CellRange {
  let current = { ...range }
  let changed = true
  while (changed) {
    changed = false
    for (const merge of merges) {
      if (!intersects(merge, current)) continue
      const next = { top: Math.min(current.top, merge.top), left: Math.min(current.left, merge.left), bottom: Math.max(current.bottom, merge.bottom), right: Math.max(current.right, merge.right) }
      if (next.top !== current.top || next.left !== current.left || next.bottom !== current.bottom || next.right !== current.right) {
        current = next
        changed = true
      }
    }
  }
  return current
}

// ── Rows and columns ───────────────────────────────────────────────────────

export function insertLines(sheet: SheetModel, kind: AxisKind, at: number, count: number): void {
  insertAxis(sheet, kind, at, count)
}

export function deleteLines(sheet: SheetModel, kind: AxisKind, at: number, count: number): void {
  deleteAxis(sheet, kind, at, count)
}

export function setHidden(sheet: SheetModel, kind: AxisKind, positions: number[], hidden: boolean): void {
  if (kind === 'row') sheet.setRowProp(positions, 'hidden', hidden || undefined)
  else sheet.setColProp(positions, 'hidden', hidden || undefined)
}

/** Sets row heights (points) or column widths (character units) by hand. */
export function setSize(sheet: SheetModel, kind: AxisKind, positions: number[], size: number): void {
  sheet.workbook.transact(() => {
    if (kind === 'row') {
      sheet.setRowProp(positions, 'size', size)
      sheet.setRowProp(positions, 'custom', true)
      sheet.setRowProp(positions, 'hidden', size <= 0 ? true : undefined)
    } else {
      sheet.setColProp(positions, 'size', size)
      sheet.setColProp(positions, 'custom', true)
      sheet.setColProp(positions, 'hidden', size <= 0 ? true : undefined)
    }
  })
}

export function setFrozen(sheet: SheetModel, rows: number, cols: number): void {
  sheet.workbook.transact(() => {
    sheet.setViewProp('frozenRows', rows > 0 ? rows : undefined)
    sheet.setViewProp('frozenCols', cols > 0 ? cols : undefined)
  })
}

/** Groups rows or columns one outline level deeper (or shallower with `delta = -1`). */
export function setOutline(sheet: SheetModel, kind: AxisKind, positions: number[], delta: 1 | -1): void {
  sheet.workbook.transact(() => {
    for (const position of positions) {
      const current = (kind === 'row' ? sheet.rowProp(position, 'level') : sheet.colProp(position, 'level')) ?? 0
      const next = Math.min(7, Math.max(0, current + delta))
      if (kind === 'row') sheet.setRowProp([position], 'level', next || undefined)
      else sheet.setColProp([position], 'level', next || undefined)
    }
  })
}

// ── Moving content: sort, fill, paste ──────────────────────────────────────

/** A cell's content and format, for moving it elsewhere. */
export interface CellSnapshot {
  data?: CellData
  /** Formula as A1 text at the source position (so it can be moved). */
  formula?: string
  xf?: number
  overrides: Partial<StyleProps>
}

export function snapshotCell(sheet: SheetModel, row: number, col: number): CellSnapshot {
  const key = sheet.keyAt(row, col)
  const data = sheet.cells.get(key)
  const snapshot: CellSnapshot = { overrides: sheet.cellOverrides(key) }
  if (data) {
    snapshot.data = data
    if (data.f !== undefined) snapshot.formula = toA1Form(data.f, sheet)
  }
  const xf = sheet.xf.get(key)
  if (xf !== undefined) snapshot.xf = xf
  return snapshot
}

export interface PlaceOptions {
  values?: boolean
  formats?: boolean
  /** Values to write instead of formulas (paste values). */
  valueFor?: (snapshot: CellSnapshot) => CellValue
}

/** Writes a snapshot taken at `from` into `to`, moving relative references by the offset. */
export function placeCell(sheet: SheetModel, snapshot: CellSnapshot, from: { row: number; col: number }, to: { row: number; col: number }, options: PlaceOptions = { values: true, formats: true }): void {
  const key = (sheet.ensure(to.row, to.col), sheet.keyAt(to.row, to.col))
  if (options.values !== false) {
    if (options.valueFor && snapshot.formula !== undefined) {
      const value = options.valueFor(snapshot)
      if (value === null) sheet.cells.delete(key)
      else sheet.cells.set(key, isErrorValue(value) ? { v: value.e, t: 'e' } : { v: value })
    } else if (snapshot.formula !== undefined) {
      const moved = shiftFormula(snapshot.formula, to.row - from.row, to.col - from.col)
      const { f: _f, spillCache: _cache, ...rest } = snapshot.data!
      sheet.cells.set(key, { ...rest, f: toIdForm(moved, sheet) })
    } else if (snapshot.data) sheet.cells.set(key, snapshot.data)
    else sheet.cells.delete(key)
  }
  if (options.formats !== false) {
    if (snapshot.xf !== undefined) sheet.xf.set(key, snapshot.xf)
    else sheet.xf.delete(key)
    const current = sheet.cellOverrides(key)
    for (const prop of Object.keys(current)) if (!(prop in snapshot.overrides)) sheet.fmt.delete(`${key}|${prop}`)
    for (const [prop, value] of Object.entries(snapshot.overrides)) sheet.fmt.set(`${key}|${prop}`, value)
  }
}

export interface SortKey {
  /** Column index in the sheet. */
  col: number
  descending?: boolean
}

/** Excel's sort order: numbers < text < booleans < errors, blanks always last. */
export function compareForSort(a: CellValue, b: CellValue, descending = false): number {
  const blankA = a === null || a === ''
  const blankB = b === null || b === ''
  if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1
  const rank = (value: CellValue) => (typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : typeof value === 'boolean' ? 2 : 3)
  let result = rank(a) - rank(b)
  if (!result) {
    if (typeof a === 'number') result = a - (b as number)
    else if (typeof a === 'string') result = a.localeCompare(b as string, undefined, { sensitivity: 'base', numeric: false })
    else if (typeof a === 'boolean') result = Number(a) - Number(b)
  }
  return descending ? -result : result
}

/** Sorts the rows of a range by keys (stable), moving content and formats like Excel. */
export function sortRange(sheet: SheetModel, range: CellRange, keys: SortKey[], value: (row: number, col: number) => CellValue): void {
  const area = clampToUsed(sheet, range)
  const rows = span(area.top, area.bottom)
  const order = [...rows].sort((a, b) => {
    for (const key of keys) {
      const result = compareForSort(value(a, key.col), value(b, key.col), key.descending)
      if (result) return result
    }
    return a - b
  })
  if (order.every((row, index) => row === rows[index])) return
  sheet.workbook.transact(() => {
    const snapshots = order.map((row) => span(area.left, area.right).map((col) => snapshotCell(sheet, row, col)))
    order.forEach((sourceRow, index) => {
      const targetRow = area.top + index
      span(area.left, area.right).forEach((col, offset) => {
        placeCell(sheet, snapshots[index]![offset]!, { row: sourceRow, col }, { row: targetRow, col })
      })
    })
  })
}

// ── Filters ────────────────────────────────────────────────────────────────

export function setAutoFilter(sheet: SheetModel, range: CellRange | undefined): void {
  sheet.workbook.transact(() => {
    const existing = sheet.filter.get('value') as AutoFilter | undefined
    if (existing) {
      // Removing a filter shows every row it hid.
      const old = sheet.resolveRange(existing.range)
      if (old) for (let row = old.top + 1; row <= old.bottom; row++) if (sheet.rowProp(row, 'hidden')) sheet.setRowProp([row], 'hidden', undefined)
    }
    if (!range) sheet.filter.delete('value')
    else sheet.filter.set('value', { range: sheet.rangeIds(range), columns: [] } satisfies AutoFilter)
  })
}

/**
 * Shows only rows whose cell in column `offset` of the filter displays one of `values` (`''`
 * for blanks), or every row with `values` undefined; then hides the rows any column filters out.
 */
export function filterColumn(sheet: SheetModel, offset: number, values: string[] | undefined, display: (row: number, col: number) => string): void {
  const filter = sheet.filter.get('value') as AutoFilter | undefined
  const range = filter && sheet.resolveRange(filter.range)
  if (!filter || !range) return
  sheet.workbook.transact(() => {
    const columns = filter.columns.filter((column) => column.col !== offset)
    if (values) columns.push({ col: offset, values })
    sheet.filter.set('value', { ...filter, columns })
    for (let row = range.top + 1; row <= range.bottom; row++) {
      const visible = columns.every((column) => !column.values || column.values.includes(display(row, range.left + column.col)))
      const hidden = !!sheet.rowProp(row, 'hidden')
      if (hidden === !visible) continue
      sheet.setRowProp([row], 'hidden', visible ? undefined : true)
    }
  })
}

// ── Notes, links, validation ───────────────────────────────────────────────

export function setNote(sheet: SheetModel, row: number, col: number, note: Note | undefined): void {
  sheet.workbook.transact(() => {
    sheet.ensure(row, col)
    const key = sheet.keyAt(row, col)
    if (note && note.text) sheet.notes.set(key, { ...(sheet.notes.get(key) as Note | undefined), ...note })
    else sheet.notes.delete(key)
  })
}

export function setLink(sheet: SheetModel, row: number, col: number, link: Hyperlink | undefined): void {
  sheet.workbook.transact(() => {
    sheet.ensure(row, col)
    const key = sheet.keyAt(row, col)
    if (link && (link.target || link.location)) sheet.links.set(key, link)
    else sheet.links.delete(key)
  })
}

export function setValidation(sheet: SheetModel, ranges: CellRange[], validation: Omit<DataValidation, 'ranges'> | undefined): void {
  sheet.workbook.transact(() => {
    // Ranges move out of existing rules first (one cell has one rule).
    for (const [id, raw] of [...sheet.dv.entries()]) {
      const existing = raw as DataValidation
      const resolved = existing.ranges.map((ids) => sheet.resolveRange(ids))
      if (resolved.some((range) => range && ranges.some((target) => intersects(range, target)))) {
        const remaining = existing.ranges.filter((_, index) => !ranges.some((target) => resolved[index] && contains(target, resolved[index]!)))
        if (remaining.length) sheet.dv.set(id, { ...existing, ranges: remaining })
        else sheet.dv.delete(id)
      }
    }
    if (validation) sheet.dv.set(randomId(), { ...validation, ranges: ranges.map((range) => sheet.rangeIds(range)) })
  })
}

function contains(outer: CellRange, inner: CellRange): boolean {
  return inner.top >= outer.top && inner.bottom <= outer.bottom && inner.left >= outer.left && inner.right <= outer.right
}

/** The validation rule covering a cell, if any. */
export function validationAt(sheet: SheetModel, row: number, col: number): DataValidation | undefined {
  for (const raw of sheet.dv.values()) {
    const validation = raw as DataValidation
    if (validation.ranges.some((ids) => {
      const range = sheet.resolveRange(ids)
      return range && rangeContains(range, row, col)
    })) return validation
  }
  return undefined
}

/** The choices of a list validation written as a literal (`"a,b,c"`), or undefined for references. */
export function literalListItems(formula: string | undefined): string[] | undefined {
  if (!formula) return undefined
  const text = formula.trim()
  if (!text.startsWith('"') || !text.endsWith('"')) return undefined
  return text
    .slice(1, -1)
    .replace(/""/g, '"')
    .split(',')
    .map((item) => item.trim())
}
