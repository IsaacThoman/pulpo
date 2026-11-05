import type * as Y from 'yjs'
import { LiveFormatError, type LiveAssetStore } from '../live-format.js'
import { decodePartText, relationshipsPathFor, relativeTarget, resolveTarget } from '../ooxml/package.js'
import { cloneShape, cloneSlide, insertShapes, insertSlides, PARTS_ORIGIN, readSlide, slideKeys } from './commands.js'
import type { PartSnapshot, RelTarget, ShapeSnapshot, SlideSnapshot } from './model.js'
import { DEFAULT_PRESENTATION_LIMITS } from './read.js'
import { DeckResources } from './render/deck.js'
import { presentationRoot, randomId, readPart, readSnapshot, setPart } from './ydoc.js'
import { normalizeText, type TextJSON } from './text.js'
import { buildShapeElement, RelationshipTable } from './write.js'
import { attr, bytesEqual, childElements, parseFragment, parseXmlDocument, REL_TYPES, serializeNode } from './xml.js'

/**
 * Copying shapes and slides, within a deck or to another one. The payload carries the parts the
 * copied content links to (images, charts, diagrams, and what those link to), so pasting into a
 * different deck can bring them along under new names.
 */

export const CLIPBOARD_MIME = 'application/x-pulpo-presentation+json'

export interface ClipboardPart {
  contentType?: string
  /** Base64 of the part's bytes. */
  data: string
  mimeType?: string
}

export interface PresentationClipboard {
  version: 1
  /** Identifies the source document, so pasting into it can reuse its parts. */
  source: string
  kind: 'shapes' | 'slides'
  shapes?: ShapeSnapshot[]
  slides?: (SlideSnapshot & { layoutName?: string })[]
  parts: Record<string, ClipboardPart>
  /** Plain text of what was copied, for other apps. */
  text: string
}

