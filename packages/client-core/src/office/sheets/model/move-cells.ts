import { PACKAGE_RELATIONSHIPS_NS, parseXml, relativeTarget } from '../../ooxml/package.js'
import { child, children, serializeNode } from '../codec/xml.js'
import { referenceParts, resolveXml } from '../codec/reference-xml.js'
import type * as Y from 'yjs'
import { rangeContains, parseRangeName, type CellRange } from '../address.js'
import { randomId } from './axis.js'
import { shiftFormula } from './references.js'
import { mapXmlReferences } from '../codec/reference-xml.js'
import { formatIdToken, mapIdTokens, toA1Form, toIdForm, type IdEnd } from './formula-ids.js'
import type { AutoFilter, ConditionalFormat, DataValidation, DrawingObject, Hyperlink, RangeIds, SheetTable } from './schema.js'
import type { SheetModel } from './workbook.js'

const contains = (outer: CellRange, inner: CellRange) => outer.top <= inner.top && outer.bottom >= inner.bottom && outer.left <= inner.left && outer.right >= inner.right
const intersects = (a: CellRange, b: CellRange) => a.top <= b.bottom && a.bottom >= b.top && a.left <= b.right && a.right >= b.left

/** Excel cut/paste is a relocation, not a copy followed by clearing. References throughout the
 * workbook follow the moved cells, including absolute references. Snapshot before clearing so
 * overlapping moves cannot overwrite their own source. */
