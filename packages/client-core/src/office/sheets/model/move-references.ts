import { mapXmlReferences } from '../codec/reference-xml.js'
import { formatIdToken, mapIdTokens, toA1Form, toIdForm } from './formula-ids.js'
import { shiftFormula } from './references.js'
import type { ConditionalFormat, DataValidation, Hyperlink } from './schema.js'
import type { SheetModel } from './workbook.js'
import type { AxisKind } from './structure.js'

export type MoveIntervals = (start: number, end: number) => [number, number][]

/** A moved range can become a union; endpoint ids alone cannot describe that union, or even
 * an interval whose endpoints were reordered. Preserve its member intervals before moving. */
export function captureMovedReferences(sheet: SheetModel, kind: AxisKind, intervals: MoveIntervals): () => void {
  const axis = kind === 'row' ? sheet.rows : sheet.cols
  const before = axis.resolve()
  const slots = kind === 'row' ? sheet.positionRows.resolve() : undefined
  const index = (id: string) => (id.startsWith('~p') ? slots?.index.get(id.slice(2)) : before.index.get(id)) ?? (/^(0|[1-9]\d*)$/.test(id) && Number(id) >= before.next ? before.ids.length + Number(id) - before.next : -1)
  const rewrite = (formula: string, owner: SheetModel) => mapIdTokens(formula, (token, text) => {
    if (token.name !== undefined || token.sheets || (token.sheet ?? owner.id) !== sheet.id || !token.to) return text
    const a = token.from[kind], b = token.to[kind]
    if (a === undefined || b === undefined || index(a) < 0 || index(b) < 0) return text
    const first = index(a), last = index(b)
    const ranges = intervals(Math.min(first, last), Math.max(first, last))
    const values = ranges.map(([start, end]) => formatIdToken({ ...token, from: { ...token.from, [kind]: axis.idAt(first <= last ? start : end) }, to: { ...token.to!, [kind]: axis.idAt(first <= last ? end : start) } }))
    return values.length === 1 ? values[0]! : `(${values.join(',')})`
  })
  const origins = [sheet.cf, sheet.dv].flatMap((collection) => [...collection].flatMap(([id, raw]) => {
    const value = raw as { ranges: import('./schema.js').RangeIds[] }
    const origin = value.ranges[0] && sheet.resolveRange(value.ranges[0])
    return origin ? [{ collection, id, row: sheet.rows.idAt(origin.top), col: sheet.cols.idAt(origin.left) }] : []
  }))
  const links = sheet.workbook.sheets().flatMap((owner) => [...owner.links].flatMap(([key, raw]) => {
    const link = raw as Hyperlink
    return link.location ? [{ owner, key, formula: toIdForm(link.location, owner) }] : []
  }))
  return () => {
    for (const owner of sheet.workbook.sheets()) {
      const visit = (value: unknown, key = ''): unknown => {
        if (typeof value === 'string') {
          if (key === 'source') return value
          if (key === 'xml' || key === 'sortXml' || key === 'anchored') return mapXmlReferences(value, (formula) => rewrite(formula, owner))
          return ['f', 'formula', 'formula1', 'formula2', 'formulas', 'formulaValue'].includes(key) ? rewrite(value, owner) : value
        }
        if (Array.isArray(value)) return value.map((entry) => visit(entry, key))
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([prop, entry]) => [prop, visit(entry, prop === 'value' && 'type' in value && value.type === 'formula' ? 'formulaValue' : prop)]))
        return value
      }
      for (const collection of [owner.cells, owner.cf, owner.dv, owner.tables, owner.filter] as const) {
        for (const [key, value] of [...collection]) {
          const effective = collection === owner.cells ? owner.cellData(key) : value
          const next = visit(effective)
          if (JSON.stringify(next) !== JSON.stringify(effective)) (collection as import('yjs').Map<unknown>).set(key, next)
        }
      }
      for (const key of [...owner.raw.keys()].filter((key) => key.startsWith('sortFormula:')).concat(['xml', 'referenceParts'])) {
        const value = owner.raw.get(key)
        if (value !== undefined) owner.raw.set(key, visit(value, key))
      }
    }
    for (const { collection, id, row, col } of origins) {
      const value = collection.get(id) as ConditionalFormat | DataValidation | undefined
      const origin = value?.ranges[0] && sheet.resolveRange(value.ranges[0])
      if (!value || !origin) continue
      const dr = origin.top - sheet.rows.indexOf(row), dc = origin.left - sheet.cols.indexOf(col)
      if (!dr && !dc) continue
      const formula = (f: string) => toIdForm(shiftFormula(toA1Form(f, sheet), dr, dc), sheet)
      if ('rules' in value) collection.set(id, { ...value, rules: value.rules.map((rule) => ({ ...rule, ...(rule.formulas ? { formulas: rule.formulas.map(formula) } : {}) })) })
      else collection.set(id, { ...value, ...(value.formula1 ? { formula1: formula(value.formula1) } : {}), ...(value.formula2 ? { formula2: formula(value.formula2) } : {}) })
    }
    for (const { owner, key, formula } of links) {
      const link = owner.links.get(key) as Hyperlink | undefined
      if (link) owner.links.set(key, { ...link, location: toA1Form(rewrite(formula, owner), owner) })
    }
    for (const [id, name] of [...sheet.workbook.names]) {
      const owner = name.scope ? sheet.workbook.sheet(name.scope) : sheet
      if (owner) sheet.workbook.names.set(id, { ...name, formula: rewrite(name.formula, owner) })
    }
  }
}
