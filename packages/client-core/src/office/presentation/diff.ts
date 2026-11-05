import type * as Y from 'yjs'
import { alignKeys } from './codec.js'
import type { PartSnapshot, PresentationSnapshot, RelTarget, ShapeSnapshot, SlideSnapshot } from './model.js'
import { readPresentation } from './read.js'
import { textToPlain } from './text.js'
import { bytesEqual, REL_TYPES, stableStringify } from './xml.js'
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

export type SlideChangeKind = 'layout' | 'hidden' | 'shown' | 'background' | 'notes' | 'transition' | 'order'

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
  deck: ('size' | 'theme' | 'masters' | 'media' | 'other')[]
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

const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b)

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
  if (!kinds.length && (before.xml !== after.xml || !same(before.effects, after.effects) || before.name !== after.name || before.descr !== after.descr || before.hidden !== after.hidden)) kinds.push('other')
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

function compareSlides(before: SlideSnapshot, after: SlideSnapshot, beforeParts: PresentationSnapshot['parts'], afterParts: PresentationSnapshot['parts']): Pick<SlideDiff, 'slideChanges' | 'shapes' | 'notesBefore' | 'notesAfter'> {
  const slideChanges: SlideChangeKind[] = []
  if (before.layout !== after.layout) slideChanges.push('layout')
  if (before.hidden !== after.hidden) slideChanges.push(after.hidden ? 'hidden' : 'shown')
  if (!same(before.background, after.background)) slideChanges.push('background')
  const notesBefore = before.notes ? textToPlain(before.notes.text) : ''
  const notesAfter = after.notes ? textToPlain(after.notes.text) : ''
  if (notesBefore !== notesAfter) slideChanges.push('notes')
  if (before.xml !== after.xml) slideChanges.push('transition')
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
    if ((!same(oldParts, newParts) || newParts.some((path) => !samePart(beforeParts[path], afterParts[path]))) && !kinds.includes('other')) kinds.push('other')
    if (kinds.length) shapes.push({ key, name: shape.name ?? previous.name ?? '', kinds, ...(kinds.includes('text') || kinds.includes('table') ? { textBefore: shapeText(previous), textAfter: shapeText(shape) } : {}) })
  }
  for (const [key, shape] of beforeShapes) {
    if (!afterShapes.has(key)) shapes.push({ key, name: shape.name ?? '', kinds: ['removed'], ...(shapeText(shape) ? { textBefore: shapeText(shape) } : {}) })
  }
  // Pure reordering of shapes (z-order) shows as "other" on the slide.
  if (!shapes.length && !same(before.shapes.map((shape) => shape.key), after.shapes.map((shape) => shape.key))) slideChanges.push('order')
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

export function diffSnapshots(beforeInput: PresentationSnapshot, afterInput: PresentationSnapshot): PresentationDiff {
  const before = beforeInput
  const after = alignKeys(beforeInput, afterInput)
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
    const comparison = compareSlides(previous.slide, slide, before.parts, after.parts)
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
  if (before.slideWidth !== after.slideWidth || before.slideHeight !== after.slideHeight) deck.push('size')
  const partKinds = new Set<string>()
  for (const path of new Set([...Object.keys(before.parts), ...Object.keys(after.parts)])) {
    const a = before.parts[path]
    const b = after.parts[path]
    if (a && b && (a.asset?.hash ?? '') === (b.asset?.hash ?? '') && bytesEqual(a.bytes, b.bytes)) continue
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