/** A stable id for a document, kept in the document so every replica (and every reload) agrees. */
export function documentIdentity(doc: Y.Doc): string {
  const id = presentationRoot(doc).get('documentId')
  return typeof id === 'string' ? id : String(doc.guid)
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

function relTargetsOfShapes(shapes: readonly ShapeSnapshot[]): RelTarget[] {
  return shapes.flatMap((shape) => [...Object.values(shape.rels), ...relTargetsOfShapes(shape.children ?? [])])
}

/** Parts reachable from `roots` through relationships (charts link to workbooks, diagrams to drawings). */
const MAX_COPY_PARTS = 5_000
const MAX_COPY_BYTES = 256 * 1024 * 1024
const tooMuchToCopy = () => new LiveFormatError('too_large', 'Too much to copy at once')

function partGraph(parts: Record<string, PartSnapshot>, roots: string[]): string[] {
  const seen = new Set<string>()
  const queue = [...roots]
  const deck = new DeckResources(parts, '')
  let size = 0
  const add = (path: string) => {
    if (seen.has(path)) return
    seen.add(path)
    size += parts[path]!.bytes?.byteLength ?? parts[path]!.asset?.sizeBytes ?? 0
    if (seen.size > MAX_COPY_PARTS || size > MAX_COPY_BYTES) throw tooMuchToCopy()
  }
  for (let index = 0; index < queue.length; index++) {
    const part = queue[index]!
    if (seen.has(part) || !parts[part]) continue
    // Never drag a slide layout or another slide along; those are mapped, not copied.
    if (/\/(slideLayouts|slideMasters|slides|notesSlides|notesMasters)\//.test(`/${part}`)) continue
    add(part)
    const relsPath = relationshipsPathFor(part)
    if (parts[relsPath]) add(relsPath)
    for (const rel of deck.rels(part).values()) if (!rel.external) queue.push(rel.target)
  }
  return [...seen]
}

export async function copyContent(doc: Y.Doc, assets: LiveAssetStore, content: { shapes?: ShapeSnapshot[]; slides?: SlideSnapshot[] }, text: string): Promise<PresentationClipboard> {
  const snapshot = readSnapshot(doc)
  const deck = new DeckResources(snapshot.parts, snapshot.mainPart)
  const roots = [
    ...relTargetsOfShapes(content.shapes ?? []),
    ...(content.slides ?? []).flatMap((slide) => [...Object.values(slide.rels), ...relTargetsOfShapes(slide.shapes)]),
  ]
    .filter((rel) => !rel.external)
    .map((rel) => rel.target)
  // SmartArt drawings are linked from the slide, not the shape; take them along with diagram data.
  for (const slide of content.slides ?? []) for (const rel of Object.values(slide.rels)) if (rel.type === REL_TYPES.diagramDrawing) roots.push(rel.target)
  const parts: Record<string, ClipboardPart> = {}
  let size = 0
  for (const path of partGraph(snapshot.parts, roots)) {
    const part = snapshot.parts[path]!
    const bytes = part.bytes ?? (part.asset ? await assets.get(part.asset.hash) : undefined)
    if (!bytes) continue
    size += bytes.byteLength
    if (size > MAX_COPY_BYTES) throw tooMuchToCopy()
    parts[path] = { data: toBase64(bytes), ...(part.contentType ? { contentType: part.contentType } : {}), ...(part.asset ? { mimeType: part.asset.mimeType } : {}) }
  }
  return {
    version: 1,
    source: documentIdentity(doc),
    kind: content.slides ? 'slides' : 'shapes',
    ...(content.shapes ? { shapes: content.shapes } : {}),
    ...(content.slides ? { slides: content.slides.map((slide) => ({ ...slide, layoutName: deck.layout(slide.layout)?.name ?? '' })) } : {}),
    parts,
    text,
  }
}

/**
 * Reads a clipboard payload. Any web page can put data on the clipboard under our type, so the
 * payload is untrusted: shapes and slides that cannot be built into valid XML are dropped here,
 * before they reach the shared document where they would break every collaborator's saves.
 */
export function parseClipboard(json: string): PresentationClipboard | undefined {
  let value: PresentationClipboard
  try {
    value = JSON.parse(json) as PresentationClipboard
  } catch {
    return undefined
  }
  if (value?.version !== 1 || (value.kind !== 'shapes' && value.kind !== 'slides') || typeof value.parts !== 'object' || value.parts === null) return undefined
  // Check aggregate budgets before validating XML or decoding/storing any parts. Include group
  // members and all slides, even when a malformed shape would later be filtered out.
  const slidesInput = Array.isArray(value.slides) ? value.slides : []
  if (slidesInput.length > 200 || countShapes([...(Array.isArray(value.shapes) ? value.shapes : []), ...slidesInput.flatMap((slide) => Array.isArray(slide?.shapes) ? slide.shapes : [])], 2_000) > 2_000) return undefined
  const entries = Object.entries(value.parts)
  if (entries.length > MAX_COPY_PARTS) return undefined
  let bytes = 0
  for (const [, part] of entries) {
    if (typeof part?.data === 'string') bytes += part.data.length * 3 / 4
    if (bytes > MAX_COPY_BYTES) return undefined
  }
  const parts: Record<string, ClipboardPart> = {}
  for (const [path, part] of entries) {
    if (typeof part?.data !== 'string' || !/^[\w./-]+$/.test(path) || path.includes('..')) continue
    parts[path] = part
  }
  const shapes = Array.isArray(value.shapes) ? value.shapes.filter(validShape) : undefined
  const slides = Array.isArray(value.slides) ? value.slides.filter(validSlide) : undefined
  return { version: 1, source: String(value.source ?? ''), kind: value.kind, ...(shapes ? { shapes } : {}), ...(slides ? { slides } : {}), parts, text: String(value.text ?? '') }
}

/** Tables count once; group members each count toward the slide and clipboard budgets. */
function countShapes(shapes: readonly ShapeSnapshot[], limit = DEFAULT_PRESENTATION_LIMITS.maxShapesPerSlide): number {
  const pending = [...shapes]
  let count = 0
  while (pending.length) {
    const shape = pending.pop()
    if (++count > limit) return count
    if (Array.isArray(shape?.children)) for (const member of shape.children) pending.push(member)
  }
  return count
}

const SHAPE_KINDS = new Set(['sp', 'pic', 'cxnSp', 'grpSp', 'graphicFrame', 'opaque'])

const MAX_INT = 2_147_483_647
const integer = (value: unknown, min: number, max = MAX_INT) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
const optionalInteger = (value: unknown, min: number, max = MAX_INT) => value === undefined || integer(value, min, max)

/** Numbers end up in attributes typed as integers in ranges; anything else would break the file. */
function validNumbers(shape: ShapeSnapshot): boolean {
  const xfrm = shape.xfrm
  if (xfrm !== undefined) {
    if (!xfrm || typeof xfrm !== 'object') return false
    if (!integer(xfrm.x, -MAX_INT) || !integer(xfrm.y, -MAX_INT) || !integer(xfrm.cx, 0) || !integer(xfrm.cy, 0)) return false
    if (!optionalInteger(xfrm.rot, -MAX_INT) || !optionalInteger(xfrm.chX, -MAX_INT) || !optionalInteger(xfrm.chY, -MAX_INT) || !optionalInteger(xfrm.chCx, 0) || !optionalInteger(xfrm.chCy, 0)) return false
    if ((xfrm.flipH !== undefined && typeof xfrm.flipH !== 'boolean') || (xfrm.flipV !== undefined && typeof xfrm.flipV !== 'boolean')) return false
  }
  if (!optionalInteger(shape.nvId, 0)) return false
  const table = shape.table
  if (table !== undefined) {
    if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return false
    if (!table.columns.every((column) => column && typeof column.key === 'string' && integer(column.w, 0) && typeof column.xml === 'string')) return false
    for (const row of table.rows) {
      if (!row || typeof row.key !== 'string' || !integer(row.h, 0) || typeof row.xml !== 'string' || !row.cells || typeof row.cells !== 'object') return false
      for (const cell of Object.values(row.cells)) {
        if (!cell || typeof cell.xml !== 'string' || !optionalInteger(cell.gridSpan, 1, 1000) || !optionalInteger(cell.rowSpan, 1, 1000)) return false
        normalizeText(cell.text)
      }
    }
  }
  return true
}

function validShape(shape: ShapeSnapshot): boolean {
  if (!shape || typeof shape !== 'object' || typeof shape.xml !== 'string' || !SHAPE_KINDS.has(shape.kind) || typeof shape.rels !== 'object' || shape.rels === null) return false
  // Text lives only on `p:sp`; anywhere else it would be written where the schema forbids it.
  if (shape.text && shape.kind !== 'sp') return false
  try {
    if (!validNumbers(shape)) return false
    if (shape.text) normalizeText(shape.text)
    if (shape.children && (!Array.isArray(shape.children) || !shape.children.every(validShape))) return false
    // Building the element exercises every XML-valued property and the text writer.
    buildShapeElement(parseXmlDocument('<w/>'), shape, {}, new RelationshipTable())
    return true
  } catch {
    return false
  }
}

function validSlide(slide: SlideSnapshot): boolean {
  if (!slide || typeof slide !== 'object' || typeof slide.xml !== 'string' || typeof slide.layout !== 'string' || !Array.isArray(slide.shapes)) return false
  try {
    if (parseXmlDocument(slide.xml).documentElement?.localName !== 'sld') return false
    if (slide.background) parseFragment(slide.background)
    if (slide.notes?.text) normalizeText(slide.notes.text)
    if (slide.notes?.xml) parseXmlDocument(slide.notes.xml)
  } catch {
    return false
  }
  slide.shapes = slide.shapes.filter(validShape)
  return typeof slide.rels === 'object' && slide.rels !== null
}

/**
 * Prepares the clipboard's parts for `doc`; returns old path → new path and a function that writes
 * them. Pasting into the source deck reuses only parts whose content and dependencies still match.
 * Anything else gets a name no other paste can pick (a random suffix), so two people pasting at
 * once never overwrite each other's images. The writer runs synchronously right before the shapes
 * are inserted, under `PARTS_ORIGIN`, so undoing the paste never deletes a part someone else uses.
 */
async function prepareParts(doc: Y.Doc, assets: LiveAssetStore, clipboard: PresentationClipboard): Promise<{ mapping: Map<string, string>; write(): void }> {
  const sameDocument = clipboard.source === documentIdentity(doc)
  const mapping = new Map<string, string>()
  const contentParts = Object.keys(clipboard.parts).filter((path) => !path.endsWith('.rels'))
  const suffix = randomId().slice(0, 8)
  const copies = new Map<string, PartSnapshot>()
  const relationships = new Map<string, Uint8Array>()
  const dependents = new Map<string, Set<string>>()
  for (const path of contentParts) {
    const part = clipboard.parts[path]!
    const bytes = fromBase64(part.data)
    copies.set(path, { ...(part.mimeType ? { asset: await assets.put(bytes, part.mimeType) } : { bytes }), ...(part.contentType ? { contentType: part.contentType } : {}) })
    const relsSource = clipboard.parts[relationshipsPathFor(path)]
    if (!relsSource) continue
    const relsBytes = fromBase64(relsSource.data)
    relationships.set(path, relsBytes)
    for (const element of childElements(parseXmlDocument(decodePartText(relsBytes)).documentElement)) {
      if (attr(element, 'TargetMode') === 'External') continue
      const target = attr(element, 'Target')
      if (target === undefined) continue
      const dependency = resolveTarget(path, target)
      const parents = dependents.get(dependency) ?? new Set<string>()
      parents.add(path)
      dependents.set(dependency, parents)
    }
  }
  return {
    mapping,
    write: () => {
      // Recheck after all asset writes: a collaborator can replace a part while they are pending.
      const root = presentationRoot(doc)
      const reusable = new Set(contentParts.filter((path) => {
        if (!sameDocument) return false
        const current = readPart(root, path)
        const copy = copies.get(path)!
        if (!current || current.contentType !== copy.contentType || current.asset?.hash !== copy.asset?.hash || current.asset?.mimeType !== copy.asset?.mimeType || !bytesEqual(current.bytes, copy.bytes)) return false
        return bytesEqual(readPart(root, relationshipsPathFor(path))?.bytes, relationships.get(path))
      }))
      // An unchanged chart must also be copied when its workbook or another dependency changed.
      const changed = contentParts.filter((path) => !reusable.has(path))
      for (let index = 0; index < changed.length; index++) for (const parent of dependents.get(changed[index]!) ?? []) {
        if (reusable.delete(parent)) changed.push(parent)
      }
      for (const path of contentParts) {
        if (reusable.has(path)) continue
        const slash = path.lastIndexOf('/')
        const dot = path.lastIndexOf('.')
        const stem = path.slice(slash + 1, dot > slash ? dot : undefined)
        const extension = dot > slash ? path.slice(dot) : ''
        mapping.set(path, `${path.slice(0, slash + 1)}${stem}-${suffix}${extension}`)
      }
      doc.transact(() => {
        for (const [path, target] of mapping) {
          setPart(root, target, copies.get(path)!)
          const rels = relationships.get(path)
          if (rels) setPart(root, relationshipsPathFor(target), { bytes: rewriteRels(rels, path, target, mapping) })
        }
      }, PARTS_ORIGIN)
    },
  }
}

/** Points a copied part's relationships at the copies of their targets. */
function rewriteRels(bytes: Uint8Array, oldSource: string, newSource: string, mapping: Map<string, string>): Uint8Array {
  const document = parseXmlDocument(decodePartText(bytes))
  for (const element of childElements(document.documentElement)) {
    if (attr(element, 'TargetMode') === 'External') continue
    const target = attr(element, 'Target')
    if (target === undefined) continue
    const resolved = resolveTarget(oldSource, target)
    element.setAttribute('Target', relativeTarget(newSource, mapping.get(resolved) ?? resolved))
  }
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${serializeNode(document.documentElement!)}`)
}

/**
 * A slide part name no deck has. Links to slides of the deck content was copied from would point
 * at whatever slide has the same part name here; they point at this instead, and are cleared on
 * save the way links to deleted slides are.
 */
const UNLINKED_SLIDE = 'ppt/slides/pulpo-unlinked-slide.xml'

function remapRels(rels: Record<string, RelTarget>, mapping: Map<string, string>, unlinkSlides: boolean): Record<string, RelTarget> {
  return Object.fromEntries(
    Object.entries(rels).map(([id, rel]) => {
      if (rel.external) return [id, rel]
      if (unlinkSlides && rel.type === REL_TYPES.slide) return [id, { ...rel, target: UNLINKED_SLIDE }]
      return [id, { ...rel, target: mapping.get(rel.target) ?? rel.target }]
    }),
  )
}

/** Text links to slides of another deck, unlinked (see UNLINKED_SLIDE). */
function unlinkText(text: TextJSON | undefined): TextJSON | undefined {
  if (!text || !JSON.stringify(text).includes('"link"')) return text
  const copy = structuredClone(text)
  for (const paragraph of copy.content ?? []) {
    for (const inline of paragraph.content ?? []) {
      for (const mark of inline.marks ?? []) {
        if (mark.type === 'link' && mark.attrs?.external === false && (mark.attrs.relType ?? REL_TYPES.slide) === REL_TYPES.slide) mark.attrs = { ...mark.attrs, target: UNLINKED_SLIDE }
      }
    }
  }
  return copy
}

function remapShape(shape: ShapeSnapshot, mapping: Map<string, string>, unlinkSlides: boolean): ShapeSnapshot {
  const text = unlinkSlides ? unlinkText(shape.text) : shape.text
  return {
    ...shape,
    rels: remapRels(shape.rels, mapping, unlinkSlides),
    ...(text ? { text } : {}),
    ...(unlinkSlides && shape.table ? { table: {
      ...shape.table,
      rows: shape.table.rows.map((row) => ({ ...row, cells: Object.fromEntries(Object.entries(row.cells).map(([key, cell]) => [key, { ...cell, text: unlinkText(cell.text)! }])) })),
    } } : {}),
    ...(shape.children ? { children: shape.children.map((member) => remapShape(member, mapping, unlinkSlides)) } : {}),
  }
}

/** Pastes shapes onto a slide, offset when pasting onto the slide they came from. Returns the new keys. */
export async function pasteShapes(doc: Y.Doc, assets: LiveAssetStore, clipboard: PresentationClipboard, slideKey: string, offset: number, origin?: unknown): Promise<string[]> {
  const fits = () => {
    const slide = readSlide(doc, slideKey)
    return slide !== undefined && countShapes(slide.shapes) + countShapes(clipboard.shapes ?? []) <= DEFAULT_PRESENTATION_LIMITS.maxShapesPerSlide
  }
  if (!fits()) return []
  const { mapping, write } = await prepareParts(doc, assets, clipboard)
  // Checked again after storing the pictures: another paste may have filled the slide meanwhile.
  if (!fits()) return []
  write()
  const sameDocument = clipboard.source === documentIdentity(doc)
  const shapes = (clipboard.shapes ?? []).map((shape) => {
    const copy = remapShape(cloneShape(shape), mapping, !sameDocument)
    if (copy.xfrm && offset) copy.xfrm = { ...copy.xfrm, x: copy.xfrm.x + offset, y: copy.xfrm.y + offset }
    return copy
  })
  return insertShapes(doc, slideKey, shapes, origin)
}

/** Pastes slides at `index`, mapping layouts by name when they come from another deck. */
export async function pasteSlides(doc: Y.Doc, assets: LiveAssetStore, clipboard: PresentationClipboard, index: number, origin?: unknown): Promise<string[]> {
  const incoming = clipboard.slides ?? []
  if (incoming.some((slide) => countShapes(slide.shapes) > DEFAULT_PRESENTATION_LIMITS.maxShapesPerSlide)) return []
  const fits = () => slideKeys(doc).length + incoming.length <= DEFAULT_PRESENTATION_LIMITS.maxSlides
  if (!fits()) return []
  const sameDocument = clipboard.source === documentIdentity(doc)
  const { mapping, write } = await prepareParts(doc, assets, clipboard)
  // Checked again after storing the pictures: another paste may have added slides meanwhile.
  if (!fits()) return []
  write()
  const snapshot = readSnapshot(doc)
  const deck = new DeckResources(snapshot.parts, snapshot.mainPart)
  const layouts = deck.masterPaths().flatMap((master) => deck.master(master)?.layouts ?? [])
  const slides = (clipboard.slides ?? []).map(({ layoutName, ...slide }) => {
    const copy = cloneSlide(slide)
    if (!sameDocument) {
      copy.layout = layouts.find((layout) => deck.layout(layout)?.name === layoutName) ?? layouts.find((layout) => deck.layout(layout)?.type === 'obj') ?? layouts[0] ?? copy.layout
      copy.rels = remapRels(copy.rels, mapping, true)
      copy.shapes = copy.shapes.map((shape) => remapShape(shape, mapping, true))
      delete copy.section
      if (copy.notes) copy.notes = { ...copy.notes, text: unlinkText(copy.notes.text)!, rels: {}, xml: '' }
    }
    return copy
  })
  return insertSlides(doc, slides, index, origin)
}

