import type * as Y from 'yjs'
import { transactChanges } from '../../assets.js'
import { matchSequences } from '../diff/sequence.js'
import { toA1Form, toIdForm } from '../model/formula-ids.js'
import { rewriteReferences } from '../model/references.js'
import type {
  AnchorPoint,
  AutoFilter,
  CellData,
  ConditionalFormat,
  DataValidation,
  DefinedName,
  DrawingObject,
  RangeIds,
  SheetTable,
} from '../model/schema.js'
import { deleteAxis, insertAxis, type AxisKind } from '../model/structure.js'
import { WorkbookModel, type SheetModel } from '../model/workbook.js'
import { randomId } from '../model/axis.js'
import { Stylesheet } from '../styles/stylesheet.js'

/**
 * Rewrites the workbook in `doc` to match `incoming` (a fresh import of a new version of the
 * file) with the smallest set of changes, in one transaction, so edits other people make at the
 * same time still merge: rows and columns inserted or deleted in the new version are inserted or
 * deleted here (found by diffing their contents), cells are written only where they differ, and
 * everything keeps its id.
 */
export function applyWorkbook(doc: Y.Doc, incomingDoc: Y.Doc, origin?: unknown): { changed: boolean } {
  const target = new WorkbookModel(doc, origin ?? null)
  const incoming = new WorkbookModel(incomingDoc)
  const changed = transactChanges(doc, () => {
    if (!target.initialized) WorkbookModel.initialize(doc, {})
    const styleMap = mergeStyles(target, incoming)
    syncMeta(target, incoming)
    const pairs = syncSheets(target, incoming)
    // Rows and columns first, everywhere: formulas in one sheet refer to rows of others, so their
    // positions must line up before any content is compared.
    for (const [targetSheet, incomingSheet] of pairs) alignSheet(targetSheet, incomingSheet, styleMap)
    for (const [targetSheet, incomingSheet] of pairs) syncSheet(targetSheet, incomingSheet, styleMap)
    syncNames(target, incoming)
    syncParts(target, incoming)
  }, origin ?? null)
  return { changed }
}

function setIfDifferent(map: Y.Map<unknown>, key: string, value: unknown): void {
  if (value === undefined) {
    if (map.has(key)) map.delete(key)
    return
  }
  if (JSON.stringify(map.get(key)) !== JSON.stringify(value)) map.set(key, value)
}

interface StyleMap {
  xf: (index: number | undefined) => number | undefined
  dxf: (index: number | undefined) => number | undefined
  stylesheet: Stylesheet
}

function mergeStyles(target: WorkbookModel, incoming: WorkbookModel): StyleMap {
  const ownXml = target.metaValue('stylesXml')
  const newXml = incoming.metaValue('stylesXml')
  if (ownXml === newXml || newXml === undefined) {
    const stylesheet = new Stylesheet(ownXml)
    return { xf: (index) => index, dxf: (index) => index, stylesheet }
  }
  const own = new Stylesheet(ownXml)
  const mapping = own.merge(new Stylesheet(newXml))
  target.meta.set('stylesXml', own.toXml())
  return {
    xf: (index) => (index === undefined ? undefined : (mapping.xf[index] ?? index)),
    dxf: (index) => (index === undefined ? undefined : (mapping.dxf[index] ?? index)),
    stylesheet: own,
  }
}

// Part paths are where this copy writes its parts; a new version's paths don't matter.
const META_KEYS = ['format', 'date1904', 'iterate', 'iterateCount', 'iterateDelta', 'csv', 'workbookXml', 'workbookRels', 'themeXml', 'contentTypesXml', 'sharedStringsSeed', 'looseParts'] as const

function syncMeta(target: WorkbookModel, incoming: WorkbookModel): void {
  for (const key of META_KEYS) setIfDifferent(target.meta, key, incoming.metaValue(key))
}

