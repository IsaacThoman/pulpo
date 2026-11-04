import { LiveFormatError } from '../../live-format.js'
import { parseXml, type OoxmlPackage, type XmlDocument } from '../../ooxml/package.js'
import { MAX_COLS, MAX_ROWS, parseCellName, parseRangeList, parseRangeName, type CellRange } from '../address.js'
import { randomId } from '../model/axis.js'
import { toIdForm } from '../model/formula-ids.js'
import { shiftFormula } from '../model/references.js'
import type {
  AxisProps,
  CellData,
  CfValue,
  ConditionalFormat,
  ConditionalRule,
  DataValidation,
  FilterColumn,
  Hyperlink,
  SheetTable,
} from '../model/schema.js'
import type { SheetModel } from '../model/workbook.js'
import { parseColor } from '../styles/stylesheet.js'
import { readDrawing } from './drawing.js'
import { lightChild, locateElement, parseFragment, type LightNode } from './light-xml.js'
import { readNotes } from './notes.js'
import { readStringItem, type SheetString } from './strings.js'
import { tidyNamespaces } from './write-worksheet.js'
import { attr, boolAttr, child, children, numberAttr, otherAttributes, REL_TYPES, serializeNode, textOf, type XmlElement } from './xml.js'

/** Elements of a worksheet the model owns; everything else stays in the preserved skeleton. */
export const MODELED_WORKSHEET_ELEMENTS = ['dimension', 'cols', 'mergeCells', 'conditionalFormatting', 'dataValidations', 'hyperlinks', 'autoFilter', 'sortState', 'tableParts', 'legacyDrawing']

export interface ReadContext {
  pkg: OoxmlPackage
  sharedStrings: SheetString[]
  /** Cells read so far in the whole workbook, against the limit. */
  cellCount: { value: number; limit: number }
  /** Parts regenerated on export (not preserved as-is). */
  regenerated: Set<string>
  /** The asset of an image or other binary part, already in the asset store. */
  asset: (path: string) => { hash: string; mimeType: string } | undefined
}

interface PendingFormula {
  row: number
  col: number
  /** A1 text of a shared formula's master, or the cell's own formula. */
  text?: string
  sharedIndex?: string
  data: CellData
}

const ROW_MODELED = ['r', 'spans', 'ht', 'customHeight', 'hidden', 'outlineLevel', 'collapsed', 's', 'customFormat']
const C_MODELED = ['r', 's', 't']
const F_MODELED = ['t', 'ref', 'si']