export function moveCells(source: SheetModel, target: SheetModel, range: CellRange, at: { row: number; col: number }): void {
  if (source.workbook.doc !== target.workbook.doc) throw new Error('Cannot cut between workbooks')
  const dr = at.row - range.top
  const dc = at.col - range.left
  const shift = (r: CellRange): CellRange => ({ top: r.top + dr, bottom: r.bottom + dr, left: r.left + dc, right: r.right + dc })
  const destination = shift(range)
  for (const owner of new Set([source, target])) for (const collection of [owner.tables, owner.merges]) {
    for (const raw of collection.values()) {
      const rect = owner.resolveRange((raw as { range: RangeIds }).range)
      if (!rect) continue
      if (owner === source && intersects(rect, range) && !contains(range, rect)) throw new Error('Cannot cut part of a table or merged cell')
      if (owner === target && intersects(rect, destination) && !(owner === source && contains(range, rect))) throw new Error('Cannot overwrite a table or merged cell')
    }
  }
  const redirect = (formula: string, context: SheetModel, resultContext = context) => mapIdTokens(formula, (token, text) => {
    if (token.name !== undefined || token.sheets) return text
    const referenced = token.sheet ? source.workbook.sheet(token.sheet) : context
    const position = (end: IdEnd) => end.row !== undefined && end.col !== undefined && referenced ? { row: referenced.rows.indexOf(end.row), col: referenced.cols.indexOf(end.col) } : undefined
    const from = position(token.from)
    const to = token.to ? position(token.to) : from
    if (referenced === source && from && to && rangeContains(range, from.row, from.col) && rangeContains(range, to.row, to.col)) {
      const movedEnd = (end: IdEnd): IdEnd => ({ ...end, row: target.rows.idAt(source.rows.indexOf(end.row!) + dr), col: target.cols.idAt(source.cols.indexOf(end.col!) + dc) })
      return formatIdToken({ ...token, sheet: token.sheet || target.id !== resultContext.id ? target.id : undefined, from: movedEnd(token.from), ...(token.to ? { to: movedEnd(token.to) } : {}) })
    }
    // An unqualified reference outside a cross-sheet cut still points at the original sheet.
    return !token.sheet && context.id !== resultContext.id ? formatIdToken({ ...token, sheet: context.id }) : text
  })
  const locations = new Map(source.workbook.sheets().flatMap((owner) => [...owner.links.values()].map((raw) => { const link = raw as Hyperlink; return [link, { owner, formula: link.location && toIdForm(link.location, owner) }] as const })))
  const ruleOrigins = new Map<object, SheetModel>()
  const movedTables = new Set<object>()
  source.workbook.transact(() => {
    target.ensure(destination.bottom, destination.right)
    const movedKeys = new Set<string>()
    const relocateMap = <T>(from: Y.Map<T>, to: Y.Map<T>, keyCell: (key: string) => string = (key) => key) => {
      const entries: [string, T][] = []
      for (const [key, value] of [...from]) {
        const cell = keyCell(key)
        const position = source.position(cell)
        if (!position || !rangeContains(range, position.row, position.col)) continue
        const dest = target.keyAt(position.row + dr, position.col + dc)
        entries.push([dest + key.slice(cell.length), value])
        from.delete(key)
      }
      for (const key of [...to.keys()]) {
        const position = target.position(keyCell(key))
        if (position && rangeContains(destination, position.row, position.col)) to.delete(key)
      }
      for (const [key, value] of entries) { to.set(key, value); if ((to as unknown) === target.cells) movedKeys.add(key) }
    }
    relocateMap(source.cells, target.cells)
    relocateMap(source.xf, target.xf)
    relocateMap(source.fmt, target.fmt, (key) => key.slice(0, key.lastIndexOf('|')))
    relocateMap(source.notes, target.notes)
    relocateMap(source.links, target.links)
    const relocateRange = (ids: RangeIds): RangeIds => {
      const rect = source.resolveRange(ids)
      return rect && contains(range, rect) ? target.rangeIds(shift(rect)) : ids
    }
    for (const [from, to] of [[source.merges as Y.Map<unknown>, target.merges as Y.Map<unknown>], [source.tables, target.tables]] as const) {
      for (const [id, raw] of [...from]) {
        const value = raw as { range: RangeIds }
        const rect = source.resolveRange(value.range)
        if (!rect || !contains(range, rect)) continue
        from.delete(id)
        const table = raw as SheetTable
        const next = { ...value, range: target.rangeIds(shift(rect)) }
        if (raw && typeof raw === 'object' && 'columns' in raw) {
          Object.assign(next, { xml: table.xml && mapXmlReferences(table.xml, (text) => redirect(text, source, target)), columns: table.columns.map((column) => ({ ...column, ...(column.xml ? { xml: mapXmlReferences(column.xml, (text) => redirect(text, source, target)) } : {}) })) })
        }
        to.set(id, next)
        movedTables.add(next)
      }
    }
    const filter = source.filter.get('value') as AutoFilter | undefined
    const filterRange = filter && source.resolveRange(filter.range)
    if (filter && filterRange && contains(range, filterRange)) {
      source.filter.delete('value')
      target.filter.set('value', { ...filter, range: target.rangeIds(shift(filterRange)), ...(filter.xml ? { xml: mapXmlReferences(filter.xml, (text) => redirect(text, source, target)) } : {}), ...(filter.sortXml ? { sortXml: mapXmlReferences(filter.sortXml, (text) => redirect(text, source, target)) } : {}) })
    }
    const subtract = (rect: CellRange, cut: CellRange): CellRange[] => {
      if (!intersects(rect, cut)) return [rect]
      const top = Math.max(rect.top, cut.top), bottom = Math.min(rect.bottom, cut.bottom)
      const left = Math.max(rect.left, cut.left), right = Math.min(rect.right, cut.right)
      return [
        { ...rect, bottom: top - 1 }, { ...rect, top: bottom + 1 },
        { top, bottom, left: rect.left, right: left - 1 }, { top, bottom, left: right + 1, right: rect.right },
      ].filter((entry) => entry.top <= entry.bottom && entry.left <= entry.right)
    }
    const rebase = (value: ConditionalFormat | DataValidation, origin: CellRange, next: CellRange) => {
      const formula = (f: string) => toIdForm(shiftFormula(toA1Form(f, source), next.top - origin.top, next.left - origin.left), source)
      if ('rules' in value) return { ...value, rules: value.rules.map((rule) => ({ ...rule, ...(rule.formulas ? { formulas: rule.formulas.map(formula) } : {}), ...Object.fromEntries(['colorScale', 'dataBar', 'iconSet'].flatMap((key) => { const entry = rule[key as 'colorScale']; return entry ? [[key, { ...entry, values: entry.values.map((v) => v.type === 'formula' && v.value ? { ...v, value: formula(v.value) } : v) }]] : [] })) })) }
      return { ...value, ...(value.formula1 ? { formula1: formula(value.formula1) } : {}), ...(value.formula2 ? { formula2: formula(value.formula2) } : {}) }
    }
    for (const [from, to] of [[source.cf, target.cf], [source.dv, target.dv]] as const) {
      if (source !== target) for (const [id, raw] of [...to]) {
        const value = raw as ConditionalFormat | DataValidation
        const ranges = value.ranges.flatMap((ids) => { const rect = target.resolveRange(ids); return rect ? subtract(rect, destination).map((r) => target.rangeIds(r)) : [] })
        if (ranges.length) to.set(id, { ...value, ranges })
        else to.delete(id)
      }
      for (const [id, raw] of [...from]) {
        const value = raw as ConditionalFormat | DataValidation
        const rects = value.ranges.flatMap((ids) => { const rect = source.resolveRange(ids); return rect ? [rect] : [] })
        const origin = rects[0]
        if (!origin) continue
        const moving = rects.filter((rect) => intersects(rect, range)).map((rect) => ({ top: Math.max(rect.top, range.top), bottom: Math.min(rect.bottom, range.bottom), left: Math.max(rect.left, range.left), right: Math.min(rect.right, range.right) }))
        const staying = rects.flatMap((rect) => subtract(rect, range)).flatMap((rect) => source === target ? subtract(rect, destination) : [rect])
        if (!moving.length && staying.length === rects.length && staying.every((r, i) => JSON.stringify(r) === JSON.stringify(rects[i]))) continue
        if (staying.length) from.set(id, { ...rebase(value, origin, staying[0]!), ranges: staying.map((rect) => source.rangeIds(rect)) })
        else from.delete(id)
        if (!moving.length) continue
        const moved = { ...rebase(value, origin, moving[0]!), ranges: moving.map((rect) => target.rangeIds(shift(rect))) }
        ruleOrigins.set(moved, source)
        to.set(source === target && staying.length ? randomId() : id, moved)
      }
    }
    const finishAttachments = source !== target ? relocateAttachments(source, target, range, (formula) => redirect(formula, source, target)) : () => {}
    for (const [id, raw] of [...source.drawings]) {
      const drawing = raw as DrawingObject
      const point = drawing.from && { row: source.rows.indexOf(drawing.from.row), col: source.cols.indexOf(drawing.from.col) }
      if (!point || !rangeContains(range, point.row, point.col)) continue
      const move = (p: NonNullable<DrawingObject['from']>) => ({ ...p, row: target.rows.idAt(Math.max(0, source.rows.indexOf(p.row) + dr)), col: target.cols.idAt(Math.max(0, source.cols.indexOf(p.col) + dc)) })
      source.drawings.delete(id)
      const movedDrawing = source !== target ? relocateDrawingLinks(drawing, source, target) : drawing
      target.drawings.set(id, { ...movedDrawing, from: move(drawing.from!), ...(drawing.to ? { to: move(drawing.to) } : {}) })
    }
    for (const owner of source.workbook.sheets()) {
      for (const [key, data] of [...owner.cells]) if (data.f !== undefined) owner.cells.set(key, { ...data, f: redirect(data.f, owner === target && movedKeys.has(key) ? source : owner, owner) })
      for (const [key, raw] of [...owner.links]) {
        const link = raw as Hyperlink
        const original = locations.get(link)
        owner.links.set(key, { ...link, ...(original?.formula ? { location: toA1Form(redirect(original.formula, original.owner, owner), owner) } : {}), ...(owner === target && original?.owner === source && link.range ? { range: relocateRange(link.range) } : {}) })
      }
      for (const [id, raw] of [...owner.cf]) {
        const value = raw as ConditionalFormat
        const context = ruleOrigins.get(value) ?? owner
        owner.cf.set(id, { ...value, rules: value.rules.map((rule) => ({ ...rule, ...(rule.formulas ? { formulas: rule.formulas.map((formula) => redirect(formula, context, owner)) } : {}), ...Object.fromEntries(['colorScale', 'dataBar', 'iconSet'].flatMap((key) => { const entry = rule[key as 'colorScale']; return entry ? [[key, { ...entry, values: entry.values.map((v) => v.type === 'formula' && v.value ? { ...v, value: redirect(v.value, context, owner) } : v) }]] : [] })) })) })
      }
      for (const [id, raw] of [...owner.dv]) {
        const value = raw as DataValidation
        const context = ruleOrigins.get(value) ?? owner
        owner.dv.set(id, { ...value, ...(value.formula1 ? { formula1: redirect(value.formula1, context, owner) } : {}), ...(value.formula2 ? { formula2: redirect(value.formula2, context, owner) } : {}) })
      }
      for (const [id, raw] of [...owner.tables]) {
        if (movedTables.has(raw as object)) continue
        const table = raw as SheetTable
        owner.tables.set(id, { ...table, ...(table.xml ? { xml: mapXmlReferences(table.xml, (text) => redirect(text, owner)) } : {}), columns: table.columns.map((column) => ({ ...column, ...(column.xml ? { xml: mapXmlReferences(column.xml, (text) => redirect(text, owner)) } : {}) })) })
      }
      // Preserved references (charts, sparkline data and table formulas) use the same tokens.
      const rewriteXml = (xml: string) => mapXmlReferences(xml, (text) => redirect(text, owner))
      const skeleton = owner.raw.get('xml')
      if (typeof skeleton === 'string') owner.raw.set('xml', rewriteXml(skeleton))
      const parts = owner.raw.get('referenceParts') as Record<string, { source: string; anchored: string }> | undefined
      if (parts) owner.raw.set('referenceParts', Object.fromEntries(Object.entries(parts).map(([path, part]) => [path, { ...part, anchored: rewriteXml(part.anchored) }])))
    }
    finishAttachments()
    for (const [id, name] of [...source.workbook.names]) {
      const context = name.scope ? source.workbook.sheet(name.scope) : undefined
      if (context) source.workbook.names.set(id, { ...name, formula: redirect(name.formula, context) })
      else source.workbook.names.set(id, { ...name, formula: redirect(name.formula, source) })
    }
  })
}

