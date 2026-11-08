import { cachedSheetRead } from '../model/read-cache.js'
import { RangeLookup } from '../range-lookup.js'
import { csvNumber } from '../codec/csv-field.js'
import { parseXml } from '../../ooxml/package.js'
import { attr, boolAttr, child, children, numberAttr } from '../codec/xml.js'
import { cellStyle } from '../styles/cell-style.js'
import { Stylesheet } from '../styles/stylesheet.js'
import { clearLinks, clearRules, metadataRangeIds, putRangeLink, rebaseRule } from '../model/range-metadata.js'
import { normalizeRanges, intersects, contains } from '../range-set.js'
import { sortedFormula, outsideSortFormulas } from '../model/sort-formulas.js'
import { MAX_COLS, MAX_ROWS, parseRangeName, rangeContains, type CellRange } from '../address.js'
import { DataOperationError } from './data-errors.js'
import { assertArrayWrite } from './array-guard.js'
import { MAX_EXPANDED_CELLS } from '../limits.js'
import { randomId } from '../model/axis.js'
import { columnIntervalProps, columnIntervals } from '../model/column-intervals.js'
import { toA1Form, toIdForm } from '../model/formula-ids.js'
import { formatA1Reference, rewriteReferences, shiftFormula } from '../model/references.js'
import type { AutoFilter, BorderEdge, BorderStyle, CellData, ConditionalFormat, ConditionalRule, DataValidation, Hyperlink, Note, SheetTable, SheetColor, StyleProp, StyleProps } from '../model/schema.js'
import { deleteAxis, insertAxis, type AxisKind } from '../model/structure.js'
import { splitCellKey, type SheetModel } from '../model/workbook.js'
import { sortPositions } from './sort-positions.js'
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

/** Shared preflight for commands which expand rectangles, before starting a transaction. */
export function canExpandRanges(ranges: CellRange[]): boolean {
  let count = 0
  return ranges.every((range) => {
    if (![range.top, range.left, range.bottom, range.right].every(Number.isInteger) || range.top < 0 || range.left < 0 || range.bottom >= MAX_ROWS || range.right >= MAX_COLS || range.bottom < range.top || range.right < range.left) return false
    count += (range.bottom - range.top + 1) * (range.right - range.left + 1)
    return count <= MAX_EXPANDED_CELLS
  })
}

export function assertExpandableRanges(ranges: CellRange[]): void {
  if (!canExpandRanges(ranges)) throw new DataOperationError('size')
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
    const n = csvNumber(text)
    return { data: n !== undefined ? { v: n, ...(String(n) !== text ? { raw: text } : {}) } : { v: text } }
  }
  const parsed = parseInput(text, { date1904: !!options.date1904 })
  const value = parsed.value
  if (value !== null && typeof value === 'object') return { data: { v: value.code, t: 'e' }, ...(parsed.numFmt ? { numFmt: parsed.numFmt } : {}) }
  return { data: { v: value as CellData['v'] }, ...(parsed.numFmt ? { numFmt: parsed.numFmt } : {}) }
}

/** Types into one cell (the formula bar's Enter). Applies an inferred number format to General cells. */
export function setCellInput(sheet: SheetModel, row: number, col: number, text: string, options: InputOptions & { currentFormat?: string; inferFormat?: boolean } = {}): void {
  setCellInputs(sheet, [{ row, col, text, options }])
}

export interface CellInput {
  row: number
  col: number
  text: string
  options?: InputOptions & { currentFormat?: string; inferFormat?: boolean }
}

/** Preflight the complete write set, then commit in one undo step. */
export function setCellInputs(sheet: SheetModel, inputs: CellInput[]): void {
  assertArrayWrite(sheet, inputs.map(({ row, col }) => ({ top: row, bottom: row, left: col, right: col })))
  sheet.workbook.transact(() => {
    for (const { row, col, text, options } of inputs) writeCellInput(sheet, row, col, text, options)
  })
}

/** Low-level writer; the enclosing batch must have passed the shared array guard. */
function writeCellInput(sheet: SheetModel, row: number, col: number, text: string, options: InputOptions & { currentFormat?: string; inferFormat?: boolean } = {}): void {
  const { data, numFmt } = contentFromInput(sheet, text, options)
  const currentFormat = numFmt ? options.currentFormat ?? cellStyle(sheet, new Stylesheet(sheet.workbook.metaValue('stylesXml')), row, col).numFmt : undefined
  sheet.workbook.transact(() => {
    sheet.setCell(row, col, data)
    if (options.inferFormat !== false && numFmt && currentFormat === 'General') sheet.setStyle({ top: row, left: col, bottom: row, right: col }, { numFmt })
  })
}

