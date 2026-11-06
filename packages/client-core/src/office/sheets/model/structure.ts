import { captureMovedReferences, type MoveIntervals } from './move-references.js'
import { tokenize } from '../formula/tokenize.js'
import { mapXmlReferences } from '../codec/reference-xml.js'
import { parseXml } from '../../ooxml/package.js'
import * as Y from 'yjs'
import type { Axis } from './axis.js'
import type { AnchorPoint, AxisProps, AutoFilter, DrawingObject, Hyperlink, ConditionalFormat, DataValidation, RangeIds, SheetTable, TableColumn } from './schema.js'
import { parseRangeList, rangeName } from '../address.js'
import { MAX_COLS } from '../address.js'
import { columnIntervals } from './column-intervals.js'
import { toA1Form, toIdForm } from './formula-ids.js'
import { splitCellKey, type SheetModel } from './workbook.js'

/**
 * Inserting, deleting, and moving rows and columns. Because cells, formulas, and every anchored
 * object refer to rows and columns by id, inserting and moving only touch the axis. Deleting also
 * removes what lived in the deleted rows and moves anchored objects to surviving neighbors. Cell
 * formulas resolve deleted references through axis tombstones without overwriting concurrent edits.
 */

export type AxisKind = 'row' | 'col'

/** Inserts `count` rows or columns before `position`; new ones take the format of the one before. */
export function insertAxis(sheet: SheetModel, kind: AxisKind, position: number, count: number): string[] {
  let inserted: string[] = []
  sheet.workbook.transact(() => {
    const axis = kind === 'row' ? sheet.rows : sheet.cols
    const finish = captureMetadata(sheet, kind)
    inserted = axis.insert(position, count)
    finish()
    if (position > 0) copyFormatFrom(sheet, kind, axis.idAt(position - 1), inserted)
  })
  return inserted
}

/** Excel gives inserted rows (columns) the formatting of the row above (column to the left). */
function copyFormatFrom(sheet: SheetModel, kind: AxisKind, sourceId: string, targets: string[]): void {
  const meta = kind === 'row' ? sheet.rowMeta : sheet.colMeta
  for (const [key, value] of [...meta.entries()]) {
    const bar = key.lastIndexOf('|')
    if (key.slice(0, bar) !== sourceId) continue
    const prop = key.slice(bar + 1)
    // Height/width and styles carry over; visibility and outline do not.
    if (prop === 'hidden' || prop === 'level' || prop === 'collapsed' || prop === 'keep') continue
    for (const target of targets) meta.set(`${target}|${prop}`, value)
  }
  const copyStyles = <T>(map: Y.Map<T>, keyOf: (key: string) => string) => {
    for (const [key, value] of [...map.entries()]) {
      const owner = keyOf(key)
      const ids = splitCellKey(owner)
      if ((kind === 'row' ? ids.row : ids.col) !== sourceId) continue
      const suffix = key.slice(owner.length)
      for (const target of targets) {
        const targetKey = kind === 'row' ? `${target}:${ids.col}` : `${ids.row}:${target}`
        map.set(targetKey + suffix, value)
      }
    }
  }
  copyStyles(sheet.xf, (key) => key)
  copyStyles(sheet.fmt, (key) => key.slice(0, key.lastIndexOf('|')))
}