function appendRelationship(sheet: SheetModel, key: string, type: string, path: string, base: string): string {
  const document = parseXml((sheet.raw.get(key) as string | undefined) ?? `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`)
  const id = `rId${randomId()}`
  const rel = document.createElementNS(PACKAGE_RELATIONSHIPS_NS, 'Relationship')
  rel.setAttribute('Id', id)
  rel.setAttribute('Type', type)
  rel.setAttribute('Target', relativeTarget(base, path))
  document.documentElement!.appendChild(rel)
  sheet.raw.set(key, serializeNode(document))
  return id
}

function relocateDrawingLinks(drawing: DrawingObject, source: SheetModel, target: SheetModel): DrawingObject {
  const ids = new Map<string, string>()
  const sourceRels = source.raw.get('drawingRels') as string | undefined
  const rels = sourceRels ? children(parseXml(sourceRels).documentElement!, 'Relationship') : []
  const links: Record<string, string> = {}
  for (const [old, path] of Object.entries(drawing.links ?? {})) {
    const type = rels.find((rel) => rel.getAttribute('Id') === old)?.getAttribute('Type') ?? `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${path === drawing.chart ? 'chart' : 'image'}`
    const id = appendRelationship(target, 'drawingRels', type, path, target.raw.get('drawingPart') as string ?? 'xl/drawings/drawing.xml')
    ids.set(old, id)
    links[id] = path
  }
  const xml = drawing.xml.replace(/(\b[\w.-]+:(?:id|embed|link)=["'])([^"']+)(["'])/g, (all, prefix: string, id: string, quote: string) => ids.has(id) ? prefix + ids.get(id) + quote : all)
  return { ...drawing, xml, ...(drawing.links ? { links } : {}) }
}

