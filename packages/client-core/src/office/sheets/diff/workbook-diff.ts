import * as Y from 'yjs'
import type { LiveAssetStore } from '../../live-format.js'
import { cellName, columnName } from '../address.js'
import { SheetCodec } from '../codec/codec.js'
import { toA1Form } from '../model/formula-ids.js'
import type { CellData, RangeIds, StyleProps } from '../model/schema.js'
import { WorkbookModel, type SheetModel } from '../model/workbook.js'
import { formatValue } from '../numfmt/index.js'
import { Stylesheet, type ResolvedStyle } from '../styles/stylesheet.js'
import { matchSequences } from './sequence.js'
import { relativeFormula } from '../model/references.js'

/**
 * What changed between two versions of a workbook, for reviewing a proposed change (an agent's
 * Suggest-mode push) the way a person would describe it: sheets added, removed, renamed; rows and
 * columns inserted or deleted; and cells whose value, formula, or format changed, by address.
 */

export interface CellChange {
  /** Address in the new version (`B7`), or in the old one for removed content. */
  address: string
  row: number
  col: number
  kind: 'added' | 'removed' | 'changed'
  /** What the cell held, as typed: a formula with `=`, or the value. */
  before?: string
  after?: string
  /** Shown values (formatted) when they differ from what was typed. */
  beforeShown?: string
  afterShown?: string
  /** Format properties that changed, with old and new values in plain words. */
  format?: { property: FormatProperty; before: string; after: string }[]
}

export type FormatProperty =
  | 'font'
  | 'size'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'textColor'
  | 'fill'
  | 'borders'
  | 'alignment'
  | 'wrap'
  | 'numberFormat'

export interface StructureChange {
  kind: 'rowsInserted' | 'rowsDeleted' | 'columnsInserted' | 'columnsDeleted'
  /** One-based rows or letters, in the version where they exist (new for inserted, old for deleted). */
  from: string
  to: string
  count: number
}

export interface SheetDiff {
  name: string
  previousName?: string
  status: 'added' | 'removed' | 'changed' | 'unchanged'
  structure: StructureChange[]
  cells: CellChange[]
  /** Changes besides cells and structure. */
  other: OtherChange[]
}

export type OtherChange =
  | { kind: 'visibility'; before: string; after: string }
  | { kind: 'merged' | 'unmerged'; range: string }
  | { kind: 'frozenRows' | 'frozenCols' | 'conditionalFormats' | 'validations' | 'drawings' | 'notes'; before: number; after: number }

export interface WorkbookDiff {
  sheets: SheetDiff[]
  /** Defined names added, removed, or changed. */
  names: { name: string; kind: 'added' | 'removed' | 'changed'; before?: string; after?: string }[]
  /** Totals for a summary line. */
  totals: { cellsChanged: number; sheetsChanged: number }
  /** True when cell lists were cut short (very large changes). */
  truncated: boolean
}

export interface DiffOptions {
  /** Most cell changes listed per sheet (the rest are counted). */
  maxCellsPerSheet?: number
}

const FORMAT_PROPS: Record<FormatProperty, (keyof StyleProps)[]> = {
  font: ['fontName'],
  size: ['fontSize'],
  bold: ['bold'],
  italic: ['italic'],
  underline: ['underline'],
  strikethrough: ['strike'],
  textColor: ['fontColor'],
  fill: ['fill'],
  borders: ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'],
  alignment: ['hAlign', 'vAlign', 'indent', 'rotation'],
  wrap: ['wrap'],
  numberFormat: ['numFmt'],
}

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'object') {
    const color = value as { rgb?: string; theme?: number; tint?: number; indexed?: number; style?: string }
    if (color.style) return color.style
    if (color.rgb) return `#${color.rgb.slice(-6)}`
    if (color.theme !== undefined) return `theme ${color.theme + 1}${color.tint ? ` ${Math.round(color.tint * 100)}%` : ''}`
    if (color.indexed !== undefined) return `palette ${color.indexed}`
    return JSON.stringify(value)
  }
  return String(value)
}

