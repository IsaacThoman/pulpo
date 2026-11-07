import type { CellRange } from '../address.js'
import { rangeContains } from '../address.js'
import { randomId } from '../model/axis.js'
import { toA1Form } from '../model/formula-ids.js'
import { clearRules, mapRuleFormulas, metadataRangeIds, metadataFormula } from '../model/range-metadata.js'
import { normalizeRanges } from '../range-set.js'
import { shiftFormula } from '../model/references.js'
import type { ConditionalFormat, DataValidation } from '../model/schema.js'
import type { SheetModel } from '../model/workbook.js'
import type { ClipboardRule } from './clipboard.js'

export { contains, intersects } from '../range-set.js'
export { clearRules } from '../model/range-metadata.js'
export const offsetRange = (r: CellRange, row: number, col: number): CellRange => ({ top: r.top + row, bottom: r.bottom + row, left: r.left + col, right: r.right + col })

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
    if (mapped.length) result.push({ ranges: mapped, origin: { row: first.top, col: first.left }, value: mapRuleFormulas(value, (f) => toA1Form(f, sheet, sheet.workbook, { followDeletedRelative: true })) })
  }
  return result
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
  ranges = normalizeRanges(ranges)
  const first = ranges[0]
  if (!first) return
  const translated = mapRuleFormulas(rule.value, (f) => metadataFormula(shiftFormula(f, first.top - rule.origin.row, first.left - rule.origin.col), sheet))
  if (kind === 'cf' && dxf) for (const r of (translated as Omit<ConditionalFormat, 'ranges'>).rules) if (r.dxfId !== undefined) r.dxfId = dxf[r.dxfId] ?? r.dxfId
  sheet[kind].set(randomId(), { ...translated, ranges: ranges.map((r) => metadataRangeIds(sheet, r)) })
}
