import { MAX_COLS, MAX_ROWS, parseRangeName, rangeContains, type CellRange } from '../address.js'
import { parseFormula, type Node } from '../formula/parse.js'
import { MAX_EXPANDED_CELLS } from '../limits.js'
import { randomId } from '../model/axis.js'
import { toA1Form, toIdForm } from '../model/formula-ids.js'
import { scanReferences, shiftFormula } from '../model/references.js'
import type { AutoFilter, BorderEdge, BorderStyle, CellData, DataValidation, Hyperlink, Note, SheetTable, SheetColor, StyleProp, StyleProps } from '../model/schema.js'
import { deleteAxis, insertAxis, type AxisKind } from '../model/structure.js'
import type { SheetModel } from '../model/workbook.js'
import { parseInput } from '../numfmt/parse.js'
import { isErrorValue, type CellValue, type SheetValues } from '../values.js'

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
  // Formulas typed here are dynamic-array formulas, as in Excel 365: a range result spills.
  if (text.startsWith('=') && text.length > 1 && !options.valuesOnly) return { data: { f: toIdForm(text.slice(1), sheet), dynamic: true } }
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
  sheet.workbook.transact(() => {
    if (kind === 'col') { sheet.setColProp(positions, 'hidden', hidden || undefined); return }
    const filter = sheet.filter.get('value') as AutoFilter | undefined
    for (const row of positions) {
      sheet.ensure(row, 0)
      const id = sheet.rows.idAt(row)
      sheet.setRowProp([row], 'manualHidden', hidden || undefined)
      sheet.setRowProp([row], 'hidden', hidden || filter?.hiddenRows?.includes(id) || undefined)
    }
  })
}

