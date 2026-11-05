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
import { slideSections } from './sections.js'
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
  // Every part name already taken, including slides and notes later in the deck: a new slide must
  // never take an existing slide's name, or links to that slide would silently point elsewhere.
  const usedParts = new Set<string>(Object.keys(snapshot.parts))
  for (const slide of snapshot.slides) {
    if (slide.part) usedParts.add(slide.part)
    if (slide.notes?.part) usedParts.add(slide.notes.part)
  }
  // And names of slides deleted since the file was read: links and custom shows that still name
  // one are cleared on export, but only while no new slide has taken the name.
  for (const name of retiredSlideParts(snapshot)) usedParts.add(name)
  const claimedParts = new Set<string>()
  const claim = (part: string | undefined) => {
    if (!part || claimedParts.has(part)) return false
    claimedParts.add(part)
    return true
  }
  const usedSlideIds = new Set<number>()
  const slideIds = new SlideIdAllocator(snapshot.slides.flatMap((slide) => (slide.sldId === undefined ? [] : [slide.sldId])))
  const slides = snapshot.slides.map((original) => {
    const slide: SlideSnapshot = { ...original }
    if (slide.sldId === undefined || usedSlideIds.has(slide.sldId) || slide.sldId < 256 || slide.sldId > MAX_SLIDE_ID) slide.sldId = slideIds.next()
    usedSlideIds.add(slide.sldId)
    if (!claim(slide.part)) {
      delete slide.source
      delete slide.relsSource
      slide.part = freePartName(usedParts, 'ppt/slides/slide', '.xml')
      claim(slide.part)
    }
    usedParts.add(slide.part!)
    if (slide.notes) {
      const notes = { ...slide.notes }
      if (!claim(notes.part)) {
        delete notes.source
        delete notes.relsSource
        notes.part = freePartName(usedParts, 'ppt/notesSlides/notesSlide', '.xml')
        claim(notes.part)
      }
      usedParts.add(notes.part!)
      slide.notes = notes
    }
    slide.shapes = assignShapeIds(slide.shapes, shapeIdsInXml(slide.xml))
    return slide
  })
  return { ...snapshot, slides }
}

/** Slide and notes part names the main part's relationships or any slide link still mention. */
function retiredSlideParts(snapshot: PresentationSnapshot): Set<string> {
  const names = new Set<string>()
  const relsPath = relationshipsPathFor(snapshot.mainPart)
  const bytes = snapshot.parts[relsPath]?.bytes
  if (bytes) {
    try {
      for (const element of childElements(parseXmlDocument(new TextDecoder().decode(bytes)).documentElement)) {
        const target = attr(element, 'Target')
        if (target && attr(element, 'TargetMode') !== 'External') names.add(resolveTarget(snapshot.mainPart, target))
      }
    } catch {
      // A damaged relationships part names nothing.
    }
  }
  const linked = (rels: Record<string, RelTarget>) => {
    for (const rel of Object.values(rels)) if (rel.type === REL_TYPES.slide && !rel.external) names.add(rel.target)
  }
  const walk = (shapes: ShapeSnapshot[]) => {
    for (const shape of shapes) {
      linked(shape.rels)
      if (shape.text && JSON.stringify(shape.text).includes('"link"')) {
        for (const paragraph of shape.text.content ?? []) for (const inline of paragraph.content ?? []) for (const mark of inline.marks ?? []) if (mark.type === 'link' && mark.attrs?.external === false && typeof mark.attrs.target === 'string') names.add(mark.attrs.target)
      }
      walk(shape.children ?? [])
    }
  }
  for (const slide of snapshot.slides) {
    linked(slide.rels)
    walk(slide.shapes)
  }
  return names
}

/** `ST_SlideId`: 256 through 2147483647. */
const MAX_SLIDE_ID = 2_147_483_647

/** New slide ids: after the highest one in use, or the lowest free one once the range is exhausted. */
class SlideIdAllocator {
  private readonly used: Set<number>
  private candidate: number

  constructor(existing: number[]) {
    this.used = new Set(existing)
    this.candidate = Math.max(255, ...existing.filter((id) => id <= MAX_SLIDE_ID)) + 1
  }

  next(): number {
    if (this.candidate > MAX_SLIDE_ID) this.candidate = 256
    while (this.used.has(this.candidate)) this.candidate++
    this.used.add(this.candidate)
    return this.candidate++
  }
}

