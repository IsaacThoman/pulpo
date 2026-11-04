import { updateYFragment } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import type { LiveAssetRef } from '../live-format.js'
import type { NotesSnapshot, PartSnapshot, RelTarget, ShapeSnapshot, SlideSnapshot, TableCell, TableRow, Xfrm } from './model.js'
import { readShape } from './read.js'
import { DeckResources, placeholderOf, placeholderType } from './render/deck.js'
import { EMPTY_TEXT, plainToText, textNode, type TextJSON } from './text.js'
import { addShape, insertSlide, orderedKeys, presentationRoot, readSlideMap, readXfrmMap, setCell, setNotes, setRow, setText } from './ydoc.js'
import { attr, child, childElements, escapeAttribute, NS, parseFragment, path, REL_TYPES } from './xml.js'

/**
 * Edits to a presentation document, shared by the editor, tests, and tools. Each runs in one
 * transaction with the caller's origin, so it is one undo step and one sync message.
 */

type YMap = Y.Map<unknown>

/** A random key for new slides, shapes, rows, and columns. */
export function newKey(prefix = 'k'): string {
  const bytes = new Uint8Array(9)
  globalThis.crypto.getRandomValues(bytes)
  return `${prefix}${Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('')}`
}

function slides(doc: Y.Doc): Y.Map<YMap> {
  return presentationRoot(doc).get('slides') as Y.Map<YMap>
}

function slideOrder(doc: Y.Doc): Y.Array<string> {
  return presentationRoot(doc).get('slideOrder') as Y.Array<string>
}

export function slideKeys(doc: Y.Doc): string[] {
  return orderedKeys(slideOrder(doc), slides(doc))
}

export function slideMap(doc: Y.Doc, slideKey: string): YMap | undefined {
  return slides(doc).get(slideKey)
}

export function shapeMap(doc: Y.Doc, slideKey: string, shapeKey: string): YMap | undefined {
  return (slideMap(doc, slideKey)?.get('shapes') as Y.Map<YMap> | undefined)?.get(shapeKey)
}

export function partsMap(doc: Y.Doc): Y.Map<PartSnapshot> {
  return presentationRoot(doc).get('parts') as Y.Map<PartSnapshot>
}

// ---------------------------------------------------------------------------------------------
// Slides

const SLIDE_FRAME = `<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`

const PLACEHOLDER_NAMES: Record<string, string> = {
  title: 'Title',
  ctrTitle: 'Title',
  subTitle: 'Subtitle',
  body: 'Text Placeholder',
  obj: 'Content Placeholder',
  pic: 'Picture Placeholder',
  tbl: 'Table Placeholder',
  chart: 'Chart Placeholder',
  dgm: 'SmartArt Placeholder',
  media: 'Media Placeholder',
}

/** Placeholder shapes a new slide on `layout` starts with (footers are left off, as in PowerPoint). */
export function placeholdersFor(deck: DeckResources, layoutPath: string): ShapeSnapshot[] {
  const layout = deck.layout(layoutPath)
  const tree = path(layout?.root, 'cSld', 'spTree')
  const shapes: ShapeSnapshot[] = []
  let id = 2
  for (const element of childElements(tree)) {
    const ph = placeholderOf(element)
    if (!ph) continue
    const type = placeholderType(ph)
    if (['dt', 'ftr', 'sldNum', 'hdr'].includes(type)) continue
    const attrs = [attr(ph, 'type') ? `type="${escapeAttribute(attr(ph, 'type')!)}"` : '', attr(ph, 'idx') ? `idx="${escapeAttribute(attr(ph, 'idx')!)}"` : '', attr(ph, 'orient') ? `orient="${escapeAttribute(attr(ph, 'orient')!)}"` : '', attr(ph, 'sz') ? `sz="${escapeAttribute(attr(ph, 'sz')!)}"` : '']
      .filter(Boolean)
      .join(' ')
    const name = `${PLACEHOLDER_NAMES[attr(ph, 'type') ?? 'obj'] ?? 'Placeholder'} ${id - 1}`
    shapes.push(
      shapeFromTemplate(
        `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeAttribute(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph ${attrs}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`,
      ),
    )
    id++
  }
  return shapes
}

/** Adds a slide based on `layoutPath` at `index`; returns its key. */
export function addSlide(doc: Y.Doc, deck: DeckResources, layoutPath: string, index: number, origin?: unknown): string {
  const key = newKey('slide-')
  const before = slideKeys(doc)[index - 1]
  const section = before ? (slideMap(doc, before)?.get('section') as string | undefined) : undefined
  const slide: SlideSnapshot = { key, layout: layoutPath, hidden: false, xml: SLIDE_FRAME, rels: {}, shapes: placeholdersFor(deck, layoutPath), ...(section ? { section } : {}) }
  doc.transact(() => insertSlide(doc, slide, index), origin)
  return key
}

