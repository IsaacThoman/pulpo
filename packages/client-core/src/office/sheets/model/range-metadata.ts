import type { CellRange } from '../address.js'
import { subtractRanges, intersects } from '../range-set.js'
import { formatIdToken, mapIdTokens, toA1Form, toIdForm } from './formula-ids.js'
import { shiftFormula } from './references.js'
import type { ConditionalFormat, DataValidation, Hyperlink, RangeIds } from './schema.js'
import type { SheetModel } from './workbook.js'

/** Worksheet metadata stays in slots when record identities are sorted. */
export function metadataRangeIds(sheet: SheetModel, range: CellRange): RangeIds {
  sheet.enablePositions()
  const ids = sheet.rangeIds(range)
  if (ids.top !== undefined) {
    ids.top = sheet.positionRowId(range.top)
    ids.bottom = sheet.positionRowId(range.bottom)
  }
  return ids
}

export function metadataFormula(formula: string, sheet: SheetModel): string {
  return mapIdTokens(toIdForm(formula, sheet), (token, text) => {
    const owner = token.sheet ? sheet.workbook.sheet(token.sheet) : sheet
    if (!owner || token.sheets || token.name !== undefined) return text
    owner.enablePositions()
    for (const end of [token.from, token.to]) if (end?.row !== undefined) {
      const row = owner.rows.indexOf(end.row)
      if (row >= 0) end.row = owner.positionRowId(row)
    }
    return formatIdToken(token)
  })
}

export function mapRuleFormulas<T extends Omit<DataValidation | ConditionalFormat, 'ranges'>>(value: T, map: (formula: string) => string, preserveXml = false): T {
  const result = JSON.parse(JSON.stringify(value)) as T
  if ('rules' in result) {
    const cf = result as Omit<ConditionalFormat, 'ranges'>
    cf.edited = true
    for (const rule of cf.rules) {
      if (!preserveXml) delete rule.xml
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

/** Rebase the one shared formula anchor; keep all surviving rectangles in the same rule. */
export function rebaseRule<T extends DataValidation | ConditionalFormat>(value: T, sheet: SheetModel, origin: CellRange, next: CellRange): T {
  return mapRuleFormulas(value, (f) => metadataFormula(shiftFormula(toA1Form(f, sheet, sheet.workbook, { followDeletedRelative: true }), next.top - origin.top, next.left - origin.left), sheet), true)
}

/** Clear a selection's union atomically without touching coverage outside it. */
export function clearRules(sheet: SheetModel, kind: 'dv' | 'cf', selection: CellRange | readonly CellRange[]): void {
  const selected = Array.isArray(selection) ? selection : [selection as CellRange]
  const collection = sheet[kind]
  for (const [id, raw] of [...collection]) {
    const value = raw as DataValidation | ConditionalFormat
    const rects = value.ranges.map((r) => sheet.resolveRange(r)).filter((r): r is CellRange => !!r)
    if (!rects.some((r) => selected.some((s) => intersects(r, s)))) continue
    const staying = subtractRanges(rects, selected)
    if (!staying.length) collection.delete(id)
    else collection.set(id, { ...rebaseRule(value, sheet, rects[0]!, staying[0]!), ranges: staying.map((r) => metadataRangeIds(sheet, r)) })
  }
}

/** Hyperlinks have one rectangle per entry (OOXML ref, rather than sqref). */
export function clearLinks(sheet: SheetModel, selection: readonly CellRange[]): void {
  const survivors: Array<{ link: Hyperlink; range: CellRange }> = []
  for (const [key, raw] of [...sheet.links]) {
    const link = raw as Hyperlink
    const point = sheet.position(key)
    const range = link.range ? sheet.resolveRange(link.range) : point && { top: point.row, bottom: point.row, left: point.col, right: point.col }
    if (!range || !selection.some((r) => intersects(range, r))) continue
    sheet.links.delete(key)
    for (const remaining of subtractRanges([range], selection)) survivors.push({ link, range: remaining })
  }
  for (const { link, range } of survivors) putRangeLink(sheet, range, link)
}

export function putRangeLink(sheet: SheetModel, range: CellRange, link: Hyperlink): Hyperlink {
  const ids = metadataRangeIds(sheet, range)
  const value = { ...link, range: ids }
  sheet.links.set(`${ids.top ?? sheet.positionRowId(range.top)}:${sheet.cols.idAt(range.left)}`, value)
  return value
}