function freePartName(used: Set<string>, prefix: string, suffix: string): string {
  for (let index = 1; ; index++) {
    const candidate = `${prefix}${index}${suffix}`
    if (!used.has(candidate)) return candidate
  }
}

/** `ST_DrawingElementId`; 0 is what templates for new shapes carry, meaning "not assigned yet". */
const validShapeId = (id: unknown): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0 && id <= MAX_COORDINATE

/** Shape ids inside template XML or content the model keeps whole (equations, ink, 3-D models). */
function shapeIdsInXml(xml: string): number[] {
  return [...xml.matchAll(/<(?:[\w.-]+:)?cNvPr\b[^>]*?\sid\s*=\s*['"](\d+)['"]/g)].map((match) => Number(match[1])).filter(validShapeId)
}

function assignShapeIds(shapes: ShapeSnapshot[], reserved: number[]): ShapeSnapshot[] {
  const used = new Set<number>([1, ...reserved])
  let next = 2
  const walk = (shape: ShapeSnapshot) => {
    if (shape.kind === 'opaque') for (const id of shapeIdsInXml(shape.xml)) {
      used.add(id)
      next = Math.max(next, id + 1)
    }
    else if (validShapeId(shape.nvId)) next = Math.max(next, shape.nvId + 1)
    shape.children?.forEach(walk)
  }
  shapes.forEach(walk)
  if (next > MAX_COORDINATE) next = 2
  const fresh = () => {
    while (used.has(next)) next = next >= MAX_COORDINATE ? 2 : next + 1
    return next++
  }
  const assign = (original: ShapeSnapshot): ShapeSnapshot => {
    const shape = { ...original }
    if (shape.kind !== 'opaque') {
      if (!validShapeId(shape.nvId) || used.has(shape.nvId)) shape.nvId = fresh()
      used.add(shape.nvId!)
    }
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
  // Only `p:sp` holds a text body; text on a group or picture (a stray command, a crafted paste)
  // would make the slide invalid, and grow by one body every time the file comes back.
  if (shape.kind === 'sp' && (differs(shape.bodyPr, derived.bodyPr) || differs(shape.text, derived.text))) {
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
    if (tbl) {
      writeTable(tbl, shape.table, derived.table, local)
      // The frame is the grid's size, as PowerPoint writes it; concurrent row and column inserts
      // each grow the stored frame, and only the grid knows their sum.
      const ext = child(child(element, 'xfrm', NS.p), 'ext', NS.a)
      if (ext && shape.table.columns.length && shape.table.rows.length) {
        ext.setAttribute('cx', emuValue(shape.table.columns.reduce((sum, column) => sum + (Number.isFinite(column.w) ? column.w : 0), 0), 0))
        ext.setAttribute('cy', emuValue(Math.max(Number(ext.getAttribute('cy')) || 0, shape.table.rows.reduce((sum, row) => sum + (Number.isFinite(row.h) ? row.h : 0), 0)), 0))
      }
    }
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

/** The largest coordinate written: `ST_PositiveCoordinate32`, which every reader accepts. */
const MAX_COORDINATE = 2_147_483_647

/** An integer attribute value: finite, rounded, and inside `[min, max]` (0 for anything not a number). */
export function emuValue(value: unknown, min = -MAX_COORDINATE, max = MAX_COORDINATE): string {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0
  return String(Math.min(max, Math.max(min, number)))
}

function xfrmElement(document: XmlDocument, xfrm: Xfrm, name: 'a:xfrm' | 'p:xfrm'): XmlElement {
  const element = createElement(document, name)
  if (xfrm.rot && Number.isFinite(xfrm.rot)) element.setAttribute('rot', emuValue(xfrm.rot))
  if (xfrm.flipH) element.setAttribute('flipH', '1')
  if (xfrm.flipV) element.setAttribute('flipV', '1')
  const point = (tag: string, a: string, b: string, x: number, y: number, min?: number) => {
    const entry = createElement(document, tag)
    entry.setAttribute(a, emuValue(x, min))
    entry.setAttribute(b, emuValue(y, min))
    element.appendChild(entry)
  }
  point('a:off', 'x', 'y', xfrm.x, xfrm.y)
  point('a:ext', 'cx', 'cy', xfrm.cx, xfrm.cy, 0)
  if (xfrm.chX !== undefined || xfrm.chY !== undefined) point('a:chOff', 'x', 'y', xfrm.chX ?? 0, xfrm.chY ?? 0)
  if (xfrm.chCx !== undefined || xfrm.chCy !== undefined) point('a:chExt', 'cx', 'cy', xfrm.chCx ?? 0, xfrm.chCy ?? 0, 0)
  return element
}

const EMPTY_CELL = '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody><a:tcPr/></a:tc>'

/** What a cell's template says, in model terms. */
function templateCell(tc: XmlElement, rels: RelationshipTable): { text: TableSnapshot['rows'][number]['cells'][string]['text']; tcPr?: string } {
  const txBody = child(tc, 'txBody', NS.a)
  const tcPr = child(tc, 'tcPr', NS.a)
  const resolver = { target: (id: string) => {
    const rel = rels.entries.get(id)
    return rel && { target: rel.target, external: rel.external === true, type: rel.type }
  } }
  return { text: txBody ? readTextBody(txBody, resolver) : readTextBody(tc, resolver), ...(tcPr ? { tcPr: serializeNode(tcPr) } : {}) }
}

function writeTable(tbl: XmlElement, table: TableSnapshot, derived: TableSnapshot | undefined, rels: RelationshipTable): void {
  const document = tbl.ownerDocument as unknown as XmlDocument
  if (differs(table.tblPr, derived?.tblPr)) replaceOrInsert(tbl, child(tbl, 'tblPr', NS.a), fragment(document, table.tblPr), ['tblGrid', 'tr'])
  const grid = child(tbl, 'tblGrid', NS.a) ?? tbl.insertBefore(createElement(document, 'a:tblGrid'), child(tbl, 'tr', NS.a) ?? null)
  for (const column of childElements(grid)) grid.removeChild(column)
  for (const column of table.columns) {
    const element = importFragment(document, column.xml)
    element.setAttribute('w', emuValue(column.w, 0))
    grid.appendChild(element)
  }
  const anchor = childElements(tbl).find((element) => element.localName === 'extLst') ?? null
  for (const row of childElements(tbl)) if (row.localName === 'tr') tbl.removeChild(row)
  for (const row of table.rows) {
    const element = importFragment(document, row.xml)
    element.setAttribute('h', emuValue(row.h, 0))
    const rowExtLst = child(element, 'extLst', NS.a)
    for (const column of table.columns) {
      const cell = row.cells[column.key]
      const tc = importFragment(document, cell?.xml ?? EMPTY_CELL)
      // Compare with this cell's own template, not a row matched by key: keys from a pushed file
      // are positional and need not match the template's row.
      const before = cell ? templateCell(tc, rels) : undefined
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
  // Row ids (`a16:rowId`) must be unique; copies made by concurrent edits drop theirs.
  const rowIds = new Set<string>()
  for (const row of childElements(tbl)) {
    if (row.localName !== 'tr') continue
    const extLst = child(row, 'extLst', NS.a)
    for (const extension of childElements(extLst)) {
      const id = childElements(extension).find((entry) => entry.localName === 'rowId')?.getAttribute('val')
      if (id === undefined || id === null) continue
      if (rowIds.has(id)) extLst!.removeChild(extension)
      else rowIds.add(id)
    }
    if (extLst && !childElements(extLst).length) row.removeChild(extLst)
  }
}

// ---------------------------------------------------------------------------------------------
// Slides and notes

interface WrittenPart {
  xml: Uint8Array
  rels: Uint8Array
}

/** Writes a slide; returns its original bytes when nothing the model covers has changed. */
function writeSlide(slide: SlideSnapshot, liveParts: ReadonlySet<string>): WrittenPart {
  if (slide.source && !linksToDeletedSlides(slide, liveParts) && slideUnchanged(slide)) {
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
  for (const shape of slide.shapes) {
    // A shape whose stored XML cannot be built (corrupt data from a bad paste or a buggy client)
    // is left out rather than making the whole deck impossible to save.
    let element: XmlElement
    try {
      element = buildShapeElement(document, shape, prefixes, table)
    } catch {
      continue
    }
    tree.insertBefore(element, treeExtLst)
  }
  dropDeadSlideLinks(root, table, liveParts)
  pruneShapeReferences(root)
  pruneRedundantNamespaces(root)
  return { xml: strToU8(serializeDocument(document)), rels: sameRelationships(slide.relsSource, part, table) ?? strToU8(table.toXml(part)) }
}

/** Whether a slide (as stored) links to a slide part that is not in the deck any more. */
function linksToDeletedSlides(slide: SlideSnapshot, liveParts: ReadonlySet<string>): boolean {
  const dead = (rel: RelTarget) => rel.type === REL_TYPES.slide && !rel.external && !liveParts.has(rel.target)
  if (Object.values(slide.rels).some(dead)) return true
  const shapes = (list: ShapeSnapshot[]): boolean => list.some((shape) => Object.values(shape.rels).some(dead) || shapes(shape.children ?? []) || linkMarksDead(shape.text))
  const linkMarksDead = (text: ShapeSnapshot['text']): boolean =>
    JSON.stringify(text ?? '').includes('"link"') &&
    (text?.content ?? []).some((paragraph) => (paragraph.content ?? []).some((inline) => (inline.marks ?? []).some((mark) => mark.type === 'link' && mark.attrs?.external === false && (mark.attrs.relType ?? REL_TYPES.slide) === REL_TYPES.slide && typeof mark.attrs.target === 'string' && !liveParts.has(mark.attrs.target))))
  return shapes(slide.shapes)
}

/**
 * Links to slides that were deleted lose their relationship; the link keeps its action with an
 * empty id, which is how PowerPoint itself leaves a link whose target slide is gone.
 */
function dropDeadSlideLinks(root: XmlElement, table: RelationshipTable, liveParts: ReadonlySet<string>): void {
  const dead = new Set<string>()
  for (const [id, rel] of table.entries) {
    if (rel.type === REL_TYPES.slide && !rel.external && !liveParts.has(rel.target)) dead.add(id)
  }
  if (!dead.size) return
  for (const id of dead) table.entries.delete(id)
  const stack: XmlElement[] = [root]
  while (stack.length) {
    const node = stack.pop()!
    for (let index = 0; index < node.attributes.length; index++) {
      const attribute = node.attributes.item(index)!
      if (attribute.namespaceURI === NS.r && dead.has(attribute.value)) attribute.value = ''
    }
    stack.push(...childElements(node))
  }
}

/**
 * Animations and connector glue name shapes by id. When those shapes are gone, the references
 * go too (as when deleting a shape in PowerPoint), so the file never points at missing shapes.
 */
function pruneShapeReferences(root: XmlElement): void {
  const ids = new Set<string>()
  const all: XmlElement[] = []
  const stack: XmlElement[] = [root]
  while (stack.length) {
    const node = stack.pop()!
    all.push(node)
    if (node.localName === 'cNvPr') ids.add(node.getAttribute('id') ?? '')
    stack.push(...childElements(node))
  }
  for (const node of all) {
    if (!node.parentNode) continue
    const name = node.localName
    if ((name === 'stCxn' || name === 'endCxn') && !ids.has(node.getAttribute('id') ?? '')) node.parentNode.removeChild(node)
    else if (BUILD_ELEMENTS.has(name ?? '') && !ids.has(node.getAttribute('spid') ?? '')) node.parentNode.removeChild(node)
    else if ((name === 'spTgt' || name === 'inkTgt') && !ids.has(node.getAttribute('spid') ?? '')) removeAnimation(node)
  }
  pruneEmptyTiming(root)
}

/** `p:bldLst` entries, each naming the shape it builds by `spid`. */
const BUILD_ELEMENTS = new Set(['bldP', 'bldGraphic', 'bldDgm', 'bldOleChart'])

/**
 * Sequences and build lists must not be empty. Once the last animation in one is gone, it goes;
 * with no time nodes left at all, so does the slide's `p:timing`.
 */
function pruneEmptyTiming(root: XmlElement): void {
  const timing = child(root, 'timing', NS.p)
  if (!timing) return
  const timeNodes = (container: XmlElement | undefined) => childElements(child(container, 'childTnLst', NS.p))
  const sequences: XmlElement[] = []
  const stack = [timing]
  while (stack.length) {
    const node = stack.pop()!
    if (node.localName === 'seq' && node.namespaceURI === NS.p) sequences.push(node)
    stack.push(...childElements(node))
  }
  for (const sequence of sequences) {
    if (timeNodes(child(sequence, 'cTn', NS.p)).length) continue
    const list = sequence.parentNode as XmlElement | null
    list?.removeChild(sequence)
  }
  const buildList = child(timing, 'bldLst', NS.p)
  if (buildList && !childElements(buildList).length) timing.removeChild(buildList)
  const rootNode = child(child(child(timing, 'tnLst', NS.p), 'par', NS.p), 'cTn', NS.p)
  if (child(timing, 'tnLst', NS.p) && !timeNodes(rootNode).length) root.removeChild(timing)
}

/** Removes the effect a target belongs to, then any time nodes it leaves empty (never the timing root). */
function removeAnimation(target: XmlElement): void {
  let par: XmlElement | null = target
  while (par && par.localName !== 'par') par = par.parentNode as XmlElement | null
  while (par && (par.parentNode as XmlElement | null)?.localName === 'childTnLst') {
    const list = par.parentNode as XmlElement
    list.removeChild(par)
    if (childElements(list).length) break
    // childTnLst → cTn → par: the enclosing time node, now empty.
    par = (list.parentNode?.parentNode as XmlElement | null) ?? null
    if (par?.localName !== 'par') break
  }
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

function writeNotes(notes: NotesSnapshot, slidePart: string, notesMaster: string, liveParts: ReadonlySet<string>): WrittenPart {
  const part = notes.part!
  const table = new RelationshipTable()
  // Slide relationships nothing in the notes refers to name the notes' own slide, which may have
  // been renamed or copied: they point at it. Referenced ones are links, kept while their slide is.
  const referenced = notesReferences(notes)
  for (const [id, rel] of Object.entries(notes.rels)) {
    if (rel.type !== REL_TYPES.slide || rel.external) table.set(id, rel)
    else if (!referenced.has(id)) table.set(id, { ...rel, target: slidePart })
    else if (liveParts.has(rel.target)) table.set(id, rel)
  }
  table.allocate(REL_TYPES.notesMaster, notesMaster, false)
  table.allocate(REL_TYPES.slide, slidePart, false)
  const deadLinks = notesLinkToDeletedSlide(notes, liveParts)
  if (notes.source && notes.xml && !deadLinks) {
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
  dropDeadSlideLinks(document.documentElement!, table, new Set([...liveParts, slidePart]))
  pruneRedundantNamespaces(document.documentElement!)
  return { xml: strToU8(serializeDocument(document)), rels: strToU8(table.toXml(part)) }
}

/** Relationship ids the notes page's XML and text refer to. */
function notesReferences(notes: NotesSnapshot): Set<string> {
  const ids = new Set<string>()
  for (const [, id] of notes.xml.matchAll(/\br:(?:id|embed|link|pict)="([^"]*)"/g)) ids.add(id!)
  for (const paragraph of notes.text.content ?? []) {
    for (const inline of paragraph.content ?? []) {
      for (const mark of inline.marks ?? []) {
        const xml = typeof mark.attrs?.xml === 'string' ? mark.attrs.xml : typeof mark.attrs?.value === 'string' ? mark.attrs.value : ''
        for (const [, id] of xml.matchAll(/\br:(?:id|embed|link|pict)="([^"]*)"/g)) ids.add(id!)
      }
    }
  }
  return ids
}

function notesLinkToDeletedSlide(notes: NotesSnapshot, liveParts: ReadonlySet<string>): boolean {
  return (notes.text.content ?? []).some((paragraph) => (paragraph.content ?? []).some((inline) => (inline.marks ?? []).some((mark) => mark.type === 'link' && mark.attrs?.external === false && (mark.attrs.relType ?? REL_TYPES.slide) === REL_TYPES.slide && typeof mark.attrs.target === 'string' && !liveParts.has(mark.attrs.target))))
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

  const liveParts = new Set(snapshot.slides.map((slide) => slide.part!))
  for (const slide of unshareSlideParts(pkg, snapshot.slides)) {
    const written = writeSlide(slide, liveParts)
    pkg.set(slide.part!, written.xml)
    pkg.set(relationshipsPathFor(slide.part!), written.rels)
    if (slide.notes) {
      const notes = writeNotes(slide.notes, slide.part!, notesMaster!, liveParts)
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
  const members = new Map<string, number[]>(snapshot.sections.map((section) => [section.key, []]))
  const assigned = slideSections(snapshot.sections.map((section) => section.key), snapshot.slides)
  snapshot.slides.forEach((slide, index) => members.get(assigned[index]!)!.push(slide.sldId!))
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

  // Custom shows list slides through relationships; entries for removed slides go with them.
  const liveIds = new Set(pkg.relationships(mainPart).map((rel) => rel.id))
  for (const show of childElements(child(presentation, 'custShowLst', NS.p))) {
    for (const entry of childElements(child(show, 'sldLst', NS.p))) {
      if (!liveIds.has(entry.getAttributeNS(NS.r, 'id') ?? '')) entry.parentNode!.removeChild(entry)
    }
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

/** Relationship types whose part belongs to one slide: PowerPoint copies them when it duplicates a slide. */
const PER_SLIDE_TYPES = new Set([
  REL_TYPES.chart,
  REL_TYPES.diagramData,
  REL_TYPES.diagramLayout,
  REL_TYPES.diagramStyle,
  REL_TYPES.diagramColors,
  REL_TYPES.diagramDrawing,
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package',
])

/**
 * A chart, diagram, or embedded object two slides share (a duplicated slide's copy, say) is given
 * to the first slide; later ones get a copy, with the copy's own embedded workbook and styles.
 */
function unshareSlideParts(pkg: OoxmlPackage, slides: SlideSnapshot[]): SlideSnapshot[] {
  const owners = new Map<string, string>()
  return slides.map((slide) => {
    const copies = new Map<string, string>()
    const remap = (rels: Record<string, RelTarget>): Record<string, RelTarget> => {
      let changed = false
      const result: Record<string, RelTarget> = {}
      for (const [id, rel] of Object.entries(rels)) {
        if (rel.external || !PER_SLIDE_TYPES.has(rel.type) || !pkg.has(rel.target)) {
          result[id] = rel
          continue
        }
        const owner = owners.get(rel.target)
        if (owner === undefined || owner === slide.key) {
          owners.set(rel.target, slide.key)
          result[id] = rel
          continue
        }
        let copy = copies.get(rel.target)
        if (!copy) {
          copy = copyPartTree(pkg, rel.target, new Map())
          copies.set(rel.target, copy)
          owners.set(copy, slide.key)
        }
        result[id] = { ...rel, target: copy }
        changed = true
      }
      return changed ? result : rels
    }
    const shapes = (list: ShapeSnapshot[]): ShapeSnapshot[] => list.map((shape) => ({ ...shape, rels: remap(shape.rels), ...(shape.children ? { children: shapes(shape.children) } : {}) }))
    return { ...slide, rels: remap(slide.rels), shapes: shapes(slide.shapes) }
  })
}

/** Copies a part under a free name next to it, with what it links to (except media), and returns the copy's name. */
function copyPartTree(pkg: OoxmlPackage, partPath: string, copied: Map<string, string>): string {
  const existing = copied.get(partPath)
  if (existing) return existing
  const match = /^(.*?)(\d*)(\.[^./]+)$/.exec(partPath)
  const [, stem, , extension] = match ?? [partPath, partPath, '', '']
  let index = 1
  while (pkg.has(`${stem}${index}${extension}`)) index++
  const target = `${stem}${index}${extension}`
  copied.set(partPath, target)
  pkg.set(target, pkg.get(partPath)!)
  const contentType = pkg.contentType(partPath)
  if (contentType && contentType !== pkg.contentType(target)) pkg.setContentType(target, contentType)
  const relsPath = relationshipsPathFor(partPath)
  if (pkg.has(relsPath)) {
    const table = new RelationshipTable()
    for (const rel of safeRelationships(pkg, partPath)) {
      if (rel.targetMode === 'External') {
        table.set(rel.id, { type: rel.type, target: rel.target, external: true })
        continue
      }
      const resolved = resolveTarget(partPath, rel.target)
      const child = pkg.has(resolved) && !resolved.startsWith('ppt/media/') && !/\/(slides|slideLayouts|slideMasters|theme)\//.test(`/${resolved}`) ? copyPartTree(pkg, resolved, copied) : resolved
      table.set(rel.id, { type: rel.type, target: child })
    }
    pkg.set(relationshipsPathFor(target), strToU8(table.toXml(target)))
  }
  return target
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
  // Parts whose type the extension's Default does not give (a pasted chart is `.xml` but not
  // `application/xml`, a WebP among PNGs) get an Override. The main part, slides and notes were
  // set above, from the format being written.
  const handled = new Set([snapshot.mainPart, ...snapshot.slides.flatMap((slide) => [slide.part!, ...(slide.notes ? [slide.notes.part!] : [])])])
  for (const partPath of pkg.paths()) {
    const contentType = snapshot.parts[partPath]?.contentType
    if (contentType && !handled.has(partPath) && partPath !== CONTENT_TYPES_PATH) want(partPath, contentType)
  }
}

