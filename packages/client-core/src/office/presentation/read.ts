import { LiveFormatError, type LiveAssetStore } from '../live-format.js'
import { OoxmlPackage, relationshipsPathFor, resolveTarget, type PackageLimits } from '../ooxml/package.js'
import type {
  NotesSnapshot,
  PartSnapshot,
  PresentationSnapshot,
  RelTarget,
  SectionSnapshot,
  ShapeKind,
  ShapeSnapshot,
  SlideSnapshot,
  TableSnapshot,
  Xfrm,
} from './model.js'
import { readTextBody, type RelationshipResolver } from './text.js'
import {
  attr,
  boolAttr,
  checkDepth,
  child,
  childElements,
  intAttr,
  NS,
  path,
  REL_TYPES,
  serializeNode,
  STRICT_NAMESPACE_PREFIX,
  type XmlElement,
} from './xml.js'

/** Limits on what one deck may contain, so hostile files fail fast instead of hanging. */
export interface PresentationLimits extends PackageLimits {
  maxSlides: number
  maxShapesPerSlide: number
  /** Largest slide side, in EMU (PowerPoint's own limit is 56 inches). */
  maxSlideSide: number
}

export const DEFAULT_PRESENTATION_LIMITS: PresentationLimits = {
  maxEntries: 10_000,
  maxUncompressedBytes: 512 * 1024 * 1024,
  maxSlides: 5_000,
  maxShapesPerSlide: 10_000,
  maxSlideSide: 51_206_400,
}

/** Nested groups deeper than this are refused (PowerPoint itself cannot make them this deep). */
const MAX_GROUP_DEPTH = 64

export const SECTION_LIST_EXT_URI = '{521415D9-36F7-43E2-AB2F-B90AF26B5E84}'

export interface ReadOptions {
  /** Stores binary parts; when absent, they are hashed but not kept (diffs only need to compare). */
  assets?: LiveAssetStore
  limits?: PresentationLimits
}

/** Reads a .pptx/.potx/.ppsx/.pptm package into a snapshot. Throws LiveFormatError. */
export async function readPresentation(bytes: Uint8Array, options: ReadOptions = {}): Promise<PresentationSnapshot> {
  const limits = options.limits ?? DEFAULT_PRESENTATION_LIMITS
  const pkg = OoxmlPackage.read(bytes, limits)
  const mainPart = pkg.mainPart()
  if (!mainPart || !pkg.has(mainPart)) throw new LiveFormatError('corrupt', 'This package has no presentation part')
  const presentation = pkg.xml(mainPart)!.documentElement!
  checkDepth(presentation)
  if (presentation.namespaceURI?.startsWith(STRICT_NAMESPACE_PREFIX)) {
    throw new LiveFormatError('unsupported', 'Strict Office Open XML presentations are not supported')
  }
  if (presentation.localName !== 'presentation' || presentation.namespaceURI !== NS.p) {
    throw new LiveFormatError('corrupt', 'The main part is not a presentation')
  }

  const slideSize = child(presentation, 'sldSz', NS.p)
  const notesSize = child(presentation, 'notesSz', NS.p)
  const slideWidth = clampSide(intAttr(slideSize, 'cx') ?? 9_144_000, limits)
  const slideHeight = clampSide(intAttr(slideSize, 'cy') ?? 6_858_000, limits)

  const slideParts: { sldId: number; part: string }[] = []
  const seenParts = new Set<string>()
  for (const entry of children(path(presentation, 'sldIdLst'), 'sldId')) {
    const id = relAttr(entry, 'id')
    const part = id ? pkg.relationshipTarget(mainPart, id) : undefined
    const sldId = intAttr(entry, 'id')
    // Duplicate references to one part and dangling ids cannot be written back faithfully; PowerPoint drops them too.
    if (!part || sldId === undefined || seenParts.has(part) || !pkg.has(part)) continue
    seenParts.add(part)
    slideParts.push({ sldId, part })
  }
  if (slideParts.length > limits.maxSlides) throw new LiveFormatError('too_large', 'This presentation has too many slides')

  const modeled = new Set<string>()
  const slides: SlideSnapshot[] = []
  const sectionBySlide = readSectionMembership(presentation)
  for (const { sldId, part } of slideParts) {
    const slide = readSlide(pkg, part, sldId, limits)
    slide.section = sectionBySlide.get(sldId)
    slides.push(slide)
    modeled.add(part)
    modeled.add(relationshipsPathFor(part))
    if (slide.notes?.part) {
      modeled.add(slide.notes.part)
      modeled.add(relationshipsPathFor(slide.notes.part))
    }
  }

  const reachable = reachableParts(pkg)
  const parts: Record<string, PartSnapshot> = {}
  for (const partPath of pkg.paths()) {
    if (modeled.has(partPath)) continue
    parts[partPath] = await readPart(pkg, partPath, options.assets, !reachable.has(partPath))
  }

  return {
    mainPart,
    slideWidth,
    slideHeight,
    notesWidth: clampSide(intAttr(notesSize, 'cx') ?? 6_858_000, limits),
    notesHeight: clampSide(intAttr(notesSize, 'cy') ?? 9_144_000, limits),
    parts,
    slides,
    sections: readSections(presentation),
  }
}

