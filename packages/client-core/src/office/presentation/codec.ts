import { pushAll } from '../../collections.js'
import type * as Y from 'yjs'
import { LiveFormatError, type LiveFormatCodec, type LiveFormatContext } from '../live-format.js'
import { blankPresentation } from './blank.js'
import type { PresentationSnapshot, ShapeSnapshot, SlideSnapshot, TableSnapshot } from './model.js'
import { transactChanges } from '../assets.js'
import { PRESENTATION_EXTENSIONS, presentationFormat, presentationMimeType } from './layout.js'
import { PRESENTATION_SCHEMA_VERSION } from './model.js'
import { readPresentation } from './read.js'
import { textToPlain } from './text.js'
import { stableStringify } from './xml.js'
import { presentationRoot, readParts, readSnapshot, reconcileSnapshot, writeSnapshot } from './ydoc.js'
import { assignIdentifiers, writePresentation } from './write.js'
import { textSummaryOfChart } from './summary.js'

export { PRESENTATION_EXTENSIONS, presentationFormat } from './layout.js'

function assertEmpty(doc: Y.Doc): void {
  if (presentationRoot(doc).size > 0) throw new Error('The document already has content')
}

export const presentationCodec: LiveFormatCodec = {
  id: 'presentation',
  schemaVersion: PRESENTATION_SCHEMA_VERSION,
  extensions: PRESENTATION_EXTENSIONS,

  mimeType: presentationMimeType,

  async createEmpty(doc, context) {
    assertEmpty(doc)
    writeSnapshot(doc, await readPresentation(blankPresentation(), { assets: context.assets }))
  },

  async importFile(doc, bytes, context) {
    assertEmpty(doc)
    writeSnapshot(doc, await readPresentation(bytes, { assets: context.assets }))
  },

  async exportFile(doc, context) {
    const root = presentationRoot(doc)
    if (!root.has('slides')) throw new LiveFormatError('corrupt', 'This document holds no presentation')
    return writePresentation(readSnapshot(doc), { format: presentationFormat(context.name), assets: context.assets })
  },

  async applyFile(doc, bytes, context, origin) {
    const incoming = await readPresentation(bytes, { assets: context.assets })
    const target = presentationRoot(doc).has('slides') ? alignKeys(readSnapshot(doc), incoming) : incoming
    // Reported from the updates the change makes: state vectors miss deletions.
    return { changed: transactChanges(doc, () => reconcileSnapshot(doc, target, origin), origin) }
  },

  referencedAssets(doc) {
    const hashes = new Set<string>()
    for (const part of Object.values(readParts(presentationRoot(doc)))) if (part.asset) hashes.add(part.asset.hash)
    return [...hashes]
  },

  toText(doc) {
    return presentationText(readSnapshot(doc))
  },
}

export type { LiveFormatContext }

// ---------------------------------------------------------------------------------------------
// Matching a pushed file to the document

/**
 * Gives the incoming snapshot the keys its slides, shapes, rows, and sections already have in the
 * document, matching on what an export of the document would have written (slide ids, shape ids,
 * section GUIDs). Matched content is then updated in place instead of replaced, which is what
 * lets concurrent edits to it survive.
 */
export function alignKeys(currentSnapshot: PresentationSnapshot, incoming: PresentationSnapshot): PresentationSnapshot {
  const current = assignIdentifiers(currentSnapshot)
  const slideKeyById = new Map(current.slides.map((slide) => [slide.sldId, slide]))
  const usedKeys = new Set<string>()
  const currentSlideKeys = new Set(current.slides.map((slide) => slide.key))
  const sectionKeyById = new Map(current.sections.map((section) => [section.id, section.key]))
  // A section the document lacks gets a key no current section has: incoming keys are positional.
  const takenSectionKeys = new Set(current.sections.map((section) => section.key))
  const sectionKeys = new Map<string, string>()
  for (const section of incoming.sections) {
    let key = sectionKeyById.get(section.id)
    if (key === undefined || [...sectionKeys.values()].includes(key)) {
      key = section.key
      while (takenSectionKeys.has(key) || [...sectionKeys.values()].includes(key)) key = `${key}-new`
    }
    sectionKeys.set(section.key, key)
  }
  return {
    ...incoming,
    sections: incoming.sections.map((section) => ({ ...section, key: sectionKeys.get(section.key)! })),
    slides: incoming.slides.map((slide) => {
      const candidate = slideKeyById.get(slide.sldId)
      // python-pptx gives a slide added after deleting the last one that slide's id; only a slide
      // that still looks like the old one (a shape in common) is the same slide.
      const match = candidate && sameSlide(candidate, slide) ? candidate : undefined
      let key = match?.key ?? slide.key
      // A slide that matched nothing must not land on a current slide by having its key.
      while (usedKeys.has(key) || (!match && currentSlideKeys.has(key))) key = `${key}-1`
      usedKeys.add(key)
      return {
        ...slide,
        key,
        ...(slide.section ? { section: sectionKeys.get(slide.section) ?? slide.section } : {}),
        shapes: match ? alignShapes(match.shapes, slide.shapes) : slide.shapes,
      }
    }),
  }
}