/** Deletes `count` rows or columns at `position`. */
export function deleteAxis(sheet: SheetModel, kind: AxisKind, position: number, count: number): void {
  const workbook = sheet.workbook
  workbook.transact(() => {
    const axis = kind === 'row' ? sheet.rows : sheet.cols
    const finish = captureMetadata(sheet, kind)
    const deleted = new Set(axis.delete(position, count))
    finish()
    const hit = (key: string) => deleted.has(kind === 'row' ? splitCellKey(key).row : splitCellKey(key).col)
    const owner = (key: string) => key.slice(0, key.lastIndexOf('|'))
    deleteKeys(sheet.cells, hit)
    deleteKeys(sheet.xf, hit)
    deleteKeys(sheet.fmt, (key) => hit(owner(key)))
    // A ranged hyperlink survives when its original top-left cell was deleted.
    for (const [key, raw] of [...sheet.links]) {
      const link = raw as Hyperlink
      if (!hit(key)) continue
      sheet.links.delete(key)
      const range = link.range && sheet.resolveRange(link.range)
      if (range) sheet.links.set(sheet.keyAt(range.top, range.left), link)
    }
    deleteKeys(sheet.notes, hit)
    deleteKeys(kind === 'row' ? sheet.rowMeta : sheet.colMeta, (key) => deleted.has(owner(key)))

    const edges = new EdgeMover(axis, deleted, position)
    adjustRanges(sheet, kind, edges)
    // Formulas (in cells, names, conditional formats, and validations) aren't rewritten: their
    // references to deleted rows resolve through the tombstones when read, so a concurrent edit of
    // the same formula is never overwritten and reversed ranges shrink like any other.
  })
}

/** Moves `count` rows or columns at `from` to start at `to` (counted after removing them). */
export function moveAxis(sheet: SheetModel, kind: AxisKind, from: number, count: number, to: number): void {
  sheet.workbook.transact(() => {
    const index = (value: number) => {
      if (value >= from && value < from + count) return to + value - from
      const removed = value >= from + count ? value - count : value
      return removed >= to ? removed + count : removed
    }
    const intervals: MoveIntervals = (start, end) => {
      const cuts = [...new Set([start, end + 1, from, from + count, to < from ? to : to + count].filter((point) => point >= start && point <= end + 1))].sort((a, b) => a - b)
      const ranges: [number, number][] = []
      for (let i = 0; i + 1 < cuts.length; i++) ranges.push([index(cuts[i]!), index(cuts[i + 1]! - 1)])
      ranges.sort((a, b) => a[0] - b[0])
      const merged: [number, number][] = []
      for (const range of ranges) {
        const previous = merged[merged.length - 1]
        if (previous && previous[1] + 1 === range[0]) previous[1] = range[1]
        else merged.push(range)
      }
      return merged
    }
    const finish = captureMetadata(sheet, kind, intervals)
    const references = captureMovedReferences(sheet, kind, intervals)
    ;(kind === 'row' ? sheet.rows : sheet.cols).move(from, count, to)
    finish()
    references()
  })
}

function deleteKeys<T>(map: Y.Map<T>, test: (key: string) => boolean): void {
  for (const key of [...map.keys()]) if (test(key)) map.delete(key)
}

/** Replaces deleted edge ids with their neighbors after a deletion. */
class EdgeMover {
  constructor(
    private readonly axis: Axis,
    readonly deleted: Set<string>,
    private readonly position: number,
  ) {}

  /** The id to use for a deleted start edge (the first survivor after the deletion). */
  start(): string {
    return this.axis.idAt(this.position)
  }

  /** The id to use for a deleted end edge, or undefined when nothing precedes it. */
  end(): string | undefined {
    return this.position > 0 ? this.axis.idAt(this.position - 1) : undefined
  }

  /** Moves a range's edges; undefined when the whole range was deleted. */
  range(start: string | undefined, end: string | undefined): [string | undefined, string | undefined] | undefined {
    const startGone = start !== undefined && this.deleted.has(start)
    const endGone = end !== undefined && this.deleted.has(end)
    if (!startGone && !endGone) return [start, end]
    if (startGone && endGone) {
      // Both edges deleted: the range survives only if it extended past the deletion on both sides,
      // which can't happen since edges are inside it. Gone.
      return undefined
    }
    if (startGone) {
      const replacement = this.start()
      // If the survivor is past the end edge, nothing is left.
      if (end !== undefined && this.axis.indexOf(replacement) > this.axis.indexOf(end)) return undefined
      return [replacement, end]
    }
    const replacement = this.end()
    if (replacement === undefined) return undefined
    if (start !== undefined && this.axis.indexOf(replacement) < this.axis.indexOf(start)) return undefined
    return [start, replacement]
  }
}

