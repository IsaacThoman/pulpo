import { strToU8 } from 'fflate'
import { LiveFormatError, type LiveAssetStore } from '../live-format.js'
import {
  CONTENT_TYPES_PATH,
  OoxmlPackage,
  PACKAGE_RELATIONSHIPS_NS,
  relationshipsPathFor,
  relativeTarget,
  resolveTarget,
} from '../ooxml/package.js'
import type { NotesSnapshot, PresentationFormat, PresentationSnapshot, RelTarget, ShapeSnapshot, SlideSnapshot, TableSnapshot, Xfrm } from './model.js'
import { notesBody, readShape, readSlide, SECTION_LIST_EXT_URI, mimeTypeFor } from './read.js'
import { readTextBody, writeParagraphs, type RelationshipAllocator } from './text.js'
import {
  attr,
  child,
  childElements,
  CONTENT_TYPES,
  createElement,
  escapeAttribute,
  importFragment,
  intAttr,
  namespaceDeclarations,
  NS,
  parseXmlDocument,
  path,
  pruneRedundantNamespaces,
  REL_TYPES,
  replaceOrInsert,
  serializeNode,
  stableStringify,
  type XmlDocument,
  type XmlElement,
} from './xml.js'

/** The main part's content type for each file extension. */
export const MAIN_CONTENT_TYPES: Record<PresentationFormat, string> = {
  pptx: CONTENT_TYPES.presentation,
  potx: CONTENT_TYPES.template,
  ppsx: CONTENT_TYPES.slideshow,
  pptm: CONTENT_TYPES.macroPresentation,
  potm: CONTENT_TYPES.macroTemplate,
  ppsm: CONTENT_TYPES.macroSlideshow,
}

const MACRO_FORMATS = new Set<PresentationFormat>(['pptm', 'potm', 'ppsm'])

// ---------------------------------------------------------------------------------------------
// Identifiers

/**
 * Fills in what new content lacks (slide ids, part names, shape ids) and repairs duplicates that
 * concurrent edits can produce. Deterministic, so the codec can predict what an export will
 * contain when it matches a pushed file back to the document.
 */
export function assignIdentifiers(snapshot: PresentationSnapshot): PresentationSnapshot {
  const usedSlideIds = new Set<number>()
  const usedParts = new Set<string>(Object.keys(snapshot.parts))
  let nextSlideId = 256
  for (const slide of snapshot.slides) if (slide.sldId !== undefined) nextSlideId = Math.max(nextSlideId, slide.sldId + 1)
  const slides = snapshot.slides.map((original) => {
    const slide: SlideSnapshot = { ...original }
    if (slide.sldId === undefined || usedSlideIds.has(slide.sldId) || slide.sldId < 256) slide.sldId = nextSlideId++
    usedSlideIds.add(slide.sldId)
    if (!slide.part || usedParts.has(slide.part)) {
      delete slide.source
      delete slide.relsSource
      slide.part = freePartName(usedParts, 'ppt/slides/slide', '.xml')
    }
    usedParts.add(slide.part)
    if (slide.notes) {
      const notes = { ...slide.notes }
      if (!notes.part || usedParts.has(notes.part)) {
        delete notes.source
        delete notes.relsSource
        notes.part = freePartName(usedParts, 'ppt/notesSlides/notesSlide', '.xml')
      }
      usedParts.add(notes.part)
      slide.notes = notes
    }
    slide.shapes = assignShapeIds(slide.shapes)
    return slide
  })
  return { ...snapshot, slides }
}

function freePartName(used: Set<string>, prefix: string, suffix: string): string {
  for (let index = 1; ; index++) {
    const candidate = `${prefix}${index}${suffix}`
    if (!used.has(candidate)) return candidate
  }
}

function assignShapeIds(shapes: ShapeSnapshot[]): ShapeSnapshot[] {
  const used = new Set<number>([1])
  let next = 2
  const walk = (shape: ShapeSnapshot) => {
    if (shape.nvId !== undefined) next = Math.max(next, shape.nvId + 1)
    shape.children?.forEach(walk)
  }
  shapes.forEach(walk)
  const assign = (original: ShapeSnapshot): ShapeSnapshot => {
    const shape = { ...original }
    if (shape.kind !== 'opaque' && (shape.nvId === undefined || used.has(shape.nvId))) shape.nvId = next++
    if (shape.nvId !== undefined) used.add(shape.nvId)
    if (shape.children) shape.children = shape.children.map(assign)
    return shape
  }
  return shapes.map(assign)
}

// ---------------------------------------------------------------------------------------------
// Relationships

/** The relationships of one part, reusing ids for targets it already links to. */
export class RelationshipTable implements RelationshipAllocator {
  readonly entries = new Map<string, RelTarget>()

