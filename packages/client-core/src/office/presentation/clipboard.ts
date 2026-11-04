import type * as Y from 'yjs'
import type { LiveAssetStore } from '../live-format.js'
import { decodePartText, relationshipsPathFor, relativeTarget, resolveTarget } from '../ooxml/package.js'
import { cloneShape, cloneSlide, insertShapes, insertSlides, partsMap } from './commands.js'
import type { PartSnapshot, RelTarget, ShapeSnapshot, SlideSnapshot } from './model.js'
import { DeckResources } from './render/deck.js'
import { readSnapshot } from './ydoc.js'
import { normalizeText } from './text.js'
import { buildShapeElement, RelationshipTable } from './write.js'
import { attr, childElements, parseFragment, parseXmlDocument, REL_TYPES, serializeNode } from './xml.js'

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

/** A stable id for a document, kept in the document so every replica agrees. */
export function documentIdentity(doc: Y.Doc): string {
  return String(doc.guid)
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
function partGraph(parts: Record<string, PartSnapshot>, roots: string[], limit = 200): string[] {
  const seen = new Set<string>()
  const queue = [...roots]
  const deck = new DeckResources(parts, '')
  while (queue.length && seen.size < limit) {
    const part = queue.shift()!
    if (seen.has(part) || !parts[part]) continue
    // Never drag a slide layout or another slide along; those are mapped, not copied.
    if (/\/(slideLayouts|slideMasters|slides|notesSlides|notesMasters)\//.test(`/${part}`)) continue
    seen.add(part)
    const relsPath = relationshipsPathFor(part)
    if (parts[relsPath]) seen.add(relsPath)
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
  for (const path of partGraph(snapshot.parts, roots)) {
    const part = snapshot.parts[path]!
    const bytes = part.bytes ?? (part.asset ? await assets.get(part.asset.hash) : undefined)
    if (!bytes) continue
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
  const parts: Record<string, ClipboardPart> = {}
  for (const [path, part] of Object.entries(value.parts)) {
    if (typeof part?.data !== 'string' || !/^[\w./-]+$/.test(path) || path.includes('..')) continue
    parts[path] = part
  }
  const shapes = Array.isArray(value.shapes) ? value.shapes.filter(validShape) : undefined
  const slides = Array.isArray(value.slides) ? value.slides.filter(validSlide) : undefined
  return { version: 1, source: String(value.source ?? ''), kind: value.kind, ...(shapes ? { shapes } : {}), ...(slides ? { slides } : {}), parts, text: String(value.text ?? '') }
}

const SHAPE_KINDS = new Set(['sp', 'pic', 'cxnSp', 'grpSp', 'graphicFrame', 'opaque'])

function validShape(shape: ShapeSnapshot): boolean {
  if (!shape || typeof shape !== 'object' || typeof shape.xml !== 'string' || !SHAPE_KINDS.has(shape.kind) || typeof shape.rels !== 'object' || shape.rels === null) return false
  try {
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

/** Brings the clipboard's parts into `doc` under fresh names; returns old path → new path. */
async function importParts(doc: Y.Doc, assets: LiveAssetStore, clipboard: PresentationClipboard): Promise<Map<string, string>> {
  const mapping = new Map<string, string>()
  const parts = partsMap(doc)
  const used = new Set(parts.keys())
  const contentParts = Object.keys(clipboard.parts).filter((path) => !path.endsWith('.rels'))
  for (const path of contentParts) {
    const slash = path.lastIndexOf('/')
    const dot = path.lastIndexOf('.')
    const stem = path.slice(slash + 1, dot > slash ? dot : undefined)
    const extension = dot > slash ? path.slice(dot) : ''
    let candidate = path
    for (let index = 1; used.has(candidate); index++) candidate = `${path.slice(0, slash + 1)}pulpo-${stem}-${index}${extension}`
    used.add(candidate)
    mapping.set(path, candidate)
  }
  const entries: [string, PartSnapshot][] = []
  for (const path of contentParts) {
    const part = clipboard.parts[path]!
    const bytes = fromBase64(part.data)
    const target = mapping.get(path)!
    if (part.mimeType) entries.push([target, { asset: await assets.put(bytes, part.mimeType), ...(part.contentType ? { contentType: part.contentType } : {}) }])
    else entries.push([target, { bytes, ...(part.contentType ? { contentType: part.contentType } : {}) }])
    const relsSource = clipboard.parts[relationshipsPathFor(path)]
    if (relsSource) entries.push([relationshipsPathFor(target), { bytes: rewriteRels(fromBase64(relsSource.data), path, target, mapping) }])
  }
  doc.transact(() => {
    for (const [path, part] of entries) parts.set(path, part)
  })
  return mapping
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

function remapRels(rels: Record<string, RelTarget>, mapping: Map<string, string>): Record<string, RelTarget> {
  return Object.fromEntries(Object.entries(rels).map(([id, rel]) => [id, rel.external ? rel : { ...rel, target: mapping.get(rel.target) ?? rel.target }]))
}

function remapShape(shape: ShapeSnapshot, mapping: Map<string, string>): ShapeSnapshot {
  return { ...shape, rels: remapRels(shape.rels, mapping), ...(shape.children ? { children: shape.children.map((member) => remapShape(member, mapping)) } : {}) }
}

/** Pastes shapes onto a slide, offset when pasting onto the slide they came from. Returns the new keys. */
export async function pasteShapes(doc: Y.Doc, assets: LiveAssetStore, clipboard: PresentationClipboard, slideKey: string, offset: number, origin?: unknown): Promise<string[]> {
  const sameDocument = clipboard.source === documentIdentity(doc)
  const mapping = sameDocument ? new Map<string, string>() : await importParts(doc, assets, clipboard)
  const shapes = (clipboard.shapes ?? []).map((shape) => {
    const copy = remapShape(cloneShape(shape), mapping)
    if (copy.xfrm && offset) copy.xfrm = { ...copy.xfrm, x: copy.xfrm.x + offset, y: copy.xfrm.y + offset }
    return copy
  })
  return insertShapes(doc, slideKey, shapes, origin)
}

/** Pastes slides at `index`, mapping layouts by name when they come from another deck. */
export async function pasteSlides(doc: Y.Doc, assets: LiveAssetStore, clipboard: PresentationClipboard, index: number, origin?: unknown): Promise<string[]> {
  const sameDocument = clipboard.source === documentIdentity(doc)
  const mapping = sameDocument ? new Map<string, string>() : await importParts(doc, assets, clipboard)
  const snapshot = readSnapshot(doc)
  const deck = new DeckResources(snapshot.parts, snapshot.mainPart)
  const layouts = deck.masterPaths().flatMap((master) => deck.master(master)?.layouts ?? [])
  const slides = (clipboard.slides ?? []).map(({ layoutName, ...slide }) => {
    const copy = cloneSlide(slide)
    if (!sameDocument) {
      copy.layout = layouts.find((layout) => deck.layout(layout)?.name === layoutName) ?? layouts.find((layout) => deck.layout(layout)?.type === 'obj') ?? layouts[0] ?? copy.layout
      copy.rels = remapRels(copy.rels, mapping)
      copy.shapes = copy.shapes.map((shape) => remapShape(shape, mapping))
      delete copy.section
      if (copy.notes) copy.notes = { ...copy.notes, rels: {}, xml: '' }
    }
    return copy
  })
  return insertSlides(doc, slides, index, origin)
}