/** Sparkline destinations and threaded comments belong to their worksheet. Moving their
 * reference text alone across sheets would create an illegal qualified sqref/ref. Transfer
 * their owning XML along with the cells, then redirect their formulas in the new context. */
function relocateAttachments(source: SheetModel, target: SheetModel, range: CellRange, redirect: (formula: string) => string): () => void {
  const pending: (() => void)[] = []
  const inside = (text: string) => {
    const rect = parseRangeName(toA1Form(text, source))
    return rect && contains(range, rect)
  }
  const skeleton = source.raw.get('xml') as string | undefined
  if (skeleton) {
    const document = parseXml(skeleton)
    for (const ext of children(child(document.documentElement!, 'extLst'), 'ext')) {
      const groups = child(ext, 'sparklineGroups')
      if (!groups) continue
      for (const group of [...children(groups, 'sparklineGroup')]) {
        const list = child(group, 'sparklines')
        const moving = children(list, 'sparkline').filter((sparkline) => inside(child(sparkline, 'sqref')?.textContent ?? ''))
        if (!moving.length || !list) continue
        const clone = group.cloneNode(true) as typeof group
        const clonedList = child(clone, 'sparklines')!
        for (const node of [...children(clonedList)]) clonedList.removeChild(node)
        for (const node of moving) { clonedList.appendChild(node.cloneNode(true)); list.removeChild(node) }
        if (!children(list).length) groups.removeChild(group)
        const movedXml = mapXmlReferences(serializeNode(clone), redirect)
        const uri = ext.getAttribute('uri') ?? ''
        pending.push(() => {
          const destination = parseXml((target.raw.get('xml') as string | undefined) ?? '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>')
          const root = destination.documentElement!
          let extLst = child(root, 'extLst')
          if (!extLst) { extLst = destination.createElementNS(root.namespaceURI, 'extLst'); root.appendChild(extLst) }
          let container = children(extLst, 'ext').find((entry) => entry.getAttribute('uri') === uri)
          if (!container) { container = destination.createElementNS(root.namespaceURI, 'ext'); container.setAttribute('uri', uri); extLst.appendChild(container) }
          let sparklineGroups = child(container, 'sparklineGroups')
          if (!sparklineGroups) { sparklineGroups = destination.createElementNS(groups.namespaceURI, groups.nodeName); container.appendChild(sparklineGroups) }
          sparklineGroups.appendChild(destination.importNode(parseXml(movedXml).documentElement!, true))
          target.raw.set('xml', serializeNode(destination))
        })
      }
    }
    source.raw.set('xml', serializeNode(document))
  }
  const parts = referenceParts(source)
  const next = { ...parts }
  for (const [path, part] of Object.entries(parts)) {
    const document = parseXml(part.anchored)
    const root = document.documentElement!
    if (!/threadedcomments/i.test(root.namespaceURI ?? '')) continue
    const moving = children(root, 'threadedComment').filter((comment) => inside(comment.getAttribute('ref') ?? ''))
    if (!moving.length) continue
    const movedRoot = root.cloneNode(false) as typeof root
    for (const node of moving) { movedRoot.appendChild(node.cloneNode(true)); root.removeChild(node) }
    next[path] = { ...part, anchored: serializeNode(document) }
    const anchored = mapXmlReferences(serializeNode(movedRoot), redirect)
    pending.push(() => {
      const destinationPath = `xl/threadedComments/threadedComment-${randomId()}.xml`
      target.raw.set('referenceParts', { ...referenceParts(target), [destinationPath]: { source: resolveXml(anchored, target), anchored } })
      appendRelationship(target, 'rels', 'http://schemas.microsoft.com/office/2017/10/relationships/threadedComment', destinationPath, target.raw.get('part') as string ?? 'xl/worksheets/sheet.xml')
    })
  }
  source.raw.set('referenceParts', next)
  for (const raw of source.drawings.values()) {
    const drawing = raw as DrawingObject
    const point = drawing.from && { row: source.rows.indexOf(drawing.from.row), col: source.cols.indexOf(drawing.from.col) }
    if (!point || !rangeContains(range, point.row, point.col)) continue
    for (const path of Object.values(drawing.links ?? {})) {
      const part = parts[path]
      if (part) pending.push(() => target.raw.set('referenceParts', { ...referenceParts(target), [path]: { ...part, anchored: mapXmlReferences(part.anchored, redirect) } }))
    }
  }
  return () => { for (const apply of pending) apply() }
}
