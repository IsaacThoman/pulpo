import type * as Y from 'yjs'
import { alignKeys } from './codec.js'
import { canonicalValue, CanonicalPresentation } from './canonical.js'
import type { PartSnapshot, PresentationSnapshot, RelTarget, ShapeSnapshot, SlideSnapshot } from './model.js'
import { readPresentation, relationshipIdsIn } from './read.js'
import { DeckResources } from './render/deck.js'
import { slideSections } from './sections.js'
import { textToPlain } from './text.js'
import { bytesEqual, parseFragment, path, REL_TYPES, stableStringify } from './xml.js'
import { readSnapshot } from './ydoc.js'

/**
 * What changed between two versions of a deck, in terms a reviewer reads: slides added, removed,
 * moved, and edited, and for edited slides which shapes changed and how their text changed.
 * Agent proposals (whole new files) are reviewed with this before they are applied.
 */

export type ShapeChangeKind = 'added' | 'removed' | 'text' | 'formatting' | 'moved' | 'resized' | 'rotated' | 'fill' | 'line' | 'geometry' | 'image' | 'table' | 'other'

export interface ShapeChange {
  key: string
  name: string
  kinds: ShapeChangeKind[]
  textBefore?: string
  textAfter?: string
}

export type SlideChangeKind = 'layout' | 'hidden' | 'shown' | 'background' | 'notes' | 'transition' | 'order' | 'formatting'

export interface SlideDiff {
  status: 'added' | 'removed' | 'moved' | 'edited' | 'unchanged'
  /** Index in the old deck (removed, moved, edited, unchanged). */
  before?: number
  /** Index in the new deck (added, moved, edited, unchanged). */
  after?: number
  /** Slide keys, for rendering thumbnails from each snapshot. */
  beforeKey?: string
  afterKey?: string
  /** A short label: the slide's title text, else its first text. */
  title: string
  slideChanges: SlideChangeKind[]
  shapes: ShapeChange[]
  notesBefore?: string
  notesAfter?: string
}

export interface PresentationDiff {
  slides: SlideDiff[]
  added: number
  removed: number
  moved: number
  edited: number
  /** Deck-wide changes: slide size, themes and masters, other parts. */
  deck: ('size' | 'theme' | 'masters' | 'media' | 'other' | 'sections')[]
  changed: boolean
  /** The snapshots compared (aligned), for drawing before/after thumbnails. */
  beforeSnapshot: PresentationSnapshot
  afterSnapshot: PresentationSnapshot
}

/** Compares two documents (a document and a proposal, or two versions). */
export function diffDocuments(before: Y.Doc, after: Y.Doc): PresentationDiff {
  return diffSnapshots(readSnapshot(before), readSnapshot(after))
}

/** Compares a document with a file, such as an agent's proposed version. */
export async function diffDocumentWithFile(before: Y.Doc, file: Uint8Array): Promise<PresentationDiff> {
  return diffSnapshots(readSnapshot(before), await readPresentation(file))
}

export async function diffFiles(before: Uint8Array, after: Uint8Array): Promise<PresentationDiff> {
  return diffSnapshots(await readPresentation(before), await readPresentation(after))
}

function titleOf(slide: SlideSnapshot): string {
  const texts = slide.shapes.flatMap((shape) => (shape.text ? [textToPlain(shape.text).trim()] : [])).filter(Boolean)
  const title = slide.shapes.find((shape) => /type="(ctrTitle|title)"/.test(shape.xml) && shape.text)
  return (title?.text ? textToPlain(title.text).trim() : texts[0] ?? '').split('\n')[0]!.slice(0, 120)
}

function shapeText(shape: ShapeSnapshot): string {
  if (shape.text) return textToPlain(shape.text)
  if (shape.table) return shape.table.rows.map((row) => shape.table!.columns.map((column) => textToPlain(row.cells[column.key]?.text ?? { type: 'doc' })).join('\t')).join('\n')
  return ''
}