function input(sheet: SheetModel, data: CellData | undefined): string | undefined {
  if (!data) return undefined
  if (data.f !== undefined) return `=${toA1Form(data.f, sheet)}`
  if (data.v === undefined || data.v === null || data.v === '') return undefined
  if (typeof data.v === 'boolean') return data.v ? 'TRUE' : 'FALSE'
  return String(data.v)
}

class SheetReader {
  readonly styles: Stylesheet
  private readonly date1904: boolean

  constructor(readonly model: WorkbookModel) {
    this.styles = new Stylesheet(model.metaValue('stylesXml'))
    this.date1904 = model.date1904
  }

  style(sheet: SheetModel, row: number, col: number): ResolvedStyle {
    const key = sheet.keyAt(row, col)
    const rowId = sheet.rows.idAt(row)
    const colId = sheet.cols.idAt(col)
    const base = sheet.xf.get(key) ?? sheet.rowProp(sheet.rows.indexOf(rowId), 'xf') ?? (sheet.colMeta.get(`${colId}|xf`) as number | undefined)
    return { ...this.styles.resolve(base), ...sheet.axisOverrides('col', colId), ...sheet.axisOverrides('row', rowId), ...sheet.cellOverrides(key) }
  }

  shown(sheet: SheetModel, row: number, col: number, data: CellData | undefined): string | undefined {
    if (!data || data.v === undefined || data.v === null) return undefined
    if (data.t === 'e') return String(data.v)
    return formatValue(data.v, this.style(sheet, row, col).numFmt, { date1904: this.date1904 }).text
  }
}

function lineKeys(sheet: SheetModel, kind: 'row' | 'col', count: number, cross: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    let key = ''
    for (let other = 0; other < cross; other++) {
      const data = kind === 'row' ? sheet.cell(index, other) : sheet.cell(other, index)
      if (data) key += `${other}=${JSON.stringify(data.f !== undefined ? '' : (data.v ?? null))};`
    }
    return key
  })
}

/** Old index → new index for rows or columns, plus the runs inserted and deleted. */
function alignment(before: SheetModel, after: SheetModel, kind: 'row' | 'col'): { map: Map<number, number>; changes: StructureChange[] } {
  const usedBefore = before.usedRange()
  const usedAfter = after.usedRange()
  const count = (range: typeof usedBefore) => (range ? (kind === 'row' ? range.bottom : range.right) + 1 : 0)
  const crossCount = Math.max(usedBefore ? (kind === 'row' ? usedBefore.right : usedBefore.bottom) + 1 : 0, usedAfter ? (kind === 'row' ? usedAfter.right : usedAfter.bottom) + 1 : 0)
  const oldKeys = lineKeys(before, kind, count(usedBefore), Math.min(crossCount, 200))
  const newKeys = lineKeys(after, kind, count(usedAfter), Math.min(crossCount, 200))
  const pairs = matchSequences(oldKeys, newKeys, 2000)
  const map = new Map<number, number>()
  const changes: StructureChange[] = []
  const label = (index: number) => (kind === 'row' ? String(index + 1) : columnName(index))
  const matchedNonEmpty = pairs ? pairs.filter(([oldIndex]) => oldKeys[oldIndex] !== '').length : 0
  if (!pairs || matchedNonEmpty < oldKeys.filter(Boolean).length * 0.5) {
    for (let index = 0; index < Math.max(oldKeys.length, newKeys.length); index++) map.set(index, index)
    return { map, changes }
  }
  let oldCursor = 0
  let newCursor = 0
  for (const [oldIndex, newIndex] of [...pairs, [oldKeys.length, newKeys.length] as [number, number]]) {
    const deleted = oldIndex - oldCursor
    const inserted = newIndex - newCursor
    const common = Math.min(deleted, inserted)
    // Edited lines pair up; the rest are structure.
    for (let offset = 0; offset < common; offset++) map.set(oldCursor + offset, newCursor + offset)
    if (deleted > common) changes.push({ kind: kind === 'row' ? 'rowsDeleted' : 'columnsDeleted', from: label(oldCursor + common), to: label(oldIndex - 1), count: deleted - common })
    if (inserted > common) changes.push({ kind: kind === 'row' ? 'rowsInserted' : 'columnsInserted', from: label(newCursor + common), to: label(newIndex - 1), count: inserted - common })
    if (oldIndex < oldKeys.length) map.set(oldIndex, newIndex)
    oldCursor = oldIndex + 1
    newCursor = newIndex + 1
  }
  return { map, changes }
}