/** A deep copy of a slide with fresh keys, ready to insert into this deck or another. */
export function cloneSlide(slide: SlideSnapshot): SlideSnapshot {
  const { sldId: _sldId, part: _part, source: _source, relsSource: _relsSource, ...rest } = slide
  const notes = slide.notes ? cloneNotes(slide.notes) : undefined
  // Comments belong to one slide; a copy starts without them.
  const rels = Object.fromEntries(Object.entries(slide.rels).filter(([, rel]) => rel.type !== REL_TYPES.comments))
  return { ...rest, key: newKey('slide-'), rels, shapes: slide.shapes.map(cloneShape), ...(notes ? { notes } : {}) }
}

function cloneNotes(notes: NotesSnapshot): NotesSnapshot {
  const { part: _part, source: _source, relsSource: _relsSource, ...rest } = notes
  return rest
}

export function cloneShape(shape: ShapeSnapshot): ShapeSnapshot {
  const copy: ShapeSnapshot = { ...shape, key: newKey('s') }
  delete copy.nvId
  if (shape.children) copy.children = shape.children.map(cloneShape)
  if (shape.table) {
    const columnKeys = new Map(shape.table.columns.map((column) => [column.key, newKey('c')]))
    copy.table = {
      ...shape.table,
      columns: shape.table.columns.map((column) => ({ ...column, key: columnKeys.get(column.key)! })),
      rows: shape.table.rows.map((row) => ({
        ...row,
        key: newKey('r'),
        cells: Object.fromEntries(Object.entries(row.cells).map(([columnKey, cell]) => [columnKeys.get(columnKey) ?? columnKey, cell])),
      })),
    }
  }
  return copy
}

export function readSlide(doc: Y.Doc, slideKey: string): SlideSnapshot | undefined {
  const map = slideMap(doc, slideKey)
  return map ? readSlideMap(slideKey, map) : undefined
}

export function duplicateSlides(doc: Y.Doc, keys: readonly string[], origin?: unknown): string[] {
  const order = slideKeys(doc)
  const sorted = [...keys].filter((key) => order.includes(key)).sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const created: string[] = []
  doc.transact(() => {
    let insertAt = Math.max(...sorted.map((key) => slideKeys(doc).indexOf(key))) + 1
    for (const key of sorted) {
      const slide = readSlide(doc, key)
      if (!slide) continue
      const copy = cloneSlide(slide)
      insertSlide(doc, copy, insertAt++)
      created.push(copy.key)
    }
  }, origin)
  return created
}

/** Inserts slides (copied from this deck or pasted from another) at `index`. */
export function insertSlides(doc: Y.Doc, copies: readonly SlideSnapshot[], index: number, origin?: unknown): string[] {
  doc.transact(() => copies.forEach((slide, offset) => insertSlide(doc, slide, index + offset)), origin)
  return copies.map((slide) => slide.key)
}

export function deleteSlides(doc: Y.Doc, keys: readonly string[], origin?: unknown): void {
  doc.transact(() => {
    const order = slideOrder(doc)
    for (let index = order.length - 1; index >= 0; index--) if (keys.includes(order.get(index))) order.delete(index, 1)
    for (const key of keys) slides(doc).delete(key)
  }, origin)
}

/** Moves slides (kept in their current relative order) so the first lands at `toIndex` of the remaining order. */
export function moveSlides(doc: Y.Doc, keys: readonly string[], toIndex: number, origin?: unknown): void {
  doc.transact(() => moveInArray(slideOrder(doc), keys, toIndex), origin)
}

function moveInArray(array: Y.Array<string>, keys: readonly string[], toIndex: number): void {
  const current = array.toArray()
  const moving = current.filter((key) => keys.includes(key))
  if (!moving.length) return
  for (let index = current.length - 1; index >= 0; index--) if (keys.includes(current[index]!)) array.delete(index, 1)
  array.insert(Math.max(0, Math.min(toIndex, array.length)), moving)
}

export function setSlideHidden(doc: Y.Doc, keys: readonly string[], hidden: boolean, origin?: unknown): void {
  doc.transact(() => {
    for (const key of keys) {
      const map = slideMap(doc, key)
      if (!map) continue
      if (hidden) map.set('hidden', true)
      else map.delete('hidden')
    }
  }, origin)
}

/**
 * Switches a slide to another layout. Placeholders without a counterpart in the new layout keep
 * where they were by getting the position they used to inherit, as PowerPoint does.
 */
export function setSlideLayout(doc: Y.Doc, deck: DeckResources, slideKey: string, layoutPath: string, origin?: unknown): void {
  const map = slideMap(doc, slideKey)
  if (!map) return
  const oldLayout = deck.layout((map.get('layout') as string) ?? '')
  const newLayout = deck.layout(layoutPath)
  doc.transact(() => {
    const shapes = map.get('shapes') as Y.Map<YMap>
    for (const [key, shape] of shapes.entries()) {
      if (shape.has('xfrm')) continue
      const ph = phOf(shape)
      if (!ph) continue
      const stillMatches = newLayout && (attr(ph, 'idx') ? newLayout.placeholders.byIdx.has(Number(attr(ph, 'idx'))) : newLayout.placeholders.byType.has(placeholderType(ph)))
      if (stillMatches) continue
      const inherited = oldLayout ? inheritedXfrm(oldLayout, ph) : undefined
      if (inherited) setXfrm(doc, slideKey, key, inherited)
    }
    map.set('layout', layoutPath)
  }, origin)
}