function flatten(shapes: ShapeSnapshot[], into = new Map<string, ShapeSnapshot>()): Map<string, ShapeSnapshot> {
  for (const shape of shapes) {
    into.set(shape.key, shape)
    flatten(shape.children ?? [], into)
  }
  return into
}

const same = (a: unknown, b: unknown) => stableStringify(canonicalValue(a)) === stableStringify(canonicalValue(b))

function compareShape(before: ShapeSnapshot, after: ShapeSnapshot): ShapeChangeKind[] {
  const kinds: ShapeChangeKind[] = []
  const textBefore = shapeText(before)
  const textAfter = shapeText(after)
  if (textBefore !== textAfter) kinds.push(after.table ? 'table' : 'text')
  else if (!same(before.text, after.text) || !same(before.bodyPr, after.bodyPr)) kinds.push('formatting')
  else if (!same(before.table, after.table)) kinds.push('table')
  const a = before.xfrm
  const b = after.xfrm
  if (a?.x !== b?.x || a?.y !== b?.y) kinds.push('moved')
  if (a?.cx !== b?.cx || a?.cy !== b?.cy) kinds.push('resized')
  if ((a?.rot ?? 0) !== (b?.rot ?? 0) || !!a?.flipH !== !!b?.flipH || !!a?.flipV !== !!b?.flipV) kinds.push('rotated')
  if (!same(before.fill, after.fill)) kinds.push('fill')
  if (!same(before.line, after.line)) kinds.push('line')
  if (!same(before.geom, after.geom)) kinds.push('geometry')
  if (!same(before.blipFill, after.blipFill) || !same(Object.values(before.rels).map((rel) => rel.target).sort(), Object.values(after.rels).map((rel) => rel.target).sort())) kinds.push('image')
  // A group's template excludes its members; their stacking order is modeled separately.
  const childKeys = (shape: ShapeSnapshot) => (shape.children ?? []).map((child) => child.key)
  if (!kinds.length && (!same(before.xml, after.xml) || !same(before.effects, after.effects) || before.name !== after.name || before.descr !== after.descr || before.hidden !== after.hidden || !same(childKeys(before), childKeys(after)))) kinds.push('other')
  return kinds
}

/** Relationships keep their paths when an agent changes the chart or diagram's contents. */
function samePart(before: PartSnapshot | undefined, after: PartSnapshot | undefined): boolean {
  if (!before || !after) return before === after
  return before.asset?.hash === after.asset?.hash && bytesEqual(before.bytes, after.bytes)
}

function referencedParts(shape: ShapeSnapshot, slide: SlideSnapshot): string[] {
  const rels: RelTarget[] = Object.values(shape.rels)
  // Diagram drawings can be attached to the slide rather than to the graphic frame.
  if (rels.some((rel) => rel.type === REL_TYPES.diagramData)) rels.push(...Object.values(slide.rels).filter((rel) => rel.type === REL_TYPES.diagramDrawing))
  return [...new Set(rels.filter((rel) => !rel.external).map((rel) => rel.target))].sort()
}

/** Resolve the background the renderer uses, including layout/master inheritance. */
function backgroundParts(slide: SlideSnapshot, deck: DeckResources): string[] {
  let background = slide.background ? parseFragment(slide.background) : undefined
  let rels = slide.rels
  if (!background) {
    const master = deck.related(slide.layout, REL_TYPES.slideMaster)
    for (const source of [slide.layout, master]) {
      if (!source) continue
      background = path(deck.xml(source), 'cSld', 'bg')
      if (!background) continue
      rels = Object.fromEntries(deck.rels(source))
      break
    }
  }
  if (!background) return []
  return [...new Set(relationshipIdsIn(background).flatMap((id) => {
    const rel = rels[id]
    return rel && !rel.external ? [rel.target] : []
  }))].sort()
}