  set(id: string, rel: RelTarget): void {
    this.entries.set(id, rel)
  }

  allocate(type: string, target: string, external: boolean, preferredId?: string): string {
    if (preferredId) {
      const preferred = this.entries.get(preferredId)
      if (preferred && preferred.type === type && preferred.target === target && !!preferred.external === external) return preferredId
    }
    for (const [id, rel] of this.entries) if (rel.type === type && rel.target === target && !!rel.external === external) return id
    let id = preferredId && !this.entries.has(preferredId) ? preferredId : undefined
    for (let index = this.entries.size + 1; !id; index++) if (!this.entries.has(`rId${index}`)) id = `rId${index}`
    this.entries.set(id, { type, target, ...(external ? { external: true } : {}) })
    return id
  }

  toXml(sourcePart: string): string {
    const entries = [...this.entries].map(([id, rel]) => {
      const target = rel.external ? rel.target : relativeTarget(sourcePart, rel.target)
      return `<Relationship Id="${escapeAttribute(id)}" Type="${escapeAttribute(rel.type)}" Target="${escapeAttribute(target)}"${rel.external ? ' TargetMode="External"' : ''}/>`
    })
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}">${entries.join('')}</Relationships>`
  }
}

/** Points every `r:` attribute in `element` from a shape-local id to the part's table. */
function remapRelationshipIds(element: XmlElement, local: Record<string, RelTarget>, table: RelationshipTable): void {
  const stack: XmlElement[] = [element]
  while (stack.length) {
    const node = stack.pop()!
    for (let index = 0; index < node.attributes.length; index++) {
      const attribute = node.attributes.item(index)!
      if (attribute.namespaceURI !== NS.r) continue
      const rel = local[attribute.value]
      if (rel) attribute.value = table.allocate(rel.type, rel.target, rel.external === true, attribute.value)
    }
    stack.push(...childElements(node))
  }
}

// ---------------------------------------------------------------------------------------------
// Shapes

const SPPR_ORDER = ['xfrm', 'custGeom', 'prstGeom', 'noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill', 'ln', 'effectLst', 'effectDag', 'scene3d', 'sp3d', 'extLst']
const FILL_NAMES = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']

function after(name: string): string[] {
  return SPPR_ORDER.slice(SPPR_ORDER.indexOf(name) + 1)
}

/** A shape's element: its template with every modeled property that changed written in. */
export function buildShapeElement(document: XmlDocument, shape: ShapeSnapshot, prefixes: Record<string, string>, table: RelationshipTable): XmlElement {
  const element = importFragment(document, shape.xml, prefixes)
  if (shape.kind !== 'opaque') {
    const local = new RelationshipTable()
    for (const [id, rel] of Object.entries(shape.rels)) local.set(id, rel)
    patchShape(element, shape, local)
    remapRelationshipIds(element, Object.fromEntries(local.entries), table)
  } else {
    remapRelationshipIds(element, shape.rels, table)
  }
  for (const member of shape.children ?? []) {
    const extLst = child(element, 'extLst', NS.p)
    element.insertBefore(buildShapeElement(document, member, prefixes, table), extLst ?? null)
  }
  return element
}

const differs = (a: unknown, b: unknown) => stableStringify(a) !== stableStringify(b)

