import type * as Y from 'yjs'
import type { LiveAssetStore } from '../../live-format.js'
import { CONTENT_TYPES_NS, OoxmlPackage, PACKAGE_RELATIONSHIPS_NS, parseXml, relationshipsPathFor, relativeTarget, resolveTarget, serializeXml, type XmlDocument } from '../../ooxml/package.js'
import { toA1Form } from '../model/formula-ids.js'
import type { DefinedName, DrawingObject, SheetFormat, SheetKind, SheetTable } from '../model/schema.js'
import { WorkbookModel, type SheetModel } from '../model/workbook.js'
import { DEFAULT_STYLES_XML, Stylesheet } from '../styles/stylesheet.js'
import { writeDrawing } from './drawing.js'
import { orderedEntries, resolvedTables } from './order.js'
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

const MEDIA_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' }

const METADATA_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata'
const METADATA_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml'

/** The cell metadata Excel 365 writes for dynamic arrays: `cm="1"` marks a formula that spills. */
const DYNAMIC_ARRAY_METADATA =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray">' +
  '<metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes>' +
  '<futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata>' +
  '<cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>'

/** The 1-based cell metadata index whose record is the XLDAPR type, in an existing metadata part. */
function xldaprIndex(xml: string): string | null {
  try {
    const root = parseXml(xml).documentElement!
    const types = children(children(root, 'metadataTypes')[0], 'metadataType')
    const type = types.findIndex((element) => element.getAttribute('name') === 'XLDAPR') + 1
    if (!type) return null
    const blocks = children(children(root, 'cellMetadata')[0], 'bk')
    const index = blocks.findIndex((block) => children(block, 'rc').some((rc) => rc.getAttribute('t') === String(type))) + 1
    return index ? String(index) : null
  } catch {
    return null
  }
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
  for (const [path, part] of [...model.parts].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) pkg.set(path, await assets.get(part.hash))

  const workbookPath = model.metaValue('workbookPath') ?? 'xl/workbook.xml'
  const types = new ContentTypes(model.metaValue('contentTypesXml'))
  const rootRels = new Rels(pkg.text('_rels/.rels'))
  const originalRootRels = rootRels.toXml()
  const pointsAtWorkbook = rootRels.list().some((rel) => rel.type === REL_TYPES.officeDocument && resolveTarget('', rel.target) === workbookPath)
  if (!pointsAtWorkbook) {
    rootRels.remove((rel) => rel.type === REL_TYPES.officeDocument)
    rootRels.add(REL_TYPES.officeDocument, workbookPath)
    // Keep the workbook relationship first, as Excel writes it.
    const rootElement = rootRels.document.documentElement!
    const officeRel = children(rootElement, 'Relationship').find((element) => element.getAttribute('Type') === REL_TYPES.officeDocument)!
    // (xmldom breaks when a node is inserted before itself.)
    if (rootElement.firstChild !== officeRel) rootElement.insertBefore(officeRel, rootElement.firstChild)
  }
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
  let nextSheetId = 1
  for (const id of usedSheetIds) nextSheetId = Math.max(nextSheetId, id + 1)
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

  // Dynamic-array formulas need the XLDAPR cell metadata; files written by Excel 365 have it, and
  // others get the standard part the first time a formula spills.
  let dynamicCm: string | null | undefined
  const dynamicArrayMetadata = (): string | undefined => {
    if (dynamicCm !== undefined) return dynamicCm ?? undefined
    const rel = workbookRels.list().find((entry) => entry.type === METADATA_REL)
    if (rel) {
      const xml = pkg.text(resolveTarget(workbookPath, rel.target))
      dynamicCm = xml ? xldaprIndex(xml) : null
    } else {
      const path = freePath(taken, (n) => (n === 1 ? 'xl/metadata.xml' : `xl/metadata${n}.xml`))
      livePaths.add(path)
      pkg.set(path, new TextEncoder().encode(DYNAMIC_ARRAY_METADATA))
      types.override(path, METADATA_CONTENT_TYPE)
      workbookRels.add(METADATA_REL, relativeTarget(workbookPath, path))
      dynamicCm = '1'
    }
    return dynamicCm ?? undefined
  }
  let tableId = 1
  const tables = resolvedTables(model)
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
    for (const [id, table] of tables.get(sheet.id) ?? []) {
      const tablePath = table.part && !livePaths.has(table.part) ? table.part : freePath(taken, (n) => `xl/tables/table${n}.xml`)
      const xml = writeTablePart(sheet, table, tableId++, headerNames(sheet, table))
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
    let drawingPath = sheet.raw.get('drawingPart') as string | undefined
    let drawingId: string | undefined
    if (!drawingPath && sheet.drawings.size) {
      // The first picture placed on a sheet without drawings gets a drawing part of its own.
      drawingPath = freePath(taken, (n) => `xl/drawings/drawing${n}.xml`)
      drawingId = rels.add(REL_TYPES.drawing, relativeTarget(path, drawingPath))
    }
    if (drawingPath) {
      livePaths.add(drawingPath)
      const drawingRels = new Rels(sheet.raw.get('drawingRels') as string | undefined)
      const embed = async (image: { hash: string; mimeType: string }) => {
        const extension = MEDIA_EXTENSIONS[image.mimeType] ?? 'png'
        const mediaPath = freePath(taken, (n) => `xl/media/image${n}.${extension}`)
        livePaths.add(mediaPath)
        pkg.set(mediaPath, await assets.get(image.hash))
        types.defaultFor(extension, image.mimeType)
        return drawingRels.add(REL_TYPES.image, relativeTarget(drawingPath!, mediaPath))
      }
      const embedded = new Map<string, string>()
      for (const [, raw] of orderedEntries(sheet, sheet.drawings, (value) => {
        const from = (value as DrawingObject).from
        return from ? { top: from.row, left: from.col } : undefined
      })) {
        const drawing = raw as { xml: string; image?: { hash: string; mimeType: string } }
        if (!drawing.xml && drawing.image && !embedded.has(drawing.image.hash)) embedded.set(drawing.image.hash, await embed(drawing.image))
      }
      pkg.set(drawingPath, new TextEncoder().encode(writeDrawing(sheet, (sheet.raw.get('drawingXml') as string | undefined) ?? '', (hash) => embedded.get(hash))))
      const originalRels = sheet.raw.get('drawingRels') as string | undefined
      if (!embedded.size && originalRels !== undefined) pkg.set(relationshipsPathFor(drawingPath), new TextEncoder().encode(originalRels))
      else if (!drawingRels.empty) pkg.set(relationshipsPathFor(drawingPath), new TextEncoder().encode(drawingRels.toXml()))
      types.override(drawingPath, CONTENT_TYPES.drawing)
    }
    const context: WorksheetWriteContext = {
      styles,
      strings,
      ...(options.values ? { values: options.values } : {}),
      ...(options.spills ? { spills: options.spills } : {}),
      addRelationship: (type, target, external) => rels.add(type, target, external),
      tableRelationships,
      dynamicArrayMetadata,
      ...(drawingId ? { drawingId } : {}),
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
  // Untouched styles go back exactly as read.
  const originalStyles = model.metaValue('stylesXml')
  pkg.set(stylesPath, new TextEncoder().encode(styles.changed || !originalStyles ? styles.toXml() : originalStyles))
  types.override(stylesPath, CONTENT_TYPES.styles)
  workbookRels.ensure(REL_TYPES.styles, relativeTarget(workbookPath, stylesPath))
  // New workbooks get the Office theme; files read without one stay without.
  if (!model.metaValue('workbookXml') && !workbookRels.list().some((rel) => rel.type === REL_TYPES.theme)) {
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
  const calcTime = model.metaValue('calcTime')
  if (calcTime !== undefined) {
    const corePath = 'docProps/core.xml'
    const terms = 'http://purl.org/dc/terms/'
    const core = parseXml(pkg.text(corePath) ?? '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>')
    let modified = core.getElementsByTagNameNS(terms, 'modified')[0]
    if (!modified || Date.parse(modified.textContent ?? '') !== calcTime) {
      if (!modified) {
        modified = core.createElementNS(terms, 'dcterms:modified')
        modified.setAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'xsi:type', 'dcterms:W3CDTF')
        core.documentElement!.appendChild(modified)
      }
      modified.textContent = new Date(calcTime).toISOString()
      pkg.set(corePath, new TextEncoder().encode(serializeXml(core)))
    }
    types.override(corePath, 'application/vnd.openxmlformats-package.core-properties+xml')
    rootRels.ensure('http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', corePath)
  }
  if (rootRels.toXml() !== originalRootRels || !pointsAtWorkbook || !pkg.has('_rels/.rels')) pkg.set('_rels/.rels', new TextEncoder().encode(rootRels.toXml()))
  types.defaultFor('rels', CONTENT_TYPES.relationships)
  types.defaultFor('xml', 'application/xml')

  pruneUnreachable(pkg, new Set(model.metaValue('looseParts') ?? []))
  types.prune(new Set(pkg.paths()))
  // Preserved overrides and rebuilt overrides must have the same order on a fresh import.
  const typesRoot = types.document.documentElement!
  const overrides = children(typesRoot, 'Override').sort((a, b) => {
    const left = a.getAttribute('PartName') ?? ''
    const right = b.getAttribute('PartName') ?? ''
    return left < right ? -1 : left > right ? 1 : 0
  })
  for (const override of overrides) typesRoot.appendChild(override)
  pkg.set('[Content_Types].xml', new TextEncoder().encode(types.toXml()))
  // ZIP entry order is part of the checksum too, including preserved parts.
  return new OoxmlPackage(new Map(pkg.paths().sort().map((path) => [path, pkg.get(path)!]))).write()
}

/** Parts of a package no relationship reaches. */
export function looseParts(pkg: OoxmlPackage): string[] {
  const copy = new OoxmlPackage(new Map(pkg.paths().map((path) => [path, pkg.get(path)!])))
  const before = new Set(copy.paths())
  pruneUnreachable(copy)
  const after = new Set(copy.paths())
  return [...before].filter((path) => !after.has(path) && path !== '[Content_Types].xml')
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
  const names = [...model.names.values()].sort((a, b) => sheetIds.indexOf(a.scope ?? '') - sheetIds.indexOf(b.scope ?? '') || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
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

/**
 * Removes parts no relationship chain from the package root reaches, left over from deleting
 * sheets or objects. Parts the file already had loose (`keep`) stay.
 */
export function pruneUnreachable(pkg: OoxmlPackage, keep: Set<string> = new Set()): void {
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
  for (const path of pkg.paths()) if (!reachable.has(path) && !keep.has(path)) pkg.delete(path)
}

const DEFAULT_WORKBOOK_XML =
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<workbookPr/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="16384" windowHeight="8192"/></bookViews><calcPr calcId="191029"/></workbook>'