/**
 * Whether a pushed shape with a current shape's id is still that shape. Tools such as python-pptx
 * give a new shape the id of a deleted one, so besides the id and kind, something of the old shape
 * must remain: its name, its text, or its place on the slide. Renaming, rewriting, or moving a
 * shape keeps it; replacing it with a different one does not.
 */
function sameShape(current: ShapeSnapshot, incoming: ShapeSnapshot): boolean {
  if (current.kind !== incoming.kind) return false
  if ((current.name ?? '') === (incoming.name ?? '')) return true
  const text = (shape: ShapeSnapshot) => (shape.text ? textToPlain(shape.text).trim() : '')
  if (text(current) && text(current) === text(incoming)) return true
  return stableStringify(current.xfrm ?? null) === stableStringify(incoming.xfrm ?? null)
}

/**
 * Whether a pushed slide with a current slide's id is that slide. Tools such as python-pptx give a
 * slide added after deleting the last one that slide's id, so the id alone is not enough: some shape
 * must continue (see `sameShape`), and if the layout changed, a shape must also keep its name or
 * its text. Renaming shapes or changing the layout keeps the slide; a new slide on another layout
 * with other shapes and text does not.
 */
function sameSlide(current: SlideSnapshot, incoming: SlideSnapshot): boolean {
  if (!current.shapes.length || !incoming.shapes.length) return current.layout === incoming.layout
  const byId = new Map(current.shapes.map((shape) => [shape.nvId, shape]))
  const continuing = incoming.shapes.filter((shape) => {
    const previous = byId.get(shape.nvId)
    return previous !== undefined && sameShape(previous, shape)
  })
  if (!continuing.length) return false
  if (current.layout === incoming.layout) return true
  const text = (shape: ShapeSnapshot) => (shape.text ? textToPlain(shape.text).trim() : '')
  return continuing.some((shape) => {
    const previous = byId.get(shape.nvId)!
    return (previous.name ?? '') === (shape.name ?? '') || (text(previous) !== '' && text(previous) === text(shape))
  })
}

function alignShapes(current: ShapeSnapshot[], incoming: ShapeSnapshot[]): ShapeSnapshot[] {
  const byId = new Map<number, ShapeSnapshot>()
  const collect = (shape: ShapeSnapshot) => {
    if (shape.nvId !== undefined && !byId.has(shape.nvId)) byId.set(shape.nvId, shape)
    shape.children?.forEach(collect)
  }
  current.forEach(collect)
  const currentKeys = new Set<string>()
  const keys = (shape: ShapeSnapshot) => {
    currentKeys.add(shape.key)
    shape.children?.forEach(keys)
  }
  current.forEach(keys)
  const used = new Set<string>()
  const align = (shape: ShapeSnapshot): ShapeSnapshot => {
    const candidate = shape.nvId !== undefined ? byId.get(shape.nvId) : undefined
    const match = candidate && sameShape(candidate, shape) ? candidate : undefined
    let key = match ? match.key : shape.key
    while (used.has(key) || (!match && currentKeys.has(key))) key = `${key}-1`
    used.add(key)
    return {
      ...shape,
      key,
      ...(shape.table && match?.table ? { table: alignTable(match.table, shape.table) } : {}),
      ...(shape.children ? { children: shape.children.map(align) } : {}),
    }
  }
  return incoming.map(align)
}


/**
 * The best monotonic pairing of `current` and `incoming` entries: the pairs `score` accepts
 * (a number, or undefined for "never"), with the highest total score. Index pairs, in order.
 */