function moveRangeIds(range: RangeIds, kind: AxisKind, edges: EdgeMover): RangeIds | undefined {
  const [a, b] = kind === 'row' ? [range.top, range.bottom] : [range.left, range.right]
  const moved = edges.range(a, b)
  if (!moved) return undefined
  if (moved[0] === a && moved[1] === b) return range
  return kind === 'row' ? { ...range, top: moved[0], bottom: moved[1] } : { ...range, left: moved[0], right: moved[1] }
}

function moveAnchor(point: AnchorPoint | undefined, kind: AxisKind, edges: EdgeMover): AnchorPoint | undefined {
  if (!point) return point
  const id = kind === 'row' ? point.row : point.col
  if (!edges.deleted.has(id)) return point
  // An object anchored in deleted rows moves to the first row after them.
  return kind === 'row' ? { ...point, row: edges.start(), rowOff: 0 } : { ...point, col: edges.start(), colOff: 0 }
}

function adjustRanges(sheet: SheetModel, kind: AxisKind, edges: EdgeMover): void {
  for (const [id, merge] of [...sheet.merges.entries()]) {
    const range = moveRangeIds(merge.range, kind, edges)
    if (!range) sheet.merges.delete(id)
    else if (range !== merge.range) sheet.merges.set(id, { ...merge, range })
  }
  // Rule ranges resolve through tombstones on read, so deleting an axis cannot resurrect a
  // rule that another client concurrently replaced or removed.
  for (const [id, raw] of [...sheet.drawings.entries()]) {
    const drawing = raw as DrawingObject
    const from = moveAnchor(drawing.from, kind, edges)
    const to = moveAnchor(drawing.to, kind, edges)
    if (from !== drawing.from || to !== drawing.to) sheet.drawings.set(id, { ...drawing, ...(from ? { from } : {}), ...(to ? { to } : {}) })
  }
}


/** Capture positional metadata BEFORE the axis changes; restore it by surviving identity afterward.
 * Column definitions and filter offsets are parallel arrays, not range endpoints. Treating them
 * as endpoints silently assigns one column's formulas/filter to another after an interior edit.
 */