function clampSide(value: number, limits: PresentationLimits): number {
  if (value <= 0) throw new LiveFormatError('corrupt', 'This presentation has an invalid slide size')
  if (value > limits.maxSlideSide) throw new LiveFormatError('too_large', 'This presentation has an oversized slide size')
  return value
}

function children(parent: XmlElement | undefined, localName: string): XmlElement[] {
  return childElements(parent).filter((element) => element.localName === localName)
}

function relAttr(element: XmlElement, localName: string): string | undefined {
  return element.getAttributeNS(NS.r, localName) || undefined
}

const BINARY_SUFFIX = /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|wdp|jxr|mp4|m4v|mov|wmv|avi|mp3|m4a|wav|wma|bin|xlsx|xlsm|docx|pptx|odttf|fntdata|ttf|otf|zip|jpeg)$/i

async function readPart(pkg: OoxmlPackage, partPath: string, assets: LiveAssetStore | undefined, orphan: boolean): Promise<PartSnapshot> {
  const bytes = pkg.get(partPath)!
  const contentType = pkg.contentType(partPath)
  const isXml = !BINARY_SUFFIX.test(partPath) && (partPath.endsWith('.xml') || partPath.endsWith('.rels') || /xml/.test(contentType ?? ''))
  const snapshot: PartSnapshot = {}
  if (contentType) snapshot.contentType = contentType
  if (orphan) snapshot.orphan = true
  if (isXml || !assets) {
    snapshot.bytes = bytes
  } else {
    snapshot.asset = await assets.put(bytes, mimeTypeFor(partPath, contentType))
  }
  return snapshot
}

export function mimeTypeFor(partPath: string, contentType?: string): string {
  if (contentType && !contentType.includes('openxmlformats') && !contentType.endsWith('+xml')) return contentType
  const extension = partPath.slice(partPath.lastIndexOf('.') + 1).toLowerCase()
  const known: Record<string, string> = {
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
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
  }
  return known[extension] ?? contentType ?? 'application/octet-stream'
}

/** Every part reachable from the package relationships. */
function reachableParts(pkg: OoxmlPackage): Set<string> {
  const reachable = new Set<string>()
  const queue = ['']
  while (queue.length) {
    const source = queue.pop()!
    const relsPath = relationshipsPathFor(source)
    if (pkg.has(relsPath)) reachable.add(relsPath)
    let relationships
    try {
      relationships = pkg.relationships(source)
    } catch {
      continue
    }
    for (const relationship of relationships) {
      if (relationship.targetMode === 'External') continue
      const target = resolveTarget(source, relationship.target)
      if (reachable.has(target) || !pkg.has(target)) continue
      reachable.add(target)
      if (target.endsWith('.xml')) queue.push(target)
    }
  }
  reachable.add('[Content_Types].xml')
  return reachable
}

function sectionList(presentation: XmlElement): XmlElement | undefined {
  for (const ext of children(child(presentation, 'extLst', NS.p), 'ext')) {
    if (attr(ext, 'uri') === SECTION_LIST_EXT_URI) return childElements(ext).find((element) => element.localName === 'sectionLst')
  }
  return undefined
}

function readSections(presentation: XmlElement): SectionSnapshot[] {
  return children(sectionList(presentation), 'section').map((section, index) => ({
    key: `section-${index}`,
    name: attr(section, 'name') ?? '',
    id: attr(section, 'id') ?? '',
  }))
}