/** Reads one worksheet part into `sheet`. */
export function readWorksheet(sheet: SheetModel, path: string, context: ReadContext): void {
  const text = context.pkg.text(path)
  if (text === undefined) throw new LiveFormatError('corrupt', `The worksheet ${path} is missing`)
  const sheetData = locateElement(text, 'sheetData')
  const skeletonText = sheetData ? text.slice(0, sheetData.start) + `<${sheetData.prefix}sheetData/>` + text.slice(sheetData.end) : text
  const document = parseXml(skeletonText)
  const root = document.documentElement!
  if (root.localName !== 'worksheet') throw new LiveFormatError('corrupt', `${path} is not a worksheet`)

  readSheetProperties(sheet, root)
  readSheetViews(sheet, root)
  readSheetFormat(sheet, root)
  readColumns(sheet, child(root, 'cols'))
  if (sheetData) readSheetData(sheet, text, sheetData.innerStart, sheetData.innerEnd, context)
  readMerges(sheet, child(root, 'mergeCells'))
  for (const element of children(root, 'conditionalFormatting')) readConditionalFormatting(sheet, element)
  readDataValidations(sheet, child(root, 'dataValidations'))
  const rels = context.pkg.relationships(path)
  readHyperlinks(sheet, child(root, 'hyperlinks'), rels)
  readAutoFilter(sheet, child(root, 'autoFilter'), child(root, 'sortState'))
  readTables(sheet, child(root, 'tableParts'), path, context)

  const drawingId = attr(child(root, 'drawing'), 'r:id')
  const drawingPath = drawingId ? context.pkg.relationshipTarget(path, drawingId) : undefined
  if (drawingPath && context.pkg.has(drawingPath)) readDrawing(sheet, drawingPath, context)
  const comments = rels.find((rel) => rel.type === REL_TYPES.comments && rel.targetMode !== 'External')
  const vmlId = attr(child(root, 'legacyDrawing'), 'r:id')
  const vmlPath = vmlId ? context.pkg.relationshipTarget(path, vmlId) : undefined
  if (comments) readNotes(sheet, context.pkg.relationshipTarget(path, comments.id)!, vmlPath, context)
  // A legacy drawing without notes (form controls) is kept as it is; the export links it again.
  if (vmlPath && !sheet.raw.has('vmlPart') && context.pkg.has(vmlPath)) sheet.raw.set('vmlPart', vmlPath)

  for (const name of MODELED_WORKSHEET_ELEMENTS) for (const element of children(root, name)) root.removeChild(element)
  sheet.raw.set('part', path)
  sheet.raw.set('xml', tidyNamespaces(serializeSkeleton(document)))
  const relsPath = path.replace(/([^/]+)$/, '_rels/$1.rels')
  const relsText = context.pkg.text(relsPath)
  // Relationships the export rebuilds from the model are left out, so a file read back after
  // export has the same skeleton (and applying it changes nothing).
  if (relsText !== undefined) sheet.raw.set('rels', withoutRelationships(relsText, [REL_TYPES.hyperlink, REL_TYPES.table, REL_TYPES.comments, REL_TYPES.vmlDrawing]))
  context.regenerated.add(path)
  context.regenerated.add(relsPath)
}

/** A relationships part without relationships of the given types. */
export function withoutRelationships(xml: string, types: string[]): string {
  const document = parseXml(xml)
  const root = document.documentElement!
  for (const element of children(root, 'Relationship')) if (types.includes(element.getAttribute('Type') ?? '')) root.removeChild(element)
  return serializeNode(document)
}

function serializeSkeleton(document: XmlDocument): string {
  return serializeNode(document)
}

function readSheetProperties(sheet: SheetModel, root: XmlElement): void {
  const properties = child(root, 'sheetPr')
  const tab = parseColor(child(properties, 'tabColor'))
  if (tab) sheet.map.set('tabColor', tab)
}

function readSheetViews(sheet: SheetModel, root: XmlElement): void {
  const view = child(child(root, 'sheetViews'), 'sheetView')
  if (!view) return
  if (!boolAttr(view, 'showGridLines', true)) sheet.view.set('showGridLines', false)
  if (!boolAttr(view, 'showRowColHeaders', true)) sheet.view.set('showHeadings', false)
  if (!boolAttr(view, 'showZeros', true)) sheet.view.set('showZeros', false)
  if (boolAttr(view, 'rightToLeft')) sheet.view.set('rightToLeft', true)
  const zoom = numberAttr(view, 'zoomScale')
  if (zoom && zoom !== 100) sheet.view.set('zoom', Math.min(400, Math.max(10, zoom)))
  const pane = child(view, 'pane')
  const state = attr(pane, 'state')
  if (pane && (state === 'frozen' || state === 'frozenSplit')) {
    const cols = Math.floor(numberAttr(pane, 'xSplit') ?? 0)
    const rows = Math.floor(numberAttr(pane, 'ySplit') ?? 0)
    if (rows > 0 && rows < MAX_ROWS) sheet.view.set('frozenRows', rows)
    if (cols > 0 && cols < MAX_COLS) sheet.view.set('frozenCols', cols)
  }
  const selection = children(view, 'selection').find((entry) => !attr(entry, 'pane') || attr(entry, 'pane') === attr(pane, 'activePane')) ?? child(view, 'selection')
  const active = attr(selection, 'activeCell')
  if (active && parseCellName(active)) sheet.view.set('selection', attr(selection, 'sqref') ?? active)
}