function patchShape(element: XmlElement, shape: ShapeSnapshot, local: RelationshipTable): void {
  const document = element.ownerDocument as unknown as XmlDocument
  const derived = readShape(element, new Map(local.entries), new Set(), { shapes: 0, limit: Number.MAX_SAFE_INTEGER }, 0)
  const nv = childElements(element).find((entry) => entry.localName?.startsWith('nv'))
  const cNvPr = nv && child(nv, 'cNvPr', NS.p)
  if (cNvPr) {
    if (shape.nvId !== undefined && shape.nvId !== derived.nvId) cNvPr.setAttribute('id', String(shape.nvId))
    if (differs(shape.name, derived.name)) cNvPr.setAttribute('name', shape.name ?? '')
    if (differs(shape.descr, derived.descr)) {
      if (shape.descr === undefined) cNvPr.removeAttribute('descr')
      else cNvPr.setAttribute('descr', shape.descr)
    }
    if (differs(shape.hidden, derived.hidden)) {
      if (shape.hidden) cNvPr.setAttribute('hidden', '1')
      else cNvPr.removeAttribute('hidden')
    }
  }

  const properties = ensureShapeProperties(element, shape.kind)
  if (differs(shape.xfrm, derived.xfrm)) {
    if (shape.kind === 'graphicFrame') {
      const replacement = shape.xfrm ? xfrmElement(document, shape.xfrm, 'p:xfrm') : undefined
      const graphic = child(element, 'graphic', NS.a)
      const existing = child(element, 'xfrm', NS.p)
      if (existing && replacement) element.replaceChild(replacement, existing)
      else if (existing) element.removeChild(existing)
      else if (replacement) element.insertBefore(replacement, graphic ?? null)
    } else if (properties) {
      replaceOrInsert(properties, child(properties, 'xfrm', NS.a), shape.xfrm ? xfrmElement(document, shape.xfrm, 'a:xfrm') : undefined, after('xfrm'))
    }
  }
  if (properties) {
    const find = (names: string[]) => childElements(properties).find((entry) => names.includes(entry.localName ?? '') && entry.namespaceURI === NS.a)
    if (differs(shape.geom, derived.geom)) replaceOrInsert(properties, find(['prstGeom', 'custGeom']), fragment(document, shape.geom), after('prstGeom'))
    if (differs(shape.fill, derived.fill)) replaceOrInsert(properties, find(FILL_NAMES), fragment(document, shape.fill), after('grpFill'))
    if (differs(shape.line, derived.line)) replaceOrInsert(properties, find(['ln']), fragment(document, shape.line), after('ln'))
    if (differs(shape.effects, derived.effects)) replaceOrInsert(properties, find(['effectLst']), fragment(document, shape.effects), after('effectDag'))
  }
  if (shape.kind === 'pic' && differs(shape.blipFill, derived.blipFill)) {
    replaceOrInsert(element, child(element, 'blipFill', NS.p), fragment(document, shape.blipFill), ['spPr'])
  }
  if (differs(shape.bodyPr, derived.bodyPr) || differs(shape.text, derived.text)) {
    let txBody = child(element, 'txBody', NS.p)
    if (!txBody && shape.text) {
      txBody = createElement(document, 'p:txBody')
      txBody.appendChild(createElement(document, 'a:bodyPr'))
      txBody.appendChild(createElement(document, 'a:lstStyle'))
      element.insertBefore(txBody, child(element, 'extLst', NS.p) ?? null)
    }
    if (txBody) {
      if (differs(shape.bodyPr, derived.bodyPr)) {
        replaceOrInsert(txBody, child(txBody, 'bodyPr', NS.a), fragment(document, shape.bodyPr) ?? createElement(document, 'a:bodyPr'), ['lstStyle', 'p'])
      }
      if (shape.text && differs(shape.text, derived.text)) writeParagraphs(txBody, shape.text, local)
      if (!shape.text && derived.text) element.removeChild(txBody)
    }
  }
  if (shape.table && differs(shape.table, derived.table)) {
    const tbl = path(element, 'graphic', 'graphicData', 'tbl')
    if (tbl) writeTable(tbl, shape.table, derived.table, local)
  }
}

function fragment(document: XmlDocument, xml: string | undefined): XmlElement | undefined {
  return xml ? importFragment(document, xml) : undefined
}

function ensureShapeProperties(element: XmlElement, kind: ShapeSnapshot['kind']): XmlElement | undefined {
  if (kind === 'graphicFrame') return undefined
  const name = kind === 'grpSp' ? 'grpSpPr' : 'spPr'
  const existing = child(element, name, NS.p)
  if (existing) return existing
  const created = createElement(element.ownerDocument as unknown as XmlDocument, `p:${name}`)
  const nv = childElements(element).find((entry) => entry.localName?.startsWith('nv'))
  const anchor = kind === 'pic' ? child(element, 'blipFill', NS.p)?.nextSibling : nv?.nextSibling
  element.insertBefore(created, anchor ?? null)
  return created
}

function xfrmElement(document: XmlDocument, xfrm: Xfrm, name: 'a:xfrm' | 'p:xfrm'): XmlElement {
  const element = createElement(document, name)
  if (xfrm.rot) element.setAttribute('rot', String(Math.round(xfrm.rot)))
  if (xfrm.flipH) element.setAttribute('flipH', '1')
  if (xfrm.flipV) element.setAttribute('flipV', '1')
  const point = (tag: string, a: string, b: string, x: number, y: number) => {
    const entry = createElement(document, tag)
    entry.setAttribute(a, String(Math.round(x)))
    entry.setAttribute(b, String(Math.round(y)))
    element.appendChild(entry)
  }
  point('a:off', 'x', 'y', xfrm.x, xfrm.y)
  point('a:ext', 'cx', 'cy', Math.max(0, xfrm.cx), Math.max(0, xfrm.cy))
  if (xfrm.chX !== undefined || xfrm.chY !== undefined) point('a:chOff', 'x', 'y', xfrm.chX ?? 0, xfrm.chY ?? 0)
  if (xfrm.chCx !== undefined || xfrm.chCy !== undefined) point('a:chExt', 'cx', 'cy', Math.max(0, xfrm.chCx ?? 0), Math.max(0, xfrm.chCy ?? 0))
  return element
}