/** Sets row heights (points) or column widths (character units) by hand. */
export function setSize(sheet: SheetModel, kind: AxisKind, positions: number[], size: number): void {
  sheet.workbook.transact(() => {
    if (kind === 'row') {
      sheet.setRowProp(positions, 'size', size)
      sheet.setRowProp(positions, 'custom', true)
      setHidden(sheet, 'row', positions, size <= 0)
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
  note?: Note
  link?: Hyperlink
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
  const note = sheet.notes.get(key) as Note | undefined
  const link = sheet.links.get(key) as Hyperlink | undefined
  if (note) snapshot.note = note
  if (link) snapshot.link = link
  if (xf !== undefined) snapshot.xf = xf
  return JSON.parse(JSON.stringify(snapshot)) as CellSnapshot
}

export interface PlaceOptions {
  values?: boolean
  formats?: boolean
  /** Values to write instead of formulas (paste values). */
  valueFor?: (snapshot: CellSnapshot) => CellValue
}

/** Writes a snapshot taken at `from` into `to`, moving relative references by the offset. */
export function placeCell(sheet: SheetModel, snapshot: CellSnapshot, from: { row: number; col: number }, to: { row: number; col: number }, options: PlaceOptions = { values: true, formats: true }): void {
  if (to.row < 0 || to.col < 0 || to.row >= MAX_ROWS || to.col >= MAX_COLS) return
  const key = (sheet.ensure(to.row, to.col), sheet.keyAt(to.row, to.col))
  if (options.values !== false) {
    if (options.valueFor) {
      const value = options.valueFor(snapshot)
      if (value === null) sheet.cells.delete(key)
      else sheet.cells.set(key, isErrorValue(value) ? { v: value.e, t: 'e' } : { v: value })
    } else if (snapshot.formula !== undefined) {
      const moved = shiftFormula(snapshot.formula, to.row - from.row, to.col - from.col)
      const { f: _f, ...rest } = snapshot.data!
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

export const DATA_ERRORS = {
  size: 'This range is too large to sort safely. Select a smaller range.',
  arrays: 'Cannot sort a range containing spilled or legacy array formulas.',
  merges: 'Cannot sort merged cells. Unmerge the cells first.',
  metadata: 'Cannot sort this range with validation, conditional formatting, drawings, or range hyperlinks. Remove them first.',
  hidden: 'Show manually hidden rows and remove outlines before sorting.',
  filter: 'Cannot change this filter safely. Only value-list filters are supported.',
  tables: 'Select cells inside a single table before sorting it.',
  keys: 'Sort keys must be columns inside the sorted range.',
  collaboration: 'Sorting a shared document requires an exclusive editing lock. Sort a local copy instead.',
  changed: 'The sheet changed while preparing the sort. Try again.',
  formulas: 'Cannot safely sort filtered formulas or formulas with references to other rows or sheets. Sort values instead.',
} as const

export class DataOperationError extends Error {
  constructor(readonly reason: keyof typeof DATA_ERRORS) {
    super(DATA_ERRORS[reason])
  }
}

export interface SortOptions {
  caseSensitive?: boolean
  /** Required to determine the extent of calculated dynamic spills. */
  values?: SheetValues
  display?: (row: number, col: number) => string
  /** Snapshot sorts cannot safely merge with concurrent record edits without a server lock. */
  collaborative?: boolean
}

/** Excel's sort order: numbers < text < booleans < errors, blanks always last. */
export function compareForSort(a: CellValue, b: CellValue, descending = false, caseSensitive = false): number {
  const blankA = a === null || a === ''
  const blankB = b === null || b === ''
  if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1
  const rank = (value: CellValue) => (typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : typeof value === 'boolean' ? 2 : 3)
  let result = rank(a) - rank(b)
  if (!result) {
    if (typeof a === 'number') result = a - (b as number)
    else if (typeof a === 'string') result = a.localeCompare(b as string, undefined, { sensitivity: caseSensitive ? 'variant' : 'accent', caseFirst: 'lower', numeric: false })
    else if (typeof a === 'boolean') result = Number(a) - Number(b)
    // Excel keeps errors in their original order.
  }
  return descending ? -result : result
}

/** A currently scalar dynamic formula can start spilling after relocation (e.g. IF(ROW(),…)). */
function alwaysScalar(node: Node): boolean {
  switch (node.type) {
    case 'number': case 'string': case 'bool': case 'error': return true
    case 'ref': return node.ref.kind === 'cell'
    case 'paren': return alwaysScalar(node.expr)
    case 'unary': return alwaysScalar(node.operand)
    case 'postfix': return node.op === '%' && alwaysScalar(node.operand)
    case 'binary': return ![':', ' ', ','].includes(node.op) && alwaysScalar(node.left) && alwaysScalar(node.right)
    case 'call': return !node.sheet && ['SUM', 'PRODUCT', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'COUNTBLANK', 'AVERAGE', 'MEDIAN', 'AND', 'OR'].includes(node.name)
    default: return false
  }
}

/** Sort a snapshot synchronously, with all safety checks completed before the first write. */
export function sortRange(sheet: SheetModel, range: CellRange, keys: SortKey[], value: (row: number, col: number) => CellValue, options: SortOptions = {}): void {
  if (options.collaborative) throw new DataOperationError('collaboration')
  // Observers are deferred inside an outer transaction, so preparation cannot detect changes.
  if (sheet.workbook.doc._transaction) throw new DataOperationError('changed')
  let changed = false
  const onChange = () => { changed = true }
  sheet.workbook.root.observeDeep(onChange)
  try {
    let area = clampToUsed(sheet, range)
    const tables = [...sheet.tables.entries()].flatMap(([id, raw]) => {
      const table = raw as SheetTable
      const rect = sheet.resolveRange(table.range)
      return rect && intersects(rect, area) ? [{ id, table, rect }] : []
    })
    if (tables.length > 1 || tables[0] && !contains(tables[0].rect, area)) throw new DataOperationError('tables')
    if (tables[0]) {
      const { table, rect } = tables[0]
      // Imported table filters aren't modeled as worksheet filters. Don't leave their XML stale.
      if (table.xml && /<(?:\w+:)?filterColumn\b/.test(table.xml)) throw new DataOperationError('filter')
      area = { ...rect, top: rect.top + (table.headerRow ? 1 : 0), bottom: rect.bottom - (table.totalsRow ? 1 : 0) }
    }
    if (!keys.length || keys.some((key) => !Number.isInteger(key.col) || key.col < area.left || key.col > area.right)) throw new DataOperationError('keys')
    if (area.top >= area.bottom) return
    if ((area.bottom - area.top + 1) * (area.right - area.left + 1) > MAX_EXPANDED_CELLS) throw new DataOperationError('size')
    if (sheet.mergedRanges().some((merge) => intersects(merge.range, area))) throw new DataOperationError('merges')
    const filter = sheet.filter.get('value') as AutoFilter | undefined
    const filterRange = filter && sheet.resolveRange(filter.range)
    const filterData = filterRange && { ...filterRange, top: filterRange.top + 1 }
    const filtering = !!filter && !!filterData && intersects(filterData, area)
    if (filtering && (!contains(area, filterData!) || !contains(filterData!, area))) throw new DataOperationError('filter')
    if (filtering) checkFilter(filter!)
    const display = options.display ?? ((r: number, c: number) => String(value(r, c) ?? ''))
    const visibility = filtering ? filterVisibility(sheet, filter!, display) : undefined
    // Arrays may be anchored outside the selection; checking selected cells alone misses members.
    sheet.forEachCell((row, col, data) => {
      const size = data.array ?? options.values?.spill?.(sheet, row, col) ?? (data.spillCache ? { rows: data.spillCache.length, cols: data.spillCache[0]?.length ?? 1 } : undefined)
      if (data.dynamic && rangeContains(area, row, col)) {
        const result = value(row, col)
        if (isErrorValue(result) && result.e === '#SPILL!') throw new DataOperationError('arrays')
      }
      const potential = data.oversizedArray || data.dynamic && !options.values?.spill
      const arrayRange = size ? { top: row, left: col, bottom: row + size.rows - 1, right: col + size.cols - 1 } : potential ? { top: row, left: col, bottom: MAX_ROWS - 1, right: MAX_COLS - 1 } : undefined
      if (arrayRange && intersects(arrayRange, area)) throw new DataOperationError('arrays')
      if (data.keep?.f) {
        const opaqueRange = data.keep.f.ref && parseRangeName(data.keep.f.ref)
        if (rangeContains(area, row, col) || opaqueRange && intersects(opaqueRange, area)) throw new DataOperationError('formulas')
      }
      if (!rangeContains(area, row, col) || data.f === undefined) return
      const formula = toA1Form(data.f, sheet)
      if (data.dynamic) {
        const parsed = parseFormula(formula)
        if (!parsed.ok || !alwaysScalar(parsed.ast)) throw new DataOperationError('arrays')
      }
      // Qualified and cross-row references have different relocation semantics in Excel.
      // Reject these until we can implement them without guessing or introducing #REF!.
      if (filtering && filter!.columns.length || data.keep?.f || scanReferences(formula).some((ref) => ref.kind === 'name' || ref.sheet || ref.external || [ref.from, ref.to].some((end) => end && !end.rowAbs && end.row !== row))) throw new DataOperationError('formulas')
    })
    for (const kind of ['dv', 'cf'] as const) for (const raw of sheet[kind].values()) {
      if ((raw as DataValidation).ranges.some((ids) => { const r = sheet.resolveRange(ids); return r && intersects(r, area) })) throw new DataOperationError('metadata')
    }
    // Opaque threaded comments/sparklines and drawing anchors cannot be split by a record move.
    if (sheet.drawings.size || /threadedComment/.test(String(sheet.raw.get('rels') ?? '')) || /threadedComment|sparkline/.test(String(sheet.raw.get('xml') ?? ''))) throw new DataOperationError('metadata')
    for (const [key, raw] of sheet.links) {
      const link = raw as Hyperlink
      const rect = link.range && sheet.resolveRange(link.range)
      const pos = sheet.position(key)
      if (rect && (rect.top !== rect.bottom || rect.left !== rect.right) && (intersects(rect, area) || pos && rangeContains(area, pos.row, pos.col))) throw new DataOperationError('metadata')
    }
    const rows = span(area.top, area.bottom)
    for (const row of rows) {
      const manual = visibility?.manual.has(sheet.rows.idAt(row)) ?? !!sheet.rowProp(row, 'hidden')
      if (sheet.rowProp(row, 'xf') !== undefined || Object.keys(sheet.axisOverrides('row', sheet.rows.idAt(row))).length) throw new DataOperationError('metadata')
      if (manual || sheet.rowProp(row, 'level') || sheet.rowProp(row, 'collapsed')) throw new DataOperationError('hidden')
    }
    // Evaluate keys once, before writes (formula evaluation may invalidate caches).
    const keyValues = new Map(rows.map((row) => [row, keys.map((key) => value(row, key.col))]))
    const order = [...rows].sort((a, b) => {
      for (let k = 0; k < keys.length; k++) {
        const result = compareForSort(keyValues.get(a)![k]!, keyValues.get(b)![k]!, keys[k]!.descending, options.caseSensitive)
        if (result) return result
      }
      return a - b
    })
    const cols = span(area.left, area.right)
    const snapshots = order.map((row) => cols.map((col) => snapshotCell(sheet, row, col)))
    const filtered = order.map((row) => visibility?.filtered.has(sheet.rows.idAt(row)) ?? false)
    if (changed) throw new DataOperationError('changed')
    sheet.workbook.transact(() => {
      order.forEach((sourceRow, index) => {
        const targetRow = rows[index]!
        if (sourceRow === targetRow) return
        cols.forEach((col, offset) => {
          const snapshot = snapshots[index]![offset]!
          placeCell(sheet, snapshot, { row: sourceRow, col }, { row: targetRow, col })
          const key = sheet.keyAt(targetRow, col)
          if (snapshot.note) sheet.notes.set(key, snapshot.note)
          else sheet.notes.delete(key)
          if (snapshot.link) sheet.links.set(key, { ...snapshot.link, ...(snapshot.link.range ? { range: sheet.rangeIds({ top: targetRow, bottom: targetRow, left: col, right: col }) } : {}) })
          else sheet.links.delete(key)
        })
      })
      const sort = keys.map((key) => ({ col: sheet.cols.idAt(key.col), descending: !!key.descending }))
      if (tables[0]) sheet.tables.set(tables[0].id, { ...tables[0].table, sort, sortCaseSensitive: !!options.caseSensitive })
      else if (!filtering) sheet.filter.set('sort', { range: sheet.rangeIds(area), columns: [], sort, sortCaseSensitive: !!options.caseSensitive } satisfies AutoFilter)
      if (filtering) {
        sheet.filter.delete('sort')
        const hiddenRows = rows.filter((_, i) => filtered[i]).map((row) => sheet.rows.idAt(row))
        for (let i = 0; i < rows.length; i++) sheet.setRowProp([rows[i]!], 'hidden', filtered[i] || undefined)
        sheet.filter.set('value', { ...filter!, hiddenRows, sort, sortCaseSensitive: !!options.caseSensitive, sortXml: undefined })
      }
    })
  } finally {
    sheet.workbook.root.unobserveDeep(onChange)
  }
}

// ── Filters ────────────────────────────────────────────────────────────────

function checkFilter(filter: AutoFilter): void {
  if (filter.columns.some((column) => !column.values)) throw new DataOperationError('filter')
}

/** Infer provenance for imported filters once; new filters keep it explicitly by row identity. */
function filterVisibility(sheet: SheetModel, filter: AutoFilter, display: (row: number, col: number) => string): { filtered: Set<string>; manual: Set<string> } {
  checkFilter(filter)
  const range = sheet.resolveRange(filter.range)!
  const previous = new Set(filter.hiddenRows)
  const filtered = new Set<string>()
  const manual = new Set<string>()
  for (let row = range.top + 1; row <= range.bottom; row++) {
    const id = sheet.rows.idAt(row)
    const matches = filter.columns.every((column) => column.values!.includes(display(row, range.left + column.col)))
    if (!matches) filtered.add(id)
    const wasFiltered = filter.hiddenRows ? previous.has(id) : !matches
    if (sheet.rowProp(row, 'manualHidden') || !filter.hiddenRows && sheet.rowProp(row, 'hidden') && !wasFiltered) manual.add(id)
  }
  return { filtered, manual }
}

export function setAutoFilter(sheet: SheetModel, range: CellRange | undefined, display?: (row: number, col: number) => string): void {
  const existing = sheet.filter.get('value') as AutoFilter | undefined
  let visibility: ReturnType<typeof filterVisibility> | undefined
  if (existing) {
    if (!existing.hiddenRows && existing.columns.length && !display) throw new DataOperationError('filter')
    visibility = filterVisibility(sheet, existing, display ?? (() => ''))
  }
  sheet.workbook.transact(() => {
    if (existing && visibility) {
      const old = sheet.resolveRange(existing.range)
      if (old) for (let row = old.top + 1; row <= old.bottom; row++) {
        sheet.setRowProp([row], 'hidden', visibility.manual.has(sheet.rows.idAt(row)) || undefined)
      }
    }
    if (!range) sheet.filter.delete('value')
    else {
      for (let row = range.top + 1; row <= range.bottom; row++) if (sheet.rowProp(row, 'hidden')) sheet.setRowProp([row], 'manualHidden', true)
      sheet.filter.set('value', { range: sheet.rangeIds(range), columns: [], hiddenRows: [] } satisfies AutoFilter)
    }
  })
}

/** Value lists combine with AND; filter hiding never takes ownership of manual hiding. */
export function filterColumn(sheet: SheetModel, offset: number, values: string[] | undefined, display: (row: number, col: number) => string): void {
  const filter = sheet.filter.get('value') as AutoFilter | undefined
  const range = filter && sheet.resolveRange(filter.range)
  if (!filter || !range) return
  if (!Number.isInteger(offset) || offset < 0 || offset > range.right - range.left) throw new DataOperationError('keys')
  const visibility = filterVisibility(sheet, filter, display)
  const columns = filter.columns.filter((column) => column.col !== offset)
  if (values) columns.push({ col: offset, values })
  const hiddenRows: string[] = []
  const hidden = new Map<number, boolean>()
  for (let row = range.top + 1; row <= range.bottom; row++) {
    const id = sheet.rows.idAt(row)
    const visible = columns.every((column) => column.values!.includes(display(row, range.left + column.col)))
    if (!visible) hiddenRows.push(id)
    hidden.set(row, !visible || visibility.manual.has(id))
  }
  sheet.workbook.transact(() => {
    sheet.filter.set('value', { ...filter, columns, hiddenRows })
    for (const id of visibility.manual) {
      const row = sheet.rows.indexOf(id)
      if (row >= 0) sheet.setRowProp([row], 'manualHidden', true)
    }
    for (const [row, hide] of hidden) if (!!sheet.rowProp(row, 'hidden') !== hide) sheet.setRowProp([row], 'hidden', hide || undefined)
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