function bestAlignment<T>(current: T[], incoming: T[], score: (a: T, b: T) => number | undefined): [number, number][] {
  if (!current.length || !incoming.length || current.length * incoming.length > 1_000_000) return []
  const best: number[][] = Array.from({ length: current.length + 1 }, () => new Array<number>(incoming.length + 1).fill(0))
  for (let i = current.length - 1; i >= 0; i--) {
    for (let j = incoming.length - 1; j >= 0; j--) {
      const value = score(current[i]!, incoming[j]!)
      best[i]![j] = Math.max(best[i + 1]![j]!, best[i]![j + 1]!, value === undefined ? -Infinity : value + best[i + 1]![j + 1]!)
    }
  }
  const pairs: [number, number][] = []
  for (let i = 0, j = 0; i < current.length && j < incoming.length; ) {
    const value = score(current[i]!, incoming[j]!)
    if (value !== undefined && best[i]![j] === value + best[i + 1]![j + 1]!) pairs.push([i++, j++])
    else if (best[i + 1]![j]! >= best[i]![j + 1]!) i++
    else j++
  }
  return pairs
}

/** One table row or column as the matcher sees it: its file id (`a16:rowId`/`colId`), if any, and its cells' texts. */
interface AxisEntry {
  id?: string
  cells: string[]
}

/** Two entries with different file ids are different records, whatever their text says. */
const conflicting = (a: AxisEntry, b: AxisEntry) => a.id !== undefined && b.id !== undefined && a.id !== b.id

/** How much of two entries' cell text is shared (0 to 1), or undefined when too little to call them one record. */
function similarity(a: AxisEntry, b: AxisEntry): number | undefined {
  if (conflicting(a, b)) return undefined
  const left = a.cells.filter(Boolean)
  const right = b.cells.filter(Boolean)
  if (!left.length || !right.length) return !left.length && !right.length ? 0.5 : undefined
  const counts = new Map<string, number>()
  for (const text of left) counts.set(text, (counts.get(text) ?? 0) + 1)
  let shared = 0
  for (const text of right) {
    const count = counts.get(text) ?? 0
    if (count > 0) {
      shared++
      counts.set(text, count - 1)
    }
  }
  const score = shared / Math.max(left.length, right.length)
  return score >= 0.5 ? score : undefined
}

/** Runs `match` on the stretches between consecutive anchors and returns the anchors with its matches added. */
function fillGaps(anchors: [number, number][], currentLength: number, incomingLength: number, match: (currentStart: number, currentEnd: number, incomingStart: number, incomingEnd: number) => [number, number][]): [number, number][] {
  const bounds = [[-1, -1] as [number, number], ...anchors, [currentLength, incomingLength] as [number, number]]
  const result: [number, number][] = []
  for (let at = 0; at < bounds.length - 1; at++) {
    if (at > 0) result.push(bounds[at]!)
    const [currentStart, incomingStart] = bounds[at]!
    const [currentEnd, incomingEnd] = bounds[at + 1]!
    if (currentEnd - currentStart > 1 && incomingEnd - incomingStart > 1) pushAll(result, match(currentStart + 1, currentEnd, incomingStart + 1, incomingEnd))
  }
  return result
}

const identity = (entry: AxisEntry) => (entry.id ? `id:${entry.id}` : `text:${entry.cells.join('\t')}`)

/**
 * Matches table rows or columns:
 * 1. entries whose identity (the file's row or column id, else the exact cell texts) is unique on
 *    both sides, wherever they moved, so reordering never loses an edit;
 * 2. among the rest, in order: the same identity, then the most similar cell texts (so a record
 *    survives a column inserted or deleted in the same push), then position, which is what an
 *    edited record looks like. Entries with different file ids never pair.
 */
function tablePairs(current: AxisEntry[], incoming: AxisEntry[]): Map<number, number> {
  const pairs = new Map<number, number>()
  const counts = (list: AxisEntry[]) => {
    const result = new Map<string, number>()
    for (const entry of list) result.set(identity(entry), (result.get(identity(entry)) ?? 0) + 1)
    return result
  }
  const currentCounts = counts(current)
  const incomingCounts = counts(incoming)
  const currentIndex = new Map(current.map((entry, index) => [identity(entry), index]))
  incoming.forEach((entry, index) => {
    const key = identity(entry)
    if (currentCounts.get(key) === 1 && incomingCounts.get(key) === 1) pairs.set(index, currentIndex.get(key)!)
  })
  const matchedCurrent = new Set(pairs.values())
  const restCurrent = current.map((_, index) => index).filter((index) => !matchedCurrent.has(index))
  const restIncoming = incoming.map((_, index) => index).filter((index) => !pairs.has(index))
  const left = restCurrent.map((index) => current[index]!)
  const right = restIncoming.map((index) => incoming[index]!)
  const exact = bestAlignment(left, right, (a, b) => (identity(a) === identity(b) ? 1 : undefined))
  const similar = fillGaps(exact, left.length, right.length, (cs, ce, is, ie) =>
    bestAlignment(left.slice(cs, ce), right.slice(is, ie), similarity).map(([a, b]) => [a + cs, b + is] as [number, number]),
  )
  const positional = fillGaps(similar, left.length, right.length, (cs, ce, is, ie) =>
    Array.from({ length: Math.min(ce - cs, ie - is) }, (_, offset) => [cs + offset, is + offset] as [number, number]).filter(([a, b]) => !conflicting(left[a]!, right[b]!)),
  )
  for (const [a, b] of positional) pairs.set(restIncoming[b]!, restCurrent[a]!)
  return pairs
}