function diffSheet(before: SheetModel | undefined, after: SheetModel | undefined, readers: { before: SheetReader; after: SheetReader }, options: Required<DiffOptions>): SheetDiff & { truncated: boolean; total: number } {
  const name = after?.name ?? before!.name
  if (!before || !after) {
    const sheet = (after ?? before)!
    const reader = after ? readers.after : readers.before
    const cells: CellChange[] = []
    let total = 0
    sheet.forEachCell((row, col, data) => {
      const text = input(sheet, data)
      if (text === undefined) return
      total++
      if (cells.length < options.maxCellsPerSheet) {
        const shown = reader.shown(sheet, row, col, data)
        cells.push({ address: cellName(row, col), row, col, kind: after ? 'added' : 'removed', ...(after ? { after: text, ...(shown !== text && shown !== undefined ? { afterShown: shown } : {}) } : { before: text }) })
      }
    })
    cells.sort((a, b) => a.row - b.row || a.col - b.col)
    return { name, status: after ? 'added' : 'removed', structure: [], cells, other: [], truncated: total > cells.length, total }
  }
  const rows = alignment(before, after, 'row')
  const cols = alignment(before, after, 'col')
  const cells: CellChange[] = []
  let total = 0
  const seen = new Set<string>()
  const consider = (oldRow: number | undefined, oldCol: number | undefined, newRow: number | undefined, newCol: number | undefined) => {
    const oldData = oldRow !== undefined && oldCol !== undefined ? before.cell(oldRow, oldCol) : undefined
    const newData = newRow !== undefined && newCol !== undefined ? after.cell(newRow, newCol) : undefined
    const oldText = oldData ? input(before, oldData) : undefined
    const newText = newData ? input(after, newData) : undefined
    const format: CellChange['format'] = []
    if (oldRow !== undefined && oldCol !== undefined && newRow !== undefined && newCol !== undefined) {
      const oldStyle = readers.before.style(before, oldRow, oldCol)
      const newStyle = readers.after.style(after, newRow, newCol)
      for (const [property, props] of Object.entries(FORMAT_PROPS) as [FormatProperty, (keyof StyleProps)[]][]) {
        const a = props.map((prop) => JSON.stringify(oldStyle[prop] ?? null)).join()
        const b = props.map((prop) => JSON.stringify(newStyle[prop] ?? null)).join()
        if (a !== b) format.push({ property, before: props.map((prop) => describeValue(oldStyle[prop])).join(', '), after: props.map((prop) => describeValue(newStyle[prop])).join(', ') })
      }
    }
    // A formula that moved with its row or column but refers to the same relative cells is unchanged.
    const sameFormula =
      oldText?.startsWith('=') && newText?.startsWith('=') && relativeFormula(oldText, oldRow!, oldCol!) === relativeFormula(newText, newRow!, newCol!)
    if ((oldText === newText || sameFormula) && !format.length) return
    total++
    if (cells.length >= options.maxCellsPerSheet) return
    const row = newRow ?? oldRow!
    const col = newCol ?? oldCol!
    const kind: CellChange['kind'] = oldText === undefined && newText !== undefined ? 'added' : newText === undefined && oldText !== undefined ? 'removed' : 'changed'
    const beforeShown = oldRow !== undefined && oldCol !== undefined ? readers.before.shown(before, oldRow, oldCol, oldData) : undefined
    const afterShown = newRow !== undefined && newCol !== undefined ? readers.after.shown(after, newRow, newCol, newData) : undefined
    cells.push({
      address: cellName(row, col),
      row,
      col,
      kind,
      ...(oldText !== undefined ? { before: oldText } : {}),
      ...(newText !== undefined ? { after: newText } : {}),
      ...(beforeShown !== undefined && beforeShown !== oldText ? { beforeShown } : {}),
      ...(afterShown !== undefined && afterShown !== newText ? { afterShown } : {}),
      ...(format.length ? { format } : {}),
    })
  }
  const oldToNew = (row: number, col: number) => ({ row: rows.map.get(row), col: cols.map.get(col) })
  // Every position that has content or style in either version.
  const positions = (sheet: SheetModel) => {
    const found: { row: number; col: number }[] = []
    const keys = new Set<string>([...sheet.cells.keys(), ...sheet.xf.keys(), ...[...sheet.fmt.keys()].map((key) => key.slice(0, key.lastIndexOf('|')))])
    for (const key of keys) {
      const position = sheet.position(key)
      if (position) found.push(position)
    }
    return found
  }
  const reverseRows = new Map([...rows.map].map(([a, b]) => [b, a]))
  const reverseCols = new Map([...cols.map].map(([a, b]) => [b, a]))
  for (const position of positions(before)) {
    const target = oldToNew(position.row, position.col)
    // Content of deleted rows/columns is reported by the structure change, not cell by cell.
    if (target.row === undefined || target.col === undefined) continue
    seen.add(`${target.row},${target.col}`)
    consider(position.row, position.col, target.row, target.col)
  }
  for (const position of positions(after)) {
    if (seen.has(`${position.row},${position.col}`)) continue
    const oldRow = reverseRows.get(position.row)
    const oldCol = reverseCols.get(position.col)
    if (oldRow === undefined || oldCol === undefined) {
      // In inserted rows/columns: everything there is new.
      const data = after.cell(position.row, position.col)
      if (input(after, data) !== undefined) consider(undefined, undefined, position.row, position.col)
      continue
    }
    consider(oldRow, oldCol, position.row, position.col)
  }
  cells.sort((a, b) => a.row - b.row || a.col - b.col)
  const other: OtherChange[] = []
  if (before.state !== after.state) other.push({ kind: 'visibility', before: before.state, after: after.state })
  const describeMerges = (sheet: SheetModel) => sheet.mergedRanges().map((merge) => `${cellName(merge.range.top, merge.range.left)}:${cellName(merge.range.bottom, merge.range.right)}`).sort()
  const oldMerges = describeMerges(before)
  const newMerges = describeMerges(after)
  for (const merge of newMerges) if (!oldMerges.includes(merge)) other.push({ kind: 'merged', range: merge })
  for (const merge of oldMerges) if (!newMerges.includes(merge)) other.push({ kind: 'unmerged', range: merge })
  for (const prop of ['frozenRows', 'frozenCols'] as const) {
    const a = before.viewProp(prop) ?? 0
    const b = after.viewProp(prop) ?? 0
    if (a !== b) other.push({ kind: prop, before: a, after: b })
  }
  const ruleCount = (sheet: SheetModel, map: Y.Map<unknown>) => [...map.values()].filter((value) =>
    (value as { ranges: RangeIds[] }).ranges.some((range) => sheet.resolveRange(range))).length
  const counts = [
    ['conditionalFormats', ruleCount(before, before.cf), ruleCount(after, after.cf)],
    ['validations', ruleCount(before, before.dv), ruleCount(after, after.dv)],
    ['drawings', before.drawings.size, after.drawings.size],
    ['notes', before.notes.size, after.notes.size],
  ] as const
  for (const [kind, a, b] of counts) if (a !== b) other.push({ kind, before: a, after: b })
  const structure = [...rows.changes, ...cols.changes]
  const changed = structure.length > 0 || total > 0 || other.length > 0 || before.name !== after.name
  return {
    name,
    ...(before.name !== after.name ? { previousName: before.name } : {}),
    status: changed ? 'changed' : 'unchanged',
    structure,
    cells,
    other,
    truncated: total > cells.length,
    total,
  }
}