function readSheetFormat(sheet: SheetModel, root: XmlElement): void {
  const format = child(root, 'sheetFormatPr')
  if (!format) return
  const value: Record<string, number | boolean> = {}
  const height = numberAttr(format, 'defaultRowHeight')
  const width = numberAttr(format, 'defaultColWidth')
  const base = numberAttr(format, 'baseColWidth')
  if (height) value.defaultRowHeight = height
  if (width) value.defaultColWidth = width
  if (base) value.baseColWidth = base
  if (boolAttr(format, 'zeroHeight')) value.zeroHeight = true
  sheet.raw.set('format', value)
}

/** Column ranges wider than this are kept as one tail range instead of per-column entries. */
const COLUMN_TAIL = 1024

function readColumns(sheet: SheetModel, cols: XmlElement | undefined): void {
  for (const col of children(cols, 'col')) {
    const min = (numberAttr(col, 'min') ?? 1) - 1
    const max = Math.min((numberAttr(col, 'max') ?? min + 1) - 1, MAX_COLS - 1)
    if (min < 0 || max < min) continue
    const props: Partial<AxisProps> = {}
    const width = numberAttr(col, 'width')
    if (width !== undefined) props.size = width
    if (boolAttr(col, 'customWidth')) props.custom = true
    if (boolAttr(col, 'hidden')) props.hidden = true
    const level = numberAttr(col, 'outlineLevel')
    if (level) props.level = level
    if (boolAttr(col, 'collapsed')) props.collapsed = true
    const style = numberAttr(col, 'style')
    if (style) props.xf = style
    const keep = otherAttributes(col, ['min', 'max', 'width', 'customWidth', 'hidden', 'outlineLevel', 'collapsed', 'style'])
    if (keep) props.keep = keep
    if (max - min >= COLUMN_TAIL) {
      // Typically `<col min="5" max="16384" style="3"/>`: the format of every remaining column.
      sheet.raw.set('colTail', { from: min, props })
      continue
    }
    sheet.cols.ensure(max + 1)
    for (let index = min; index <= max; index++) {
      const id = sheet.cols.idAt(index)
      for (const [prop, value] of Object.entries(props)) sheet.colMeta.set(`${id}|${prop}`, value)
    }
  }
}

/** What reading one sheet's cells keeps track of. */
interface SheetDataState {
  pending: PendingFormula[]
  /** Shared formula masters by `si`. */
  masters: Map<string, { row: number; col: number; text: string }>
  /** Cells covered by an array formula's result, by cell key: the anchor's data and the offset. */
  arrayMembers: Map<string, { anchor: CellData; dr: number; dc: number }>
}

function readSheetData(sheet: SheetModel, text: string, from: number, to: number, context: ReadContext): void {
  const state: SheetDataState = { pending: [], masters: new Map(), arrayMembers: new Map() }
  let row = -1
  // Rows are parsed one at a time so the light DOM stays small.
  let cursor = from
  while (cursor < to) {
    const rowStart = text.indexOf('<', cursor)
    if (rowStart < 0 || rowStart >= to) break
    const nodes = parseRowAt(text, rowStart, to)
    if (!nodes) break
    cursor = nodes.next
    const node = nodes.node
    if (!node || node.name !== 'row') continue
    const declared = Number(node.attrs.r)
    row = Number.isInteger(declared) && declared >= 1 ? declared - 1 : row + 1
    if (row >= MAX_ROWS) throw new LiveFormatError('corrupt', 'A row is outside the grid')
    readRow(sheet, row, node)
    let col = -1
    for (const cell of node.children) {
      if (cell.name !== 'c') continue
      const ref = cell.attrs.r ? parseCellName(cell.attrs.r) : undefined
      col = ref ? ref.col : col + 1
      if (col >= MAX_COLS) throw new LiveFormatError('corrupt', 'A cell is outside the grid')
      if (++context.cellCount.value > context.cellCount.limit) throw new LiveFormatError('too_large', 'This workbook has too many cells to edit')
      readCell(sheet, ref?.row ?? row, col, cell, text, context, state)
    }
  }
  // Shared formulas: followers take their master's text, moved by their offset from it.
  for (const entry of state.pending) {
    let formula = entry.text
    if (formula === undefined && entry.sharedIndex !== undefined) {
      const master = state.masters.get(entry.sharedIndex)
      if (master) formula = shiftFormula(master.text, entry.row - master.row, entry.col - master.col)
    }
    if (formula === undefined) continue
    const data: CellData = { ...entry.data, f: toIdForm(formula, sheet) }
    sheet.cells.set(sheet.keyAt(entry.row, entry.col), data)
  }
}

