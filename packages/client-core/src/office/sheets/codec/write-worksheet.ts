import { orderedEntries } from './order.js'
import { columnIntervals, columnIntervalProps } from '../model/column-intervals.js'
import { parseXml, type XmlDocument } from '../../ooxml/package.js'
import { cellName, columnName, MAX_COLS, MAX_ROWS, rangeName, type CellRange } from '../address.js'
import { toA1Form } from '../model/formula-ids.js'
import type {
  AutoFilter,
  AxisProps,
  CellData,
  CellScalar,
  CfValue,
  ConditionalFormat,
  ConditionalRule,
  DataValidation,
  Hyperlink,
  RangeIds,
  SheetTable,
  StyleProps,
} from '../model/schema.js'
import { splitCellKey, type SheetModel } from '../model/workbook.js'
import { colorAttrs, type Stylesheet } from '../styles/stylesheet.js'
import type { SharedStringTable } from './strings.js'
import { attr, child, children, encodeSheetText, escapeXml, needsPreserve, serializeNode, SHEET_NS, xmlAttrs, type XmlElement } from './xml.js'

/** CT_Worksheet's child order: elements must appear in this order or Excel repairs the file. */
const WORKSHEET_ORDER = [
  'sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'sheetCalcPr', 'sheetProtection', 'protectedRanges',
  'scenarios', 'autoFilter', 'sortState', 'dataConsolidate', 'customSheetViews', 'mergeCells', 'phoneticPr', 'conditionalFormatting',
  'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks',
  'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture',
  'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst',
]

export const DEFAULT_WORKSHEET_XML =
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData/>' +
  '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>'

/** The value of a cell the writer should store: from the calculation engine, or as cached. */
export type ValueSource = (sheet: SheetModel, row: number, col: number, data: CellData) => CellScalar | { e: string } | undefined

export interface WorksheetWriteContext {
  styles: Stylesheet
  strings: SharedStringTable
  values?: ValueSource
  /** Spilled results of dynamic array formulas: anchor key → values, from the engine. */
  spills?: (sheet: SheetModel, row: number, col: number) => (CellScalar | { e: string })[][] | undefined
  /** Adds a relationship from the sheet and returns its id. */
  addRelationship: (type: string, target: string, external: boolean) => string
  /** Relationship ids of table parts, by table id. */
  tableRelationships: Map<string, string>
  /** Relationship id of a drawing part created on this export. */
  drawingId?: string
  /** Relationship id of the legacy drawing (notes), if the sheet has one. */
  legacyDrawingId?: string
  isTemplate?: boolean
  /** The `cm` index marking a dynamic-array formula, adding the cell metadata it needs. */
  dynamicArrayMetadata?: () => string | undefined
}

function insertInOrder(root: XmlElement, element: XmlElement): void {
  const position = WORKSHEET_ORDER.indexOf(element.localName ?? '')
  const next = children(root).find((node) => {
    const order = WORKSHEET_ORDER.indexOf(node.localName ?? '')
    return order > position
  })
  root.insertBefore(element, next ?? null)
}

/** Parses an XML fragment written as a string into an element of `document`. */
function fragment(document: XmlDocument, xml: string): XmlElement {
  const parsed = parseXml(`<wrapper xmlns="${SHEET_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">${xml}</wrapper>`)
  return document.importNode(children(parsed.documentElement!)[0]!, true) as XmlElement
}

function sqref(sheet: SheetModel, ranges: RangeIds[]): string {
  return ranges
    .map((ids) => sheet.resolveRange(ids))
    .filter((range): range is CellRange => !!range)
    .map(rangeText)
    .join(' ')
}

/** A1 text of a range, using `A:A`/`1:1` forms for whole columns and rows. */
export function rangeText(range: CellRange): string {
  if (range.top === 0 && range.bottom >= MAX_ROWS - 1) return `${columnName(range.left)}:${columnName(range.right)}`
  if (range.left === 0 && range.right >= MAX_COLS - 1) return `${range.top + 1}:${range.bottom + 1}`
  return rangeName(range)
}

/** Style overrides of a cell including those of its row and column (cell beats row beats column). */
export function cellStyleIndex(sheet: SheetModel, styles: Stylesheet, rowId: string, colId: string, key: string): number | undefined {
  const cellXf = sheet.xf.get(key)
  const rowXf = sheet.rowMeta.get(`${rowId}|xf`) as number | undefined
  const colXf = (sheet.colMeta.get(`${colId}|xf`) as number | undefined) ?? columnTailXf(sheet, colId)
  const base = cellXf ?? rowXf ?? colXf
  const overrides: Partial<StyleProps> = {
    ...sheet.axisOverrides('col', colId),
    ...sheet.axisOverrides('row', rowId),
    ...sheet.cellOverrides(key),
  }
  if (!Object.keys(overrides).length) return base
  return styles.intern(base, overrides)
}

