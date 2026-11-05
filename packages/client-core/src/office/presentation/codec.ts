import type * as Y from 'yjs'
import { LiveFormatError, type LiveFormatCodec, type LiveFormatContext } from '../live-format.js'
import { blankPresentation } from './blank.js'
import type { PresentationSnapshot, ShapeSnapshot, SlideSnapshot, TableSnapshot } from './model.js'
import { transactChanges } from '../assets.js'
import { PRESENTATION_EXTENSIONS, presentationFormat, presentationMimeType } from './layout.js'
import { PRESENTATION_SCHEMA_VERSION } from './model.js'
import { readPresentation } from './read.js'
import { textToPlain } from './text.js'
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
    return { changed: transactChanges(doc, () => reconcileSnapshot(doc, target), origin) }
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
 * Whether a pushed slide with a current slide's id is that slide. Tools such as python-pptx give a
 * slide added after deleting the last one that slide's id, so the id alone is not enough: the
 * slides must share a shape (id and kind), and either keep their layout or share a shape name.
 * Renaming shapes, or changing only the layout, keeps the slide; a new slide on another layout
 * with other shapes does not.
 */
function sameSlide(current: SlideSnapshot, incoming: SlideSnapshot): boolean {
  if (!current.shapes.length || !incoming.shapes.length) return current.layout === incoming.layout
  const identity = (shape: ShapeSnapshot) => `${shape.nvId}\u0000${shape.kind}`
  const shapes = new Set(current.shapes.map(identity))
  if (!incoming.shapes.some((shape) => shapes.has(identity(shape)))) return false
  if (current.layout === incoming.layout) return true
  const names = new Set(current.shapes.map((shape) => shape.name ?? '').filter(Boolean))
  return incoming.shapes.some((shape) => shape.name !== undefined && names.has(shape.name))
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
    const match = candidate && candidate.kind === shape.kind ? candidate : undefined
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
 * Whether two rows (or two columns) hold mostly the same cell texts. Comparing cell texts as a
 * multiset, not the whole row, lets a row survive a column inserted or deleted in the same push.
 */
function similarCells(a: string[], b: string[]): boolean {
  const left = a.filter(Boolean)
  const right = b.filter(Boolean)
  if (!left.length || !right.length) return !left.length && !right.length
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
  return shared * 2 >= Math.max(left.length, right.length)
}

/** Longest common subsequence under `similarCells`: index pairs (current, incoming), in order. */
function similarSubsequence(current: string[][], incoming: string[][]): [number, number][] {
  if (current.length * incoming.length > 1_000_000) return []
  const table: number[][] = Array.from({ length: current.length + 1 }, () => new Array<number>(incoming.length + 1).fill(0))
  for (let i = current.length - 1; i >= 0; i--) {
    for (let j = incoming.length - 1; j >= 0; j--) {
      table[i]![j] = similarCells(current[i]!, incoming[j]!) ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const pairs: [number, number][] = []
  for (let i = 0, j = 0; i < current.length && j < incoming.length; ) {
    if (similarCells(current[i]!, incoming[j]!) && table[i]![j] === table[i + 1]![j + 1]! + 1) pairs.push([i++, j++])
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++
    else j++
  }
  return pairs
}

/**
 * Matches table rows or columns by their cells' texts, then pairs the entries left between two
 * matches by position, which is what an edited row looks like.
 */
function tablePairs(current: string[][], incoming: string[][]): Map<number, number> {
  const matched = similarSubsequence(current, incoming)
  const pairs = new Map<number, number>()
  for (const [currentIndex, incomingIndex] of matched) pairs.set(incomingIndex, currentIndex)
  const anchors = [[-1, -1], ...matched, [current.length, incoming.length]] as [number, number][]
  for (let at = 0; at < anchors.length - 1; at++) {
    const [currentStart, incomingStart] = anchors[at]!
    const [currentEnd, incomingEnd] = anchors[at + 1]!
    for (let offset = 1; currentStart + offset < currentEnd && incomingStart + offset < incomingEnd; offset++) pairs.set(incomingStart + offset, currentStart + offset)
  }
  return pairs
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
  const columnCells = (table: TableSnapshot) => table.columns.map((column) => table.rows.map((row) => text(table, row, column.key)))
  const columns = alignTableAxis(current.columns, incoming.columns, tablePairs(columnCells(current), columnCells(incoming)))
  const columnKey = new Map(incoming.columns.map((column, index) => [column.key, columns[index]!.key]))
  const rowCells = (table: TableSnapshot) => table.rows.map((row) => table.columns.map((column) => text(table, row, column.key)))
  const rows = alignTableAxis(current.rows, incoming.rows, tablePairs(rowCells(current), rowCells(incoming)))
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