/** Parses the next top-level element of sheetData starting at `start`. */
function parseRowAt(text: string, start: number, limit: number): { node: LightNode | undefined; next: number } | undefined {
  if (text.startsWith('<!--', start)) {
    const end = text.indexOf('-->', start)
    return end < 0 ? undefined : { node: undefined, next: end + 3 }
  }
  const nameMatch = /^<((?:[\w.-]+:)?)([\w.-]+)/.exec(text.slice(start, start + 64))
  if (!nameMatch) throw new LiveFormatError('corrupt', 'Unexpected content in sheet data')
  const closing = `</${nameMatch[1]}${nameMatch[2]}>`
  // A self-closing row (`<row r="3"/>`) ends at its own tag.
  const tagEnd = text.indexOf('>', start)
  if (tagEnd < 0) throw new LiveFormatError('corrupt', 'Unterminated tag in sheet data')
  const end = text[tagEnd - 1] === '/' ? tagEnd + 1 : text.indexOf(closing, tagEnd) + closing.length
  if (end < closing.length || end > limit) throw new LiveFormatError('corrupt', 'Unterminated row in sheet data')
  const [node] = parseFragment(text, start, end)
  return { node, next: end }
}

function readRow(sheet: SheetModel, row: number, node: LightNode): void {
  const attrs = node.attrs
  const props: Partial<AxisProps> = {}
  const height = Number(attrs.ht)
  if (attrs.ht !== undefined && Number.isFinite(height)) props.size = height
  if (attrs.customHeight === '1' || attrs.customHeight === 'true') props.custom = true
  if (attrs.hidden === '1' || attrs.hidden === 'true') props.hidden = true
  const level = Number(attrs.outlineLevel)
  if (level > 0) props.level = level
  if (attrs.collapsed === '1' || attrs.collapsed === 'true') props.collapsed = true
  if (attrs.s !== undefined && (attrs.customFormat === '1' || attrs.customFormat === 'true')) props.xf = Number(attrs.s)
  const keep: Record<string, string> = {}
  for (const [name, value] of Object.entries(attrs)) if (!ROW_MODELED.includes(name)) keep[name] = value
  if (Object.keys(keep).length) props.keep = keep
  if (!Object.keys(props).length) return
  sheet.rows.ensure(row + 1)
  const id = sheet.rows.idAt(row)
  for (const [prop, value] of Object.entries(props)) sheet.rowMeta.set(`${id}|${prop}`, value)
}