function columnTailXf(sheet: SheetModel, colId: string): number | undefined {
  return columnIntervalProps(sheet, sheet.cols.indexOf(colId)).xf
}

export function writeWorksheet(sheet: SheetModel, context: WorksheetWriteContext): string {
  const document = parseXml((sheet.raw.get('xml') as string | undefined) ?? DEFAULT_WORKSHEET_XML)
  const root = document.documentElement!
  // Some writers prefix every element (`<x:worksheet>`); declaring the namespace as the default
  // too lets the unprefixed rows and elements written here sit in it.
  if (root.prefix && !root.hasAttribute('xmlns')) root.setAttribute('xmlns', SHEET_NS)
  const { rowsXml, used, maxRowLevel } = writeSheetData(sheet, context)

  patchSheetProperties(document, root, sheet)
  const dimension = fragment(document, `<dimension ref="${used ? rangeName(used) : 'A1'}"/>`)
  insertInOrder(root, dimension)
  patchSheetViews(document, root, sheet)
  const { xml: colsXml, maxLevel: maxColLevel } = writeColumns(sheet, context.styles)
  patchSheetFormat(document, root, maxRowLevel, maxColLevel)
  if (colsXml) insertInOrder(root, fragment(document, colsXml))
  const sheetData = child(root, 'sheetData') ?? (() => {
    const element = document.createElementNS(SHEET_NS, 'sheetData')
    insertInOrder(root, element)
    return element
  })()
  // Rows go in as a placeholder replaced in the serialized text: building millions of DOM nodes
  // for them would be slow.
  sheetData.appendChild(document.createComment('PULPO_SHEET_DATA'))

  const filter = sheet.filter.get('value') as AutoFilter | undefined
  if (filter) {
    const xml = writeAutoFilter(sheet, filter)
    if (xml) insertInOrder(root, fragment(document, xml))
    if (filter.sortXml) {
      const range = sheet.resolveRange(filter.range)
      const sort = fragment(document, filter.sortXml)
      if (range) sort.setAttribute('ref', rangeName({ ...range, top: range.top + 1 }))
      insertInOrder(root, sort)
    }
  }
  const merges = sheet.mergedRanges().sort((a, b) => a.range.top - b.range.top || a.range.left - b.range.left || a.range.bottom - b.range.bottom || a.range.right - b.range.right)
  if (merges.length) {
    insertInOrder(root, fragment(document, `<mergeCells count="${merges.length}">${merges.map((merge) => `<mergeCell ref="${rangeName(merge.range)}"/>`).join('')}</mergeCells>`))
  }
  for (const format of orderedEntries(sheet, sheet.cf, (value) => (value as ConditionalFormat).ranges[0]).map(([, value]) => value) as ConditionalFormat[]) {
    const xml = writeConditionalFormat(sheet, format)
    if (xml) insertInOrder(root, fragment(document, xml))
  }
  const validations = writeDataValidations(sheet)
  if (validations) insertInOrder(root, fragment(document, validations))
  const links = writeHyperlinks(sheet, context)
  if (links) insertInOrder(root, fragment(document, links))
  if (context.drawingId && !child(root, 'drawing')) insertInOrder(root, fragment(document, `<drawing r:id="${context.drawingId}"/>`))
  // The notes drawing's relationship is rebuilt, so its id is new.
  for (const legacy of children(root, 'legacyDrawing')) root.removeChild(legacy)
  if (context.legacyDrawingId) insertInOrder(root, fragment(document, `<legacyDrawing r:id="${context.legacyDrawingId}"/>`))
  if (context.tableRelationships.size) {
    const parts = [...context.tableRelationships.values()].map((id) => `<tablePart r:id="${id}"/>`).join('')
    insertInOrder(root, fragment(document, `<tableParts count="${context.tableRelationships.size}">${parts}</tableParts>`))
  }
  const text = tidyNamespaces(serializeNode(document))
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${text.replace('<!--PULPO_SHEET_DATA-->', rowsXml)}`
}

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/**
 * Elements imported from fragments carry their own namespace declarations; drop the ones the
 * root already makes (declaring the relationships prefix there if needed), as Excel writes.
 */
export function tidyNamespaces(xml: string): string {
  const rootStart = xml.search(/<[^?!]/)
  const rootEnd = xml.indexOf('>', rootStart)
  let head = xml.slice(0, rootEnd)
  let body = xml.slice(rootEnd)
  // The root always declares the relationships prefix, as Excel writes it.
  if (!/\sxmlns:r="/.test(head)) head += ` xmlns:r="${R_NS}"`
  for (const [prefix, uri] of [['', SHEET_NS], [':r', R_NS]] as const) {
    if (!head.includes(`xmlns${prefix}="${uri}"`)) continue
    body = body.split(` xmlns${prefix}="${uri}"`).join('')
  }
  return head + body
}

function patchSheetProperties(document: XmlDocument, root: XmlElement, sheet: SheetModel): void {
  let properties = child(root, 'sheetPr')
  const color = sheet.tabColor
  const existing = child(properties, 'tabColor')
  if (existing) properties!.removeChild(existing)
  if (!color) return
  if (!properties) {
    properties = document.createElementNS(SHEET_NS, 'sheetPr')
    insertInOrder(root, properties)
  }
  const tab = document.createElementNS(SHEET_NS, 'tabColor')
  for (const [name, value] of Object.entries(colorAttrs(color))) tab.setAttribute(name, value)
  properties.insertBefore(tab, properties.firstChild)
}

function patchSheetViews(document: XmlDocument, root: XmlElement, sheet: SheetModel): void {
  let views = child(root, 'sheetViews')
  const needed = [...sheet.view.keys()].some((key) => key !== 'topLeft')
  if (!views && !needed) return
  if (!views) {
    views = fragment(document, '<sheetViews><sheetView workbookViewId="0"/></sheetViews>')
    insertInOrder(root, views)
  }
  let view = child(views, 'sheetView')
  if (!view) {
    view = document.createElementNS(SHEET_NS, 'sheetView')
    view.setAttribute('workbookViewId', '0')
    views.appendChild(view)
  }
  const set = (name: string, value: string | undefined) => {
    if (value === undefined) view!.removeAttribute(name)
    else view!.setAttribute(name, value)
  }
  set('showGridLines', sheet.viewProp('showGridLines') === false ? '0' : undefined)
  set('showRowColHeaders', sheet.viewProp('showHeadings') === false ? '0' : undefined)
  set('showZeros', sheet.viewProp('showZeros') === false ? '0' : undefined)
  set('rightToLeft', sheet.viewProp('rightToLeft') ? '1' : undefined)
  const zoom = sheet.viewProp('zoom')
  set('zoomScale', zoom && zoom !== 100 ? String(Math.round(zoom)) : undefined)
  const rows = sheet.viewProp('frozenRows') ?? 0
  const cols = sheet.viewProp('frozenCols') ?? 0
  const pane = child(view, 'pane')
  const wasFrozen = pane && /^frozen/.test(attr(pane, 'state') ?? '')
  const selectionRef = sheet.viewProp('selection') ?? undefined
  const unchanged = wasFrozen && Number(attr(pane, 'ySplit') ?? 0) === rows && Number(attr(pane, 'xSplit') ?? 0) === cols
  if (unchanged) {
    // Same frozen panes as read: keep the pane's scroll position and selections.
  } else if (rows || cols) {
    for (const node of [...children(view, 'pane'), ...children(view, 'selection')]) view.removeChild(node)
    const activePane = rows && cols ? 'bottomRight' : rows ? 'bottomLeft' : 'topRight'
    const paneXml = `<pane${xmlAttrs({ xSplit: cols || undefined, ySplit: rows || undefined, topLeftCell: cellName(rows, cols), activePane, state: 'frozen' })}/>`
    const first = child(view, 'pivotSelection') ?? child(view, 'extLst')
    view.insertBefore(fragment(document, paneXml), first ?? null)
    const panes = rows && cols ? ['topRight', 'bottomLeft', 'bottomRight'] : [activePane]
    for (const name of panes) {
      const active = name === activePane && selectionRef ? selectionRef.split(/\s+/)[0]! : cellName(rows, cols)
      const sqrefText = name === activePane && selectionRef ? selectionRef : active
      view.insertBefore(fragment(document, `<selection pane="${name}" activeCell="${escapeXml(active.split(':')[0]!)}" sqref="${escapeXml(sqrefText)}"/>`), first ?? null)
    }
  } else if (wasFrozen) {
    for (const node of [...children(view, 'pane'), ...children(view, 'selection')]) view.removeChild(node)
  }
  if (!rows && !cols && selectionRef && !pane) {
    for (const node of children(view, 'selection')) view.removeChild(node)
    const active = selectionRef.split(/\s+/)[0]!.split(':')[0]!
    view.insertBefore(fragment(document, `<selection activeCell="${escapeXml(active)}" sqref="${escapeXml(selectionRef)}"/>`), child(view, 'pivotSelection') ?? child(view, 'extLst') ?? null)
  }
}

function patchSheetFormat(document: XmlDocument, root: XmlElement, maxRowLevel: number, maxColLevel: number): void {
  let format = child(root, 'sheetFormatPr')
  if (!format && !maxRowLevel && !maxColLevel) return
  if (!format) {
    format = fragment(document, '<sheetFormatPr defaultRowHeight="15"/>')
    insertInOrder(root, format)
  }
  if (maxRowLevel) format.setAttribute('outlineLevelRow', String(maxRowLevel))
  else format.removeAttribute('outlineLevelRow')
  if (maxColLevel) format.setAttribute('outlineLevelCol', String(maxColLevel))
  else format.removeAttribute('outlineLevelCol')
}

function axisProps(meta: Map<string, unknown> | { get(key: string): unknown }, id: string): Partial<AxisProps> {
  const props: Partial<AxisProps> = {}
  for (const prop of ['size', 'custom', 'hidden', 'level', 'collapsed', 'xf', 'keep'] as const) {
    const value = meta.get(`${id}|${prop}`)
    if (value !== undefined) (props as Record<string, unknown>)[prop] = value
  }
  return props
}

function writeColumns(sheet: SheetModel, styles: Stylesheet): { xml: string; maxLevel: number } {
  const columns = new Map<number, string>()
  let maxLevel = 0
  const owners = new Set<string>()
  for (const key of sheet.colMeta.keys()) owners.add(key.slice(0, key.lastIndexOf('|')))
  let xml = ''
  for (const interval of columnIntervals(sheet)) {
    maxLevel = Math.max(maxLevel, interval.props.level ?? 0)
    const attrs = colAttrs(interval.props)
    if (attrs) xml += `<col min="${interval.from + 1}" max="${interval.to + 1}"${attrs}/>`
  }
  for (const id of [...owners].sort((a, b) => sheet.cols.indexOf(a) - sheet.cols.indexOf(b))) {
    const index = sheet.cols.indexOf(id)
    if (index < 0) continue
    const inherited = columnIntervalProps(sheet, index)
    const props = axisProps(sheet.colMeta, id)
    const overrides = sheet.axisOverrides('col', id)
    const xf = Object.keys(overrides).length ? styles.intern(props.xf ?? inherited.xf, overrides) : props.xf
    const attrs = colAttrs({ ...inherited, ...props, ...(xf !== undefined ? { xf } : {}) })
    if (!attrs) continue
    maxLevel = Math.max(maxLevel, props.level ?? 0)
    columns.set(index, attrs)
  }
  const sorted = [...columns.entries()].sort((a, b) => a[0] - b[0])
  for (let index = 0; index < sorted.length; ) {
    const [start, attrs] = sorted[index]!
    let end = start
    // Neighbors with identical settings share one <col> element.
    while (index + 1 < sorted.length && sorted[index + 1]![0] === end + 1 && sorted[index + 1]![1] === attrs) {
      index++
      end++
    }
    xml += `<col min="${start + 1}" max="${end + 1}"${attrs}/>`
    index++
  }
  return { xml: xml ? `<cols>${xml}</cols>` : '', maxLevel }
}

function colAttrs(props: Partial<AxisProps>): string {
  const width = props.size ?? (props.hidden || props.xf !== undefined || props.level ? 9.140625 : undefined)
  if (width === undefined && !props.hidden && props.xf === undefined && !props.level && !props.collapsed) return ''
  return (
    xmlAttrs({
      width,
      style: props.xf || undefined,
      hidden: props.hidden || undefined,
      customWidth: props.custom || undefined,
      outlineLevel: props.level || undefined,
      collapsed: props.collapsed || undefined,
    }) +
    Object.entries(props.keep ?? {})
      .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
      .join('')
  )
}

interface RowEntry {
  cells: Map<number, string>
}

function writeSheetData(sheet: SheetModel, context: WorksheetWriteContext): { rowsXml: string; used: CellRange | undefined; maxRowLevel: number } {
  const rows = new Map<number, RowEntry>()
  const { styles } = context
  let top = Infinity
  let left = Infinity
  let bottom = -1
  let right = -1
  const entry = (row: number) => {
    let found = rows.get(row)
    if (!found) {
      found = { cells: new Map() }
      rows.set(row, found)
    }
    return found
  }
  const touch = (row: number, col: number) => {
    top = Math.min(top, row)
    left = Math.min(left, col)
    bottom = Math.max(bottom, row)
    right = Math.max(right, col)
  }
  const keys = new Set<string>(sheet.cells.keys())
  for (const key of sheet.xf.keys()) keys.add(key)
  for (const key of sheet.fmt.keys()) keys.add(key.slice(0, key.lastIndexOf('|')))
  // Results spilled by dynamic arrays are written as plain values (Excel does the same).
  const spilled = new Map<string, CellScalar | { e: string }>()
  for (const [key, data] of orderedEntries(sheet, sheet.cells)) {
    if (!data.f || !(data.dynamic || data.array)) continue
    const position = sheet.position(key)
    if (!position) continue
    const values = context.spills?.(sheet, position.row, position.col) ?? data.spillCache
    if (!values) continue
    values.forEach((rowValues, dr) =>
      rowValues.forEach((value, dc) => {
        if (!dr && !dc) return
        const row = position.row + dr
        const col = position.col + dc
        if (row >= MAX_ROWS || col >= MAX_COLS) return
        const memberKey = sheet.keyAt(row, col)
        if (sheet.cells.has(memberKey)) return
        spilled.set(`${row}:${col}`, value)
        keys.add(memberKey)
      }),
    )
  }
  for (const [key] of orderedEntries(sheet, [...keys].map((key) => [key, null]))) {
    const ids = splitCellKey(key)
    const row = sheet.rows.indexOf(ids.row)
    const col = sheet.cols.indexOf(ids.col)
    if (row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS) continue
    const data = sheet.cells.get(key)
    const style = cellStyleIndex(sheet, styles, ids.row, ids.col, key)
    const spill = spilled.get(`${row}:${col}`)
    const xml = data ? writeCell(sheet, row, col, data, style, context) : spill !== undefined ? writeValueCell(row, col, spill, style, context) : style ? `<c r="${cellName(row, col)}" s="${style}"/>` : ''
    if (!xml) continue
    entry(row).cells.set(col, xml)
    touch(row, col)
  }
  // Rows with properties but no cells still need a <row>.
  const rowOwners = new Set<string>()
  for (const key of sheet.rowMeta.keys()) rowOwners.add(key.slice(0, key.lastIndexOf('|')))
  let maxRowLevel = 0
  const rowAttrs = new Map<number, string>()
  for (const id of [...rowOwners].sort((a, b) => sheet.rows.indexOf(a) - sheet.rows.indexOf(b))) {
    const index = sheet.rows.indexOf(id)
    if (index < 0 || index >= MAX_ROWS) continue
    const props = axisProps(sheet.rowMeta, id)
    const overrides = sheet.axisOverrides('row', id)
    const xf = Object.keys(overrides).length ? styles.intern(props.xf, overrides) : props.xf
    maxRowLevel = Math.max(maxRowLevel, props.level ?? 0)
    const attrs =
      xmlAttrs({
        s: xf !== undefined ? xf : undefined,
        customFormat: xf !== undefined ? true : undefined,
        ht: props.size,
        hidden: props.hidden || undefined,
        customHeight: props.custom || undefined,
        outlineLevel: props.level || undefined,
        collapsed: props.collapsed || undefined,
      }) +
      Object.entries(props.keep ?? {})
        .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
        .join('')
    if (!attrs) continue
    rowAttrs.set(index, attrs)
    entry(index)
  }
  const sortedRows = [...rows.keys()].sort((a, b) => a - b)
  let rowsXml = ''
  for (const row of sortedRows) {
    const cells = rows.get(row)!.cells
    const cols = [...cells.keys()].sort((a, b) => a - b)
    rowsXml += `<row r="${row + 1}"${rowAttrs.get(row) ?? ''}>`
    for (const col of cols) rowsXml += cells.get(col)!
    rowsXml += '</row>'
  }
  return { rowsXml, used: bottom >= 0 ? { top, left, bottom, right } : undefined, maxRowLevel }
}

function errorOrValue(value: CellScalar | { e: string } | undefined): { v: CellScalar; error: boolean } {
  if (value !== null && typeof value === 'object') return { v: value.e, error: true }
  return { v: value ?? null, error: false }
}

function writeValueCell(row: number, col: number, value: CellScalar | { e: string }, style: number | undefined, context: WorksheetWriteContext): string {
  const { v, error } = errorOrValue(value)
  const ref = cellName(row, col)
  const s = style ? ` s="${style}"` : ''
  if (v === null) return style ? `<c r="${ref}"${s}/>` : ''
  if (error) return `<c r="${ref}"${s} t="e"><v>${escapeXml(String(v))}</v></c>`
  if (typeof v === 'boolean') return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`
  if (typeof v === 'number') return `<c r="${ref}"${s}><v>${numberText(v)}</v></c>`
  return `<c r="${ref}"${s} t="s"><v>${context.strings.add({ text: v })}</v></c>`
}

