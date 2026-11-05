import type * as Y from 'yjs'
import { LiveFormatError, type LiveAssetStore } from '../../live-format.js'
import { OoxmlPackage, parseXml, relationshipsPathFor, serializeXml, type PackageLimits } from '../../ooxml/package.js'
import { IMPORT_ORIGIN } from '../model/edits.js'
import { randomId } from '../model/axis.js'
import { toIdForm } from '../model/formula-ids.js'
import type { DefinedName, SheetFormat, SheetKind, WorkbookMeta } from '../model/schema.js'
import { WorkbookModel } from '../model/workbook.js'
import { readWorksheet, withoutRelationships, type ReadContext } from './read-worksheet.js'
import { readSharedStrings } from './strings.js'
import { looseParts } from './write-xlsx.js'
import { attr, boolAttr, child, children, CONTENT_TYPES, numberAttr, otherAttributes, REL_TYPES, serializeNode, textOf } from './xml.js'

export interface XlsxReadOptions {
  /** Most cells a workbook may have to open for editing. */
  maxCells?: number
  limits?: PackageLimits
}

export const DEFAULT_MAX_CELLS = 2_000_000

const STRICT_NS = 'http://purl.oclc.org/ooxml/spreadsheetml/main'

const SHEET_KINDS: Record<string, SheetKind> = {
  [REL_TYPES.worksheet]: 'worksheet',
  [REL_TYPES.chartsheet]: 'chartsheet',
  [REL_TYPES.dialogsheet]: 'dialogsheet',
  [REL_TYPES.macrosheet]: 'macrosheet',
}