/** Pairs each incoming sheet with a sheet here (same name, else same part, else same position). */
function syncSheets(target: WorkbookModel, incoming: WorkbookModel): [SheetModel, SheetModel][] {
  const own = target.sheets()
  const theirs = incoming.sheets()
  const pairs = new Map<SheetModel, SheetModel>()
  const used = new Set<SheetModel>()
  for (const sheet of theirs) {
    const match = own.find((candidate) => !used.has(candidate) && candidate.name.toLowerCase() === sheet.name.toLowerCase())
    if (match) {
      pairs.set(sheet, match)
      used.add(match)
    }
  }
  for (const sheet of theirs) {
    if (pairs.has(sheet)) continue
    const part = sheet.raw.get('part')
    const match = own.find((candidate) => !used.has(candidate) && part !== undefined && candidate.raw.get('part') === part)
    if (match) {
      pairs.set(sheet, match)
      used.add(match)
    }
  }
  // Remaining sheets: renamed ones keep their place.
  theirs.forEach((sheet, index) => {
    if (pairs.has(sheet)) return
    const candidate = own[index]
    if (candidate && !used.has(candidate)) {
      pairs.set(sheet, candidate)
      used.add(candidate)
    }
  })
  // Sheets the new version doesn't have go (unless that would leave none).
  for (const sheet of own) {
    if (used.has(sheet)) continue
    target.sheetsMap.delete(sheet.id)
    const order = target.order.toArray()
    for (let index = order.length - 1; index >= 0; index--) if (order[index] === sheet.id) target.order.delete(index, 1)
  }
  const result: [SheetModel, SheetModel][] = []
  theirs.forEach((sheet, index) => {
    let match = pairs.get(sheet)
    if (!match) match = target.addSheet(target.sheetByName(sheet.name) ? target.uniqueSheetName(sheet.name) : sheet.name, index)
    if (match.name !== sheet.name) match.map.set('name', sheet.name)
    result.push([match, sheet])
  })
  // Tab order.
  const wantedOrder = result.map(([sheet]) => sheet.id)
  if (target.sheetIds().join() !== wantedOrder.join()) {
    wantedOrder.forEach((id, index) => {
      if (target.sheetIds()[index] !== id) target.moveSheet(id, index)
    })
  }
  for (const [own, other] of result) {
    for (const key of ['state', 'tabColor', 'kind']) setIfDifferent(own.map, key, other.map.get(key))
  }
  const active = incoming.metaValue('activeSheet')
  const activeIndex = active ? incoming.sheetIds().indexOf(active) : -1
  if (activeIndex >= 0) setIfDifferent(target.meta, 'activeSheet', result[activeIndex]?.[0].id)
  return result
}

/**
 * A row's (or column's) contents as text that doesn't change when rows or columns are inserted
 * elsewhere: formulas are written with references relative to the cell.
 */
/**
 * Every row's (or column's) contents as one string each, built from the stored cells (not by
 * probing every position, which is quadratic on big sheets).
 */
function lineSignatures(sheet: SheetModel, kind: AxisKind, count: number, styles: (xf: number | undefined) => number | undefined): string[] {
  const parts: [number, string][][] = Array.from({ length: count }, () => [])
  const add = (key: string, text: string) => {
    const position = sheet.position(key)
    if (!position) return
    const line = kind === 'row' ? position.row : position.col
    const other = kind === 'row' ? position.col : position.row
    if (line < count) parts[line]!.push([other, text])
  }
  for (const [key, data] of sheet.cells) {
    const position = sheet.position(key)
    if (position) add(key, `c${cellSignature(sheet, data)}`)
  }
  for (const [key, xf] of sheet.xf) {
    const mapped = styles(xf)
    if (mapped !== undefined) add(key, `s${mapped}`)
  }
  return parts.map((line) =>
    line
      .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1))
      .map(([other, text]) => `${other}=${text}`)
      .join(';'),
  )
}

/**
 * What a cell contributes to its row's (or column's) signature. Formulas count by their shape,
 * with each reference reduced to the sheet it points at: tools differ in whether they adjust
 * references when they insert rows (Excel and LibreOffice do, openpyxl doesn't), and either way
 * the moved row should still match its old self.
 */
function cellSignature(sheet: SheetModel, data: CellData): string {
  if (data.f !== undefined) return `f:${rewriteReferences(toA1Form(data.f, sheet), (ref) => (ref.kind === 'ref' ? `${ref.sheet ? `${ref.sheet.first}!` : ''}#` : undefined))}`
  return `v:${JSON.stringify(data.v ?? null)}${data.t ?? ''}`
}

interface Extent {
  rows: number
  cols: number
}