function compareSlides(before: SlideSnapshot, after: SlideSnapshot, beforeCanonical: CanonicalPresentation, afterCanonical: CanonicalPresentation): Pick<SlideDiff, 'slideChanges' | 'shapes' | 'notesBefore' | 'notesAfter'> {
  const beforeDeck = beforeCanonical.deck
  const afterDeck = afterCanonical.deck
  const beforeParts = beforeDeck.parts
  const afterParts = afterDeck.parts
  const slideChanges: SlideChangeKind[] = []
  if (before.layout !== after.layout) slideChanges.push('layout')
  if (before.hidden !== after.hidden) slideChanges.push(after.hidden ? 'hidden' : 'shown')
  const oldBackgroundParts = backgroundParts(before, beforeDeck)
  const newBackgroundParts = backgroundParts(after, afterDeck)
  if (!same(before.background, after.background) || !same(oldBackgroundParts, newBackgroundParts)
    || newBackgroundParts.some((part) => !samePart(beforeParts[part], afterParts[part]))) slideChanges.push('background')
  const notesBefore = before.notes ? textToPlain(before.notes.text) : ''
  const notesAfter = after.notes ? textToPlain(after.notes.text) : ''
  if (notesBefore !== notesAfter) slideChanges.push('notes')
  if (!same(before.xml, after.xml)) slideChanges.push('transition')
  const beforeShapes = flatten(before.shapes)
  const afterShapes = flatten(after.shapes)
  const shapes: ShapeChange[] = []
  for (const [key, shape] of afterShapes) {
    const previous = beforeShapes.get(key)
    if (!previous) {
      shapes.push({ key, name: shape.name ?? '', kinds: ['added'], ...(shapeText(shape) ? { textAfter: shapeText(shape) } : {}) })
      continue
    }
    const kinds = compareShape(previous, shape)
    const oldParts = referencedParts(previous, before)
    const newParts = referencedParts(shape, after)
    if ((!same(oldParts, newParts) || newParts.some((path) => !same(beforeCanonical.part(path), afterCanonical.part(path)))) && !kinds.includes('other')) kinds.push('other')
    if (kinds.length) shapes.push({ key, name: shape.name ?? previous.name ?? '', kinds, ...(kinds.includes('text') || kinds.includes('table') ? { textBefore: shapeText(previous), textAfter: shapeText(shape) } : {}) })
  }
  for (const [key, shape] of beforeShapes) {
    if (!afterShapes.has(key)) shapes.push({ key, name: shape.name ?? '', kinds: ['removed'], ...(shapeText(shape) ? { textBefore: shapeText(shape) } : {}) })
  }
  // Pure reordering of shapes (z-order) shows as "other" on the slide.
  if (!shapes.length && !same(before.shapes.map((shape) => shape.key), after.shapes.map((shape) => shape.key))) slideChanges.push('order')
  // The specific labels are explanatory; the complete canonical comparison is the safety net.
  if (!shapes.length && !slideChanges.length && beforeCanonical.slide(before) !== afterCanonical.slide(after)) slideChanges.push('formatting')
  return { slideChanges, shapes, ...(notesBefore !== notesAfter ? { notesBefore, notesAfter } : {}) }
}

/** Indices of `a` that keep their relative order in `b` (a longest common subsequence). */
function stableKeys(a: string[], b: string[]): Set<string> {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
  const kept = new Set<string>()
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      kept.add(a[i]!)
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++
    else j++
  }
  return kept
}

/** Compare modeled sections, using effective membership as it is shown and saved. */
function sectionMembership(snapshot: PresentationSnapshot): Map<string, string | undefined> {
  const names = new Map(snapshot.sections.map((section) => [section.key, section.name]))
  const memberships = slideSections(snapshot.sections.map((section) => section.key), snapshot.slides)
  return new Map(snapshot.slides.map((slide, index) => [slide.key, names.get(memberships[index] ?? '')]))
}