function phOf(shape: YMap) {
  const xml = shape.get('xml')
  if (typeof xml !== 'string') return undefined
  try {
    return placeholderOf(parseFragment(xml))
  } catch {
    return undefined
  }
}

function inheritedXfrm(layout: NonNullable<ReturnType<DeckResources['layout']>>, ph: ReturnType<typeof placeholderOf>): Xfrm | undefined {
  if (!ph) return undefined
  const match = (attr(ph, 'idx') ? layout.placeholders.byIdx.get(Number(attr(ph, 'idx'))) : undefined) ?? layout.placeholders.byType.get(placeholderType(ph))
  const master = layout.master && (layout.master.placeholders.byType.get(placeholderType(ph) === 'ctrTitle' ? 'title' : placeholderType(ph)) ?? layout.master.placeholders.byType.get('body'))
  for (const source of [match, master]) {
    const xfrm = child(child(source, 'spPr', NS.p), 'xfrm', NS.a)
    if (xfrm) {
      const shape = readShape(source!, new Map(), new Set(), { shapes: 0, limit: 1 }, 0)
      if (shape.xfrm) return shape.xfrm
    }
  }
  return undefined
}

/** Sets or clears the slide's own background (`p:bg` XML); undefined inherits from the layout. */
export function setSlideBackground(doc: Y.Doc, slideKey: string, background: string | undefined, origin?: unknown): void {
  const map = slideMap(doc, slideKey)
  if (!map) return
  doc.transact(() => (background ? map.set('background', background) : map.delete('background')), origin)
}

/** A `p:bg` with a solid color, gradient, or picture fill (`fill` is a DrawingML fill element). */
export function backgroundXml(fill: string): string {
  return `<p:bg xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:bgPr>${fill}<a:effectLst/></p:bgPr></p:bg>`
}

/** The notes text fragment of a slide, created on first use. */
export function ensureNotes(doc: Y.Doc, slideKey: string, origin?: unknown): Y.XmlFragment | undefined {
  const map = slideMap(doc, slideKey)
  if (!map) return undefined
  const existing = map.get('notes') as YMap | undefined
  if (existing) return existing.get('text') as Y.XmlFragment
  doc.transact(() => setNotes(map, { xml: '', rels: {}, text: EMPTY_TEXT }), origin)
  return (map.get('notes') as YMap).get('text') as Y.XmlFragment
}

// ---------------------------------------------------------------------------------------------
// Sections

export function addSection(doc: Y.Doc, name: string, firstSlideKey: string, origin?: unknown): string {
  const key = newKey('section-')
  doc.transact(() => {
    const root = presentationRoot(doc)
    const order = root.get('sectionOrder') as Y.Array<string>
    const sections = root.get('sections') as Y.Map<{ name: string; id: string }>
    const keys = slideKeys(doc)
    const start = keys.indexOf(firstSlideKey)
    // Slides from here to the next section start join the new one.
    const previous = start > 0 ? (slideMap(doc, keys[start - 1]!)?.get('section') as string | undefined) : undefined
    for (let index = start; index >= 0 && index < keys.length; index++) {
      const slide = slideMap(doc, keys[index]!)!
      const section = slide.get('section') as string | undefined
      if (index > start && section !== previous) break
      slide.set('section', key)
    }
    sections.set(key, { name, id: newGuid() })
    let before = previous ? order.toArray().indexOf(previous) + 1 : 0
    if (!previous && start > 0) {
      // Slides before the first section need one too; PowerPoint calls it "Default Section".
      const defaultKey = newKey('section-')
      sections.set(defaultKey, { name: 'Default Section', id: newGuid() })
      order.insert(0, [defaultKey])
      for (const slideKey of keys.slice(0, start)) slideMap(doc, slideKey)!.set('section', defaultKey)
      before = 1
    }
    order.insert(Math.min(before, order.length), [key])
  }, origin)
  return key
}

export function renameSection(doc: Y.Doc, key: string, name: string, origin?: unknown): void {
  const sections = presentationRoot(doc).get('sections') as Y.Map<{ name: string; id: string }>
  const section = sections.get(key)
  if (section) doc.transact(() => sections.set(key, { ...section, name }), origin)
}

/** Removes a section; its slides join the section before it. */
export function removeSection(doc: Y.Doc, key: string, origin?: unknown): void {
  doc.transact(() => {
    const root = presentationRoot(doc)
    const order = root.get('sectionOrder') as Y.Array<string>
    const index = order.toArray().indexOf(key)
    const previous = index > 0 ? order.get(index - 1) : undefined
    for (const slideKey of slideKeys(doc)) {
      const slide = slideMap(doc, slideKey)!
      if (slide.get('section') !== key) continue
      if (previous) slide.set('section', previous)
      else slide.delete('section')
    }
    if (index >= 0) order.delete(index, 1)
    ;(root.get('sections') as Y.Map<unknown>).delete(key)
  }, origin)
}