function extentOf(sheet: SheetModel): Extent {
  const used = sheet.usedRange()
  let rows = used ? used.bottom + 1 : 0
  let cols = used ? used.right + 1 : 0
  for (const key of sheet.rowMeta.keys()) rows = Math.max(rows, sheet.rows.indexOf(key.slice(0, key.lastIndexOf('|'))) + 1)
  for (const key of sheet.colMeta.keys()) cols = Math.max(cols, sheet.cols.indexOf(key.slice(0, key.lastIndexOf('|'))) + 1)
  return { rows, cols }
}

/** Inserts and deletes rows or columns here so they line up with the incoming sheet. */
function alignAxis(own: SheetModel, other: SheetModel, kind: AxisKind, styles: StyleMap): number {
  const ownExtent = extentOf(own)
  const otherExtent = extentOf(other)
  const count = (extent: Extent) => (kind === 'row' ? extent.rows : extent.cols)
  const ownLines = lineSignatures(own, kind, count(ownExtent), (xf) => xf)
  const otherLines = lineSignatures(other, kind, count(otherExtent), styles.xf)
  const pairs = matchSequences(ownLines, otherLines)
  if (!pairs) return 0
  const matchedNonEmpty = pairs.filter(([index]) => ownLines[index] !== '').length
  const nonEmpty = Math.max(1, ownLines.filter((line) => line !== '').length)
  // Without most lines matching, structure can't be inferred; compare by position instead.
  if (matchedNonEmpty / nonEmpty < 0.5) return 0
  // Walk from the bottom so earlier indexes stay valid.
  const ops: { type: 'delete' | 'insert'; at: number; count: number }[] = []
  let ownCursor = ownLines.length
  let otherCursor = otherLines.length
  // Gaps between matched lines, last gap first; the gap before the first match ends at -1.
  for (let index = pairs.length - 1; index >= -1; index--) {
    const [ownIndex, otherIndex] = index >= 0 ? pairs[index]! : [-1, -1]
    const deleted = ownCursor - ownIndex - 1
    const inserted = otherCursor - otherIndex - 1
    // A changed line (one deleted, one inserted at the same place) is an edit, not a structure change.
    const common = Math.min(deleted, inserted)
    if (deleted > common) ops.push({ type: 'delete', at: ownIndex + 1 + common, count: deleted - common })
    if (inserted > common) ops.push({ type: 'insert', at: ownIndex + 1 + common, count: inserted - common })
    ownCursor = ownIndex
    otherCursor = otherIndex
  }
  let applied = 0
  for (const op of ops) {
    // Trailing empty lines are not structure.
    if (op.type === 'insert' && op.at >= ownLines.length) continue
    if (op.type === 'delete' && op.at >= otherLines.length && op.at + op.count >= ownLines.length) continue
    if (op.type === 'delete') deleteAxis(own, kind, op.at, op.count)
    else insertAxis(own, kind, op.at, op.count)
    applied++
  }
  return applied
}

function alignSheet(own: SheetModel, other: SheetModel, styles: StyleMap): void {
  if ((other.map.get('kind') ?? 'worksheet') !== 'worksheet') return
  // Align the axis whose lines survived the change best; then the other one.
  const rowsFirst = alignmentScore(own, other, 'row', styles) >= alignmentScore(own, other, 'col', styles)
  alignAxis(own, other, rowsFirst ? 'row' : 'col', styles)
  alignAxis(own, other, rowsFirst ? 'col' : 'row', styles)
}

function syncSheet(own: SheetModel, other: SheetModel, styles: StyleMap): void {
  const extent = extentOf(other)
  if (extent.rows && extent.cols) own.ensure(extent.rows - 1, extent.cols - 1)
  syncCells(own, other, styles)
  syncAxisMeta(own, other, 'row', styles)
  syncAxisMeta(own, other, 'col', styles)
  syncView(own, other)
  syncCollections(own, other, styles)
  for (const key of new Set([...own.raw.keys(), ...other.raw.keys()])) setIfDifferent(own.raw, key, other.raw.get(key))
}

function alignmentScore(own: SheetModel, other: SheetModel, kind: AxisKind, styles: StyleMap): number {
  const ownExtent = extentOf(own)
  const otherExtent = extentOf(other)
  const lines = (sheet: SheetModel, extent: Extent, map: (xf: number | undefined) => number | undefined) =>
    lineSignatures(sheet, kind, kind === 'row' ? extent.rows : extent.cols, map)
  const ownLines = lines(own, ownExtent, (xf) => xf)
  const otherSet = new Set(lines(other, otherExtent, styles.xf))
  return ownLines.filter((line) => line !== '' && otherSet.has(line)).length / Math.max(1, ownLines.length)
}