/** The `val` of an `a16:rowId` or `a16:colId` in a row's or column's XML. */
function axisId(xml: string): string | undefined {
  return /<(?:[\w-]+:)?(?:rowId|colId)\b[^>]*\bval="([^"]+)"/.exec(xml)?.[1]
}

/** New entries must not reuse even a deleted entry's key: its edits may still be in flight. */
function alignTableAxis<T extends { key: string }>(current: T[], incoming: T[], pairs: Map<number, number>): T[] {
  const taken = new Set(current.map((entry) => entry.key))
  return incoming.map((entry, index) => {
    const paired = pairs.get(index)
    if (paired !== undefined) return { ...entry, key: current[paired]!.key }
    let key = `${entry.key}-${index}-new`
    while (taken.has(key)) key += '-new'
    taken.add(key)
    return { ...entry, key }
  })
}

function alignTable(current: TableSnapshot, incoming: TableSnapshot): TableSnapshot {
  const text = (table: TableSnapshot, row: TableSnapshot['rows'][number], column: string) => textToPlain(row.cells[column]?.text ?? { type: 'doc' })
  const columnEntries = (table: TableSnapshot): AxisEntry[] => table.columns.map((column) => ({ id: axisId(column.xml), cells: table.rows.map((row) => text(table, row, column.key)) }))
  const columns = alignTableAxis(current.columns, incoming.columns, tablePairs(columnEntries(current), columnEntries(incoming)))
  const columnKey = new Map(incoming.columns.map((column, index) => [column.key, columns[index]!.key]))
  const rowEntries = (table: TableSnapshot): AxisEntry[] => table.rows.map((row) => ({ id: axisId(row.xml), cells: table.columns.map((column) => text(table, row, column.key)) }))
  const rows = alignTableAxis(current.rows, incoming.rows, tablePairs(rowEntries(current), rowEntries(incoming)))
    .map((row) => ({ ...row, cells: Object.fromEntries(Object.entries(row.cells).map(([column, cell]) => [columnKey.get(column) ?? column, cell])) }))
  return { ...incoming, columns, rows }
}

// ---------------------------------------------------------------------------------------------
// Plain text

/** The deck as text, slide by slide: what agents `cat` and what search indexes. */
export function presentationText(snapshot: PresentationSnapshot): string {
  return snapshot.slides
    .map((slide, index) => {
      const lines = [`--- Slide ${index + 1}${slide.hidden ? ' (hidden)' : ''} ---`]
      for (const shape of slide.shapes) appendShapeText(lines, shape, snapshot)
      const notes = slide.notes ? textToPlain(slide.notes.text).trim() : ''
      if (notes) lines.push('', 'Notes:', notes)
      return lines.join('\n')
    })
    .join('\n\n')
}

function appendShapeText(lines: string[], shape: ShapeSnapshot, snapshot: PresentationSnapshot): void {
  if (shape.text) {
    const text = textToPlain(shape.text).trim()
    if (text) lines.push(text)
  }
  if (shape.table) {
    for (const row of shape.table.rows) {
      lines.push(shape.table.columns.map((column) => textToPlain(row.cells[column.key]?.text ?? { type: 'doc' }).replace(/\s+/g, ' ').trim()).join('\t'))
    }
  }
  if (shape.kind === 'graphicFrame') {
    const chart = Object.values(shape.rels).find((rel) => rel.type.endsWith('/chart'))
    const part = chart && snapshot.parts[chart.target]
    if (part?.bytes) {
      const summary = textSummaryOfChart(part.bytes)
      if (summary) lines.push(summary)
    }
  }
  if (shape.kind === 'pic' && shape.descr) lines.push(`[Image: ${shape.descr}]`)
  for (const member of shape.children ?? []) appendShapeText(lines, member, snapshot)
}
