import type { CellRange } from '../address.js'
import { rangeContains } from '../address.js'
import { randomId } from '../model/axis.js'
import { toA1Form, toIdForm } from '../model/formula-ids.js'
import { shiftFormula } from '../model/references.js'
import type { ConditionalFormat, DataValidation } from '../model/schema.js'
import type { SheetModel } from '../model/workbook.js'
import type { SheetValues } from '../values.js'
import type { ClipboardRule } from './clipboard.js'

export const contains = (a: CellRange, b: CellRange) => a.top <= b.top && a.bottom >= b.bottom && a.left <= b.left && a.right >= b.right
export const intersects = (a: CellRange, b: CellRange) => a.top <= b.bottom && a.bottom >= b.top && a.left <= b.right && a.right >= b.left
export const offsetRange = (r: CellRange, row: number, col: number): CellRange => ({ top: r.top + row, bottom: r.bottom + row, left: r.left + col, right: r.right + col })

/** Subtract without changing the first range's formula anchor. */
function subtract(a: CellRange, b: CellRange): CellRange[] {
  if (!intersects(a, b)) return [a]
  const top = Math.max(a.top, b.top), bottom = Math.min(a.bottom, b.bottom)
  const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right)
  return [{ ...a, bottom: top - 1 }, { ...a, top: bottom + 1 }, { top, bottom, left: a.left, right: left - 1 }, { top, bottom, left: right + 1, right: a.right }].filter((r) => r.top <= r.bottom && r.left <= r.right)
}

function mapFormulas<T extends Omit<DataValidation | ConditionalFormat, 'ranges'>>(value: T, map: (formula: string) => string): T {
  const result = JSON.parse(JSON.stringify(value)) as T
  if ('rules' in result) {
    const cf = result as Omit<ConditionalFormat, 'ranges'>
    cf.edited = true
    for (const rule of cf.rules) {
      delete rule.xml
      if (rule.formulas) rule.formulas = rule.formulas.map(map)
      for (const key of ['colorScale', 'dataBar', 'iconSet'] as const) {
        const scale = rule[key]
        if (scale) scale.values = scale.values.map((v) => v.type === 'formula' && v.value ? { ...v, value: map(v.value) } : v)
      }
    }
  } else {
    const dv = result as Omit<DataValidation, 'ranges'>
    if (dv.formula1) dv.formula1 = map(dv.formula1)
    if (dv.formula2) dv.formula2 = map(dv.formula2)
  }
  return result
}

export function snapshotRules<T extends DataValidation | ConditionalFormat>(sheet: SheetModel, collection: Iterable<unknown>, rows: number[], cols: number[]): ClipboardRule<T>[] {
  const result: ClipboardRule<T>[] = []
  for (const raw of collection) {
    const value = raw as T
    const ranges = value.ranges.map((r) => sheet.resolveRange(r)).filter((r): r is CellRange => !!r)
    const first = ranges[0]
    if (!first) continue
    const mapped: CellRange[] = []
    // Compress each visible run; gaps in the source become adjacent clipboard cells.
    rows.forEach((row, dr) => {
      let start = -1
      for (let dc = 0; dc <= cols.length; dc++) {
        const inside = dc < cols.length && ranges.some((r) => rangeContains(r, row, cols[dc]!))
        if (inside && start < 0) start = dc
        if (!inside && start >= 0) { mapped.push({ top: dr, bottom: dr, left: start, right: dc - 1 }); start = -1 }
      }
    })
    if (mapped.length) result.push({ ranges: mapped, origin: { row: first.top, col: first.left }, value: mapFormulas(value, (f) => toA1Form(f, sheet)) })
  }
  return result
}

/** Clears rule coverage without expanding the selected cells. */
export function clearRules(sheet: SheetModel, kind: 'dv' | 'cf', destination: CellRange): void {
  const collection = sheet[kind]
  for (const [id, raw] of [...collection]) {
    const value = raw as DataValidation | ConditionalFormat
    const rects = value.ranges.map((r) => sheet.resolveRange(r)).filter((r): r is CellRange => !!r)
    if (!rects.some((r) => intersects(r, destination))) continue
    const staying = rects.flatMap((r) => subtract(r, destination))
    if (!staying.length) collection.delete(id)
    else {
      const first = rects[0]!, next = staying[0]!
      collection.set(id, { ...mapFormulas(value, (f) => toIdForm(shiftFormula(toA1Form(f, sheet), next.top - first.top, next.left - first.left), sheet)), ranges: staying.map((r) => sheet.rangeIds(r)) })
    }
  }
}

/** Replace destination metadata only for the modes which carry it. Rebase survivors as well. */
export function pasteRules<T extends DataValidation | ConditionalFormat>(sheet: SheetModel, kind: 'dv' | 'cf', rules: ClipboardRule<T>[], destination: CellRange, sourceRows: number[], sourceCols: number[], dxf?: number[]): void {
  clearRules(sheet, kind, destination)
  const height = sourceRows.length, width = sourceCols.length
  for (let dr = 0; dr <= destination.bottom - destination.top; dr += height) for (let dc = 0; dc <= destination.right - destination.left; dc += width) {
    for (const rule of rules) {
      const ranges = rule.ranges.map((rect) => offsetRange(rect, destination.top + dr, destination.left + dc))
      placeRule(sheet, kind, rule, ranges, dxf)
    }
  }
}

/** Keep disjoint ranges in one rule: ranking, scales and duplicates use the whole domain. */
export function placeRule<T extends DataValidation | ConditionalFormat>(sheet: SheetModel, kind: 'dv' | 'cf', rule: ClipboardRule<T>, ranges: CellRange[], dxf?: number[]): void {
  const first = ranges[0]
  if (!first) return
  const translated = mapFormulas(rule.value, (f) => toIdForm(shiftFormula(f, first.top - rule.origin.row, first.left - rule.origin.col), sheet))
  if (kind === 'cf' && dxf) for (const r of (translated as Omit<ConditionalFormat, 'ranges'>).rules) if (r.dxfId !== undefined) r.dxfId = dxf[r.dxfId] ?? r.dxfId
  sheet[kind].set(randomId(), { ...translated, ranges: ranges.map((r) => sheet.rangeIds(r)) })
}

/** Refuse partial legacy arrays and edits to spill members, before any destination write. */
export function canWriteArrays(sheet: SheetModel, destination: CellRange, values: SheetValues): boolean {
  let allowed = true
  sheet.forEachCell((row, col, data) => {
    const size = data.array ?? values.spill?.(sheet, row, col)
    if (!size) return
    const range = { top: row, left: col, bottom: row + size.rows - 1, right: col + size.cols - 1 }
    if (intersects(range, destination) && !contains(destination, range)) allowed = false
  })
  return allowed
}