function readCell(
  sheet: SheetModel,
  row: number,
  col: number,
  node: LightNode,
  source: string,
  context: ReadContext,
  state: SheetDataState,
): void {
  const { pending, masters } = state
  const { attrs } = node
  const style = Number(attrs.s)
  const valueNode = lightChild(node, 'v')
  const formulaNode = lightChild(node, 'f')
  const data: CellData = {}
  const type = attrs.t ?? 'n'
  const raw = valueNode?.text
  switch (type) {
    case 's': {
      if (raw === undefined || raw.trim() === '') break
      const item = context.sharedStrings[Number(raw)]
      if (item) {
        data.v = item.text
        if (item.runs) data.runs = item.runs
        if (item.phonetic) data.phonetic = item.phonetic
      } else if (raw !== undefined) {
        // A dangling shared string index; Excel and LibreOffice show the cell empty.
        data.v = ''
      }
      break
    }
    case 'inlineStr': {
      const inline = lightChild(node, 'is')
      if (inline) {
        const item = readStringItem(inline, source)
        data.v = item.text
        if (item.runs) data.runs = item.runs
      }
      break
    }
    case 'str':
      data.v = raw ?? ''
      break
    case 'b':
      if (raw !== undefined) data.v = raw.trim() === '1' || raw.trim() === 'true'
      break
    case 'e':
      if (raw !== undefined) {
        data.v = raw.trim()
        data.t = 'e'
      }
      break
    case 'd': {
      // ISO 8601 dates (rare; Strict-flavored writers). Stored as serials like Excel does.
      const ms = raw ? Date.parse(raw.trim().endsWith('Z') || /T.*[+-]\d\d:?\d\d$/.test(raw.trim()) ? raw.trim() : `${raw.trim()}Z`) : NaN
      if (Number.isFinite(ms)) data.v = (ms - Date.UTC(1899, 11, 30)) / 86_400_000
      break
    }
    default:
      if (raw !== undefined && raw.trim() !== '') {
        const n = Number(raw)
        data.v = Number.isFinite(n) ? n : raw
      }
  }
  const keepC: Record<string, string> = {}
  for (const [name, value] of Object.entries(attrs)) if (!C_MODELED.includes(name)) keepC[name] = value
  const extra = node.children.filter((entry) => entry.name !== 'v' && entry.name !== 'f' && entry.name !== 'is' && source.startsWith(`<${entry.name}`, entry.start))
  if (Object.keys(keepC).length || extra.length) {
    data.keep = {}
    if (Object.keys(keepC).length) data.keep.c = keepC
    if (extra.length) data.keep.extra = extra.map((entry) => source.slice(entry.start, entry.end)).join('')
  }
  if (Number.isFinite(style) && style > 0) {
    sheet.ensure(row, col)
    sheet.xf.set(sheet.keyAt(row, col), style)
  } else if (inheritsStyle(sheet, row, col)) {
    // A cell without `s` has format 0 even in a formatted row or column; say so explicitly,
    // since cells without a format of their own take the row's or column's.
    sheet.ensure(row, col)
    sheet.xf.set(sheet.keyAt(row, col), 0)
  }
  if (formulaNode) {
    const formulaType = formulaNode.attrs.t ?? 'normal'
    const keepF: Record<string, string> = {}
    for (const [name, value] of Object.entries(formulaNode.attrs)) if (!F_MODELED.includes(name)) keepF[name] = value
    const formulaText = formulaNode.text
    if (formulaType === 'dataTable') {
      // What-if data tables: kept exactly, never recalculated.
      data.keep = { ...data.keep, f: { t: 'dataTable', ...(formulaNode.attrs.ref ? { ref: formulaNode.attrs.ref } : {}), ...keepF }, fText: formulaText }
    } else {
      if (Object.keys(keepF).length) data.keep = { ...data.keep, f: keepF }
      if (formulaType === 'array') {
        const range = formulaNode.attrs.ref ? parseRangeName(formulaNode.attrs.ref) : undefined
        if (attrs.cm !== undefined) data.dynamic = true
        else if (range) data.array = { rows: range.bottom - range.top + 1, cols: range.right - range.left + 1 }
        else data.array = { rows: 1, cols: 1 }
        if (range && (range.bottom > range.top || range.right > range.left)) markArrayMembers(sheet, row, col, range, data, state)
      }
      sheet.ensure(row, col)
      if (formulaType === 'shared' && formulaNode.attrs.si !== undefined) {
        const index = formulaNode.attrs.si
        if (formulaText.trim()) {
          masters.set(index, { row, col, text: formulaText })
          pending.push({ row, col, text: formulaText, data })
        } else pending.push({ row, col, sharedIndex: index, data })
        return
      } else if (formulaText.trim()) {
        pending.push({ row, col, text: formulaText, data })
        return
      }
      // An empty formula element: keep the value.
    }
  }
  if (data.v === undefined && !data.runs && !data.keep) return
  sheet.ensure(row, col)
  const key = sheet.keyAt(row, col)
  // A member of an array formula's result is recorded on the anchor, not stored as content.
  const member = state.arrayMembers.get(key)
  if (member) {
    const cached = member.anchor.spillCache?.[member.dr]
    if (cached) cached[member.dc] = data.t === 'e' ? { e: String(data.v) } : (data.v ?? null)
    return
  }
  sheet.cells.set(key, data)
}