/** Compares two workbooks in Y.Docs. Sheets are matched by name, then by position. */
export function diffWorkbooks(beforeDoc: Y.Doc, afterDoc: Y.Doc, options: DiffOptions = {}): WorkbookDiff {
  const resolved: Required<DiffOptions> = { maxCellsPerSheet: options.maxCellsPerSheet ?? 500 }
  const before = new WorkbookModel(beforeDoc)
  const after = new WorkbookModel(afterDoc)
  const readers = { before: new SheetReader(before), after: new SheetReader(after) }
  const oldSheets = before.sheets()
  const newSheets = after.sheets()
  const used = new Set<SheetModel>()
  const pairs: [SheetModel | undefined, SheetModel | undefined][] = []
  for (const sheet of newSheets) {
    const match = oldSheets.find((candidate) => !used.has(candidate) && candidate.name.toLowerCase() === sheet.name.toLowerCase())
    if (match) used.add(match)
    pairs.push([match, sheet])
  }
  // An unmatched new sheet is a renamed old one when their contents are mostly the same.
  const contents = (sheet: SheetModel) => {
    const set = new Set<string>()
    sheet.forEachCell((row, col, data) => set.add(`${row},${col}=${input(sheet, data) ?? ''}`))
    return set
  }
  for (const pair of pairs) {
    if (pair[0]) continue
    const mine = contents(pair[1]!)
    const match = oldSheets.find((candidate) => {
      if (used.has(candidate)) return false
      const theirs = contents(candidate)
      if (!mine.size && !theirs.size) return true
      let shared = 0
      for (const entry of mine) if (theirs.has(entry)) shared++
      return shared / (mine.size + theirs.size - shared) >= 0.5
    })
    if (match) {
      pair[0] = match
      used.add(match)
    }
  }
  for (const sheet of oldSheets) if (!used.has(sheet)) pairs.push([sheet, undefined])
  let truncated = false
  let cellsChanged = 0
  const sheets = pairs.map(([a, b]) => {
    const { truncated: cut, total, ...diff } = diffSheet(a, b, readers, resolved)
    truncated ||= cut
    cellsChanged += total
    return diff
  })
  const nameKey = (model: WorkbookModel, name: { name: string; scope?: string }) => `${name.scope ? `${model.sheet(name.scope)?.name ?? ''}!` : ''}${name.name}`
  const oldNames = new Map([...before.names.values()].map((name) => [nameKey(before, name), toA1Form(name.formula, name.scope ? before.sheet(name.scope) : undefined, before)]))
  const newNames = new Map([...after.names.values()].map((name) => [nameKey(after, name), toA1Form(name.formula, name.scope ? after.sheet(name.scope) : undefined, after)]))
  const names: WorkbookDiff['names'] = []
  for (const [name, formula] of newNames) {
    const old = oldNames.get(name)
    if (old === undefined) names.push({ name, kind: 'added', after: formula })
    else if (old !== formula) names.push({ name, kind: 'changed', before: old, after: formula })
  }
  for (const [name, formula] of oldNames) if (!newNames.has(name)) names.push({ name, kind: 'removed', before: formula })
  return { sheets, names, totals: { cellsChanged, sheetsChanged: sheets.filter((sheet) => sheet.status !== 'unchanged').length }, truncated }
}

/** Compares two versions of a spreadsheet file (xlsx/csv bytes). */
export async function diffSheetFiles(before: Uint8Array, after: Uint8Array, context: { name: string; assets: LiveAssetStore }, options: DiffOptions = {}): Promise<WorkbookDiff> {
  const codec = new SheetCodec()
  const beforeDoc = new Y.Doc()
  const afterDoc = new Y.Doc()
  await codec.importFile(beforeDoc, before, context)
  await codec.importFile(afterDoc, after, context)
  return diffWorkbooks(beforeDoc, afterDoc, options)
}