const EMPTY_CELL = '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody><a:tcPr/></a:tc>'

function writeTable(tbl: XmlElement, table: TableSnapshot, derived: TableSnapshot | undefined, rels: RelationshipTable): void {
  const document = tbl.ownerDocument as unknown as XmlDocument
  if (differs(table.tblPr, derived?.tblPr)) replaceOrInsert(tbl, child(tbl, 'tblPr', NS.a), fragment(document, table.tblPr), ['tblGrid', 'tr'])
  const grid = child(tbl, 'tblGrid', NS.a) ?? tbl.insertBefore(createElement(document, 'a:tblGrid'), child(tbl, 'tr', NS.a) ?? null)
  for (const column of childElements(grid)) grid.removeChild(column)
  for (const column of table.columns) {
    const element = importFragment(document, column.xml)
    element.setAttribute('w', String(Math.round(column.w)))
    grid.appendChild(element)
  }
  const derivedRows = new Map((derived?.rows ?? []).map((row) => [row.key, row]))
  const anchor = childElements(tbl).find((element) => element.localName === 'extLst') ?? null
  for (const row of childElements(tbl)) if (row.localName === 'tr') tbl.removeChild(row)
  for (const row of table.rows) {
    const element = importFragment(document, row.xml)
    element.setAttribute('h', String(Math.round(row.h)))
    const rowExtLst = child(element, 'extLst', NS.a)
    for (const column of table.columns) {
      const cell = row.cells[column.key]
      const before = derivedRows.get(row.key)?.cells[column.key]
      const tc = importFragment(document, cell?.xml ?? EMPTY_CELL)
      if (cell) {
        const setOrRemove = (name: string, value: string | undefined) => (value === undefined ? tc.removeAttribute(name) : tc.setAttribute(name, value))
        setOrRemove('gridSpan', cell.gridSpan && cell.gridSpan > 1 ? String(cell.gridSpan) : undefined)
        setOrRemove('rowSpan', cell.rowSpan && cell.rowSpan > 1 ? String(cell.rowSpan) : undefined)
        setOrRemove('hMerge', cell.hMerge ? '1' : undefined)
        setOrRemove('vMerge', cell.vMerge ? '1' : undefined)
        if (differs(cell.tcPr, before?.tcPr)) replaceOrInsert(tc, child(tc, 'tcPr', NS.a), fragment(document, cell.tcPr), ['extLst'])
        if (!before || differs(cell.text, before.text)) {
          let txBody = child(tc, 'txBody', NS.a)
          if (!txBody) {
            txBody = importFragment(document, '<a:txBody><a:bodyPr/><a:lstStyle/></a:txBody>')
            tc.insertBefore(txBody, tc.firstChild)
          }
          writeParagraphs(txBody, cell.text, rels)
        }
      }
      element.insertBefore(tc, rowExtLst ?? null)
    }
    tbl.insertBefore(element, anchor)
  }
}

// ---------------------------------------------------------------------------------------------
// Slides and notes

interface WrittenPart {
  xml: Uint8Array
  rels: Uint8Array
}

/** Writes a slide; returns its original bytes when nothing the model covers has changed. */
function writeSlide(slide: SlideSnapshot): WrittenPart {
  if (slide.source && slideUnchanged(slide)) {
    return { xml: slide.source, rels: slide.relsSource ?? strToU8(new RelationshipTable().toXml(slide.part!)) }
  }
  const part = slide.part!
  const document = parseXmlDocument(slide.xml)
  const root = document.documentElement!
  const prefixes = namespaceDeclarations(root)
  if (slide.hidden) root.setAttribute('show', '0')
  else root.removeAttribute('show')

  const table = new RelationshipTable()
  for (const [id, rel] of Object.entries(slide.rels)) table.set(id, rel)
  if (slide.layout) table.allocate(REL_TYPES.slideLayout, slide.layout, false, preferredIdFor(slide, REL_TYPES.slideLayout))
  if (slide.notes?.part) table.allocate(REL_TYPES.notesSlide, slide.notes.part, false, preferredIdFor(slide, REL_TYPES.notesSlide))

  const cSld = child(root, 'cSld', NS.p) ?? root.insertBefore(createElement(document, 'p:cSld'), root.firstChild)
  if (slide.background) {
    const background = importFragment(document, slide.background, prefixes)
    remapRelationshipIds(background, slide.rels, table)
    cSld.insertBefore(background, cSld.firstChild)
  }
  let tree = child(cSld, 'spTree', NS.p)
  if (!tree) {
    tree = importFragment(document, '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>')
    cSld.appendChild(tree)
  }
  const treeExtLst = child(tree, 'extLst', NS.p) ?? null
  for (const shape of slide.shapes) tree.insertBefore(buildShapeElement(document, shape, prefixes, table), treeExtLst)
  pruneRedundantNamespaces(root)
  return { xml: strToU8(serializeDocument(document)), rels: sameRelationships(slide.relsSource, part, table) ?? strToU8(table.toXml(part)) }
}