/** A cell's content in a form comparable across workbooks (formulas as A1 text). */
function comparable(sheet: SheetModel, data: CellData | undefined): string {
  if (!data) return ''
  if (data.f !== undefined) {
    // A formula's cached result is derived (exports recalculate it), so only the formula counts.
    const { f, v: _v, t: _t, spillCache: _cache, ...rest } = data
    return JSON.stringify({ ...rest, f: toA1Form(f, sheet) })
  }
  return JSON.stringify(data)
}

function syncCells(own: SheetModel, other: SheetModel, styles: StyleMap): void {
  const positions = new Set<string>()
  const collect = (sheet: SheetModel) => {
    for (const key of [...sheet.cells.keys(), ...sheet.xf.keys(), ...[...sheet.fmt.keys()].map((entry) => entry.slice(0, entry.lastIndexOf('|')))]) {
      const position = sheet.position(key)
      if (position) positions.add(`${position.row},${position.col}`)
    }
  }
  collect(own)
  collect(other)
  for (const position of positions) {
    const [row, col] = position.split(',').map(Number) as [number, number]
    const otherData = other.cell(row, col)
    const ownKey = own.keyAt(row, col)
    const ownData = own.cells.get(ownKey)
    if (comparable(own, ownData) !== comparable(other, otherData)) {
      if (!otherData) own.cells.delete(ownKey)
      else {
        const data: CellData = { ...otherData }
        if (otherData.f !== undefined) data.f = toIdForm(toA1Form(otherData.f, other), own)
        own.cells.set(ownKey, data)
      }
    }
    // Styles: the incoming base format, mapped into our stylesheet, replaces ours and our overrides,
    // unless what we show already looks the same.
    const otherKey = other.keyAt(row, col)
    const otherXf = styles.xf(other.xf.get(otherKey))
    const ownXf = own.xf.get(ownKey)
    const overrides = own.cellOverrides(ownKey)
    const hasOverrides = Object.keys(overrides).length > 0
    if (ownXf === otherXf && !hasOverrides) continue
    if (hasOverrides || ownXf !== undefined) {
      const effective = styles.stylesheet.intern(ownXf, overrides)
      if (effective === (otherXf ?? 0) || sameResolved(styles.stylesheet, effective, otherXf ?? 0)) continue
    }
    if (otherXf === undefined) own.xf.delete(ownKey)
    else own.xf.set(ownKey, otherXf)
    for (const prop of Object.keys(overrides)) own.fmt.delete(`${ownKey}|${prop}`)
  }
}

function sameResolved(stylesheet: Stylesheet, a: number, b: number): boolean {
  return JSON.stringify(stylesheet.resolve(a)) === JSON.stringify(stylesheet.resolve(b))
}

function syncAxisMeta(own: SheetModel, other: SheetModel, kind: AxisKind, styles: StyleMap): void {
  const ownMeta = kind === 'row' ? own.rowMeta : own.colMeta
  const otherMeta = kind === 'row' ? other.rowMeta : other.colMeta
  const ownAxis = kind === 'row' ? own.rows : own.cols
  const otherAxis = kind === 'row' ? other.rows : other.cols
  const wanted = new Map<string, unknown>()
  for (const [key, value] of otherMeta) {
    const bar = key.lastIndexOf('|')
    const index = otherAxis.indexOf(key.slice(0, bar))
    if (index < 0) continue
    const prop = key.slice(bar + 1)
    wanted.set(`${ownAxis.idAt(index)}|${prop}`, prop === 'xf' ? styles.xf(value as number) : value)
  }
  for (const key of [...ownMeta.keys()]) if (!wanted.has(key)) ownMeta.delete(key)
  if (wanted.size) ownAxis.ensure(Math.max(...[...wanted.keys()].map((key) => ownAxis.indexOf(key.slice(0, key.lastIndexOf('|'))))) + 1)
  for (const [key, value] of wanted) setIfDifferent(ownMeta, key, value)
}

function syncView(own: SheetModel, other: SheetModel): void {
  for (const key of new Set([...own.view.keys(), ...other.view.keys()])) setIfDifferent(own.view, key, other.view.get(key))
}