/** Fills every cell of the ranges with the same input (Ctrl+Enter). Relative references move. */
export function fillInput(sheet: SheetModel, ranges: CellRange[], origin: { row: number; col: number }, text: string, options: InputOptions = {}): void {
  if (text === '') { clearContents(sheet, ranges); return }
  assertExpandableRanges(ranges)
  assertArrayWrite(sheet, ranges)
  const styles = new Stylesheet(sheet.workbook.metaValue('stylesXml'))
  sheet.workbook.transact(() => {
    for (const range of ranges) {
      for (let row = range.top; row <= range.bottom; row++) {
        for (let col = range.left; col <= range.right; col++) {
          const shifted = fillInputText(text, origin, row, col, options)
          writeCellInput(sheet, row, col, shifted, { ...options, currentFormat: cellStyle(sheet, styles, row, col).numFmt })
        }
      }
    }
  })
}

/** The exact typed input at a fill destination, shared by validation preflight and writing. */
export function fillInputText(text: string, origin: { row: number; col: number }, row: number, col: number, options: InputOptions = {}): string {
  return text.startsWith('=') && !options.valuesOnly ? `=${shiftFormula(text.slice(1), row - origin.row, col - origin.col)}` : text
}

export function clearContents(sheet: SheetModel, ranges: CellRange[]): void {
  assertArrayWrite(sheet, ranges)
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

/** Remove stored axis formats, including positional row slots and compact imported columns. */
function clearAxisFormats(sheet: SheetModel, ranges: CellRange[]): void {
  for (const kind of ['row', 'col'] as const) {
    const selected = ranges.filter(kind === 'row' ? isWholeRows : isWholeColumns)
    if (!selected.length) continue
    const meta = kind === 'row' ? sheet.rowMeta : sheet.colMeta
    for (const key of [...meta.keys()]) {
      const split = key.lastIndexOf('|')
      const id = key.slice(0, split), prop = key.slice(split + 1)
      if (prop !== 'xf' && !prop.startsWith('s.')) continue
      const position = kind === 'row' ? sheet.rowMetaPosition(id, prop) : sheet.cols.indexOf(id)
      if (position >= 0 && selected.some((r) => kind === 'row' ? position >= r.top && position <= r.bottom : position >= r.left && position <= r.right)) meta.delete(key)
    }
  }
  let intervals = columnIntervals(sheet)
  for (const range of ranges.filter(isWholeColumns)) {
    intervals = intervals.flatMap((interval) => {
      if (interval.to < range.left || interval.from > range.right || interval.props.xf === undefined) return [interval]
      const { xf: _xf, ...props } = interval.props
      return [
        ...(interval.from < range.left ? [{ ...interval, to: range.left - 1 }] : []),
        { from: Math.max(interval.from, range.left), to: Math.min(interval.to, range.right), props },
        ...(interval.to > range.right ? [{ ...interval, from: range.right + 1 }] : []),
      ]
    })
  }
  if (JSON.stringify(intervals) !== JSON.stringify(columnIntervals(sheet))) sheet.raw.set('colTail', intervals)
}

function formattedRows(sheet: SheetModel): number[] {
  const rows = new Set<number>()
  for (const key of sheet.rowMeta.keys()) {
    const split = key.lastIndexOf('|'), prop = key.slice(split + 1)
    if (prop !== 'xf' && !prop.startsWith('s.')) continue
    const row = sheet.rowMetaPosition(key.slice(0, split), prop)
    if (row >= 0) rows.add(row)
  }
  return [...rows]
}

/** Explicit resets are needed where an unselected axis would otherwise reapply its style. */
function inheritedFormatResets(sheet: SheetModel, ranges: CellRange[]): CellRange[] {
  const rows = new Set<number>(), cols = new Set<number>()
  for (const kind of ['row', 'col'] as const) {
    for (const key of (kind === 'row' ? sheet.rowMeta : sheet.colMeta).keys()) {
      const split = key.lastIndexOf('|'), prop = key.slice(split + 1)
      if (prop !== 'xf' && !prop.startsWith('s.')) continue
      const id = key.slice(0, split)
      const position = kind === 'row' ? sheet.rowMetaPosition(id, prop) : sheet.cols.indexOf(id)
      if (position >= 0) (kind === 'row' ? rows : cols).add(position)
    }
  }
  for (const interval of columnIntervals(sheet)) if (interval.props.xf !== undefined) for (let col = Math.max(0, interval.from); col <= Math.min(MAX_COLS - 1, interval.to); col++) cols.add(col)
  const resets: CellRange[] = []
  for (const range of ranges) {
    if (!isWholeRows(range)) for (const row of rows) if (row >= range.top && row <= range.bottom) resets.push({ ...range, top: row, bottom: row })
    if (!isWholeColumns(range)) for (const col of cols) if (col >= range.left && col <= range.right) resets.push({ ...range, left: col, right: col })
  }
  assertExpandableRanges(resets)
  return resets
}

export function clearFormats(sheet: SheetModel, ranges: CellRange[]): void {
  const resets = inheritedFormatResets(sheet, ranges)
  const defaults = new Stylesheet(sheet.workbook.metaValue('stylesXml')).resolve(0)
  sheet.workbook.transact(() => {
    clearAxisFormats(sheet, ranges)
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
    clearRules(sheet, 'cf', ranges)
    for (const range of resets) for (let row = range.top; row <= range.bottom; row++) for (let col = range.left; col <= range.right; col++) {
      const overrides = { ...sheet.axisOverrides('col', sheet.cols.idAt(col)), ...sheet.axisOverrides('row', sheet.rows.idAt(row)) }
      const patch = Object.fromEntries(Object.keys(overrides).map((prop) => [prop, defaults[prop as StyleProp]])) as StylePatch
      if (sheet.rowProp(row, 'xf') !== undefined || sheet.colProp(col, 'xf') !== undefined || columnIntervalProps(sheet, col).xf !== undefined) sheet.setBaseXf(row, col, 0)
      if (Object.keys(patch).length) sheet.setStyle({ top: row, bottom: row, left: col, right: col }, patch)
    }
  })
}

export function clearAll(sheet: SheetModel, ranges: CellRange[]): void {
  // Clear Formats can require explicit resets at intersections with inherited formats.
  // Prepare that work before deleting values, so refusal never leaves a partial Clear All.
  inheritedFormatResets(sheet, ranges)
  assertArrayWrite(sheet, ranges)
  sheet.workbook.transact(() => {
    clearContents(sheet, ranges)
    clearFormats(sheet, ranges)
    clearRules(sheet, 'dv', ranges)
    clearLinks(sheet, ranges)
    for (const key of [...sheet.notes.keys()]) {
      const point = sheet.position(key)
      if (point && ranges.some((r) => rangeContains(r, point.row, point.col))) sheet.notes.delete(key)
    }
  })
}

function preflightStyle(sheet: SheetModel, ranges: CellRange[], dense: CellRange[] = []): number[] {
  const rowFormats = formattedRows(sheet)
  const intersections = ranges.filter((r) => isWholeColumns(r) && !isWholeRows(r)).flatMap((r) => rowFormats.map((row) => ({ ...r, top: row, bottom: row })))
  // Include blank intersections where row formats take precedence over column formats.
  const rowWork = ranges.filter((r) => isWholeColumns(r) && isWholeRows(r)).flatMap(() => rowFormats.length ? [{ top: 0, bottom: rowFormats.length - 1, left: 0, right: 0 }] : [])
  assertExpandableRanges([...dense, ...rowWork, ...intersections, ...ranges.map((r) => isWholeColumns(r) ? { top: 0, bottom: 0, left: r.left, right: r.right } : isWholeRows(r) ? { top: r.top, bottom: r.bottom, left: 0, right: 0 } : r)])
  return rowFormats
}

/** Applies style properties to ranges; whole rows/columns style the row/column and their cells. */
export function applyStyle(sheet: SheetModel, ranges: CellRange[], patch: StylePatch): void {
  const rowFormats = preflightStyle(sheet, ranges)
  sheet.workbook.transact(() => {
    for (const range of ranges) {
      if (isWholeColumns(range) || isWholeRows(range)) {
        const kind = isWholeColumns(range) && !isWholeRows(range) ? 'col' : 'row'
        if (isWholeColumns(range) && isWholeRows(range)) {
          // Every column, including blank columns outside the used area.
          sheet.setAxisStyle('col', span(0, MAX_COLS - 1), patch)
          if (rowFormats.length) sheet.setAxisStyle('row', rowFormats, patch)
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
        if (isWholeColumns(range) && !isWholeRows(range)) for (const row of rowFormats) sheet.setStyle({ ...range, top: row, bottom: row }, patch)
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
  const axis = ranges.filter((r) => (isWholeColumns(r) || isWholeRows(r)) && (preset === 'all' || preset === 'none'))
  const axisSet = new Set(axis)
  const dense = ranges.filter((r) => !axisSet.has(r))
  preflightStyle(sheet, axis, dense)
  sheet.workbook.transact(() => {
    const border = preset === 'none' ? null : edge()
    applyStyle(sheet, axis, { borderTop: border, borderBottom: border, borderLeft: border, borderRight: border })
    for (const range of dense) {
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
  assertExpandableRanges(ranges)
  const targets = ranges.flatMap((range) => mode === 'across'
    ? span(range.top, range.bottom).map((row) => ({ ...range, top: row, bottom: row })) : [range])
  const cellCount = (areas: CellRange[]) => areas.reduce((count, r) => count + (r.bottom - r.top + 1) * (r.right - r.left + 1), 0)
  if (cellCount(normalizeRanges(ranges)) !== cellCount(ranges)) throw new DataOperationError('merges')
  const existingMerges = sheet.mergedRanges()
  for (const target of targets) {
    for (const merge of existingMerges) {
      if (intersects(merge.range, target) && !contains(target, merge.range)) throw new DataOperationError('merges')
    }
  }
  const cleared = ranges.flatMap((r) => mode === 'across'
    ? [{ ...r, left: r.left + 1 }]
    : [{ ...r, top: r.top + 1 }, { ...r, bottom: r.top, left: r.left + 1 }]).filter((r) => r.top <= r.bottom && r.left <= r.right)
  assertArrayWrite(sheet, cleared)
  sheet.workbook.transact(() => {
    for (const range of ranges) {
      const targets = mode === 'across' ? span(range.top, range.bottom).map((row) => ({ ...range, top: row, bottom: row })) : [range]
      for (const target of targets) {
        if (target.top === target.bottom && target.left === target.right) continue
        // Existing merges inside go; contents other than the first go.
        for (const merge of existingMerges) if (intersects(merge.range, target)) sheet.merges.delete(merge.id)
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
  assertArrayWrite(sheet, [], { insert: { kind, at } })
  assertExpandableRanges([kind === 'row' ? { top: at, bottom: at + count - 1, left: 0, right: 0 } : { left: at, right: at + count - 1, top: 0, bottom: 0 }])
  if (at > 0) {
    const source = (kind === 'row' ? sheet.rows : sheet.cols).idAt(at - 1)
    let properties = 1
    for (const key of (kind === 'row' ? sheet.rowMeta : sheet.colMeta).keys()) {
      const bar = key.lastIndexOf('|'), prop = key.slice(bar + 1)
      if (['hidden', 'manualHidden', 'level', 'collapsed', 'keep'].includes(prop)) continue
      if (kind === 'row' ? sheet.rowMetaPosition(key.slice(0, bar), prop) === at - 1 : key.slice(0, bar) === source) properties++
    }
    for (const map of [sheet.xf, sheet.fmt]) for (const key of map.keys()) {
      const owner = map === sheet.fmt ? key.slice(0, key.lastIndexOf('|')) : key
      const ids = splitCellKey(owner)
      if ((kind === 'row' ? ids.row : ids.col) === source) properties++
    }
    if (properties * count > MAX_EXPANDED_CELLS) throw new DataOperationError('size')
  }
  insertAxis(sheet, kind, at, count)
}

export function deleteLines(sheet: SheetModel, kind: AxisKind, at: number, count: number): void {
  if (count <= 0) return
  assertExpandableRanges([kind === 'row' ? { top: at, bottom: at + count - 1, left: 0, right: 0 } : { left: at, right: at + count - 1, top: 0, bottom: 0 }])
  assertArrayWrite(sheet, [kind === 'row' ? { top: at, bottom: at + count - 1, left: 0, right: MAX_COLS - 1 } : { left: at, right: at + count - 1, top: 0, bottom: MAX_ROWS - 1 }])
  deleteAxis(sheet, kind, at, count)
}

function checkAxisPositions(kind: AxisKind, positions: number[]): void {
  if (positions.length > MAX_EXPANDED_CELLS || positions.some((p) => !Number.isInteger(p) || p < 0 || p >= (kind === 'row' ? MAX_ROWS : MAX_COLS))) throw new DataOperationError('size')
}

export function setHidden(sheet: SheetModel, kind: AxisKind, positions: number[], hidden: boolean): void {
  checkAxisPositions(kind, positions)
  sheet.workbook.transact(() => {
    if (!hidden) {
      // Lines dragged to zero size come back at the default size, as in Excel.
      const collapsed = positions.filter((p) => ((kind === 'row' ? sheet.rowProp(p, 'size') : sheet.colProp(p, 'size')) ?? 1) <= 0)
      for (const prop of ['size', 'custom'] as const) {
        if (kind === 'row') sheet.setRowProp(collapsed, prop, undefined)
        else sheet.setColProp(collapsed, prop, undefined)
      }
    }
    if (kind === 'col') { sheet.setColProp(positions, 'hidden', hidden || undefined); return }
    const filter = sheet.filter.get('value') as AutoFilter | undefined
    const filteredRows = new Set(filter?.hiddenRows)
    for (const row of positions) {
      sheet.ensure(row, 0)
      const id = sheet.rows.idAt(row)
      sheet.setRowProp([row], 'manualHidden', hidden || undefined)
      sheet.setRowProp([row], 'hidden', hidden || filteredRows.has(id) || undefined)
    }
  })
}

/** Sets row heights (points) or column widths (character units) by hand. */
export function setSize(sheet: SheetModel, kind: AxisKind, positions: number[], size: number): void {
  checkAxisPositions(kind, positions)
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
  checkAxisPositions(kind, positions)
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
  const data = sheet.cellData(key)
  const snapshot: CellSnapshot = { overrides: sheet.cellOverrides(key) }
  if (data) {
    snapshot.data = data
    if (data.f !== undefined) snapshot.formula = toA1Form(data.f, sheet)
  }
  const xf = sheet.xf.get(key)
  const note = sheet.notes.get(key) as Note | undefined
  const link = sheet.linkAt(row, col)
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

export { DATA_ERRORS, DataOperationError } from './data-errors.js'

export interface SortOptions {
  caseSensitive?: boolean
  /** Required to determine the extent of calculated dynamic spills. */
  values?: SheetValues
  display?: (row: number, col: number) => string
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

/** Sort a snapshot synchronously, with all safety checks completed before the first write. */
export function sortRange(sheet: SheetModel, range: CellRange, keys: SortKey[], value: (row: number, col: number) => CellValue, options: SortOptions = {}): void {
  // Observers are deferred inside an outer transaction, so preparation cannot detect changes.
  if (sheet.workbook.doc._transaction) throw new DataOperationError('changed')
  let changed = false
  const onChange = () => { changed = true }
  sheet.workbook.root.observeDeep(onChange)
  try {
    let area = clampToUsed(sheet, range)
    let tableFilter: AutoFilter | undefined
    const tables = [...sheet.tables.entries()].flatMap(([id, raw]) => {
      const table = raw as SheetTable
      const rect = sheet.resolveRange(table.range)
      return rect && intersects(rect, area) ? [{ id, table, rect }] : []
    })
    if (tables.length > 1 || tables[0] && !contains(tables[0].rect, area)) throw new DataOperationError('tables')
    if (tables[0]) {
      const { table, rect } = tables[0]
      if (table.xml && /<(?:\w+:)?filterColumn\b/.test(table.xml)) {
        const auto = child(parseXml(table.xml).documentElement, 'autoFilter')
        if (!auto) throw new DataOperationError('filter')
        const columns = children(auto, 'filterColumn').map((column) => {
          const list = child(column, 'filters')
          if (!list || children(list).some((node) => node.localName !== 'filter')) throw new DataOperationError('filter')
          const values = children(list, 'filter').map((node) => attr(node, 'val') ?? '')
          if (boolAttr(list, 'blank')) values.push('')
          return { col: numberAttr(column, 'colId') ?? 0, values }
        })
        const filterRect = { ...rect, bottom: rect.bottom - Number(table.totalsRow) }
        tableFilter = { range: { top: sheet.rows.idAt(filterRect.top), bottom: sheet.rows.idAt(filterRect.bottom), left: sheet.cols.idAt(filterRect.left), right: sheet.cols.idAt(filterRect.right) }, columns }
      }
      area = { ...rect, top: rect.top + (table.headerRow ? 1 : 0), bottom: rect.bottom - (table.totalsRow ? 1 : 0) }
    }
    if (!keys.length || keys.some((key) => !Number.isInteger(key.col) || key.col < area.left || key.col > area.right)) throw new DataOperationError('keys')
    if (area.top >= area.bottom) return
    assertExpandableRanges([area])
    const merges = sheet.mergedRanges().map((merge) => merge.range).filter((r) => intersects(r, area))
    const blockHeight = merges.length ? merges[0]!.bottom - merges[0]!.top + 1 : 1
    const blockWidth = merges.length ? merges[0]!.right - merges[0]!.left + 1 : 1
    if (merges.length && (merges.some((r) => !contains(area, r) || r.bottom - r.top + 1 !== blockHeight || r.right - r.left + 1 !== blockWidth || (r.top - area.top) % blockHeight || (r.left - area.left) % blockWidth) || merges.length * blockHeight * blockWidth !== (area.bottom - area.top + 1) * (area.right - area.left + 1))) throw new DataOperationError('merges')
    const filter = tableFilter ?? sheet.filter.get('value') as AutoFilter | undefined
    const filterRange = filter && sheet.resolveRange(filter.range)
    const filterData = filterRange && { ...filterRange, top: filterRange.top + 1 }
    const filtering = !!filter && !!filterData && intersects(filterData, area)
    if (filtering) checkFilter(filter!)
    const display = options.display ?? ((r: number, c: number) => String(value(r, c) ?? ''))
    const visibility = filtering ? filterVisibility(sheet, filter!, display) : undefined
    assertArrayWrite(sheet, [area], { sort: { values: options.values, value } })
    sheet.forEachCell((row, col, data) => {
      if (data.keep?.f?.t === 'dataTable') {
        const opaqueRange = data.keep.f.ref && parseRangeName(data.keep.f.ref)
        if (rangeContains(area, row, col) || opaqueRange && intersects(opaqueRange, area)) throw new DataOperationError('formulas')
      }
    })
    const rows = span(area.top, area.bottom)
    // Content, including styled blanks and annotations, beside the selection must stay put.
    const outside = (key: string) => {
      const pos = sheet.position(key.split('|')[0]!)
      return pos && pos.row >= area.top && pos.row <= area.bottom && (pos.col < area.left || pos.col > area.right)
    }
    const permute = ![sheet.cells, sheet.xf, sheet.fmt, sheet.notes, sheet.links].some((map) => [...map.keys()].some(outside))
    // Evaluate keys once, before writes (formula evaluation may invalidate caches).
    const keyValues = new Map(rows.map((row) => [row, keys.map((key) => value(row, key.col))]))
    const blocks = rows.filter((_, i) => i % blockHeight === 0)
    const order = blocks.sort((a, b) => {
      for (let k = 0; k < keys.length; k++) {
        const result = compareForSort(keyValues.get(a)![k]!, keyValues.get(b)![k]!, keys[k]!.descending, options.caseSensitive)
        if (result) return result
      }
      return a - b
    }).flatMap((start) => span(start, start + blockHeight - 1))
    const cols = span(area.left, area.right)
    const snapshots = order.map((row) => cols.map((col) => snapshotCell(sheet, row, col)))
    const manual = order.map((row) => visibility?.manual.has(sheet.rows.idAt(row)) ?? !!(sheet.rowProp(row, 'manualHidden') || sheet.rowProp(row, 'hidden')))
    const restorePositions = permute ? sortPositions(sheet, area) : undefined
    const rangeLinks = [...sheet.links.entries()].filter(([, raw]) => { const link = raw as Hyperlink; return link.range && (link.range.top?.startsWith('~p') || link.range.top !== link.range.bottom || link.range.left !== link.range.right) })
    const rangeLinkKeys = new Set(rangeLinks.map(([key]) => key))
    const movedFormulas = permute ? order.map((row) => cols.map((col) => {
      const key = sheet.keyAt(row, col)
      const f = sheet.cellData(key)?.f
      return f === undefined ? undefined : sortedFormula(sheet, key, f, area)
    })) : []
    const keepOutsideFormulas = permute ? outsideSortFormulas(sheet, area) : undefined
    const ids = order.map((row) => sheet.rows.idAt(row))
    // Same-row references follow the record. Cross-row relative references inside the data
    // keep their offset (Calc's real sort); absolute references stay positional. References
    // outside the data retain their identities, including references to other sheets.
    const formulas = order.map((source, i) => cols.map((col, c) => {
      const formula = snapshots[i]![c]!.formula
      if (formula === undefined) return undefined
      return rewriteReferences(formula, (ref) => {
        if (ref.kind === 'name' || ref.external || ref.sheet && ref.sheet.first !== sheet.name) return undefined
        const end = (e: typeof ref.from) => {
          if (e.row === undefined || e.row < area.top || e.row > area.bottom) return e
          return { ...e, row: e.rowAbs ? e.row : e.row + rows[i]! - source }
        }
        const from = end(ref.from)
        const to = ref.to && end(ref.to)
        if ([from, to].some((e) => e?.row !== undefined && (e.row < 0 || e.row >= MAX_ROWS))) return '#REF!'
        return formatA1Reference({ ...ref, from, to })
      })
    }))
    if (changed) throw new DataOperationError('changed')
    sheet.workbook.transact(() => {
      if (permute) {
        restorePositions!()
        sheet.rows.permute(area.top, ids)
        keepOutsideFormulas!()
      }
      order.forEach((sourceRow, index) => {
        const targetRow = rows[index]!
        cols.forEach((col, offset) => {
          const snapshot = snapshots[index]![offset]!
          const formula = formulas[index]![offset]
          if (permute) {
            const moved = movedFormulas[index]![offset]
            if (moved) sheet.raw.set(`sortFormula:${sheet.keyAt(targetRow, col)}`, moved)
            return
          }
          if (sourceRow === targetRow) return
          placeCell(sheet, { ...snapshot, formula: undefined }, { row: sourceRow, col }, { row: targetRow, col })
          if (formula !== undefined) sheet.cells.set(sheet.keyAt(targetRow, col), { ...snapshot.data!, f: toIdForm(formula, sheet) })
          const key = sheet.keyAt(targetRow, col)
          if (snapshot.note) sheet.notes.set(key, snapshot.note)
          else sheet.notes.delete(key)
          if (rangeLinkKeys.has(key) || snapshot.link?.range && (snapshot.link.range.top?.startsWith('~p') || snapshot.link.range.top !== snapshot.link.range.bottom || snapshot.link.range.left !== snapshot.link.range.right)) {
            if (!rangeLinkKeys.has(key)) sheet.links.delete(key)
            return
          }
          if (snapshot.link) sheet.links.set(key, { ...snapshot.link, ...(snapshot.link.range ? { range: sheet.rangeIds({ top: targetRow, bottom: targetRow, left: col, right: col }) } : {}) })
          else sheet.links.delete(key)
        })
      })
      if (!permute) for (let i = 0; i < rows.length; i++) {
        sheet.setRowProp([rows[i]!], 'manualHidden', manual[i] || undefined)
        sheet.setRowProp([rows[i]!], 'hidden', manual[i] || undefined)
      }
      const sort = keys.map((key) => ({ col: sheet.cols.idAt(key.col), descending: !!key.descending }))
      if (tables[0]) sheet.tables.set(tables[0].id, { ...sheet.tables.get(tables[0].id) as SheetTable, sort, sortCaseSensitive: !!options.caseSensitive })
      else if (!filtering) sheet.filter.set('sort', { range: permute ? { ...sheet.rangeIds(area), top: sheet.positionRowId(area.top), bottom: sheet.positionRowId(area.bottom) } : sheet.rangeIds(area), columns: [], sort, sortCaseSensitive: !!options.caseSensitive } satisfies AutoFilter)
      if (filtering) {
        sheet.filter.delete('sort')
        const current = tableFilter ?? sheet.filter.get('value') as AutoFilter
        options.values?.refresh?.()
        const hiddenRows: string[] = []
        const matches = filterMatcher(current.columns, display)
        const currentRange = tableFilter ? filterRange! : sheet.resolveRange(current.range)!
        for (let row = currentRange.top + 1; row <= currentRange.bottom; row++) {
          // Evaluate after every record and formula has moved, with fresh positional caches.
          const hidden = !matches(row, currentRange.left)
          if (hidden) hiddenRows.push(sheet.rows.idAt(row))
          const manuallyHidden = !!sheet.rowProp(row, 'manualHidden') || (row < area.top || row > area.bottom) && visibility!.manual.has(sheet.rows.idAt(row))
          if (!!sheet.rowProp(row, 'manualHidden') !== manuallyHidden) sheet.setRowProp([row], 'manualHidden', manuallyHidden || undefined)
          if (!!sheet.rowProp(row, 'hidden') !== (hidden || manuallyHidden)) sheet.setRowProp([row], 'hidden', hidden || manuallyHidden || undefined)
        }
        if (!tableFilter) sheet.filter.set('value', { ...current, hiddenRows, sort, sortCaseSensitive: !!options.caseSensitive, sortXml: undefined })
      }
    })
  } finally {
    sheet.workbook.root.unobserveDeep(onChange)
  }
}

// ── Filters ────────────────────────────────────────────────────────────────

/** Build value membership once for a row pass, rather than scanning allowed values per cell. */
function filterMatcher(columns: AutoFilter['columns'], display: (row: number, col: number) => string): (row: number, left: number) => boolean {
  const indexed = columns.map((column) => ({ col: column.col, values: new Set(column.values) }))
  return (row, left) => indexed.every((column) => column.values.has(display(row, left + column.col)))
}

function checkFilter(filter: AutoFilter): void {
  if (filter.columns.some((column) => !column.values)) throw new DataOperationError('filter')
}

/** Infer provenance for imported filters once; new filters keep it explicitly by row identity. */
function filterVisibility(sheet: SheetModel, filter: AutoFilter, display: (row: number, col: number) => string): { filtered: Set<string>; manual: Set<string> } {
  checkFilter(filter)
  const range = sheet.resolveRange(filter.range)!
  assertExpandableRanges([range])
  const previous = new Set(filter.hiddenRows)
  const filtered = new Set<string>()
  const manual = new Set<string>()
  const matchesRow = filterMatcher(filter.columns, display)
  for (let row = range.top + 1; row <= range.bottom; row++) {
    const id = sheet.rows.idAt(row)
    const matches = matchesRow(row, range.left)
    if (!matches) filtered.add(id)
    const wasFiltered = filter.hiddenRows ? previous.has(id) : !matches
    if (sheet.rowProp(row, 'manualHidden') || !filter.hiddenRows && sheet.rowProp(row, 'hidden') && !wasFiltered) manual.add(id)
  }
  return { filtered, manual }
}

export function setAutoFilter(sheet: SheetModel, range: CellRange | undefined, display?: (row: number, col: number) => string): void {
  if (range) { range = clampToUsed(sheet, range); assertExpandableRanges([range]) }
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
  const matchesRow = filterMatcher(columns, display)
  for (let row = range.top + 1; row <= range.bottom; row++) {
    const id = sheet.rows.idAt(row)
    const visible = matchesRow(row, range.left)
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

/** Set/remove one cell, preserving the rest of any imported multi-cell hyperlink. */
export function setLink(sheet: SheetModel, row: number, col: number, link: Hyperlink | undefined): void {
  const point = { top: row, bottom: row, left: col, right: col }
  const range = link?.range ? sheet.resolveRange(link.range) : point
  setRangeLinks(sheet, range ? [range] : [], link)
}

export function setRangeLinks(sheet: SheetModel, ranges: CellRange[], link: Hyperlink | undefined): void {
  const selected = normalizeRanges(ranges)
  sheet.workbook.transact(() => {
    clearLinks(sheet, selected)
    if (link && (link.target || link.location)) for (const range of selected) {
      // Single-cell links follow records; range links, including split survivors, stay positional.
      if (range.top === range.bottom && range.left === range.right) {
        sheet.ensure(range.top, range.left)
        const { range: _range, ...value } = link
        sheet.links.set(sheet.keyAt(range.top, range.left), value)
      } else putRangeLink(sheet, range, link)
    }
  })
}

export function setValidation(sheet: SheetModel, ranges: CellRange[], validation: Omit<DataValidation, 'ranges'> | undefined): void {
  const selected = normalizeRanges(ranges)
  sheet.workbook.transact(() => {
    clearRules(sheet, 'dv', selected)
    if (validation && selected.length) {
      const value = { ...validation, ranges: [] } as DataValidation
      sheet.dv.set(randomId(), { ...rebaseRule(value, sheet, ranges[0]!, selected[0]!), ranges: selected.map((range) => metadataRangeIds(sheet, range)) })
    }
  })
}

/** Replacing/clearing CF differs from adding another Excel rule, which may overlap it. */
export function setConditionalFormat(sheet: SheetModel, ranges: CellRange[], format: Omit<ConditionalFormat, 'ranges'> | undefined, mode: 'replace' | 'add' = 'replace'): void {
  const selected = normalizeRanges(ranges)
  sheet.workbook.transact(() => {
    if (!format || mode === 'replace') clearRules(sheet, 'cf', selected)
    if (format && selected.length) {
      const value = { ...format, ranges: [] } as ConditionalFormat
      sheet.cf.set(randomId(), { ...rebaseRule(value, sheet, ranges[0]!, selected[0]!), ranges: selected.map((range) => metadataRangeIds(sheet, range)) })
    }
  })
}

/** The validation rule covering a cell, if any. */
export function validationAt(sheet: SheetModel, row: number, col: number): DataValidation | undefined {
  return validationEntryAt(sheet, row, col)?.value
}

/** The validation covering a cell with its key in `sheet.dv`, for editing it in place. */
export function validationEntryAt(sheet: SheetModel, row: number, col: number): { id: string; value: DataValidation } | undefined {
  const lookup = cachedSheetRead(sheet.workbook.doc, sheet.map, 'validations', () => new RangeLookup(
    [...sheet.dv.entries()].map(([id, value]) => ({ id, value: value as DataValidation })),
    (entry) => entry.value.ranges.flatMap((ids) => { const range = sheet.resolveRange(ids); return range ? [range] : [] }),
  ))
  return lookup.first(row, col)
}

/** Replaces one validation's settings in place: its ranges (and file position) stay as they are. */
export function updateValidation(sheet: SheetModel, id: string, validation: Omit<DataValidation, 'ranges'> | undefined): void {
  const existing = sheet.dv.get(id) as DataValidation | undefined
  if (!existing) return
  sheet.workbook.transact(() => {
    if (!validation) sheet.dv.delete(id)
    else sheet.dv.set(id, { ...validation, ranges: existing.ranges, ...(existing.fileOrder !== undefined ? { fileOrder: existing.fileOrder } : {}) })
  })
}

/** A list validation's literal `"a,b,c"` formula; undefined when an item can't be written in one (commas). */
export function listValidationFormula(items: string[]): string | undefined {
  const cleaned = items.map((item) => item.trim()).filter(Boolean)
  if (!cleaned.length || cleaned.some((item) => item.includes(','))) return undefined
  return `"${cleaned.join(',').replace(/"/g, '""')}"`
}

/**
 * Adds a conditional format rule over ranges with the highest priority, as Excel adds new rules
 * at the top: every other rule on the sheet moves down one, keeping priorities unique.
 */
export function addConditionalRule(sheet: SheetModel, ranges: CellRange[], rule: ConditionalRule): void {
  sheet.workbook.transact(() => {
    for (const [id, raw] of [...sheet.cf]) {
      const format = raw as ConditionalFormat
      if (format.rules.some((existing) => existing.priority >= rule.priority)) sheet.cf.set(id, { ...format, rules: format.rules.map((existing) => existing.priority >= rule.priority ? { ...existing, priority: existing.priority + 1 } : existing) })
    }
    setConditionalFormat(sheet, ranges, { rules: [rule] }, 'add')
  })
}

/** The contiguous numbers directly above a cell, else left of it, for AutoSum to total. */
export function autoSumSource(value: (row: number, col: number) => CellValue, row: number, col: number): CellRange | undefined {
  const numeric = (r: number, c: number) => typeof value(r, c) === 'number'
  if (row > 0 && numeric(row - 1, col)) {
    let top = row - 1
    while (top > 0 && numeric(top - 1, col)) top--
    return { top, bottom: row - 1, left: col, right: col }
  }
  if (col > 0 && numeric(row, col - 1)) {
    let left = col - 1
    while (left > 0 && numeric(row, left - 1)) left--
    return { top: row, bottom: row, left, right: col - 1 }
  }
  return undefined
}

/**
 * Where AutoSum puts totals for a selected range: below each column that has numbers (in the
 * selection's own last row when that row is empty), or right of a single selected row.
 */
export function autoSumTotals(value: (row: number, col: number) => CellValue, range: CellRange, used: CellRange | undefined): { row: number; col: number; source: CellRange }[] {
  const blank = (r: number, c: number) => { const v = value(r, c); return v === null || v === '' }
  const hasNumber = (source: CellRange) => {
    for (let r = source.top; r <= source.bottom; r++) for (let c = source.left; c <= source.right; c++) if (typeof value(r, c) === 'number') return true
    return false
  }
  // Past the used area every cell is empty, so scans stop there.
  const lastRow = Math.min(MAX_ROWS - 1, Math.max(range.bottom, used?.bottom ?? 0) + 1)
  const lastCol = Math.min(MAX_COLS - 1, Math.max(range.right, used?.right ?? 0) + 1)
  if (range.top === range.bottom && range.right > range.left) {
    if (!hasNumber(range)) return []
    let col = range.right + 1
    while (col < lastCol && !blank(range.top, col)) col++
    return col < MAX_COLS && blank(range.top, col) ? [{ row: range.top, col, source: range }] : []
  }
  const columns = span(range.left, range.right)
  let row: number
  let bottom = range.bottom
  if (range.bottom > range.top && columns.every((c) => blank(range.bottom, c))) {
    row = range.bottom
    bottom = range.bottom - 1
  } else {
    row = range.bottom + 1
    while (row < lastRow && !columns.every((c) => blank(row, c))) row++
    if (row >= MAX_ROWS || !columns.every((c) => blank(row, c))) return []
  }
  return columns.flatMap((col) => {
    const source = { top: range.top, bottom, left: col, right: col }
    return hasNumber(source) ? [{ row, col, source }] : []
  })
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