function readSectionMembership(presentation: XmlElement): Map<number, string> {
  const membership = new Map<number, string>()
  children(sectionList(presentation), 'section').forEach((section, index) => {
    for (const entry of children(child(section, 'sldIdLst'), 'sldId')) {
      const id = intAttr(entry, 'id')
      if (id !== undefined && !membership.has(id)) membership.set(id, `section-${index}`)
    }
  })
  return membership
}

function relationshipMap(pkg: OoxmlPackage, part: string): Map<string, RelTarget> {
  const map = new Map<string, RelTarget>()
  for (const relationship of pkg.relationships(part)) {
    const external = relationship.targetMode === 'External'
    map.set(relationship.id, {
      type: relationship.type,
      target: external ? relationship.target : resolveTarget(part, relationship.target),
      ...(external ? { external: true } : {}),
    })
  }
  return map
}

function resolverFor(rels: Map<string, RelTarget>): RelationshipResolver {
  return {
    target(id) {
      const rel = rels.get(id)
      return rel && { target: rel.target, external: rel.external === true }
    },
  }
}

/** Shape-tree children that are not shapes. */
const TREE_PROPERTIES = new Set(['nvGrpSpPr', 'grpSpPr', 'extLst'])

export function readSlide(pkg: OoxmlPackage, part: string, sldId: number | undefined, limits: PresentationLimits = DEFAULT_PRESENTATION_LIMITS): SlideSnapshot {
  const document = pkg.xml(part)!
  const root = document.documentElement!
  if (root.localName !== 'sld') throw new LiveFormatError('corrupt', `${part} is not a slide`)
  // Before anything walks or clones the tree: hostile nesting would otherwise cost quadratic memory.
  checkDepth(root)
  const rels = relationshipMap(pkg, part)
  const frame = root.cloneNode(true) as XmlElement
  const cSld = child(frame, 'cSld', NS.p)
  const tree = child(cSld, 'spTree', NS.p)
  const background = child(cSld, 'bg', NS.p)
  const shapes: ShapeSnapshot[] = []
  const usedIds = new Set<string>()
  const counter = { shapes: 0, limit: limits.maxShapesPerSlide }
  if (tree) {
    for (const element of childElements(tree)) {
      if (TREE_PROPERTIES.has(element.localName ?? '')) continue
      shapes.push(readShape(element, rels, usedIds, counter, 0))
      tree.removeChild(element)
    }
  }
  if (background) cSld!.removeChild(background)

  const shapeRelIds = new Set<string>()
  const collect = (shape: ShapeSnapshot) => {
    for (const id of Object.keys(shape.rels)) shapeRelIds.add(id)
    shape.children?.forEach(collect)
  }
  shapes.forEach(collect)
  const frameRelIds = new Set(relationshipIdsIn(frame))
  if (background) for (const id of relationshipIdsIn(background)) frameRelIds.add(id)

  let layout = ''
  let notes: NotesSnapshot | undefined
  const slideRels: Record<string, RelTarget> = {}
  for (const [id, rel] of rels) {
    if (rel.type === REL_TYPES.slideLayout && !rel.external) layout = rel.target
    else if (rel.type === REL_TYPES.notesSlide && !rel.external) notes = pkg.has(rel.target) ? readNotes(pkg, rel.target) : undefined
    else if (!shapeRelIds.has(id) || frameRelIds.has(id)) slideRels[id] = rel
  }

  return {
    key: sldId === undefined ? `slide-${part}` : `slide-${sldId}`,
    ...(sldId === undefined ? {} : { sldId }),
    part,
    layout,
    hidden: attr(root, 'show') === '0',
    xml: serializeNode(frame),
    ...(background ? { background: serializeNode(background) } : {}),
    rels: slideRels,
    shapes,
    ...(notes ? { notes } : {}),
    source: pkg.get(part)!,
    ...(pkg.has(relationshipsPathFor(part)) ? { relsSource: pkg.get(relationshipsPathFor(part))! } : {}),
  }
}

/** Every `r:` attribute value in a subtree, plus `relId`s that DrawingML extensions use. */
export function relationshipIdsIn(element: XmlElement): string[] {
  const ids: string[] = []
  const stack: XmlElement[] = [element]
  while (stack.length) {
    const node = stack.pop()!
    for (let index = 0; index < node.attributes.length; index++) {
      const attribute = node.attributes.item(index)!
      if (attribute.namespaceURI === NS.r && attribute.value) ids.push(attribute.value)
    }
    stack.push(...childElements(node))
  }
  return ids
}