function captureMetadata(sheet: SheetModel, kind: AxisKind, moved?: MoveIntervals): () => void {
  const axis = kind === 'row' ? sheet.rows : sheet.cols
  const tables = [...sheet.tables].map(([id, raw]) => {
    const table = raw as SheetTable
    const range = sheet.resolveRange(table.range)
    const columns = new Map<string, TableColumn>()
    if (range) for (let col = range.left; col <= range.right; col++) columns.set(sheet.cols.idAt(col), table.columns[col - range.left]!)
    const intervals = range && moved?.(kind === 'row' ? range.top : range.left, kind === 'row' ? range.bottom : range.right)
    if (intervals && intervals.length > 1) throw new Error('Cannot move part of a table outside its range')
    const bounds = intervals?.[0]
    if (range && bounds && bounds[1] - bounds[0] !== (kind === 'row' ? range.bottom - range.top : range.right - range.left)) throw new Error('Cannot move part of a table outside its range')
    if (range && bounds && kind === 'row') {
      if (table.headerRow && moved!(range.top, range.top)[0]![0] !== bounds[0]) throw new Error('Cannot move a table header into its data')
      if (table.totalsRow && moved!(range.bottom, range.bottom)[0]![0] !== bounds[1]) throw new Error('Cannot move table totals into its data')
    }
    return { id, table, range, columns, bounds }
  })
  const rangeUpdates: (() => void)[] = []
  if (moved) {
    // Capture numerical intervals now; idAt must run only AFTER the axis moved.
    const plan = (ids: RangeIds) => {
      const rect = sheet.resolveRange(ids)
      const positions = rect && moved(kind === 'row' ? rect.top : rect.left, kind === 'row' ? rect.bottom : rect.right)
      return () => positions?.map(([start, end]) => ({ ...ids, ...(kind === 'row' ? { top: axis.idAt(start), bottom: axis.idAt(end) } : { left: axis.idAt(start), right: axis.idAt(end) }) })) ?? []
    }
    for (const [id, value] of sheet.merges) {
      const rect = sheet.resolveRange(value.range)
      if (rect && moved(kind === 'row' ? rect.top : rect.left, kind === 'row' ? rect.bottom : rect.right).length > 1) throw new Error('Cannot split a merged cell')
      const resolve = plan(value.range)
      rangeUpdates.push(() => { const range = resolve()[0]; if (range) sheet.merges.set(id, { ...value, range }) })
    }
    for (const collection of [sheet.cf, sheet.dv]) for (const [id, raw] of collection) {
      const value = raw as { ranges: RangeIds[] }
      const resolve = value.ranges.map(plan)
      rangeUpdates.push(() => collection.set(id, { ...value, ranges: resolve.flatMap((entry) => entry()) }))
    }
  }
  const drawings = [...sheet.drawings].map(([id, raw]) => {
    const drawing = raw as DrawingObject
    const position = (point: AnchorPoint | undefined) => point && { row: sheet.rows.indexOf(point.row), col: sheet.cols.indexOf(point.col) }
    return { id, drawing, from: position(drawing.from), to: position(drawing.to) }
  })
  const intervals = kind === 'col' ? columnIntervals(sheet) : []
  const intervalIds = intervals.length ? Array.from({ length: MAX_COLS }, (_, col) => ({ id: sheet.cols.idAt(col), props: intervals.filter((entry) => col >= entry.from && col <= entry.to).reduce<Partial<AxisProps>>((props, entry) => Object.assign(props, entry.props), {}) })) : []
  const intervalProps = new Map(intervalIds.map((entry) => [entry.id, entry.props]))
  const filter = sheet.filter.get('value') as AutoFilter | undefined
  const filterRange = filter && sheet.resolveRange(filter.range)
  const filterIntervals = filterRange && moved?.(kind === 'row' ? filterRange.top : filterRange.left, kind === 'row' ? filterRange.bottom : filterRange.right)
  if (filterIntervals && filterIntervals.length > 1) throw new Error('Cannot split an autofilter')
  const filterBounds = filterIntervals?.[0]
  const filterColumns = filterRange && filter?.columns.map((column) => ({ ...column, id: sheet.cols.idAt(filterRange.left + column.col) }))
  // Locations are formulas too, but remain public A1 strings for link navigation.
  const links = sheet.workbook.sheets().flatMap((owner) => [...owner.links].flatMap(([key, raw]) => {
    const link = raw as Hyperlink
    return link.location ? [{ owner, key, formula: toIdForm(link.location, owner) }] : []
  }))
  const selection = sheet.viewProp('selection')
  const selected = selection && parseRangeList(selection).map((range) => sheet.rangeIds(range))
  const frozenKey = kind === 'row' ? 'frozenRows' : 'frozenCols'
  const frozen = sheet.viewProp(frozenKey) ?? 0
  const boundary = frozen > 0 ? axis.idAt(frozen) : undefined
  return () => {
    for (const update of rangeUpdates) update()
    for (const { owner, key, formula } of links) {
      const link = owner.links.get(key) as Hyperlink | undefined
      if (link) owner.links.set(key, { ...link, location: toA1Form(formula, owner) })
    }
    if (intervalIds.length) {
      const next: typeof intervals = []
      for (let col = 0; col < MAX_COLS; col++) {
        let props = intervalProps.get(sheet.cols.idAt(col))
        if (!props) {
          const { hidden: _hidden, level: _level, collapsed: _collapsed, keep: _keep, ...inherited } = (col > 0 ? intervalProps.get(sheet.cols.idAt(col - 1)) : undefined) ?? {}
          props = inherited
        }
        if (!Object.keys(props).length) continue
        const last = next[next.length - 1]
        if (last && last.to === col - 1 && JSON.stringify(last.props) === JSON.stringify(props)) last.to = col
        else next.push({ from: col, to: col, props })
      }
      sheet.raw.set('colTail', next)
    }
    for (const { id, table, range: before, columns, bounds } of tables) {
      if (!before) continue
      const range = bounds ? { ...before, ...(kind === 'row' ? { top: bounds[0], bottom: bounds[1] } : { left: bounds[0], right: bounds[1] }) } : sheet.resolveRange(table.range)
      if (!range) { sheet.tables.delete(id); continue }
      const names = new Set(table.columns.map((column) => column.name.toLowerCase()))
      let nextColumnId = 1
      for (const column of table.columns) {
        const id = column.xml && parseXml(column.xml).documentElement?.getAttribute('id')
        if (id) nextColumnId = Math.max(nextColumnId, Number(id) + 1)
      }
      const next: TableColumn[] = []
      for (let col = range.left; col <= range.right; col++) {
        const existing = columns.get(sheet.cols.idAt(col))
        if (existing) next.push(existing)
        else {
          let suffix = 1
          while (names.has(`column${suffix}`)) suffix++
          const name = `Column${suffix}`
          names.add(name.toLowerCase())
          next.push({ name, xml: `<tableColumn xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${nextColumnId++}" name="${name}"/>` })
          if (table.headerRow) sheet.setCell(range.top, col, { v: name })
        }
      }
      sheet.tables.set(id, {
        ...table, range: sheet.rangeIds(range), columns: next,
        ...(table.xml && kind === 'col' ? { xml: remapTableFilters(table.xml, [...columns.keys()], Array.from({ length: next.length }, (_, offset) => sheet.cols.idAt(range.left + offset))) } : {}),
        // The totals row has its own identity; deleting it does not turn the last data row into totals.
        totalsRow: table.totalsRow && sheet.rows.indexOf(table.range.bottom!) >= 0,
      } satisfies SheetTable)
    }
    for (const { table } of tables) {
      const current = [...sheet.tables.values()].find((raw) => (raw as SheetTable).name === table.name) as SheetTable | undefined
      const names = new Set(current?.columns.map((column) => column.name.toLowerCase()) ?? [])
      if (!current || table.columns.some((column) => !names.has(column.name.toLowerCase()))) invalidateTableReferences(sheet, table, names, !current)
    }
    if (filter && filterRange) {
      const range = filterBounds ? { ...filterRange, ...(kind === 'row' ? { top: filterBounds[0], bottom: filterBounds[1] } : { left: filterBounds[0], right: filterBounds[1] }) } : sheet.resolveRange(filter.range)
      if (!range) sheet.filter.delete('value')
      else sheet.filter.set('value', {
        ...filter, range: sheet.rangeIds(range),
        columns: (filterColumns ?? []).flatMap(({ id, ...column }) => {
          const col = sheet.cols.indexOf(id)
          return col < range.left || col > range.right ? [] : [{ ...column, col: col - range.left }]
        }),
        ...(filter.sort ? { sort: filter.sort.filter((entry) => sheet.cols.indexOf(entry.col) >= 0) } : {}),
      } satisfies AutoFilter)
    }
    for (const { id, drawing, from, to } of drawings) {
      if (!from || drawing.anchor === 'absolute') continue
      if (drawing.keep?.editAs === 'absolute') {
        sheet.drawings.set(id, { ...drawing, from: { ...drawing.from!, row: sheet.rows.idAt(from.row), col: sheet.cols.idAt(from.col) }, ...(to ? { to: { ...drawing.to!, row: sheet.rows.idAt(to.row), col: sheet.cols.idAt(to.col) } } : {}) })
      } else if (drawing.keep?.editAs === 'oneCell' && to) {
        const now = kind === 'row' ? sheet.rows.indexOf(drawing.from!.row) : sheet.cols.indexOf(drawing.from!.col)
        const start = now >= 0 ? now : axis.deletedPosition(drawing.from![kind], 'start') ?? 0
        sheet.drawings.set(id, { ...drawing, to: { ...drawing.to!, [kind]: axis.idAt(Math.max(0, start + to[kind] - from[kind])) } })
      }
    }
    if (selected) sheet.view.set('selection', selected.flatMap((ids) => {
      const range = sheet.resolveRange(ids)
      return range ? [rangeName(range)] : []
    }).join(' ') || 'A1')
    const topLeft = sheet.viewProp('topLeft')
    if (topLeft) {
      const id = topLeft[kind]
      if (axis.indexOf(id) < 0) sheet.view.set('topLeft', { ...topLeft, [kind]: axis.idAt(Math.max(0, axis.deletedPosition(id, 'start') ?? 0)) })
    }
    if (boundary) sheet.view.set(frozenKey, Math.max(0, axis.indexOf(boundary) < 0 ? axis.deletedPosition(boundary, 'start') ?? 0 : axis.indexOf(boundary)))
  }
}