/** Numbers as Excel writes them: shortest round-tripping text, no `+` in exponents. */
export function numberText(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return String(value).replace('e+', 'E').replace('e-', 'E-')
}

function writeCell(sheet: SheetModel, row: number, col: number, data: CellData, style: number | undefined, context: WorksheetWriteContext): string {
  const ref = cellName(row, col)
  const extraAttrs = Object.entries(data.keep?.c ?? {})
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join('')
  const s = style ? ` s="${style}"` : ''
  const extra = data.keep?.extra ?? ''
  if (data.keep?.fText !== undefined && data.keep.f) {
    // A data table formula, kept as read with its cached value.
    const { v, error } = errorOrValue(data.t === 'e' ? { e: String(data.v) } : (data.v ?? null))
    const fAttrs = Object.entries(data.keep.f)
      .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
      .join('')
    return `<c r="${ref}"${s}${valueType(v, error, true)}${extraAttrs}><f${fAttrs}>${escapeXml(data.keep.fText)}</f>${valueXml(v, context, true)}${extra}</c>`
  }
  if (data.f !== undefined) {
    const current = toA1Form(data.f, sheet)
    const formula = data.keep?.fa !== undefined && data.keep.fc === current ? data.keep.fa : current
    const computed = context.values?.(sheet, row, col, data)
    const cached = computed !== undefined ? computed : data.t === 'e' ? { e: String(data.v) } : (data.v ?? null)
    const { v, error } = errorOrValue(cached)
    const fAttrs: Record<string, string> = { ...(data.keep?.f ?? {}) }
    let refAttr = ''
    let cellAttrs = extraAttrs
    const spill = data.array || data.dynamic ? (context.spills?.(sheet, row, col) ?? data.spillCache) : undefined
    // Legacy array formulas always cover their range; a dynamic-array formula is written as an
    // array (with the dynamic-array cell metadata, `cm`) when it spills or was one in the file.
    const hadMetadata = data.keep?.c?.cm !== undefined
    // Oversized arrays keep their original attributes without constructing a spill.
    if (!data.oversizedArray && (data.array || (data.dynamic && (spill || hadMetadata)))) {
      const rows = spill?.length ?? data.array?.rows ?? 1
      const cols = spill?.[0]?.length ?? data.array?.cols ?? 1
      refAttr = ` t="array" ref="${rangeName({ top: row, left: col, bottom: Math.min(MAX_ROWS - 1, row + rows - 1), right: Math.min(MAX_COLS - 1, col + cols - 1) })}"`
      if (data.dynamic && !hadMetadata) {
        const cm = context.dynamicArrayMetadata?.()
        if (cm) cellAttrs += ` cm="${cm}"`
      }
    }
    const fAttrText = Object.entries(fAttrs)
      .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
      .join('')
    return `<c r="${ref}"${s}${valueType(v, error, true)}${cellAttrs}><f${refAttr}${fAttrText}>${escapeXml(formula)}</f>${valueXml(v, context, true)}${extra}</c>`
  }
  if (data.runs?.length || typeof data.v === 'string') {
    if (data.t === 'e') return `<c r="${ref}"${s} t="e"${extraAttrs}><v>${escapeXml(String(data.v))}</v>${extra}</c>`
    const index = context.strings.add({ text: String(data.v ?? ''), ...(data.runs ? { runs: data.runs } : {}), ...(data.phonetic ? { phonetic: data.phonetic } : {}) })
    return `<c r="${ref}"${s} t="s"${extraAttrs}><v>${index}</v>${extra}</c>`
  }
  if (typeof data.v === 'boolean') return `<c r="${ref}"${s} t="b"${extraAttrs}><v>${data.v ? 1 : 0}</v>${extra}</c>`
  if (typeof data.v === 'number') {
    const kept = data.keep?.v !== undefined && Math.abs(data.v) === Number.MAX_VALUE && Math.sign(Number(data.keep.v)) === Math.sign(data.v) ? escapeXml(data.keep.v) : undefined
    return `<c r="${ref}"${s}${extraAttrs}><v>${kept ?? numberText(data.v)}</v>${extra}</c>`
  }
  return style || extraAttrs || extra ? `<c r="${ref}"${s}${extraAttrs}>${extra}</c>` : ''
}