function nonVisualProperties(element: XmlElement): XmlElement | undefined {
  const nv = childElements(element).find((entry) => entry.localName?.startsWith('nv'))
  return nv ? child(nv, 'cNvPr', NS.p) : undefined
}

function shapeKind(element: XmlElement): ShapeKind {
  if (element.namespaceURI !== NS.p) return 'opaque'
  switch (element.localName) {
    case 'sp':
    case 'pic':
    case 'cxnSp':
    case 'grpSp':
    case 'graphicFrame':
      return element.localName
    default:
      return 'opaque'
  }
}

export function readXfrm(xfrm: XmlElement | undefined): Xfrm | undefined {
  if (!xfrm) return undefined
  const off = child(xfrm, 'off', NS.a)
  const ext = child(xfrm, 'ext', NS.a)
  const result: Xfrm = { x: intAttr(off, 'x') ?? 0, y: intAttr(off, 'y') ?? 0, cx: intAttr(ext, 'cx') ?? 0, cy: intAttr(ext, 'cy') ?? 0 }
  const rot = intAttr(xfrm, 'rot')
  if (rot) result.rot = rot
  if (boolAttr(xfrm, 'flipH')) result.flipH = true
  if (boolAttr(xfrm, 'flipV')) result.flipV = true
  const chOff = child(xfrm, 'chOff', NS.a)
  const chExt = child(xfrm, 'chExt', NS.a)
  if (chOff) {
    result.chX = intAttr(chOff, 'x') ?? 0
    result.chY = intAttr(chOff, 'y') ?? 0
  }
  if (chExt) {
    result.chCx = intAttr(chExt, 'cx') ?? 0
    result.chCy = intAttr(chExt, 'cy') ?? 0
  }
  return result
}

/** The element holding a shape's geometry and fill: `spPr`, `grpSpPr`, or none for graphic frames. */
export function shapeProperties(element: XmlElement): XmlElement | undefined {
  return child(element, 'spPr', NS.p) ?? child(element, 'grpSpPr', NS.p) ?? child(element, 'spPr', NS.dsp) ?? child(element, 'grpSpPr', NS.dsp)
}

export const FILL_NAMES = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'])

export function readShape(
  element: XmlElement,
  rels: Map<string, RelTarget>,
  usedKeys: Set<string>,
  counter: { shapes: number; limit: number },
  depth: number,
): ShapeSnapshot {
  if (++counter.shapes > counter.limit) throw new LiveFormatError('too_large', 'A slide has too many shapes')
  if (depth > MAX_GROUP_DEPTH) throw new LiveFormatError('corrupt', 'Shapes are nested too deeply')
  const kind = shapeKind(element)
  const template = element.cloneNode(true) as XmlElement
  const cNvPr = kind === 'opaque' ? undefined : nonVisualProperties(element)
  const nvId = intAttr(cNvPr, 'id')
  const shape: ShapeSnapshot = { key: uniqueKey(nvId === undefined ? 'x' : `s${nvId}`, usedKeys), kind, xml: '', rels: {} }
  if (nvId !== undefined) shape.nvId = nvId
  const name = attr(cNvPr, 'name')
  if (name !== undefined) shape.name = name
  const descr = attr(cNvPr, 'descr')
  if (descr !== undefined) shape.descr = descr
  if (boolAttr(cNvPr, 'hidden')) shape.hidden = true

  if (kind !== 'opaque') {
    const properties = shapeProperties(element)
    const xfrm = kind === 'graphicFrame' ? child(element, 'xfrm', NS.p) : child(properties, 'xfrm', NS.a)
    const transform = readXfrm(xfrm)
    if (transform) shape.xfrm = transform
    for (const entry of childElements(properties)) {
      const local = entry.localName ?? ''
      if (local === 'prstGeom' || local === 'custGeom') shape.geom = serializeNode(entry)
      else if (FILL_NAMES.has(local)) shape.fill = serializeNode(entry)
      else if (local === 'ln') shape.line = serializeNode(entry)
      else if (local === 'effectLst') shape.effects = serializeNode(entry)
    }
    const blipFill = child(element, 'blipFill', NS.p)
    if (kind === 'pic' && blipFill) shape.blipFill = serializeNode(blipFill)
    const txBody = child(element, 'txBody', NS.p)
    if (txBody) {
      const bodyPr = child(txBody, 'bodyPr', NS.a)
      if (bodyPr) shape.bodyPr = serializeNode(bodyPr)
      shape.text = readTextBody(txBody, resolverFor(rels))
    }
    const table = path(element, 'graphic', 'graphicData', 'tbl')
    if (kind === 'graphicFrame' && table) shape.table = readTable(table, rels)
  }

  if (kind === 'grpSp') {
    shape.children = []
    for (const member of childElements(element)) {
      if (TREE_PROPERTIES.has(member.localName ?? '')) continue
      shape.children.push(readShape(member, rels, usedKeys, counter, depth + 1))
    }
    for (const member of childElements(template)) if (!TREE_PROPERTIES.has(member.localName ?? '')) template.removeChild(member)
  }

  const ownIds = kind === 'grpSp' ? relationshipIdsIn(template) : relationshipIdsIn(element)
  for (const id of ownIds) {
    const rel = rels.get(id)
    if (rel) shape.rels[id] = rel
  }
  shape.xml = serializeNode(template)
  return shape
}