function remapTableFilters(xml: string, before: string[], after: string[]): string {
  const document = parseXml(xml)
  const filters = document.getElementsByTagNameNS('*', 'filterColumn')
  const entries = Array.from({ length: filters.length }, (_, index) => filters.item(index)!)
  for (const entry of entries) {
    const offset = after.indexOf(before[Number(entry.getAttribute('colId'))]!)
    if (offset < 0) entry.parentNode?.removeChild(entry)
    else entry.setAttribute('colId', String(offset))
  }
  return document.toString()
}

/** A deleted structured reference is permanently #REF!, even if a new column later reuses its name. */
function invalidateTableReferences(sheet: SheetModel, table: SheetTable, names: Set<string>, gone: boolean): void {
  const rewrite = (formula: string, owner: SheetModel, implicit = false): string => {
    const text = toA1Form(formula, owner)
    const deleted = tokenize(text).filter((token) => {
      const ref = token.structured
      if (!ref) return false
      const matches = ref.table ? [table.name, table.displayName].some((name) => name.toLowerCase() === ref.table!.toLowerCase()) : implicit
      return matches && (gone || [ref.firstColumn, ref.lastColumn].some((name) => name !== undefined && !names.has(name.toLowerCase())))
    })
    if (!deleted.length) return formula
    let result = text
    for (const token of deleted.reverse()) result = result.slice(0, token.start) + '#REF!' + result.slice(token.end)
    return toIdForm(result, owner)
  }
  const area = sheet.resolveRange(table.range)
  for (const owner of sheet.workbook.sheets()) {
    for (const [key, cell] of [...owner.cells]) {
      if (!cell.f) continue
      const position = owner.position(key)
      const implicit = owner === sheet && !!area && !!position && position.row >= area.top && position.row <= area.bottom && position.col >= area.left && position.col <= area.right
      const f = rewrite(cell.f, owner, implicit)
      if (f !== cell.f) owner.cells.set(key, { ...cell, f })
    }
    for (const [id, raw] of [...owner.cf]) {
      const value = raw as ConditionalFormat
      const rules = value.rules.map((rule) => ({ ...rule, ...(rule.formulas ? { formulas: rule.formulas.map((formula) => rewrite(formula, owner)) } : {}) }))
      if (JSON.stringify(rules) !== JSON.stringify(value.rules)) owner.cf.set(id, { ...value, rules })
    }
    for (const [id, raw] of [...owner.dv]) {
      const value = raw as DataValidation
      const next = { ...value, ...(value.formula1 ? { formula1: rewrite(value.formula1, owner) } : {}), ...(value.formula2 ? { formula2: rewrite(value.formula2, owner) } : {}) }
      if (JSON.stringify(next) !== JSON.stringify(value)) owner.dv.set(id, next)
    }
    const parts = owner.raw.get('referenceParts') as Record<string, { source: string; anchored: string }> | undefined
    if (parts) owner.raw.set('referenceParts', Object.fromEntries(Object.entries(parts).map(([path, part]) => [path, { ...part, anchored: mapXmlReferences(part.anchored, (formula) => rewrite(formula, owner)) }])))
    for (const [id, raw] of [...owner.tables]) {
      const value = raw as SheetTable
      const columns = value.columns.map((column) => column.xml ? { ...column, xml: mapXmlReferences(column.xml, (formula) => rewrite(formula, owner, value.name === table.name)) } : column)
      if (columns.some((column, index) => column.xml !== value.columns[index]?.xml)) owner.tables.set(id, { ...value, columns })
    }
  }
  for (const [id, name] of [...sheet.workbook.names]) {
    const owner = name.scope ? sheet.workbook.sheet(name.scope) : sheet
    if (!owner) continue
    const formula = rewrite(name.formula, owner)
    if (formula !== name.formula) sheet.workbook.names.set(id, { ...name, formula })
  }
}