function valueType(value: CellScalar, error: boolean, formula: boolean): string {
  if (error) return ' t="e"'
  if (typeof value === 'boolean') return ' t="b"'
  if (typeof value === 'string') return formula ? ' t="str"' : ' t="s"'
  return ''
}

function valueXml(value: CellScalar, context: WorksheetWriteContext, formula: boolean): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return `<v>${value ? 1 : 0}</v>`
  if (typeof value === 'number') return `<v>${numberText(value)}</v>`
  if (formula) return `<v${needsPreserve(value) ? ' xml:space="preserve"' : ''}>${encodeSheetText(value)}</v>`
  return `<v>${context.strings.add({ text: value })}</v>`
}

function cfValueXml(value: CfValue, sheet: SheetModel): string {
  const val = value.value === undefined ? undefined : value.type === 'formula' ? toA1Form(value.value, sheet, sheet.workbook, { followDeletedRelative: true }) : value.value
  return `<cfvo${xmlAttrs({ type: value.type, val, gte: value.gte === false ? false : undefined })}/>`
}

function ruleXml(sheet: SheetModel, rule: ConditionalRule): string {
  if (rule.xml) {
    // Unedited rules go back as read, with formulas and priority brought up to date.
    const element = parseXml(rule.xml).documentElement!
    element.setAttribute('priority', String(rule.priority))
    const formulas = children(element, 'formula')
    formulas.forEach((formula, index) => {
      const text = rule.formulas?.[index]
      if (text !== undefined) formula.textContent = toA1Form(text, sheet, sheet.workbook, { followDeletedRelative: true })
    })
    for (const cfvos of ['colorScale', 'dataBar', 'iconSet']) {
      const container = child(element, cfvos)
      const values = rule.colorScale?.values ?? rule.dataBar?.values ?? rule.iconSet?.values
      if (!container || !values) continue
      children(container, 'cfvo').forEach((cfvo, index) => {
        const value = values[index]
        if (value?.type === 'formula' && value.value !== undefined) cfvo.setAttribute('val', toA1Form(value.value, sheet, sheet.workbook, { followDeletedRelative: true }))
      })
    }
    return serializeNode(element)
  }
  const attrs = xmlAttrs({
    type: rule.type,
    dxfId: rule.dxfId,
    priority: rule.priority,
    stopIfTrue: rule.stopIfTrue || undefined,
    operator: rule.operator,
    text: rule.text,
    timePeriod: rule.timePeriod,
    rank: rule.rank,
    percent: rule.percent || undefined,
    bottom: rule.bottom || undefined,
    aboveAverage: rule.aboveAverage === false ? false : undefined,
    equalAverage: rule.equalAverage || undefined,
    stdDev: rule.stdDev,
  })
  let body = ''
  if (rule.colorScale) body += `<colorScale>${rule.colorScale.values.map((value) => cfValueXml(value, sheet)).join('')}${rule.colorScale.colors.map((color) => `<color${xmlAttrs(colorAttrs(color))}/>`).join('')}</colorScale>`
  if (rule.dataBar) body += `<dataBar${xmlAttrs({ minLength: rule.dataBar.minLength, maxLength: rule.dataBar.maxLength, showValue: rule.dataBar.showValue === false ? false : undefined })}>${rule.dataBar.values.map((value) => cfValueXml(value, sheet)).join('')}<color${xmlAttrs(colorAttrs(rule.dataBar.color))}/></dataBar>`
  if (rule.iconSet) body += `<iconSet${xmlAttrs({ iconSet: rule.iconSet.set, reverse: rule.iconSet.reverse || undefined, showValue: rule.iconSet.showValue === false ? false : undefined })}>${rule.iconSet.values.map((value) => cfValueXml(value, sheet)).join('')}</iconSet>`
  for (const formula of rule.formulas ?? []) body += `<formula>${escapeXml(toA1Form(formula, sheet, sheet.workbook, { followDeletedRelative: true }))}</formula>`
  return `<cfRule${attrs}>${body}</cfRule>`
}