function newGuid(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`
}

// ---------------------------------------------------------------------------------------------
// Shapes

/** A shape snapshot from its XML, with a fresh key; modeled values come from the XML itself. */
export function shapeFromTemplate(xml: string, rels: Record<string, RelTarget> = {}, overrides: Partial<ShapeSnapshot> = {}): ShapeSnapshot {
  const element = parseFragment(xml)
  const shape = readShape(element, new Map(Object.entries(rels)), new Set(), { shapes: 0, limit: 10_000 }, 0)
  return { ...shape, ...overrides, key: overrides.key ?? newKey('s'), rels: { ...shape.rels, ...rels } }
}

/** PowerPoint's default style for new shapes: accent 1 fill, darker outline, white text. */
const SHAPE_STYLE =
  '<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="15000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>'

const LINE_STYLE =
  '<p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></p:style>'

const LINE_PRESETS = new Set(['line', 'straightConnector1', 'bentConnector2', 'bentConnector3', 'bentConnector4', 'bentConnector5', 'curvedConnector2', 'curvedConnector3', 'curvedConnector4', 'curvedConnector5'])

function xfrmXml(xfrm: Xfrm): string {
  return `<a:xfrm${xfrm.rot ? ` rot="${Math.round(xfrm.rot)}"` : ''}${xfrm.flipH ? ' flipH="1"' : ''}${xfrm.flipV ? ' flipV="1"' : ''}><a:off x="${Math.round(xfrm.x)}" y="${Math.round(xfrm.y)}"/><a:ext cx="${Math.round(Math.max(0, xfrm.cx))}" cy="${Math.round(Math.max(0, xfrm.cy))}"/></a:xfrm>`
}

/** A preset shape (`rect`, `ellipse`, `rightArrow`, …), or a connector for line presets. */
export function presetShape(preset: string, xfrm: Xfrm, name: string): ShapeSnapshot {
  const geometry = `<a:prstGeom prst="${escapeAttribute(preset)}"><a:avLst/></a:prstGeom>`
  if (LINE_PRESETS.has(preset)) {
    return shapeFromTemplate(
      `<p:cxnSp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvCxnSpPr><p:cNvPr id="0" name="${escapeAttribute(name)}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrmXml(xfrm)}${geometry}</p:spPr>${LINE_STYLE}</p:cxnSp>`,
    )
  }
  return shapeFromTemplate(
    `<p:sp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvSpPr><p:cNvPr id="0" name="${escapeAttribute(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrmXml(xfrm)}${geometry}</p:spPr>${SHAPE_STYLE}<p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`,
  )
}

export function textBox(xfrm: Xfrm, name: string, text = ''): ShapeSnapshot {
  const shape = shapeFromTemplate(
    `<p:sp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvSpPr><p:cNvPr id="0" name="${escapeAttribute(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrmXml(xfrm)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`,
  )
  return text ? { ...shape, text: plainToText(text) } : shape
}

/** A picture of an image already in the asset store; adds its media part. */
export function addImagePart(doc: Y.Doc, asset: LiveAssetRef, origin?: unknown): string {
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/webp': 'png' }[asset.mimeType] ?? 'png'
  // Content-addressed names: two people inserting the same image at once write the same part.
  const partPath = `ppt/media/pulpo-${asset.hash.slice(0, 16)}.${extension}`
  doc.transact(() => {
    if (!partsMap(doc).has(partPath)) partsMap(doc).set(partPath, { asset, contentType: asset.mimeType })
  }, origin)
  return partPath
}

export function pictureShape(partPath: string, xfrm: Xfrm, name: string, description = ''): ShapeSnapshot {
  return shapeFromTemplate(
    `<p:pic xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:nvPicPr><p:cNvPr id="0" name="${escapeAttribute(name)}" descr="${escapeAttribute(description)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrmXml(xfrm)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
    { rId1: { type: REL_TYPES.image, target: partPath } },
  )
}

const EMPTY_CELL_XML = '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></a:txBody><a:tcPr/></a:tc>'

/** A table with the default "Medium Style 2 - Accent 1" look, header row, and banded rows. */
export function tableShape(rows: number, columns: number, xfrm: Xfrm, name: string): ShapeSnapshot {
  const width = Math.floor(xfrm.cx / columns)
  const height = Math.max(370840, Math.floor(xfrm.cy / rows))
  const grid = Array.from({ length: columns }, () => `<a:gridCol w="${width}"/>`).join('')
  const body = Array.from({ length: rows }, () => `<a:tr h="${height}">${Array.from({ length: columns }, () => EMPTY_CELL_XML).join('')}</a:tr>`).join('')
  return shapeFromTemplate(
    `<p:graphicFrame xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvGraphicFramePr><p:cNvPr id="0" name="${escapeAttribute(name)}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${Math.round(xfrm.x)}" y="${Math.round(xfrm.y)}"/><a:ext cx="${width * columns}" cy="${height * rows}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr><a:tblGrid>${grid}</a:tblGrid>${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
  )
}