function inheritsStyle(sheet: SheetModel, row: number, col: number): boolean {
  if (sheet.rowMeta.get(`${sheet.rows.idAt(row)}|xf`) !== undefined) return true
  if (sheet.colMeta.get(`${sheet.cols.idAt(col)}|xf`) !== undefined) return true
  const tail = sheet.raw.get('colTail') as { from: number; props: Partial<AxisProps> } | undefined
  return !!tail?.props.xf && col >= tail.from
}

/** Array formula results live on the anchor (spillCache), not in member cells. */
function markArrayMembers(sheet: SheetModel, row: number, col: number, range: CellRange, data: CellData, state: SheetDataState): void {
  const rows = range.bottom - range.top + 1
  const cols = range.right - range.left + 1
  if (rows * cols > 1_000_000) return
  data.spillCache = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null))
  data.spillCache[0]![0] = data.t === 'e' ? { e: String(data.v) } : (data.v ?? null)
  sheet.ensure(range.bottom, range.right)
  for (let r = range.top; r <= range.bottom; r++) {
    for (let c = range.left; c <= range.right; c++) {
      if (r !== row || c !== col) state.arrayMembers.set(sheet.keyAt(r, c), { anchor: data, dr: r - row, dc: c - col })
    }
  }
}

function readMerges(sheet: SheetModel, element: XmlElement | undefined): void {
  for (const merge of children(element, 'mergeCell')) {
    const range = parseRangeName(attr(merge, 'ref') ?? '')
    if (!range || (range.top === range.bottom && range.left === range.right)) continue
    sheet.merges.set(randomId(), { range: sheet.rangeIds(range) })
  }
}

function readCfValues(element: XmlElement, sheet: SheetModel): CfValue[] {
  return children(element, 'cfvo').map((cfvo) => {
    const value: CfValue = { type: (attr(cfvo, 'type') ?? 'num') as CfValue['type'] }
    const val = attr(cfvo, 'val')
    if (val !== undefined) value.value = value.type === 'formula' ? toIdForm(val.replace(/^=/, ''), sheet) : val
    if (attr(cfvo, 'gte') !== undefined) value.gte = boolAttr(cfvo, 'gte', true)
    return value
  })
}