function uniqueKey(base: string, used: Set<string>): string {
  let key = base
  for (let suffix = 2; used.has(key); suffix++) key = `${base}-${suffix}`
  used.add(key)
  return key
}

function readTable(table: XmlElement, rels: Map<string, RelTarget>): TableSnapshot {
  const tblPr = child(table, 'tblPr', NS.a)
  const columns = children(child(table, 'tblGrid', NS.a), 'gridCol').map((column, index) => ({
    key: `c${index}`,
    w: intAttr(column, 'w') ?? 0,
    xml: serializeNode(column),
  }))
  const rows = children(table, 'tr').map((row, rowIndex) => {
    const template = row.cloneNode(true) as XmlElement
    for (const cell of children(template, 'tc')) template.removeChild(cell)
    const cells: TableSnapshot['rows'][number]['cells'] = {}
    children(row, 'tc').forEach((cell, columnIndex) => {
      if (columnIndex >= columns.length) return
      const txBody = child(cell, 'txBody', NS.a)
      const tcPr = child(cell, 'tcPr', NS.a)
      cells[columns[columnIndex]!.key] = {
        xml: serializeNode(cell),
        text: txBody ? readTextBody(txBody, resolverFor(rels)) : readTextBody(cell),
        ...(intAttr(cell, 'gridSpan') ? { gridSpan: intAttr(cell, 'gridSpan')! } : {}),
        ...(intAttr(cell, 'rowSpan') ? { rowSpan: intAttr(cell, 'rowSpan')! } : {}),
        ...(boolAttr(cell, 'hMerge') ? { hMerge: true } : {}),
        ...(boolAttr(cell, 'vMerge') ? { vMerge: true } : {}),
        ...(tcPr ? { tcPr: serializeNode(tcPr) } : {}),
      }
    })
    return { key: `r${rowIndex}`, h: intAttr(row, 'h') ?? 0, xml: serializeNode(template), cells }
  })
  return { ...(tblPr ? { tblPr: serializeNode(tblPr) } : {}), columns, rows }
}

function readNotes(pkg: OoxmlPackage, part: string): NotesSnapshot | undefined {
  const document = pkg.xml(part)
  const root = document?.documentElement
  if (!root || root.localName !== 'notes') return undefined
  checkDepth(root)
  const rels = relationshipMap(pkg, part)
  const body = notesBody(root)
  return {
    part,
    xml: serializeNode(root),
    rels: Object.fromEntries(rels),
    text: body ? readTextBody(body, resolverFor(rels)) : readTextBody(root.ownerDocument!.createElement('empty')),
    source: pkg.get(part)!,
    ...(pkg.has(relationshipsPathFor(part)) ? { relsSource: pkg.get(relationshipsPathFor(part))! } : {}),
  }
}

/** The text body of a notes slide's body placeholder. */
export function notesBody(root: XmlElement): XmlElement | undefined {
  const tree = path(root, 'cSld', 'spTree')
  for (const shape of children(tree, 'sp')) {
    const placeholder = path(shape, 'nvSpPr', 'nvPr', 'ph')
    if (placeholder && attr(placeholder, 'type') === 'body') return child(shape, 'txBody', NS.p)
  }
  return undefined
}
