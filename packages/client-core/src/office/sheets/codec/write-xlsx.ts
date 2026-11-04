import type * as Y from 'yjs'
import type { LiveAssetStore } from '../../live-format.js'
import { CONTENT_TYPES_NS, OoxmlPackage, PACKAGE_RELATIONSHIPS_NS, parseXml, relationshipsPathFor, relativeTarget, resolveTarget, serializeXml, type XmlDocument } from '../../ooxml/package.js'
import { toA1Form } from '../model/formula-ids.js'
import type { DefinedName, SheetFormat, SheetKind, SheetTable } from '../model/schema.js'
import { WorkbookModel, type SheetModel } from '../model/workbook.js'
import { DEFAULT_STYLES_XML, Stylesheet } from '../styles/stylesheet.js'
import { writeDrawing } from './drawing.js'
import { writeComments, writeNotesVml } from './notes.js'
import { readSharedStrings, SharedStringTable } from './strings.js'
import { writeTablePart, writeWorksheet, type ValueSource, type WorksheetWriteContext } from './write-worksheet.js'
import { children, CONTENT_TYPES, escapeXml, REL_TYPES, SHEET_NS, type XmlElement } from './xml.js'
import { DEFAULT_THEME_XML } from './default-theme.js'

export interface XlsxWriteOptions {
  /** The format to write; defaults to the format the workbook was read as. */
  format?: SheetFormat
  /** Current values of formula cells (from the calculation engine); default: cached values. */
  values?: ValueSource
  spills?: WorksheetWriteContext['spills']
  /** Ask Excel to recalculate everything when the file is opened (when values may be stale). */
  recalculateOnLoad?: boolean
}

const MAIN_CONTENT_TYPE: Record<SheetFormat, string> = {
  xlsx: CONTENT_TYPES.workbook,
  xlsm: CONTENT_TYPES.workbookMacro,
  xltx: CONTENT_TYPES.template,
  xltm: CONTENT_TYPES.templateMacro,
  csv: CONTENT_TYPES.workbook,
  tsv: CONTENT_TYPES.workbook,
}

const SHEET_REL_TYPES: Record<SheetKind, string> = {
  worksheet: REL_TYPES.worksheet,
  chartsheet: REL_TYPES.chartsheet,
  dialogsheet: REL_TYPES.dialogsheet,
  macrosheet: REL_TYPES.macrosheet,
}

const VBA_REL = 'http://schemas.microsoft.com/office/2006/relationships/vbaProject'