function writeConditionalFormat(sheet: SheetModel, format: ConditionalFormat): string | undefined {
  const ref = sqref(sheet, format.ranges)
  if (!ref || !format.rules.length) return undefined
  const attrs = Object.entries(format.keep ?? {})
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join('')
  return `<conditionalFormatting sqref="${ref}"${attrs}>${format.rules.map((rule) => ruleXml(sheet, rule)).join('')}</conditionalFormatting>`
}

function writeDataValidations(sheet: SheetModel): string | undefined {
  let xml = ''
  let count = 0
  for (const validation of orderedEntries(sheet, sheet.dv, (value) => (value as DataValidation).ranges[0]).map(([, value]) => value) as DataValidation[]) {
    const ref = sqref(sheet, validation.ranges)
    if (!ref) continue
    count++
    const attrs = xmlAttrs({
      type: validation.type === 'none' ? undefined : validation.type,
      errorStyle: validation.errorStyle && validation.errorStyle !== 'stop' ? validation.errorStyle : undefined,
      operator: validation.operator,
      allowBlank: validation.allowBlank || undefined,
      showDropDown: validation.showDropDown || undefined,
      showInputMessage: validation.showInputMessage || undefined,
      showErrorMessage: validation.showErrorMessage || undefined,
      errorTitle: validation.errorTitle,
      error: validation.error,
      promptTitle: validation.promptTitle,
      prompt: validation.prompt,
      sqref: ref,
    }) +
      Object.entries(validation.keep ?? {})
        .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
        .join('')
    const formula1 = validation.formula1 !== undefined ? `<formula1>${escapeXml(toA1Form(validation.formula1, sheet, sheet.workbook, { followDeletedRelative: true }))}</formula1>` : ''
    const formula2 = validation.formula2 !== undefined ? `<formula2>${escapeXml(toA1Form(validation.formula2, sheet, sheet.workbook, { followDeletedRelative: true }))}</formula2>` : ''
    xml += `<dataValidation${attrs}>${formula1}${formula2}</dataValidation>`
  }
  return count ? `<dataValidations count="${count}">${xml}</dataValidations>` : undefined
}