function readConditionalFormatting(sheet: SheetModel, element: XmlElement): void {
  const ranges = parseRangeList(attr(element, 'sqref') ?? '')
  if (!ranges.length) return
  const rules: ConditionalRule[] = children(element, 'cfRule').map((ruleElement) => {
    const rule: ConditionalRule = {
      type: (attr(ruleElement, 'type') ?? 'expression') as ConditionalRule['type'],
      priority: numberAttr(ruleElement, 'priority') ?? 1,
      xml: serializeNode(ruleElement),
    }
    if (boolAttr(ruleElement, 'stopIfTrue')) rule.stopIfTrue = true
    const operator = attr(ruleElement, 'operator')
    if (operator) rule.operator = operator
    const dxfId = numberAttr(ruleElement, 'dxfId')
    if (dxfId !== undefined) rule.dxfId = dxfId
    const text = attr(ruleElement, 'text')
    if (text !== undefined) rule.text = text
    const timePeriod = attr(ruleElement, 'timePeriod')
    if (timePeriod) rule.timePeriod = timePeriod
    const rank = numberAttr(ruleElement, 'rank')
    if (rank !== undefined) rule.rank = rank
    if (boolAttr(ruleElement, 'percent')) rule.percent = true
    if (boolAttr(ruleElement, 'bottom')) rule.bottom = true
    if (attr(ruleElement, 'aboveAverage') !== undefined) rule.aboveAverage = boolAttr(ruleElement, 'aboveAverage', true)
    if (boolAttr(ruleElement, 'equalAverage')) rule.equalAverage = true
    const stdDev = numberAttr(ruleElement, 'stdDev')
    if (stdDev !== undefined) rule.stdDev = stdDev
    const formulas = children(ruleElement, 'formula').map((formula) => toIdForm(textOf(formula), sheet))
    if (formulas.length) rule.formulas = formulas
    const scale = child(ruleElement, 'colorScale')
    if (scale) rule.colorScale = { values: readCfValues(scale, sheet), colors: children(scale, 'color').map((color) => parseColor(color) ?? { rgb: 'FF000000' }) }
    const bar = child(ruleElement, 'dataBar')
    if (bar) {
      rule.dataBar = { values: readCfValues(bar, sheet), color: parseColor(child(bar, 'color')) ?? { rgb: 'FF638EC6' } }
      if (attr(bar, 'showValue') !== undefined) rule.dataBar.showValue = boolAttr(bar, 'showValue', true)
      const minLength = numberAttr(bar, 'minLength')
      const maxLength = numberAttr(bar, 'maxLength')
      if (minLength !== undefined) rule.dataBar.minLength = minLength
      if (maxLength !== undefined) rule.dataBar.maxLength = maxLength
    }
    const icons = child(ruleElement, 'iconSet')
    if (icons) {
      rule.iconSet = { set: attr(icons, 'iconSet') ?? '3TrafficLights1', values: readCfValues(icons, sheet) }
      if (boolAttr(icons, 'reverse')) rule.iconSet.reverse = true
      if (attr(icons, 'showValue') !== undefined) rule.iconSet.showValue = boolAttr(icons, 'showValue', true)
    }
    return rule
  })
  const format: ConditionalFormat = { ranges: ranges.map((range) => sheet.rangeIds(range)), rules }
  const keep = otherAttributes(element, ['sqref'])
  if (keep) format.keep = keep
  sheet.cf.set(randomId(), format)
}

function readDataValidations(sheet: SheetModel, element: XmlElement | undefined): void {
  for (const entry of children(element, 'dataValidation')) {
    const ranges = parseRangeList(attr(entry, 'sqref') ?? '')
    if (!ranges.length) continue
    const validation: DataValidation = { ranges: ranges.map((range) => sheet.rangeIds(range)), type: (attr(entry, 'type') ?? 'none') as DataValidation['type'] }
    const operator = attr(entry, 'operator')
    if (operator) validation.operator = operator
    const formula1 = child(entry, 'formula1')
    const formula2 = child(entry, 'formula2')
    if (formula1) validation.formula1 = toIdForm(textOf(formula1), sheet)
    if (formula2) validation.formula2 = toIdForm(textOf(formula2), sheet)
    if (boolAttr(entry, 'allowBlank')) validation.allowBlank = true
    // `showDropDown="1"` means the in-cell dropdown is HIDDEN (a famous misnomer).
    if (boolAttr(entry, 'showDropDown')) validation.showDropDown = true
    if (boolAttr(entry, 'showInputMessage')) validation.showInputMessage = true
    if (boolAttr(entry, 'showErrorMessage')) validation.showErrorMessage = true
    const errorStyle = attr(entry, 'errorStyle')
    if (errorStyle === 'warning' || errorStyle === 'information' || errorStyle === 'stop') validation.errorStyle = errorStyle
    for (const name of ['errorTitle', 'error', 'promptTitle', 'prompt'] as const) {
      const value = attr(entry, name)
      if (value !== undefined) validation[name] = value
    }
    const keep = otherAttributes(entry, ['sqref', 'type', 'operator', 'allowBlank', 'showDropDown', 'showInputMessage', 'showErrorMessage', 'errorStyle', 'errorTitle', 'error', 'promptTitle', 'prompt'])
    if (keep) validation.keep = keep
    sheet.dv.set(randomId(), validation)
  }
}