export function formatOfContentType(contentType: string | undefined): SheetFormat | undefined {
  switch (contentType) {
    case CONTENT_TYPES.workbook:
      return 'xlsx'
    case CONTENT_TYPES.workbookMacro:
      return 'xlsm'
    case CONTENT_TYPES.template:
      return 'xltx'
    case CONTENT_TYPES.templateMacro:
      return 'xltm'
    default:
      return undefined
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
  webp: 'image/webp',
}

/** Fills an empty Y.Doc from xlsx/xlsm/xltx bytes. */
export async function readXlsx(doc: Y.Doc, bytes: Uint8Array, assets: LiveAssetStore, options: XlsxReadOptions = {}): Promise<void> {
  const pkg = OoxmlPackage.read(bytes, options.limits)
  if (pkg.relationships('').some((rel) => rel.type === 'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument')) {
    throw new LiveFormatError('unsupported', 'Strict Open XML workbooks are not supported; save as a regular .xlsx')
  }
  const workbookPath = pkg.mainPart()
  if (!workbookPath || !pkg.has(workbookPath)) throw new LiveFormatError('corrupt', 'This package has no workbook')
  const format = formatOfContentType(pkg.contentType(workbookPath))
  const workbookDocument = pkg.xml(workbookPath)!
  const workbookRoot = workbookDocument.documentElement!
  if (workbookRoot.namespaceURI === STRICT_NS) throw new LiveFormatError('unsupported', 'Strict Open XML workbooks are not supported; save as a regular .xlsx')
  if (!format || workbookRoot.localName !== 'workbook') throw new LiveFormatError('corrupt', 'This file is not a spreadsheet')

  const rels = pkg.relationships(workbookPath)
  const relTarget = (type: string) => {
    const rel = rels.find((entry) => entry.type === type && entry.targetMode !== 'External')
    return rel ? pkg.relationshipTarget(workbookPath, rel.id) : undefined
  }
  const sharedStringsPath = relTarget(REL_TYPES.sharedStrings)
  const stylesPath = relTarget(REL_TYPES.styles)
  const themePath = relTarget(REL_TYPES.theme)
  const sharedStringsText = sharedStringsPath ? pkg.text(sharedStringsPath) : undefined
  const sharedStrings = sharedStringsText ? readSharedStrings(sharedStringsText) : []
  const properties = child(workbookRoot, 'workbookPr')
  const calc = child(workbookRoot, 'calcPr')

  const regenerated = new Set<string>([workbookPath, relationshipsPathFor(workbookPath), '[Content_Types].xml'])
  if (sharedStringsPath) regenerated.add(sharedStringsPath)
  if (stylesPath) regenerated.add(stylesPath)
  const calcChain = relTarget(REL_TYPES.calcChain)
  // The calculation chain lists formula cells in order; it goes stale with any edit and Excel
  // rebuilds it, so it is dropped rather than kept.
  if (calcChain) regenerated.add(calcChain)

  const meta: Partial<WorkbookMeta> = {
    format,
    date1904: boolAttr(properties, 'date1904'),
    iterate: boolAttr(calc, 'iterate'),
    iterateCount: numberAttr(calc, 'iterateCount') ?? 100,
    iterateDelta: numberAttr(calc, 'iterateDelta') ?? 0.001,
    workbookPath,
    ...(stylesPath && pkg.text(stylesPath) !== undefined ? { stylesXml: pkg.text(stylesPath)!, stylesPath } : {}),
    ...(themePath && pkg.text(themePath) !== undefined ? { themeXml: pkg.text(themePath)!, themePath } : {}),
    ...(sharedStringsPath ? { sharedStringsPath } : {}),
    ...(pkg.text(relationshipsPathFor(workbookPath)) !== undefined
      ? { workbookRels: withoutRelationships(pkg.text(relationshipsPathFor(workbookPath))!, [REL_TYPES.calcChain, REL_TYPES.sharedStrings]) }
      : {}),
  }

  // Binary parts (images and the like) go to the asset store first, so the sheets can then be read
  // synchronously, each in one transaction.
  const uploaded = new Map<string, { hash: string; mimeType: string; sizeBytes: number }>()
  for (const path of pkg.paths()) {
    if (/\.(xml|rels|vml)$/i.test(path)) continue
    const mimeType = MIME_BY_EXTENSION[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? pkg.contentType(path) ?? 'application/octet-stream'
    const ref = await assets.put(pkg.get(path)!, mimeType)
    uploaded.set(path, { hash: ref.hash, mimeType, sizeBytes: ref.sizeBytes })
  }
  const cellCount = { value: 0, limit: options.maxCells ?? DEFAULT_MAX_CELLS }
  const context: ReadContext = {
    pkg,
    sharedStrings,
    cellCount,
    regenerated,
    asset: (path) => {
      const found = uploaded.get(path)
      return found && { hash: found.hash, mimeType: found.mimeType }
    },
  }

  const coreXml = pkg.text('docProps/core.xml')
  const core = coreXml ? parseXml(coreXml) : undefined
  const modified = core?.getElementsByTagNameNS('http://purl.org/dc/terms/', 'modified')[0]?.textContent
  const calcTime = modified ? Date.parse(modified) : NaN
  if (Number.isFinite(calcTime)) meta.calcTime = calcTime
  let model!: WorkbookModel
  doc.transact(() => { model = WorkbookModel.initialize(doc, meta) }, IMPORT_ORIGIN)
  const sheetElements = children(child(workbookRoot, 'sheets'), 'sheet')
  if (!sheetElements.length) throw new LiveFormatError('corrupt', 'This workbook has no sheets')
  const sheets: { id: string; path?: string; kind: SheetKind }[] = []
  doc.transact(() => {
    for (const element of sheetElements) {
      const relId = attr(element, 'r:id')
      const rel = relId ? rels.find((entry) => entry.id === relId) : undefined
      const path = rel && rel.targetMode !== 'External' ? pkg.relationshipTarget(workbookPath, rel.id) : undefined
      const kind = (rel && SHEET_KINDS[rel.type]) ?? 'worksheet'
      const name = attr(element, 'name') ?? model.nextSheetName()
      const sheet = model.addSheet(model.sheetByName(name) ? model.uniqueSheetName(name) : name)
      const state = attr(element, 'state')
      if (state === 'hidden' || state === 'veryHidden') sheet.map.set('state', state)
      sheet.map.set('kind', kind)
      const sheetId = numberAttr(element, 'sheetId')
      if (sheetId !== undefined) sheet.raw.set('sheetId', sheetId)
      const keep = otherAttributes(element, ['name', 'sheetId', 'state', 'r:id'])
      if (keep) sheet.raw.set('keep', keep)
      sheets.push({ id: sheet.id, ...(path ? { path } : {}), kind })
    }
  }, IMPORT_ORIGIN)

  // Macro and dialog sheets are kept as parts but index into the shared string table, which is
  // rebuilt on export: keep its original entries first so their indexes stay valid.
  if (sharedStringsText && sheets.some((entry) => entry.kind === 'macrosheet' || entry.kind === 'dialogsheet')) {
    doc.transact(() => model.meta.set('sharedStringsSeed', sharedStringsText), IMPORT_ORIGIN)
  }
  for (const entry of sheets) {
    const sheet = model.sheet(entry.id)!
    if (entry.kind !== 'worksheet' || !entry.path || !pkg.has(entry.path)) {
      // Chart sheets, dialog sheets, and macro sheets are kept as parts and shown as tabs.
      if (entry.path) doc.transact(() => sheet.raw.set('part', entry.path), IMPORT_ORIGIN)
      continue
    }
    doc.transact(() => readWorksheet(sheet, entry.path!, context), IMPORT_ORIGIN)
  }

  doc.transact(() => {
    readDefinedNames(model, child(workbookRoot, 'definedNames'), sheets.map((entry) => entry.id))
    const views = child(child(workbookRoot, 'bookViews'), 'workbookView')
    const active = numberAttr(views, 'activeTab') ?? 0
    model.meta.set('activeSheet', sheets[Math.min(active, sheets.length - 1)]!.id)
    // The workbook XML without what the model owns (the active tab is the model's too).
    for (const name of ['sheets', 'definedNames']) for (const element of children(workbookRoot, name)) workbookRoot.removeChild(element)
    for (const view of children(child(workbookRoot, 'bookViews'), 'workbookView')) view.removeAttribute('activeTab')
    // Whether Excel must recalculate on open depends on how the export was made, not the source.
    children(workbookRoot, 'calcPr')[0]?.removeAttribute('fullCalcOnLoad')
    children(workbookRoot, 'calcPr')[0]?.removeAttribute('iterate')
    // The date system is the model's.
    children(workbookRoot, 'workbookPr')[0]?.removeAttribute('date1904')
    model.meta.set('workbookXml', serializeNode(workbookDocument))
  }, IMPORT_ORIGIN)

  // Everything not rebuilt on export is kept as bytes.
  const parts = model.parts
  const kept: [string, { hash: string; sizeBytes: number; contentType?: string }][] = []
  for (const path of pkg.paths()) {
    if (regenerated.has(path)) continue
    const contentType = pkg.contentType(path)
    const ref = uploaded.get(path) ?? (await assets.put(pkg.get(path)!, contentType ?? 'application/octet-stream'))
    kept.push([path, { hash: ref.hash, sizeBytes: ref.sizeBytes, ...(contentType ? { contentType } : {}) }])
  }
  doc.transact(() => {
    for (const [path, part] of kept) parts.set(path, part)
    // Content types without the overrides of rebuilt parts; the export declares what it writes.
    model.meta.set('contentTypesXml', withoutOverrides(pkg.text('[Content_Types].xml')!, regenerated))
    const loose = looseParts(pkg).filter((path) => !regenerated.has(path))
    if (loose.length) model.meta.set('looseParts', loose)
  }, IMPORT_ORIGIN)
}

function withoutOverrides(xml: string, paths: Set<string>): string {
  const document = parseXml(xml)
  const root = document.documentElement!
  const lower = new Set([...paths].map((path) => `/${path}`.toLowerCase()))
  for (const element of children(root, 'Override')) if (lower.has((element.getAttribute('PartName') ?? '').toLowerCase())) root.removeChild(element)
  // The defaults the export always declares, added the way it adds them.
  for (const [extension, contentType] of [['rels', CONTENT_TYPES.relationships], ['xml', 'application/xml']] as const) {
    if (children(root, 'Default').some((element) => element.getAttribute('Extension')?.toLowerCase() === extension)) continue
    const element = document.createElementNS('http://schemas.openxmlformats.org/package/2006/content-types', 'Default')
    element.setAttribute('Extension', extension)
    element.setAttribute('ContentType', contentType)
    root.insertBefore(element, root.firstChild)
  }
  return serializeXml(document)
}

function readDefinedNames(model: WorkbookModel, element: ReturnType<typeof child>, sheetIds: string[]): void {
  for (const entry of children(element, 'definedName')) {
    const name = attr(entry, 'name')
    if (!name) continue
    const local = numberAttr(entry, 'localSheetId')
    const scope = local !== undefined ? sheetIds[local] : undefined
    const scopeSheet = scope ? model.sheet(scope) : undefined
    const definedName: DefinedName = {
      name,
      // Names have no sheet of their own; references in them are almost always qualified.
      formula: toIdForm(textOf(entry), scopeSheet, model),
      ...(scope ? { scope } : {}),
    }
    if (boolAttr(entry, 'hidden')) definedName.hidden = true
    const comment = attr(entry, 'comment')
    if (comment !== undefined) definedName.comment = comment
    const keep = otherAttributes(entry, ['name', 'localSheetId', 'hidden', 'comment'])
    if (keep) definedName.keep = keep
    model.names.set(randomId(), definedName)
  }
}