/** Adds shapes to a slide (on top, or at `index` of the top level); returns their keys. */
export function insertShapes(doc: Y.Doc, slideKey: string, shapes: readonly ShapeSnapshot[], origin?: unknown, index?: number): string[] {
  const map = slideMap(doc, slideKey)
  if (!map) return []
  doc.transact(() => {
    const order = map.get('shapeOrder') as Y.Array<string>
    const store = map.get('shapes') as Y.Map<YMap>
    for (const shape of shapes) addShape(store, shape)
    order.insert(index === undefined ? order.length : Math.max(0, Math.min(index, order.length)), shapes.map((shape) => shape.key))
  }, origin)
  return shapes.map((shape) => shape.key)
}

/** The array a shape is listed in (the slide's order, or its group's members) and its parent group. */
export function containerOf(slide: YMap, shapeKey: string): { array: Y.Array<string>; parent?: string } | undefined {
  const order = slide.get('shapeOrder') as Y.Array<string>
  if (order.toArray().includes(shapeKey)) return { array: order }
  for (const [key, shape] of (slide.get('shapes') as Y.Map<YMap>).entries()) {
    const members = shape.get('children')
    if (members instanceof Y.Array && (members.toArray() as string[]).includes(shapeKey)) return { array: members as Y.Array<string>, parent: key }
  }
  return undefined
}

export function deleteShapes(doc: Y.Doc, slideKey: string, keys: readonly string[], origin?: unknown): void {
  const map = slideMap(doc, slideKey)
  if (!map) return
  doc.transact(() => {
    const store = map.get('shapes') as Y.Map<YMap>
    const remove = (key: string) => {
      const shape = store.get(key)
      const members = shape?.get('children')
      if (members instanceof Y.Array) for (const member of members.toArray() as string[]) remove(member)
      store.delete(key)
    }
    for (const key of keys) {
      const container = containerOf(map, key)
      if (container) {
        const items = container.array.toArray()
        for (let index = items.length - 1; index >= 0; index--) if (items[index] === key) container.array.delete(index, 1)
      }
      remove(key)
    }
  }, origin)
}

/** Sets a shape's transform. Partial values update only those fields (concurrent moves and resizes merge). */
export function setXfrm(doc: Y.Doc, slideKey: string, shapeKey: string, xfrm: Partial<Xfrm>, origin?: unknown): void {
  const shape = shapeMap(doc, slideKey, shapeKey)
  if (!shape) return
  doc.transact(() => {
    let map = shape.get('xfrm') as Y.Map<number | boolean> | undefined
    if (!(map instanceof Y.Map)) {
      map = new Y.Map<number | boolean>()
      shape.set('xfrm', map)
    }
    for (const [key, value] of Object.entries(xfrm)) {
      if (value === undefined || value === false || (key === 'rot' && value === 0)) map.delete(key)
      else map.set(key, typeof value === 'number' ? Math.round(value) : value)
    }
  }, origin)
}

export function readXfrm(doc: Y.Doc, slideKey: string, shapeKey: string): Xfrm | undefined {
  const map = shapeMap(doc, slideKey, shapeKey)?.get('xfrm')
  return map instanceof Y.Map ? readXfrmMap(map) : undefined
}

export type ShapeProperty = 'fill' | 'line' | 'effects' | 'geom' | 'bodyPr' | 'name' | 'descr' | 'blipFill' | 'hidden'

/** Sets a modeled shape property (XML strings for fill/line/effects/geometry/body). */
export function setShapeProperty(doc: Y.Doc, slideKey: string, shapeKeys: readonly string[], property: ShapeProperty, value: string | boolean | undefined, origin?: unknown): void {
  doc.transact(() => {
    for (const key of shapeKeys) {
      const shape = shapeMap(doc, slideKey, key)
      if (!shape) continue
      if (value === undefined || value === false) shape.delete(property)
      else shape.set(property, value)
    }
  }, origin)
}

/**
 * Rewrites a shape's text as a minimal diff (typing goes through the inline editor instead), so
 * someone typing in the same shape at the same time keeps their edits.
 */
export function setShapeText(doc: Y.Doc, slideKey: string, shapeKey: string, text: TextJSON, origin?: unknown): void {
  const shape = shapeMap(doc, slideKey, shapeKey)
  if (!shape) return
  doc.transact(() => {
    const fragment = shape.get('text')
    if (fragment instanceof Y.XmlFragment) updateYFragment(doc, fragment, textNode(text), { mapping: new Map(), isOMark: new Map() })
    else setText(shape, 'text', text)
  }, origin)
}

export type ZOrder = 'front' | 'back' | 'forward' | 'backward'

export function reorderShapes(doc: Y.Doc, slideKey: string, keys: readonly string[], where: ZOrder, origin?: unknown): void {
  const map = slideMap(doc, slideKey)
  if (!map) return
  doc.transact(() => {
    const container = containerOf(map, keys[0] ?? '')
    if (!container) return
    const items = container.array.toArray()
    const selected = items.filter((key) => keys.includes(key))
    const rest = items.filter((key) => !keys.includes(key))
    let target: string[]
    if (where === 'front') target = [...rest, ...selected]
    else if (where === 'back') target = [...selected, ...rest]
    else {
      target = [...items]
      const indexes = target.map((key, index) => (keys.includes(key) ? index : -1)).filter((index) => index >= 0)
      const step = where === 'forward' ? 1 : -1
      for (const index of step > 0 ? [...indexes].reverse() : indexes) {
        const swap = index + step
        if (swap < 0 || swap >= target.length || keys.includes(target[swap]!)) continue
        ;[target[index], target[swap]] = [target[swap]!, target[index]!]
      }
    }
    moveToMatch(container.array, target)
  }, origin)
}

