import * as Y from 'yjs'
import type { Axis } from './axis.js'
import type { AnchorPoint, ConditionalFormat, DataValidation, DrawingObject, RangeIds } from './schema.js'
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
    inserted = axis.insert(position, count)
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
    const deleted = new Set(axis.delete(position, count))
    const hit = (key: string) => deleted.has(kind === 'row' ? splitCellKey(key).row : splitCellKey(key).col)
    const owner = (key: string) => key.slice(0, key.lastIndexOf('|'))
    deleteKeys(sheet.cells, hit)
    deleteKeys(sheet.xf, hit)
    deleteKeys(sheet.fmt, (key) => hit(owner(key)))
    deleteKeys(sheet.links, hit)
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
  sheet.workbook.transact(() => (kind === 'row' ? sheet.rows : sheet.cols).move(from, count, to))
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
  const adjustList = <T extends { ranges: RangeIds[] }>(map: Y.Map<unknown>, rewrite?: (value: T) => T) => {
    for (const [id, raw] of [...map.entries()]) {
      const value = raw as T
      const ranges = value.ranges.map((range) => moveRangeIds(range, kind, edges)).filter((range): range is RangeIds => !!range)
      if (!ranges.length) {
        map.delete(id)
        continue
      }
      const next = rewrite ? rewrite({ ...value, ranges }) : { ...value, ranges }
      if (JSON.stringify(next) !== JSON.stringify(value)) map.set(id, next)
    }
  }
  adjustList<ConditionalFormat>(sheet.cf)
  adjustList<DataValidation>(sheet.dv)
  for (const [id, raw] of [...sheet.tables.entries()]) {
    const table = raw as { range: RangeIds }
    const range = moveRangeIds(table.range, kind, edges)
    if (!range) sheet.tables.delete(id)
    else if (range !== table.range) sheet.tables.set(id, { ...table, range })
  }
  const filter = sheet.filter.get('value') as { range: RangeIds } | undefined
  if (filter) {
    const range = moveRangeIds(filter.range, kind, edges)
    if (!range) sheet.filter.delete('value')
    else if (range !== filter.range) sheet.filter.set('value', { ...filter, range })
  }
  for (const [id, raw] of [...sheet.drawings.entries()]) {
    const drawing = raw as DrawingObject
    const from = moveAnchor(drawing.from, kind, edges)
    const to = moveAnchor(drawing.to, kind, edges)
    if (from !== drawing.from || to !== drawing.to) sheet.drawings.set(id, { ...drawing, ...(from ? { from } : {}), ...(to ? { to } : {}) })
  }
}