/** The original relationships bytes, when the rewritten part links to exactly the same things. */
function sameRelationships(source: Uint8Array | undefined, part: string, table: RelationshipTable): Uint8Array | undefined {
  if (!source) return undefined
  try {
    const pkg = new OoxmlPackage()
    pkg.set(relationshipsPathFor(part), source)
    const original = Object.fromEntries(
      pkg.relationships(part).map((rel) => [rel.id, { type: rel.type, target: rel.targetMode === 'External' ? rel.target : resolveTarget(part, rel.target), ...(rel.targetMode === 'External' ? { external: true } : {}) }]),
    )
    return stableStringify(original) === stableStringify(Object.fromEntries(table.entries)) ? source : undefined
  } catch {
    return undefined
  }
}

/** Keeps the relationship id a slide had for its layout or notes. */
function preferredIdFor(slide: SlideSnapshot, type: string): string | undefined {
  if (!slide.relsSource) return undefined
  try {
    const rels = parseXmlDocument(new TextDecoder().decode(slide.relsSource)).documentElement!
    return childElements(rels).find((entry) => attr(entry, 'Type') === type)?.getAttribute('Id') ?? undefined
  } catch {
    return undefined
  }
}

const slideComparable = (slide: SlideSnapshot) => {
  const { key: _key, sldId: _sldId, section: _section, source: _source, relsSource: _relsSource, notes, ...rest } = slide
  return stableStringify({ ...rest, notesPart: notes?.part })
}

/** Whether the modeled slide still says exactly what its source bytes say. */
function slideUnchanged(slide: SlideSnapshot): boolean {
  try {
    const pkg = new OoxmlPackage()
    pkg.set(slide.part!, slide.source!)
    if (slide.relsSource) pkg.set(relationshipsPathFor(slide.part!), slide.relsSource)
    const reread = readSlide(pkg, slide.part!, slide.sldId)
    delete reread.notes
    return slideComparable({ ...reread, notes: slide.notes?.part ? ({ part: notesPartFromRels(pkg, slide.part!) } as NotesSnapshot) : undefined }) === slideComparable(slide)
  } catch {
    return false
  }
}

function notesPartFromRels(pkg: OoxmlPackage, part: string): string | undefined {
  return pkg.relatedParts(part, REL_TYPES.notesSlide)[0]
}

const NEW_NOTES_XML =
  '<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>'

function writeNotes(notes: NotesSnapshot, slidePart: string, notesMaster: string): WrittenPart {
  const part = notes.part!
  const table = new RelationshipTable()
  for (const [id, rel] of Object.entries(notes.rels)) table.set(id, rel.type === REL_TYPES.slide ? { ...rel, target: slidePart } : rel)
  table.allocate(REL_TYPES.notesMaster, notesMaster, false)
  table.allocate(REL_TYPES.slide, slidePart, false)
  const relsXml = strToU8(table.toXml(part))
  if (notes.source && notes.xml) {
    try {
      const original = parseXmlDocument(new TextDecoder().decode(notes.source)).documentElement!
      const body = notesBody(original)
      const text = body ? readTextBody(body) : undefined
      const relsUnchanged = notes.relsSource && stableStringify(Object.fromEntries(table.entries)) === stableStringify(notes.rels)
      if (text && !differs(text, notes.text) && relsUnchanged) return { xml: notes.source, rels: notes.relsSource! }
    } catch {
      // Fall through and rewrite it.
    }
  }
  const document = parseXmlDocument(notes.xml || NEW_NOTES_XML)
  let body = notesBody(document.documentElement!)
  if (!body) {
    const tree = path(document.documentElement!, 'cSld', 'spTree')
    if (!tree) throw new LiveFormatError('corrupt', `${part} has no shape tree`)
    const shape = importFragment(document, '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>')
    tree.appendChild(shape)
    body = child(shape, 'txBody', NS.p)!
  }
  writeParagraphs(body, notes.text, table)
  pruneRedundantNamespaces(document.documentElement!)
  return { xml: strToU8(serializeDocument(document)), rels: strToU8(table.toXml(part)) }
}

function serializeDocument(document: XmlDocument): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + serializeNode(document).replace(/^<\?xml[^?]*\?>\s*/, '')
}

// ---------------------------------------------------------------------------------------------
// The package

export interface WriteOptions {
  format: PresentationFormat
  assets: LiveAssetStore
}