/** Moves only the items whose position changed. */
function moveToMatch(array: Y.Array<string>, target: string[]): void {
  const current = array.toArray()
  if (current.join('\u0000') === target.join('\u0000')) return
  array.delete(0, array.length)
  array.insert(0, target)
}

/** Bounding box (unrotated) of shapes, in EMU. */
export function boundsOf(xfrms: readonly Xfrm[]): Xfrm {
  const left = Math.min(...xfrms.map((xfrm) => xfrm.x))
  const top = Math.min(...xfrms.map((xfrm) => xfrm.y))
  const right = Math.max(...xfrms.map((xfrm) => xfrm.x + xfrm.cx))
  const bottom = Math.max(...xfrms.map((xfrm) => xfrm.y + xfrm.cy))
  return { x: left, y: top, cx: right - left, cy: bottom - top }
}

/**
 * Groups shapes that share a container. The group's child space equals its own box, so members
 * keep their stored coordinates untouched.
 */
export function groupShapes(doc: Y.Doc, slideKey: string, keys: readonly string[], xfrms: ReadonlyMap<string, Xfrm>, name: string, origin?: unknown): string | undefined {
  const map = slideMap(doc, slideKey)
  if (!map || keys.length < 2) return undefined
  const container = containerOf(map, keys[0]!)
  if (!container || keys.some((key) => !container.array.toArray().includes(key))) return undefined
  const boxes = keys.map((key) => xfrms.get(key)).filter((xfrm): xfrm is Xfrm => xfrm !== undefined)
  if (boxes.length !== keys.length) return undefined
  const bounds = boundsOf(boxes)
  const group = shapeFromTemplate(
    `<p:grpSp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvGrpSpPr><p:cNvPr id="0" name="${escapeAttribute(name)}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:grpSp>`,
    {},
    { xfrm: { ...bounds, chX: bounds.x, chY: bounds.y, chCx: bounds.cx, chCy: bounds.cy }, children: [] },
  )
  doc.transact(() => {
    const items = container.array.toArray()
    const topmost = Math.max(...keys.map((key) => items.indexOf(key)))
    const ordered = items.filter((key) => keys.includes(key))
    // Members without their own transform (placeholders) get the one they inherited.
    for (const key of keys) if (!shapeMap(doc, slideKey, key)!.has('xfrm')) setXfrm(doc, slideKey, key, xfrms.get(key)!)
    addShape(map.get('shapes') as Y.Map<YMap>, group)
    const groupMap = shapeMap(doc, slideKey, group.key)!
    ;(groupMap.get('children') as Y.Array<string>).push(ordered)
    for (let index = items.length - 1; index >= 0; index--) if (keys.includes(items[index]!)) container.array.delete(index, 1)
    container.array.insert(Math.min(topmost - (ordered.length - 1), container.array.length), [group.key])
  }, origin)
  return group.key
}

/** Dissolves a group, mapping its members' transforms into the parent's coordinates. */
export function ungroupShape(doc: Y.Doc, slideKey: string, groupKey: string, origin?: unknown): string[] {
  const map = slideMap(doc, slideKey)
  const group = shapeMap(doc, slideKey, groupKey)
  const container = map ? containerOf(map, groupKey) : undefined
  const members = group?.get('children')
  if (!map || !group || !container || !(members instanceof Y.Array)) return []
  const groupXfrm = readXfrm(doc, slideKey, groupKey)
  const keys = (members.toArray() as string[]).filter((key) => shapeMap(doc, slideKey, key))
  doc.transact(() => {
    for (const key of keys) {
      const xfrm = readXfrm(doc, slideKey, key)
      if (xfrm && groupXfrm) setXfrm(doc, slideKey, key, mapOutOfGroup(xfrm, groupXfrm))
    }
    const index = container.array.toArray().indexOf(groupKey)
    container.array.delete(index, 1)
    container.array.insert(index, keys)
    ;(map.get('shapes') as Y.Map<YMap>).delete(groupKey)
  }, origin)
  return keys
}

