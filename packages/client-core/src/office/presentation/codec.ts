import type * as Y from 'yjs'
import { LiveFormatError, type LiveFormatCodec, type LiveFormatContext } from '../live-format.js'
import { blankPresentation } from './blank.js'
import type { PresentationSnapshot, ShapeSnapshot, SlideSnapshot, TableSnapshot } from './model.js'
import { transactChanges } from '../assets.js'
import { PRESENTATION_EXTENSIONS, presentationFormat, presentationMimeType } from './layout.js'
import { PRESENTATION_SCHEMA_VERSION } from './model.js'
import { readPresentation } from './read.js'
import { textToPlain } from './text.js'
import { longestCommonSubsequence, presentationRoot, readParts, readSnapshot, reconcileSnapshot, writeSnapshot } from './ydoc.js'
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
      // that still looks like the old one (same layout, a shape in common) is the same slide.
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

function sameSlide(current: SlideSnapshot, incoming: SlideSnapshot): boolean {
  if (current.layout !== incoming.layout) return false
  if (!current.shapes.length || !incoming.shapes.length) return true
  const signature = (shape: ShapeSnapshot) => `${shape.nvId}\u0000${shape.kind}\u0000${shape.name ?? ''}`
  const shapes = new Set(current.shapes.map(signature))
  return incoming.shapes.some((shape) => shapes.has(signature(shape)))
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
 * Matches columns by position when the counts agree. Rows match by their text first (longest
 * common subsequence), so a row deleted in one place and added in another does not shift
 * everyone's typing into the wrong row; rows left between two matches pair up by position, which
 * is what an edited row looks like.
 */
function alignTable(current: TableSnapshot, incoming: TableSnapshot): TableSnapshot {
  const columns =
    current.columns.length === incoming.columns.length
      ? incoming.columns.map((column, index) => ({ ...column, key: current.columns[index]!.key }))
      : incoming.columns
  const columnKey = new Map(incoming.columns.map((column, index) => [column.key, columns[index]!.key]))
  const signature = (row: TableSnapshot['rows'][number], keys: string[]) => keys.map((key) => textToPlain(row.cells[key]?.text ?? { type: 'doc' })).join('\t')
  const currentSignatures = current.rows.map((row) => signature(row, current.columns.map((column) => column.key)))
  const incomingSignatures = incoming.rows.map((row) => signature(row, incoming.columns.map((column) => column.key)))
  const common = longestCommonSubsequence(currentSignatures, incomingSignatures)
  const pairs = new Map<number, number>()
  const currentMatched = [...common.current].sort((a, b) => a - b)
  const incomingMatched = [...common.target].sort((a, b) => a - b)
  currentMatched.forEach((index, at) => pairs.set(incomingMatched[at]!, index))
  // Between consecutive matches (and before the first, after the last), pair the rest in order.
  const anchors = [[-1, -1], ...incomingMatched.map((index, at) => [currentMatched[at]!, index]), [current.rows.length, incoming.rows.length]] as [number, number][]
  for (let at = 0; at < anchors.length - 1; at++) {
    const [currentStart, incomingStart] = anchors[at]!
    const [currentEnd, incomingEnd] = anchors[at + 1]!
    for (let offset = 1; currentStart + offset < currentEnd && incomingStart + offset < incomingEnd; offset++) pairs.set(incomingStart + offset, currentStart + offset)
  }
  const used = new Set<string>()
  const rows = incoming.rows.map((row, index) => {
    const paired = pairs.get(index)
    let key = paired !== undefined ? current.rows[paired]!.key : undefined
    if (!key || used.has(key)) key = `${row.key}-${index}-new`
    used.add(key)
    const cells = Object.fromEntries(Object.entries(row.cells).map(([column, cell]) => [columnKey.get(column) ?? column, cell]))
    return { ...row, key, cells }
  })
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