export async function writePresentation(input: PresentationSnapshot, options: WriteOptions): Promise<Uint8Array> {
  const snapshot = assignIdentifiers(input)
  const pkg = new OoxmlPackage()
  for (const [partPath, part] of Object.entries(snapshot.parts)) {
    if (part.bytes) pkg.set(partPath, part.bytes)
    else if (part.asset) pkg.set(partPath, await options.assets.get(part.asset.hash))
  }
  if (!pkg.has(CONTENT_TYPES_PATH)) throw new LiveFormatError('corrupt', 'This presentation has no [Content_Types].xml')
  if (!pkg.has(snapshot.mainPart)) throw new LiveFormatError('corrupt', 'This presentation has no presentation part')

  let notesMaster = pkg.relatedParts(snapshot.mainPart, REL_TYPES.notesMaster)[0]
  if (!notesMaster && snapshot.slides.some((slide) => slide.notes)) notesMaster = addNotesMaster(pkg, snapshot.mainPart)

  for (const slide of snapshot.slides) {
    const written = writeSlide(slide)
    pkg.set(slide.part!, written.xml)
    pkg.set(relationshipsPathFor(slide.part!), written.rels)
    if (slide.notes) {
      const notes = writeNotes(slide.notes, slide.part!, notesMaster!)
      pkg.set(slide.notes.part!, notes.xml)
      pkg.set(relationshipsPathFor(slide.notes.part!), notes.rels)
    }
  }

  writePresentationPart(pkg, snapshot)
  if (!MACRO_FORMATS.has(options.format)) dropMacros(pkg, snapshot.mainPart)
  collectGarbage(pkg, snapshot)
  writeContentTypes(pkg, snapshot, options.format)
  return pkg.write()
}

function addNotesMaster(pkg: OoxmlPackage, mainPart: string): string {
  const theme = pkg.relatedParts(pkg.relatedParts(mainPart, REL_TYPES.slideMaster)[0] ?? '', REL_TYPES.theme)[0]
  const used = new Set(pkg.paths())
  const masterPath = freePartName(used, 'ppt/notesMasters/notesMaster', '.xml')
  const themePath = freePartName(used, 'ppt/theme/theme', '.xml')
  if (theme) pkg.set(themePath, pkg.get(theme)!)
  pkg.set(
    masterPath,
    strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1143000" y="685800"/><a:ext cx="4572000" cy="3429000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>',
    ),
  )
  if (theme) pkg.addRelationship(masterPath, REL_TYPES.theme, relativeTarget(masterPath, themePath))
  pkg.setContentType(masterPath, CONTENT_TYPES.notesMaster)
  pkg.setContentType(themePath, CONTENT_TYPES.theme)
  const id = pkg.addRelationship(mainPart, REL_TYPES.notesMaster, relativeTarget(mainPart, masterPath))
  const presentation = pkg.xml(mainPart)!.documentElement!
  const list = createElement(presentation.ownerDocument as unknown as XmlDocument, 'p:notesMasterIdLst')
  const entry = createElement(presentation.ownerDocument as unknown as XmlDocument, 'p:notesMasterId')
  entry.setAttributeNS(NS.r, 'r:id', id)
  list.appendChild(entry)
  const anchor = childElements(presentation).find((element) => !['sldMasterIdLst'].includes(element.localName ?? ''))
  presentation.insertBefore(list, anchor ?? null)
  return masterPath
}


interface PresentationLists {
  slides: { sldId: number; part: string }[]
  slideWidth: number
  slideHeight: number
  notesWidth: number
  notesHeight: number
  sections: { name: string; id: string; slides: number[] }[]
}

function presentationLists(pkg: OoxmlPackage, mainPart: string): PresentationLists {
  const presentation = pkg.xml(mainPart)!.documentElement!
  const slides = childElements(child(presentation, 'sldIdLst', NS.p)).flatMap((entry) => {
    const id = entry.getAttributeNS(NS.r, 'id')
    const part = id ? pkg.relationshipTarget(mainPart, id) : undefined
    const sldId = intAttr(entry, 'id')
    return part && sldId !== undefined ? [{ sldId, part }] : []
  })
  const size = child(presentation, 'sldSz', NS.p)
  const notes = child(presentation, 'notesSz', NS.p)
  return {
    slides,
    slideWidth: intAttr(size, 'cx') ?? 0,
    slideHeight: intAttr(size, 'cy') ?? 0,
    notesWidth: intAttr(notes, 'cx') ?? 0,
    notesHeight: intAttr(notes, 'cy') ?? 0,
    sections: childElements(sectionListElement(presentation)).map((section) => ({
      name: attr(section, 'name') ?? '',
      id: attr(section, 'id') ?? '',
      slides: childElements(child(section, 'sldIdLst')).map((entry) => intAttr(entry, 'id') ?? 0),
    })),
  }
}