/** A member's transform in its group's parent coordinates (scale, flips, then rotation about the group center). */
export function mapOutOfGroup(member: Xfrm, group: Xfrm): Xfrm {
  const scaleX = group.chCx ? group.cx / group.chCx : 1
  const scaleY = group.chCy ? group.cy / group.chCy : 1
  let x = group.x + (member.x - (group.chX ?? 0)) * scaleX
  let y = group.y + (member.y - (group.chY ?? 0)) * scaleY
  const cx = member.cx * scaleX
  const cy = member.cy * scaleY
  let flipH = member.flipH === true
  let flipV = member.flipV === true
  let rot = member.rot ?? 0
  if (group.flipH) {
    x = group.x + group.cx - (x - group.x) - cx
    flipH = !flipH
    rot = -rot
  }
  if (group.flipV) {
    y = group.y + group.cy - (y - group.y) - cy
    flipV = !flipV
    rot = -rot
  }
  const groupRot = group.rot ?? 0
  if (groupRot) {
    const angle = (groupRot / 60000) * (Math.PI / 180)
    const centerX = group.x + group.cx / 2
    const centerY = group.y + group.cy / 2
    const memberX = x + cx / 2 - centerX
    const memberY = y + cy / 2 - centerY
    x = centerX + memberX * Math.cos(angle) - memberY * Math.sin(angle) - cx / 2
    y = centerY + memberX * Math.sin(angle) + memberY * Math.cos(angle) - cy / 2
    rot += groupRot
  }
  rot = ((rot % 21_600_000) + 21_600_000) % 21_600_000
  return { x, y, cx, cy, ...(rot ? { rot } : {}), ...(flipH ? { flipH } : {}), ...(flipV ? { flipV } : {}) }
}

/** Reads shapes (with members) for copying. */
export function readShapes(doc: Y.Doc, slideKey: string, keys: readonly string[]): ShapeSnapshot[] {
  const slide = readSlide(doc, slideKey)
  if (!slide) return []
  const found: ShapeSnapshot[] = []
  const walk = (shapes: ShapeSnapshot[]) => {
    for (const shape of shapes) {
      if (keys.includes(shape.key)) found.push(shape)
      else if (shape.children) walk(shape.children)
    }
  }
  walk(slide.shapes)
  return found
}

export function duplicateShapes(doc: Y.Doc, slideKey: string, keys: readonly string[], offset: number, origin?: unknown): string[] {
  const copies = readShapes(doc, slideKey, keys).map((shape) => {
    const copy = cloneShape(shape)
    if (copy.xfrm) copy.xfrm = { ...copy.xfrm, x: copy.xfrm.x + offset, y: copy.xfrm.y + offset }
    return copy
  })
  return insertShapes(doc, slideKey, copies, origin)
}

// ---------------------------------------------------------------------------------------------
// Tables

function tableMapOf(doc: Y.Doc, slideKey: string, shapeKey: string): YMap | undefined {
  const table = shapeMap(doc, slideKey, shapeKey)?.get('table')
  return table instanceof Y.Map ? table : undefined
}

function emptyCell(): TableCell {
  return { xml: EMPTY_CELL_XML, text: EMPTY_TEXT }
}

/** Inserts a row before `index`, copying the neighboring row's height and cell formatting. */
export function insertTableRow(doc: Y.Doc, slideKey: string, shapeKey: string, index: number, origin?: unknown): string | undefined {
  const table = tableMapOf(doc, slideKey, shapeKey)
  if (!table) return undefined
  const rowOrder = table.get('rowOrder') as Y.Array<string>
  const rows = table.get('rows') as Y.Map<YMap>
  const columns = orderedKeys(table.get('columnOrder') as Y.Array<string>, table.get('columns') as Y.Map<unknown>)
  const rowKeys = orderedKeys(rowOrder, rows)
  const template = rows.get(rowKeys[Math.min(Math.max(index - 1, 0), rowKeys.length - 1)] ?? '')
  const key = newKey('r')
  const row: TableRow = { key, h: (template?.get('h') as number) ?? 370840, xml: (template?.get('xml') as string) ?? '<a:tr/>', cells: {} }
  for (const column of columns) {
    const source = (template?.get('cells') as Y.Map<YMap> | undefined)?.get(column)
    const tcPr = source?.get('tcPr') as string | undefined
    row.cells[column] = { ...emptyCell(), ...(tcPr ? { tcPr } : {}) }
  }
  doc.transact(() => {
    setRow(rows, row)
    const at = index >= rowKeys.length ? rowOrder.length : rowOrder.toArray().indexOf(rowKeys[index]!)
    rowOrder.insert(Math.max(0, at), [key])
    growFrame(doc, slideKey, shapeKey, 0, row.h)
  }, origin)
  return key
}

/** Inserts a column before `index`, splitting width from the neighbor so the table keeps its size. */
export function insertTableColumn(doc: Y.Doc, slideKey: string, shapeKey: string, index: number, origin?: unknown): string | undefined {
  const table = tableMapOf(doc, slideKey, shapeKey)
  if (!table) return undefined
  const columnOrder = table.get('columnOrder') as Y.Array<string>
  const columns = table.get('columns') as Y.Map<{ w: number; xml: string }>
  const columnKeys = orderedKeys(columnOrder, columns)
  const neighborKey = columnKeys[Math.min(Math.max(index - 1, 0), columnKeys.length - 1)]
  const neighbor = neighborKey ? columns.get(neighborKey) : undefined
  const key = newKey('c')
  const width = neighbor ? Math.round(neighbor.w / 2) : 914400
  doc.transact(() => {
    if (neighbor && neighborKey) columns.set(neighborKey, { ...neighbor, w: neighbor.w - width })
    columns.set(key, { w: width, xml: '<a:gridCol w="0"/>' })
    const at = index >= columnKeys.length ? columnOrder.length : columnOrder.toArray().indexOf(columnKeys[index]!)
    columnOrder.insert(Math.max(0, at), [key])
    for (const row of (table.get('rows') as Y.Map<YMap>).values()) {
      const cells = row.get('cells') as Y.Map<YMap>
      const source = neighborKey ? cells.get(neighborKey) : undefined
      const tcPr = source?.get('tcPr') as string | undefined
      setCell(cells, key, { ...emptyCell(), ...(tcPr ? { tcPr } : {}) })
    }
  }, origin)
  return key
}