/** Moves a range from the incoming sheet's ids to ours, by position. */
function translateRange(own: SheetModel, other: SheetModel, range: RangeIds): RangeIds | undefined {
  const resolved = other.resolveRange(range)
  if (!resolved) return undefined
  const ids: RangeIds = {}
  if (range.top !== undefined) {
    own.rows.ensure(resolved.bottom + 1)
    ids.top = own.rows.idAt(resolved.top)
    ids.bottom = own.rows.idAt(resolved.bottom)
  }
  if (range.left !== undefined) {
    own.cols.ensure(resolved.right + 1)
    ids.left = own.cols.idAt(resolved.left)
    ids.right = own.cols.idAt(resolved.right)
  }
  return ids
}

function translatePoint(own: SheetModel, other: SheetModel, point: AnchorPoint | undefined): AnchorPoint | undefined {
  if (!point) return undefined
  const row = other.rows.indexOf(point.row)
  const col = other.cols.indexOf(point.col)
  if (row < 0 || col < 0) return undefined
  own.ensure(row, col)
  return { ...point, row: own.rows.idAt(row), col: own.cols.idAt(col) }
}

function translateFormula(own: SheetModel, other: SheetModel, formula: string): string {
  return toIdForm(toA1Form(formula, other), own)
}

/** Replaces a collection's entries with the incoming ones where their positioned form differs. */
function syncCollection<T>(ownMap: Y.Map<unknown>, otherMap: Y.Map<unknown>, ownForm: (value: T) => string, otherForm: (value: T) => string, translate: (value: T) => T | undefined): void {
  const ownByForm = new Map<string, string[]>()
  for (const [id, value] of ownMap) {
    const form = ownForm(value as T)
    ownByForm.set(form, [...(ownByForm.get(form) ?? []), id])
  }
  const keep = new Set<string>()
  const additions: T[] = []
  for (const value of otherMap.values()) {
    const form = otherForm(value as T)
    const ids = ownByForm.get(form)
    const id = ids?.shift()
    if (id !== undefined) keep.add(id)
    else additions.push(value as T)
  }
  for (const id of [...ownMap.keys()]) if (!keep.has(id)) ownMap.delete(id)
  for (const value of additions) {
    const translated = translate(value)
    if (translated !== undefined) ownMap.set(randomId(), translated)
  }
}

/** Ranges and formulas as positions and A1 text, so entries compare across workbooks. */
function positioned(sheet: SheetModel, value: unknown, dxf: (index: number | undefined) => number | undefined = (index) => index): string {
  return JSON.stringify(value, (key, entry: unknown) => {
    // XML kept as read is written back re-serialized; what the model says is what counts.
    if (key === 'xml' || key === 'shape' || key === 'sortXml' || key === 'part' || key === 'rPr') return undefined
    if ((key === 'range' || key === 'ranges') && entry) {
      const ranges = Array.isArray(entry) ? (entry as RangeIds[]) : [entry as RangeIds]
      const resolved = ranges.map((range) => sheet.resolveRange(range) ?? null)
      return Array.isArray(entry) ? resolved : resolved[0]
    }
    if ((key === 'from' || key === 'to') && entry && typeof entry === 'object' && 'row' in entry) {
      const point = entry as AnchorPoint
      return { ...point, row: sheet.rows.indexOf(point.row), col: sheet.cols.indexOf(point.col) }
    }
    if (key === 'formulas' && Array.isArray(entry)) return (entry as string[]).map((formula) => toA1Form(formula, sheet))
    if ((key === 'formula1' || key === 'formula2') && typeof entry === 'string') return toA1Form(entry, sheet)
    if (key === 'dxfId' && typeof entry === 'number') return dxf(entry)
    return entry
  })
}