function writeHyperlinks(sheet: SheetModel, context: WorksheetWriteContext): string | undefined {
  let xml = ''
  for (const [key, raw] of orderedEntries(sheet, sheet.links)) {
    const link = raw as Hyperlink
    const position = sheet.position(key)
    if (!position) continue
    const range = link.range ? sheet.resolveRange(link.range) : undefined
    const ref = range ? rangeName(range) : cellName(position.row, position.col)
    const id = link.target ? context.addRelationship('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', link.target, true) : undefined
    xml += `<hyperlink${xmlAttrs({ ref, 'r:id': id, location: link.location, tooltip: link.tooltip, display: link.display })}/>`
  }
  return xml ? `<hyperlinks>${xml}</hyperlinks>` : undefined
}

function writeAutoFilter(sheet: SheetModel, filter: AutoFilter): string | undefined {
  const range = sheet.resolveRange(filter.range)
  if (!range) return undefined
  const width = range.right - range.left + 1
  const columns = filter.columns
    .filter((column) => column.col < width)
    .map((column) => {
      if (column.values && !column.xml?.includes('customFilters') && !column.xml?.includes('top10') && !column.xml?.includes('dynamicFilter') && !column.xml?.includes('colorFilter') && !column.xml?.includes('iconFilter')) {
        const blank = column.values.includes('')
        const values = column.values.filter((value) => value !== '')
        return `<filterColumn colId="${column.col}"><filters${blank ? ' blank="1"' : ''}>${values.map((value) => `<filter val="${escapeXml(value)}"/>`).join('')}</filters></filterColumn>`
      }
      return column.xml ? column.xml.replace(/colId="\d+"/, `colId="${column.col}"`) : ''
    })
    .join('')
  // The last sort (and extensions) stay while the filter covers the same cells it was read with.
  const ref = rangeName(range)
  const kept = filter.xml && new RegExp(`^<(?:\\w+:)?autoFilter\\b[^>]*\\bref="${ref}"`).test(filter.xml) ? keptFilterChildren(filter.xml) : ''
  return `<autoFilter ref="${ref}">${columns}${kept}</autoFilter>`
}