function sectionListElement(presentation: XmlElement): XmlElement | undefined {
  for (const ext of childElements(child(presentation, 'extLst', NS.p))) {
    if (attr(ext, 'uri') === SECTION_LIST_EXT_URI) return childElements(ext).find((element) => element.localName === 'sectionLst')
  }
  return undefined
}

/** Sections as the file lists them: each a run of slides, in slide order. */
function wantedSections(snapshot: PresentationSnapshot): PresentationLists['sections'] {
  if (!snapshot.sections.length) return []
  const known = new Map(snapshot.sections.map((section) => [section.key, section]))
  const members = new Map<string, number[]>(snapshot.sections.map((section) => [section.key, []]))
  let current = snapshot.sections[0]!.key
  for (const slide of snapshot.slides) {
    // A slide without a (surviving) section joins the one before it, as PowerPoint does.
    if (slide.section && known.has(slide.section)) current = slide.section
    members.get(current)!.push(slide.sldId!)
  }
  return snapshot.sections.map((section) => ({ name: section.name, id: section.id, slides: members.get(section.key)! }))
}

function writePresentationPart(pkg: OoxmlPackage, snapshot: PresentationSnapshot): void {
  const mainPart = snapshot.mainPart
  const before = presentationLists(pkg, mainPart)
  const wanted: PresentationLists = {
    slides: snapshot.slides.map((slide) => ({ sldId: slide.sldId!, part: slide.part! })),
    slideWidth: snapshot.slideWidth,
    slideHeight: snapshot.slideHeight,
    notesWidth: snapshot.notesWidth,
    notesHeight: snapshot.notesHeight,
    sections: wantedSections(snapshot),
  }
  if (!differs(before, wanted)) return
  const document = pkg.xml(mainPart)!
  const presentation = document.documentElement!

  // Relationships: keep ids of slides that stay, drop those of removed slides, add new ones.
  const wantedParts = new Set(wanted.slides.map((slide) => slide.part))
  const relIdByPart = new Map<string, string>()
  for (const rel of pkg.relationships(mainPart)) {
    if (rel.type !== REL_TYPES.slide) continue
    const target = resolveTarget(mainPart, rel.target)
    if (wantedParts.has(target) && !relIdByPart.has(target)) relIdByPart.set(target, rel.id)
    else pkg.removeRelationship(mainPart, rel.id)
  }
  for (const slide of wanted.slides) {
    if (!relIdByPart.has(slide.part)) relIdByPart.set(slide.part, pkg.addRelationship(mainPart, REL_TYPES.slide, relativeTarget(mainPart, slide.part)))
  }

  let list = child(presentation, 'sldIdLst', NS.p)
  if (!list) {
    list = createElement(document, 'p:sldIdLst')
    const anchor = childElements(presentation).find((element) => !['sldMasterIdLst', 'notesMasterIdLst', 'handoutMasterIdLst'].includes(element.localName ?? ''))
    presentation.insertBefore(list, anchor ?? null)
  }
  const originalEntries = new Map(childElements(list).map((entry) => [intAttr(entry, 'id'), entry]))
  for (const entry of childElements(list)) list.removeChild(entry)
  for (const slide of wanted.slides) {
    const entry = (originalEntries.get(slide.sldId) as XmlElement | undefined) ?? createElement(document, 'p:sldId')
    entry.setAttribute('id', String(slide.sldId))
    entry.setAttributeNS(NS.r, 'r:id', relIdByPart.get(slide.part)!)
    list.appendChild(entry)
  }

  setSize(document, presentation, 'sldSz', wanted.slideWidth, wanted.slideHeight, 'notesSz')
  setSize(document, presentation, 'notesSz', wanted.notesWidth, wanted.notesHeight)
  if (differs(before.sections, wanted.sections)) writeSections(document, presentation, wanted.sections)
}

function setSize(document: XmlDocument, presentation: XmlElement, name: string, cx: number, cy: number, before?: string): void {
  let element = child(presentation, name, NS.p)
  if (!element) {
    element = createElement(document, `p:${name}`)
    presentation.insertBefore(element, (before && child(presentation, before, NS.p)) || null)
  }
  if (intAttr(element, 'cx') !== cx) element.setAttribute('cx', String(cx))
  if (intAttr(element, 'cy') !== cy) element.setAttribute('cy', String(cy))
}