function syncCollections(own: SheetModel, other: SheetModel, styles: StyleMap): void {
  const ownForm = (value: unknown) => positioned(own, value)
  const otherForm = (value: unknown) => positioned(other, value, styles.dxf)
  const ranges = (value: { ranges: RangeIds[] }) => {
    const translated = value.ranges.map((range) => translateRange(own, other, range)).filter((range): range is RangeIds => !!range)
    return translated.length ? translated : undefined
  }
  syncCollection<{ range: RangeIds }>(own.merges as Y.Map<unknown>, other.merges as Y.Map<unknown>, ownForm, otherForm, (value) => {
    const range = translateRange(own, other, value.range)
    return range && { range }
  })
  syncCollection<ConditionalFormat>(own.cf, other.cf, ownForm, otherForm, (value) => {
    const translated = ranges(value)
    if (!translated) return undefined
    return {
      ...value,
      ranges: translated,
      rules: value.rules.map((rule) => ({
        ...rule,
        ...(rule.dxfId !== undefined ? { dxfId: styles.dxf(rule.dxfId)! } : {}),
        ...(rule.formulas ? { formulas: rule.formulas.map((formula) => translateFormula(own, other, formula)) } : {}),
      })),
    }
  })
  syncCollection<DataValidation>(own.dv, other.dv, ownForm, otherForm, (value) => {
    const translated = ranges(value)
    if (!translated) return undefined
    return {
      ...value,
      ranges: translated,
      ...(value.formula1 !== undefined ? { formula1: translateFormula(own, other, value.formula1) } : {}),
      ...(value.formula2 !== undefined ? { formula2: translateFormula(own, other, value.formula2) } : {}),
    }
  })
  syncCollection<SheetTable>(own.tables, other.tables, ownForm, otherForm, (value) => {
    const range = translateRange(own, other, value.range)
    return range && { ...value, range }
  })
  syncCollection<DrawingObject>(own.drawings, other.drawings, ownForm, otherForm, (value) => {
    const from = translatePoint(own, other, value.from)
    const to = translatePoint(own, other, value.to)
    return { ...value, ...(from ? { from } : {}), ...(to ? { to } : {}) }
  })
  // Cell-keyed maps: links and notes.
  for (const [ownMap, otherMap] of [
    [own.links, other.links],
    [own.notes, other.notes],
  ] as const) {
    const wanted = new Map<string, unknown>()
    for (const [key, value] of otherMap) {
      const position = other.position(key)
      if (!position) continue
      own.ensure(position.row, position.col)
      const translated = (value as { range?: RangeIds }).range ? { ...(value as object), range: translateRange(own, other, (value as { range: RangeIds }).range) } : value
      wanted.set(own.keyAt(position.row, position.col), translated)
    }
    for (const key of [...ownMap.keys()]) if (!wanted.has(key)) ownMap.delete(key)
    for (const [key, value] of wanted) {
      if (positioned(own, ownMap.get(key)) !== positioned(own, value)) ownMap.set(key, value)
    }
  }
  const otherFilter = other.filter.get('value') as AutoFilter | undefined
  const ownFilter = own.filter.get('value') as AutoFilter | undefined
  if (!otherFilter) {
    if (ownFilter) own.filter.delete('value')
  } else if (positioned(own, ownFilter) !== positioned(other, otherFilter)) {
    const range = translateRange(own, other, otherFilter.range)
    if (range) own.filter.set('value', { ...otherFilter, range })
  }
}

function syncNames(target: WorkbookModel, incoming: WorkbookModel): void {
  const scopeName = (model: WorkbookModel, scope: string | undefined) => (scope ? (model.sheet(scope)?.name ?? '') : '')
  const form = (model: WorkbookModel, name: DefinedName) => JSON.stringify({ ...name, scope: scopeName(model, name.scope), formula: toA1Form(name.formula, name.scope ? model.sheet(name.scope) : undefined, model) })
  const own = new Map<string, string>()
  for (const [id, name] of target.names) own.set(form(target, name), id)
  const keep = new Set<string>()
  const additions: DefinedName[] = []
  for (const name of incoming.names.values()) {
    const id = own.get(form(incoming, name))
    if (id) keep.add(id)
    else additions.push(name)
  }
  for (const id of [...target.names.keys()]) if (!keep.has(id)) target.names.delete(id)
  for (const name of additions) {
    const scopeSheet = name.scope ? target.sheetByName(scopeName(incoming, name.scope)) : undefined
    if (name.scope && !scopeSheet) continue
    const formula = toIdForm(toA1Form(name.formula, name.scope ? incoming.sheet(name.scope) : undefined, incoming), scopeSheet, target)
    target.names.set(randomId(), { ...name, formula, ...(scopeSheet ? { scope: scopeSheet.id } : {}) })
  }
}

function syncParts(target: WorkbookModel, incoming: WorkbookModel): void {
  for (const key of new Set([...target.parts.keys(), ...incoming.parts.keys()])) setIfDifferent(target.parts as Y.Map<unknown>, key, incoming.parts.get(key))
}