function readHyperlinks(sheet: SheetModel, element: XmlElement | undefined, rels: { id: string; target: string; targetMode?: string }[]): void {
  for (const entry of children(element, 'hyperlink')) {
    const range = parseRangeName(attr(entry, 'ref') ?? '')
    if (!range) continue
    const link: Hyperlink = {}
    const relId = attr(entry, 'r:id')
    const rel = relId ? rels.find((candidate) => candidate.id === relId) : undefined
    if (rel) link.target = rel.target
    for (const name of ['location', 'tooltip', 'display'] as const) {
      const value = attr(entry, name)
      if (value !== undefined) link[name] = value
    }
    if (range.bottom > range.top || range.right > range.left) link.range = sheet.rangeIds(range)
    sheet.ensure(range.top, range.left)
    sheet.links.set(sheet.keyAt(range.top, range.left), link)
  }
}

function readAutoFilter(sheet: SheetModel, element: XmlElement | undefined, sortState: XmlElement | undefined): void {
  const range = element && parseRangeName(attr(element, 'ref') ?? '')
  if (!element || !range) return
  const columns: FilterColumn[] = children(element, 'filterColumn').map((column) => {
    const entry: FilterColumn = { col: numberAttr(column, 'colId') ?? 0, xml: serializeNode(column) }
    const filters = child(column, 'filters')
    if (filters && !children(filters).some((node) => node.localName === 'dateGroupItem')) {
      entry.values = children(filters, 'filter').map((filter) => attr(filter, 'val') ?? '')
      if (boolAttr(filters, 'blank')) entry.values.push('')
    }
    return entry
  })
  sheet.filter.set('value', {
    range: sheet.rangeIds(range),
    columns,
    xml: serializeNode(element),
    ...(sortState ? { sortXml: serializeNode(sortState) } : {}),
  })
}

function readTables(sheet: SheetModel, element: XmlElement | undefined, sheetPath: string, context: ReadContext): void {
  for (const part of children(element, 'tablePart')) {
    const relId = attr(part, 'r:id')
    const path = relId ? context.pkg.relationshipTarget(sheetPath, relId) : undefined
    const document = path ? context.pkg.xml(path) : undefined
    const root = document?.documentElement
    if (!path || !root) continue
    const range = parseRangeName(attr(root, 'ref') ?? '')
    if (!range) continue
    const table: SheetTable = {
      name: attr(root, 'name') ?? attr(root, 'displayName') ?? 'Table',
      displayName: attr(root, 'displayName') ?? attr(root, 'name') ?? 'Table',
      range: sheet.rangeIds(range),
      headerRow: attr(root, 'headerRowCount') !== '0',
      totalsRow: (numberAttr(root, 'totalsRowCount') ?? 0) > 0,
      columns: children(child(root, 'tableColumns'), 'tableColumn').map((column) => ({ name: attr(column, 'name') ?? '', xml: serializeNode(column) })),
      part: path,
      xml: context.pkg.text(path) ?? '',
    }
    sheet.tables.set(randomId(), table)
    context.regenerated.add(path)
  }
}