function writeSections(document: XmlDocument, presentation: XmlElement, sections: PresentationLists['sections']): void {
  const existing = sectionListElement(presentation)
  const ext = existing?.parentNode as XmlElement | undefined
  if (!sections.length) {
    if (ext) ext.parentNode!.removeChild(ext)
    return
  }
  const xml = `<p:ext uri="${SECTION_LIST_EXT_URI}"><p14:sectionLst xmlns:p14="${NS.p14}">${sections
    .map(
      (section) =>
        `<p14:section name="${escapeAttribute(section.name)}" id="${escapeAttribute(section.id)}"><p14:sldIdLst>${section.slides.map((id) => `<p14:sldId id="${id}"/>`).join('')}</p14:sldIdLst></p14:section>`,
    )
    .join('')}</p14:sectionLst></p:ext>`
  const replacement = importFragment(document, xml)
  if (ext) {
    ext.parentNode!.replaceChild(replacement, ext)
    return
  }
  let extLst = child(presentation, 'extLst', NS.p)
  if (!extLst) {
    extLst = createElement(document, 'p:extLst')
    presentation.appendChild(extLst)
  }
  extLst.appendChild(replacement)
}

/** A macro-free format cannot hold a VBA project: unlink it (garbage collection drops the part) and its content type. */
function dropMacros(pkg: OoxmlPackage, mainPart: string): void {
  for (const rel of pkg.relationships(mainPart)) {
    if (rel.type !== REL_TYPES.vbaProject) continue
    pkg.removeRelationship(mainPart, rel.id)
  }
  const types = pkg.xml(CONTENT_TYPES_PATH)?.documentElement
  for (const entry of childElements(types)) {
    if ((attr(entry, 'ContentType') ?? '').includes('vbaProject') || (attr(entry, 'ContentType') ?? '').includes('macroEnabled')) {
      if (entry.localName === 'Default') types!.removeChild(entry)
    }
  }
}

/** Removes parts nothing links to any more (a deleted slide's chart, say), except imported orphans. */
function collectGarbage(pkg: OoxmlPackage, snapshot: PresentationSnapshot): void {
  const reachable = new Set<string>([CONTENT_TYPES_PATH])
  const queue = ['']
  while (queue.length) {
    const source = queue.pop()!
    const relsPath = relationshipsPathFor(source)
    if (pkg.has(relsPath)) reachable.add(relsPath)
    for (const rel of safeRelationships(pkg, source)) {
      if (rel.targetMode === 'External') continue
      const target = resolveTarget(source, rel.target)
      if (reachable.has(target) || !pkg.has(target)) continue
      reachable.add(target)
      if (pkg.has(relationshipsPathFor(target))) queue.push(target)
    }
  }
  for (const partPath of pkg.paths()) {
    if (reachable.has(partPath) || snapshot.parts[partPath]?.orphan) continue
    // A relationships part belongs to its source part: keep it while the source stays.
    const owner = relsOwner(partPath)
    if (owner !== undefined && (reachable.has(owner) || snapshot.parts[owner]?.orphan)) continue
    pkg.delete(partPath)
  }
}

function relsOwner(partPath: string): string | undefined {
  const match = /^(.*?)_rels\/([^/]+)\.rels$/.exec(partPath)
  return match ? `${match[1]}${match[2]}` : undefined
}

function safeRelationships(pkg: OoxmlPackage, part: string) {
  try {
    return pkg.relationships(part)
  } catch {
    return []
  }
}

function writeContentTypes(pkg: OoxmlPackage, snapshot: PresentationSnapshot, format: PresentationFormat): void {
  const types = pkg.xml(CONTENT_TYPES_PATH)!
  const root = types.documentElement!
  const present = new Set(pkg.paths())
  for (const override of childElements(root)) {
    if (override.localName !== 'Override') continue
    const partName = (attr(override, 'PartName') ?? '').replace(/^\//, '')
    if (!present.has(partName)) root.removeChild(override)
  }
  const want = (partPath: string, contentType: string) => {
    if (pkg.contentType(partPath) !== contentType) pkg.setContentType(partPath, contentType)
  }
  want(snapshot.mainPart, MAIN_CONTENT_TYPES[format])
  for (const slide of snapshot.slides) {
    want(slide.part!, CONTENT_TYPES.slide)
    if (slide.notes) want(slide.notes.part!, CONTENT_TYPES.notesSlide)
  }
  for (const partPath of pkg.paths()) {
    if (partPath === CONTENT_TYPES_PATH || pkg.contentType(partPath)) continue
    const extension = partPath.slice(partPath.lastIndexOf('.') + 1).toLowerCase()
    if (extension === 'rels') pkg.ensureDefaultContentType('rels', 'application/vnd.openxmlformats-package.relationships+xml')
    else if (extension === 'xml') pkg.ensureDefaultContentType('xml', 'application/xml')
    else pkg.ensureDefaultContentType(extension, snapshot.parts[partPath]?.contentType ?? mimeTypeFor(partPath))
  }
}