/** An autofilter's `sortState` and `extLst`, as written. */
function keptFilterChildren(xml: string): string {
  return [...xml.matchAll(/<((?:\w+:)?(?:sortState|extLst))\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g)].map((match) => match[0]).join('')
}

/** The table part XML with its range, columns, and autofilter updated. */
export function writeTablePart(sheet: SheetModel, table: SheetTable, id: number, headerNames?: string[]): string | undefined {
  const range = sheet.resolveRange(table.range)
  if (!range) return undefined
  const document = parseXml(table.xml || `<table xmlns="${SHEET_NS}" id="${id}" name="${escapeXml(table.name)}" displayName="${escapeXml(table.displayName)}" ref="A1"><autoFilter ref="A1"/><tableColumns count="0"/><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`)
  const root = document.documentElement!
  // A table that hasn't moved keeps its autofilter as written (LibreOffice includes the totals row).
  const moved = root.getAttribute('ref') !== rangeName(range)
  root.setAttribute('ref', rangeName(range))
  root.setAttribute('name', table.name)
  root.setAttribute('displayName', table.displayName)
  const filter = child(root, 'autoFilter')
  if (filter && (moved || !filter.getAttribute('ref'))) filter.setAttribute('ref', rangeName(table.totalsRow ? { ...range, bottom: range.bottom - 1 } : range))
  const width = range.right - range.left + 1
  const columns = child(root, 'tableColumns')
  if (columns) {
    const existing = children(columns, 'tableColumn')
    for (const node of existing) columns.removeChild(node)
    const names = table.columns.slice(0, width).map((column, index) => ({ ...column, name: headerNames?.[index] || column.name }))
    while (names.length < width) names.push({ name: headerNames?.[names.length] || `Column${names.length + 1}` })
    let nextId = 1
    for (const node of existing) nextId = Math.max(nextId, (Number(node.getAttribute('id')) || 0) + 1)
    for (const column of names) {
      const element = column.xml ? (document.importNode(parseXml(column.xml).documentElement!, true) as XmlElement) : document.createElementNS(SHEET_NS, 'tableColumn')
      if (!element.getAttribute('id')) element.setAttribute('id', String(nextId++))
      element.setAttribute('name', column.name)
      columns.appendChild(element)
    }
    columns.setAttribute('count', String(names.length))
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${serializeNode(root)}`
}