const EMPTY_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`

/** A relationships part being edited. */
class Rels {
  readonly document: XmlDocument

  constructor(xml: string | undefined) {
    this.document = parseXml(xml ?? EMPTY_RELS)
  }

  private get elements(): XmlElement[] {
    return children(this.document.documentElement!, 'Relationship')
  }

  list(): { id: string; type: string; target: string; external: boolean }[] {
    return this.elements.map((element) => ({
      id: element.getAttribute('Id') ?? '',
      type: element.getAttribute('Type') ?? '',
      target: element.getAttribute('Target') ?? '',
      external: element.getAttribute('TargetMode') === 'External',
    }))
  }

  remove(test: (rel: { id: string; type: string; target: string }) => boolean): void {
    for (const element of this.elements) {
      const rel = { id: element.getAttribute('Id') ?? '', type: element.getAttribute('Type') ?? '', target: element.getAttribute('Target') ?? '' }
      if (test(rel)) this.document.documentElement!.removeChild(element)
    }
  }

  add(type: string, target: string, external = false): string {
    const taken = new Set(this.list().map((rel) => rel.id))
    let next = taken.size + 1
    while (taken.has(`rId${next}`)) next++
    const id = `rId${next}`
    const element = this.document.createElementNS(PACKAGE_RELATIONSHIPS_NS, 'Relationship')
    element.setAttribute('Id', id)
    element.setAttribute('Type', type)
    element.setAttribute('Target', target)
    if (external) element.setAttribute('TargetMode', 'External')
    this.document.documentElement!.appendChild(element)
    return id
  }

  /** The id of a relationship of `type` to `target` (relative), adding it if missing. */
  ensure(type: string, target: string): string {
    return this.list().find((rel) => rel.type === type && rel.target === target)?.id ?? this.add(type, target)
  }

  get empty(): boolean {
    return this.elements.length === 0
  }

  toXml(): string {
    return serializeXml(this.document)
  }
}

/** [Content_Types].xml being edited. */
class ContentTypes {
  readonly document: XmlDocument

  constructor(xml: string | undefined) {
    this.document = parseXml(xml ?? `<Types xmlns="${CONTENT_TYPES_NS}"><Default Extension="rels" ContentType="${CONTENT_TYPES.relationships}"/><Default Extension="xml" ContentType="application/xml"/></Types>`)
  }

  override(path: string, contentType: string): void {
    const partName = `/${path}`
    const root = this.document.documentElement!
    for (const element of children(root, 'Override')) {
      if (element.getAttribute('PartName')?.toLowerCase() === partName.toLowerCase()) {
        element.setAttribute('ContentType', contentType)
        return
      }
    }
    const element = this.document.createElementNS(CONTENT_TYPES_NS, 'Override')
    element.setAttribute('PartName', partName)
    element.setAttribute('ContentType', contentType)
    root.appendChild(element)
  }

  defaultFor(extension: string, contentType: string): void {
    const root = this.document.documentElement!
    if (children(root, 'Default').some((element) => element.getAttribute('Extension')?.toLowerCase() === extension)) return
    const element = this.document.createElementNS(CONTENT_TYPES_NS, 'Default')
    element.setAttribute('Extension', extension)
    element.setAttribute('ContentType', contentType)
    root.insertBefore(element, root.firstChild)
  }

  /** Drops overrides for parts that are not in the package. */
  prune(paths: Set<string>): void {
    const root = this.document.documentElement!
    const lower = new Set([...paths].map((path) => `/${path}`.toLowerCase()))
    for (const element of children(root, 'Override')) {
      if (!lower.has((element.getAttribute('PartName') ?? '').toLowerCase())) root.removeChild(element)
    }
  }

  toXml(): string {
    return serializeXml(this.document)
  }
}

function freePath(taken: (path: string) => boolean, pattern: (n: number) => string): string {
  for (let n = 1; ; n++) if (!taken(pattern(n))) return pattern(n)
}

/** Writes the workbook in `doc` as xlsx/xlsm/xltx bytes. */
export async function writeXlsx(doc: Y.Doc, assets: LiveAssetStore, options: XlsxWriteOptions = {}): Promise<Uint8Array> {
  const model = new WorkbookModel(doc)
  const format = options.format && options.format !== 'csv' && options.format !== 'tsv' ? options.format : (model.metaValue('format') ?? 'xlsx')
  const outputFormat: SheetFormat = format === 'csv' || format === 'tsv' ? 'xlsx' : format
  const pkg = new OoxmlPackage()
  for (const [path, part] of model.parts) pkg.set(path, await assets.get(part.hash))

  const workbookPath = model.metaValue('workbookPath') ?? 'xl/workbook.xml'
  const types = new ContentTypes(model.metaValue('contentTypesXml'))
  const rootRels = new Rels(pkg.text('_rels/.rels'))
  rootRels.remove((rel) => rel.type === REL_TYPES.officeDocument)
  rootRels.add(REL_TYPES.officeDocument, workbookPath)
  // Keep the workbook relationship first, as Excel writes it.
  const rootElement = rootRels.document.documentElement!
  const officeRel = children(rootElement, 'Relationship').find((element) => element.getAttribute('Type') === REL_TYPES.officeDocument)!
  // (xmldom breaks when a node is inserted before itself.)
  if (rootElement.firstChild !== officeRel) rootElement.insertBefore(officeRel, rootElement.firstChild)
  types.override(workbookPath, MAIN_CONTENT_TYPE[outputFormat])

  const workbookRels = new Rels(model.metaValue('workbookRels'))
  workbookRels.remove((rel) => rel.type === REL_TYPES.calcChain || rel.type === REL_TYPES.sharedStrings)
  // Saving a macro-enabled workbook as .xlsx/.xltx drops its macros, as Excel does.
  if (outputFormat === 'xlsx' || outputFormat === 'xltx') workbookRels.remove((rel) => rel.type === VBA_REL)

  const styles = new Stylesheet(model.metaValue('stylesXml') ?? DEFAULT_STYLES_XML)
  const strings = new SharedStringTable()
  const seed = model.metaValue('sharedStringsSeed')
  if (seed) for (const item of readSharedStrings(seed)) strings.add(item, true)
  const sheets = model.sheets()
  const sheetEntries: string[] = []
  const usedSheetIds = new Set(sheets.map((sheet) => sheet.raw.get('sheetId') as number | undefined).filter((id): id is number => id !== undefined))
  let nextSheetId = Math.max(0, ...usedSheetIds) + 1
  const livePaths = new Set<string>()
  const taken = (path: string) => pkg.has(path) || livePaths.has(path)
  const sheetPaths = new Map<string, string>()

  // Assign every sheet its part first, so formulas and rels can refer to each other.
  for (const sheet of sheets) {
    let path = sheet.raw.get('part') as string | undefined
    const kind = (sheet.map.get('kind') as SheetKind | undefined) ?? 'worksheet'
    if (!path || (livePaths.has(path) && kind === 'worksheet')) {
      path = freePath(taken, (n) => `xl/worksheets/sheet${n}.xml`)
    }
    livePaths.add(path)
    sheetPaths.set(sheet.id, path)
  }
  // Relationships to sheets that no longer exist go; existing ones keep their ids.
  const wanted = new Set(sheets.map((sheet) => sheetPaths.get(sheet.id)))
  workbookRels.remove((rel) => Object.values(SHEET_REL_TYPES).includes(rel.type as never) && !wanted.has(resolveTarget(workbookPath, rel.target)))

  let tableId = 1
  const tableNames = new Set<string>()
  for (const sheet of sheets) {
    const path = sheetPaths.get(sheet.id)!
    const kind = (sheet.map.get('kind') as SheetKind | undefined) ?? 'worksheet'
    const relTarget = relativeTarget(workbookPath, path)
    const existing = workbookRels.list().find((rel) => rel.type === SHEET_REL_TYPES[kind] && resolveTarget(workbookPath, rel.target) === path)
    const relId = existing?.id ?? workbookRels.add(SHEET_REL_TYPES[kind], relTarget)
    let sheetId = sheet.raw.get('sheetId') as number | undefined
    if (sheetId === undefined || sheetEntries.some((entry) => entry.includes(` sheetId="${sheetId}"`))) sheetId = nextSheetId++
    const keep = Object.entries((sheet.raw.get('keep') as Record<string, string> | undefined) ?? {})
      .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
      .join('')
    const state = sheet.state === 'visible' ? '' : ` state="${sheet.state}"`
    sheetEntries.push(`<sheet name="${escapeXml(sheet.name)}" sheetId="${sheetId}"${state}${keep} r:id="${relId}"/>`)
    if (kind !== 'worksheet') continue

    const relsPath = relationshipsPathFor(path)
    const rels = new Rels(sheet.raw.get('rels') as string | undefined)
    // Rebuilt below from the model.
    rels.remove((rel) => rel.type === REL_TYPES.hyperlink || rel.type === REL_TYPES.table || rel.type === REL_TYPES.comments || rel.type === REL_TYPES.vmlDrawing)
    const tableRelationships = new Map<string, string>()
    for (const [id, raw] of sheet.tables) {
      const table = raw as SheetTable
      let name = table.name
      while (tableNames.has(name.toLowerCase())) name = `${table.name}_${tableNames.size + 1}`
      tableNames.add(name.toLowerCase())
      const tablePath = table.part && !livePaths.has(table.part) ? table.part : freePath(taken, (n) => `xl/tables/table${n}.xml`)
      const xml = writeTablePart(sheet, { ...table, name, displayName: name === table.name ? table.displayName : name }, tableId++, headerNames(sheet, table))
      if (!xml) continue
      livePaths.add(tablePath)
      pkg.set(tablePath, new TextEncoder().encode(xml))
      types.override(tablePath, CONTENT_TYPES.table)
      tableRelationships.set(id, rels.add(REL_TYPES.table, relativeTarget(path, tablePath)))
    }
    let legacyDrawingId: string | undefined
    const comments = writeComments(sheet)
    if (comments) {
      const commentsPath = (sheet.raw.get('commentsPart') as string | undefined) ?? freePath(taken, (n) => `xl/comments${n}.xml`)
      livePaths.add(commentsPath)
      pkg.set(commentsPath, new TextEncoder().encode(comments))
      types.override(commentsPath, CONTENT_TYPES.comments)
      rels.add(REL_TYPES.comments, relativeTarget(path, commentsPath))
    }
    const vmlPath = (sheet.raw.get('vmlPart') as string | undefined) ?? (comments ? freePath(taken, (n) => `xl/drawings/vmlDrawing${n}.vml`) : undefined)
    const vml = vmlPath && (sheet.raw.has('vmlXml') || comments) ? writeNotesVml(sheet) : undefined
    if (vmlPath && (vml || pkg.has(vmlPath))) {
      if (vml) pkg.set(vmlPath, new TextEncoder().encode(vml))
      livePaths.add(vmlPath)
      types.defaultFor('vml', CONTENT_TYPES.vmlDrawing)
      legacyDrawingId = rels.add(REL_TYPES.vmlDrawing, relativeTarget(path, vmlPath))
    }
    const drawingPath = sheet.raw.get('drawingPart') as string | undefined
    if (drawingPath) {
      pkg.set(drawingPath, new TextEncoder().encode(writeDrawing(sheet, sheet.raw.get('drawingXml') as string)))
      const drawingRels = sheet.raw.get('drawingRels') as string | undefined
      if (drawingRels) pkg.set(relationshipsPathFor(drawingPath), new TextEncoder().encode(drawingRels))
      types.override(drawingPath, CONTENT_TYPES.drawing)
    }
    const context: WorksheetWriteContext = {
      styles,
      strings,
      ...(options.values ? { values: options.values } : {}),
      ...(options.spills ? { spills: options.spills } : {}),
      addRelationship: (type, target, external) => rels.add(type, target, external),
      tableRelationships,
      ...(legacyDrawingId ? { legacyDrawingId } : {}),
    }
    pkg.set(path, new TextEncoder().encode(writeWorksheet(sheet, context)))
    types.override(path, CONTENT_TYPES.worksheet)
    if (!rels.empty) pkg.set(relsPath, new TextEncoder().encode(rels.toXml()))
    else pkg.delete(relsPath)
  }

  // Shared strings and styles.
  if (strings.size) {
    const sharedStringsPath = model.metaValue('sharedStringsPath') ?? 'xl/sharedStrings.xml'
    pkg.set(sharedStringsPath, new TextEncoder().encode(strings.toXml()))
    types.override(sharedStringsPath, CONTENT_TYPES.sharedStrings)
    workbookRels.add(REL_TYPES.sharedStrings, relativeTarget(workbookPath, sharedStringsPath))
  }
  const stylesPath = model.metaValue('stylesPath') ?? 'xl/styles.xml'
  pkg.set(stylesPath, new TextEncoder().encode(styles.toXml()))
  types.override(stylesPath, CONTENT_TYPES.styles)
  workbookRels.ensure(REL_TYPES.styles, relativeTarget(workbookPath, stylesPath))
  if (!workbookRels.list().some((rel) => rel.type === REL_TYPES.theme)) {
    const themePath = 'xl/theme/theme1.xml'
    if (!pkg.has(themePath)) pkg.set(themePath, new TextEncoder().encode(model.metaValue('themeXml') ?? DEFAULT_THEME_XML))
    types.override(themePath, CONTENT_TYPES.theme)
    workbookRels.add(REL_TYPES.theme, relativeTarget(workbookPath, themePath))
  }

  // The workbook part.
  const workbook = parseXml(model.metaValue('workbookXml') ?? DEFAULT_WORKBOOK_XML)
  patchWorkbook(workbook, model, sheetEntries, options)
  pkg.set(workbookPath, new TextEncoder().encode(serializeXml(workbook)))
  pkg.set(relationshipsPathFor(workbookPath), new TextEncoder().encode(workbookRels.toXml()))
  pkg.set('_rels/.rels', new TextEncoder().encode(rootRels.toXml()))
  types.defaultFor('rels', CONTENT_TYPES.relationships)
  types.defaultFor('xml', 'application/xml')

  pruneUnreachable(pkg)
  types.prune(new Set(pkg.paths()))
  pkg.set('[Content_Types].xml', new TextEncoder().encode(types.toXml()))
  return pkg.write()
}

function headerNames(sheet: SheetModel, table: SheetTable): string[] | undefined {
  if (!table.headerRow) return undefined
  const range = sheet.resolveRange(table.range)
  if (!range) return undefined
  const names: string[] = []
  for (let col = range.left; col <= range.right; col++) {
    const value = sheet.cell(range.top, col)?.v
    names.push(value === undefined || value === null ? '' : String(value))
  }
  return names
}

/** Workbook children in CT_Workbook order. */
const WORKBOOK_ORDER = ['fileVersion', 'fileSharing', 'workbookPr', 'workbookProtection', 'bookViews', 'sheets', 'functionGroups', 'externalReferences', 'definedNames', 'calcPr', 'oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst']

function insertWorkbookChild(root: XmlElement, element: XmlElement): void {
  const position = WORKBOOK_ORDER.indexOf(element.localName ?? '')
  const next = children(root).find((node) => WORKBOOK_ORDER.indexOf(node.localName ?? '') > position)
  root.insertBefore(element, next ?? null)
}

function patchWorkbook(document: XmlDocument, model: WorkbookModel, sheetEntries: string[], options: XlsxWriteOptions): void {
  const root = document.documentElement!
  for (const name of ['sheets', 'definedNames']) for (const element of children(root, name)) root.removeChild(element)
  const wrap = (xml: string) =>
    document.importNode(
      parseXml(`<w xmlns="${SHEET_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${xml}</w>`).documentElement!.firstChild!,
      true,
    ) as XmlElement
  insertWorkbookChild(root, wrap(`<sheets>${sheetEntries.join('')}</sheets>`))
  const sheetIds = model.sheetIds()
  const names = [...model.names.values()]
    .map((name: DefinedName) => {
      const scopeIndex = name.scope ? sheetIds.indexOf(name.scope) : -1
      if (name.scope && scopeIndex < 0) return ''
      const scopeSheet = name.scope ? model.sheet(name.scope) : undefined
      const attrs = Object.entries(name.keep ?? {})
        .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
        .join('')
      return `<definedName name="${escapeXml(name.name)}"${scopeIndex >= 0 ? ` localSheetId="${scopeIndex}"` : ''}${name.hidden ? ' hidden="1"' : ''}${name.comment !== undefined ? ` comment="${escapeXml(name.comment)}"` : ''}${attrs}>${escapeXml(toA1Form(name.formula, scopeSheet, model))}</definedName>`
    })
    .filter(Boolean)
  if (names.length) insertWorkbookChild(root, wrap(`<definedNames>${names.join('')}</definedNames>`))
  // The 1904 flag and the active tab follow the model.
  let properties = children(root, 'workbookPr')[0]
  if (!properties) {
    properties = document.createElementNS(SHEET_NS, 'workbookPr')
    insertWorkbookChild(root, properties)
  }
  if (model.date1904) properties.setAttribute('date1904', '1')
  else properties.removeAttribute('date1904')
  const active = Math.max(0, sheetIds.indexOf(model.metaValue('activeSheet') ?? ''))
  let views = children(root, 'bookViews')[0]
  if (!views) {
    views = wrap('<bookViews><workbookView/></bookViews>')
    insertWorkbookChild(root, views)
  }
  const view = children(views, 'workbookView')[0]
  if (view) {
    if (active) view.setAttribute('activeTab', String(active))
    else view.removeAttribute('activeTab')
    // firstSheet must name a visible sheet that exists.
    if (Number(view.getAttribute('firstSheet') ?? 0) >= sheetIds.length) view.removeAttribute('firstSheet')
  }
  let calc = children(root, 'calcPr')[0]
  if (!calc) {
    calc = document.createElementNS(SHEET_NS, 'calcPr')
    calc.setAttribute('calcId', '191029')
    insertWorkbookChild(root, calc)
  }
  if (model.metaValue('iterate')) {
    calc.setAttribute('iterate', '1')
    calc.setAttribute('iterateCount', String(model.metaValue('iterateCount') ?? 100))
    calc.setAttribute('iterateDelta', String(model.metaValue('iterateDelta') ?? 0.001))
  } else calc.removeAttribute('iterate')
  if (options.recalculateOnLoad) calc.setAttribute('fullCalcOnLoad', '1')
}

/** Removes parts no relationship chain from the package root reaches (left over from deletions). */
function pruneUnreachable(pkg: OoxmlPackage): void {
  const reachable = new Set<string>(['[Content_Types].xml', '_rels/.rels'])
  const queue = ['']
  while (queue.length) {
    const source = queue.pop()!
    const relsPath = relationshipsPathFor(source)
    if (!pkg.has(relsPath)) continue
    reachable.add(relsPath)
    for (const rel of pkg.relationships(source)) {
      if (rel.targetMode === 'External') continue
      const target = resolveTarget(source, rel.target)
      if (reachable.has(target) || !pkg.has(target)) continue
      reachable.add(target)
      queue.push(target)
    }
  }
  for (const path of pkg.paths()) if (!reachable.has(path)) pkg.delete(path)
}

const DEFAULT_WORKBOOK_XML =
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<workbookPr/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="16384" windowHeight="8192"/></bookViews><calcPr calcId="191029"/></workbook>'