export function deleteTableRows(doc: Y.Doc, slideKey: string, shapeKey: string, keys: readonly string[], origin?: unknown): void {
  const table = tableMapOf(doc, slideKey, shapeKey)
  if (!table) return
  doc.transact(() => {
    const rowOrder = table.get('rowOrder') as Y.Array<string>
    const rows = table.get('rows') as Y.Map<YMap>
    let removed = 0
    for (const key of keys) removed += (rows.get(key)?.get('h') as number) ?? 0
    const items = rowOrder.toArray()
    for (let index = items.length - 1; index >= 0; index--) if (keys.includes(items[index]!)) rowOrder.delete(index, 1)
    for (const key of keys) rows.delete(key)
    growFrame(doc, slideKey, shapeKey, 0, -removed)
  }, origin)
}

export function deleteTableColumns(doc: Y.Doc, slideKey: string, shapeKey: string, keys: readonly string[], origin?: unknown): void {
  const table = tableMapOf(doc, slideKey, shapeKey)
  if (!table) return
  doc.transact(() => {
    const columnOrder = table.get('columnOrder') as Y.Array<string>
    const columns = table.get('columns') as Y.Map<{ w: number; xml: string }>
    let removed = 0
    for (const key of keys) removed += columns.get(key)?.w ?? 0
    const items = columnOrder.toArray()
    for (let index = items.length - 1; index >= 0; index--) if (keys.includes(items[index]!)) columnOrder.delete(index, 1)
    for (const key of keys) columns.delete(key)
    for (const row of (table.get('rows') as Y.Map<YMap>).values()) for (const key of keys) (row.get('cells') as Y.Map<YMap>).delete(key)
    growFrame(doc, slideKey, shapeKey, -removed, 0)
  }, origin)
}

export function setColumnWidth(doc: Y.Doc, slideKey: string, shapeKey: string, columnKey: string, width: number, origin?: unknown): void {
  const table = tableMapOf(doc, slideKey, shapeKey)
  const columns = table?.get('columns') as Y.Map<{ w: number; xml: string }> | undefined
  const column = columns?.get(columnKey)
  if (!column) return
  const next = Math.max(91440, Math.round(width))
  doc.transact(() => {
    columns!.set(columnKey, { ...column, w: next })
    growFrame(doc, slideKey, shapeKey, next - column.w, 0)
  }, origin)
}

export function setRowHeight(doc: Y.Doc, slideKey: string, shapeKey: string, rowKey: string, height: number, origin?: unknown): void {
  const row = (tableMapOf(doc, slideKey, shapeKey)?.get('rows') as Y.Map<YMap> | undefined)?.get(rowKey)
  if (!row) return
  const next = Math.max(91440, Math.round(height))
  doc.transact(() => {
    growFrame(doc, slideKey, shapeKey, 0, next - ((row.get('h') as number) ?? 0))
    row.set('h', next)
  }, origin)
}

function growFrame(doc: Y.Doc, slideKey: string, shapeKey: string, dx: number, dy: number): void {
  const xfrm = readXfrm(doc, slideKey, shapeKey)
  if (!xfrm) return
  setXfrm(doc, slideKey, shapeKey, { cx: Math.max(0, xfrm.cx + dx), cy: Math.max(0, xfrm.cy + dy) })
}

/** The table cell text fragment for the inline editor. */
export function cellFragment(doc: Y.Doc, slideKey: string, shapeKey: string, rowKey: string, columnKey: string): Y.XmlFragment | undefined {
  const row = (tableMapOf(doc, slideKey, shapeKey)?.get('rows') as Y.Map<YMap> | undefined)?.get(rowKey)
  const cell = (row?.get('cells') as Y.Map<YMap> | undefined)?.get(columnKey)
  const text = cell?.get('text')
  return text instanceof Y.XmlFragment ? text : undefined
}

/** A shape's text fragment for the inline editor, created (with the shape's text body) on first use. */
export function shapeFragment(doc: Y.Doc, slideKey: string, shapeKey: string, origin?: unknown): Y.XmlFragment | undefined {
  const shape = shapeMap(doc, slideKey, shapeKey)
  if (!shape) return undefined
  const text = shape.get('text')
  if (text instanceof Y.XmlFragment) return text
  const kind = shape.get('kind')
  if (kind !== 'sp') return undefined
  let fragment: Y.XmlFragment | undefined
  doc.transact(() => {
    fragment = setText(shape, 'text', EMPTY_TEXT)
  }, origin)
  return fragment
}