export function diffSnapshots(beforeInput: PresentationSnapshot, afterInput: PresentationSnapshot): PresentationDiff {
  const before = beforeInput
  const after = alignKeys(beforeInput, afterInput)
  const beforeCanonical = new CanonicalPresentation(new DeckResources(before.parts, before.mainPart))
  const afterCanonical = new CanonicalPresentation(new DeckResources(after.parts, after.mainPart))
  const beforeKeys = before.slides.map((slide) => slide.key)
  const afterKeys = after.slides.map((slide) => slide.key)
  const beforeByKey = new Map(before.slides.map((slide, index) => [slide.key, { slide, index }]))
  const afterSet = new Set(afterKeys)
  const common = beforeKeys.filter((key) => afterSet.has(key))
  const stable = stableKeys(common, afterKeys.filter((key) => beforeByKey.has(key)))
  const slides: SlideDiff[] = []
  after.slides.forEach((slide, index) => {
    const previous = beforeByKey.get(slide.key)
    if (!previous) {
      slides.push({ status: 'added', after: index, afterKey: slide.key, title: titleOf(slide), slideChanges: [], shapes: slide.shapes.map((shape) => ({ key: shape.key, name: shape.name ?? '', kinds: ['added'] as ShapeChangeKind[], ...(shapeText(shape) ? { textAfter: shapeText(shape) } : {}) })) })
      return
    }
    const comparison = compareSlides(previous.slide, slide, beforeCanonical, afterCanonical)
    const edited = comparison.slideChanges.length > 0 || comparison.shapes.length > 0
    const moved = !stable.has(slide.key)
    slides.push({
      status: moved ? 'moved' : edited ? 'edited' : 'unchanged',
      before: previous.index,
      after: index,
      beforeKey: slide.key,
      afterKey: slide.key,
      title: titleOf(slide),
      ...comparison,
    })
  })
  before.slides.forEach((slide, index) => {
    if (afterSet.has(slide.key)) return
    // Removed slides are listed where they used to be.
    const position = slides.findIndex((entry) => (entry.before ?? Number.POSITIVE_INFINITY) > index)
    const entry: SlideDiff = { status: 'removed', before: index, beforeKey: slide.key, title: titleOf(slide), slideChanges: [], shapes: [] }
    if (position < 0) slides.push(entry)
    else slides.splice(position, 0, entry)
  })
  const deck: PresentationDiff['deck'] = []
  const beforeSections = sectionMembership(before)
  const afterSections = sectionMembership(after)
  if (!same(before.sections.map((section) => section.name), after.sections.map((section) => section.name))
    || [...new Set([...beforeSections.keys(), ...afterSections.keys()])].some((key) => beforeSections.get(key) !== afterSections.get(key))) deck.push('sections')
  if (before.slideWidth !== after.slideWidth || before.slideHeight !== after.slideHeight) deck.push('size')
  const partKinds = new Set<string>()
  for (const path of new Set([...Object.keys(before.parts), ...Object.keys(after.parts)])) {
    const a = before.parts[path]
    const b = after.parts[path]
    if (a && b && same(beforeCanonical.part(path), afterCanonical.part(path))) continue
    if (path.includes('/theme/')) partKinds.add('theme')
    else if (path.includes('slideMaster') || path.includes('slideLayout')) partKinds.add('masters')
    else if (path.includes('/media/')) partKinds.add('media')
    else if (!/docProps|presentation\.xml|_rels\/presentation|\[Content_Types\]|charts\/|diagrams\/|embeddings\//.test(path)) partKinds.add('other')
  }
  deck.push(...([...partKinds] as PresentationDiff['deck']))
  const count = (status: SlideDiff['status']) => slides.filter((slide) => slide.status === status).length
  // Moved slides that were also edited still count as edited for the summary.
  const edited = slides.filter((slide) => slide.status === 'edited' || (slide.status === 'moved' && (slide.shapes.length || slide.slideChanges.length))).length
  const result = { slides, added: count('added'), removed: count('removed'), moved: count('moved'), edited, deck, beforeSnapshot: before, afterSnapshot: after }
  return { ...result, changed: result.added + result.removed + result.moved + result.edited + deck.length > 0 }
}
