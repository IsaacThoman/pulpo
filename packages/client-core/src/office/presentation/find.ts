import * as Y from 'yjs'
import { resolvedMembers, slideKeys, slideMap } from './commands.js'
import { orderedKeys } from './ydoc.js'

/**
 * Find and replace across a deck: every slide in order, its shapes in drawing order (group
 * members inside their group, table cells row by row), then its speaker notes. Text is read
 * straight from the Y.XmlFragments, and replacements are Y.Text edits at the match, so typing
 * elsewhere (even in the same paragraph) merges, and replaced text keeps its formatting.
 */

export interface FindOptions {
  matchCase?: boolean
  wholeWord?: boolean
}

export interface FindMatch {
  slide: string
  /** The shape whose text matched (a group member's own key); absent in the notes. */
  shape?: string
  /** The shape to select: the outermost group around the shape, else the shape itself. */
  root?: string
  /** Table cell. */
  row?: string
  column?: string
  notes?: true
  /** The paragraph, and offsets in its text, where a line break or field counts as one character. */
  paragraph: number
  from: number
  to: number
  text: string
}

type Location = Pick<FindMatch, 'slide' | 'shape' | 'root' | 'row' | 'column' | 'notes'> & { fragment: Y.XmlFragment }

/** A paragraph's text, and where each piece of it lives in the Yjs tree. */
interface Paragraph {
  text: string
  pieces: { start: number; length: number; node: Y.XmlText | Y.XmlElement; offset: number; attributes?: Record<string, unknown> }[]
}

const ATOM = '￼'
const WORD = /[\p{L}\p{N}\p{M}_]/u

function* locations(doc: Y.Doc): Generator<Location> {
  for (const slide of slideKeys(doc)) {
    const map = slideMap(doc, slide)
    if (!map) continue
    const shapes = map.get('shapes') as Y.Map<Y.Map<unknown>>
    const members = resolvedMembers(map)
    // As the reader does: a shape concurrent grouping lists twice is shown at its first listing.
    const seen = new Set<string>()
    function* visit(key: string, root: string, depth: number): Generator<Location> {
      const shape = shapes.get(key)
      if (!shape || seen.has(key) || depth > 64) return
      seen.add(key)
      const children = members.get(key)
      if (children) {
        for (const member of children) yield* visit(member, root, depth + 1)
        return
      }
      const text = shape.get('text')
      if (shape.get('kind') === 'sp' && text instanceof Y.XmlFragment) yield { slide, shape: key, root, fragment: text }
      const table = shape.get('table')
      if (!(table instanceof Y.Map)) return
      const rows = table.get('rows') as Y.Map<Y.Map<unknown>>
      const columns = orderedKeys(table.get('columnOrder') as Y.Array<string>, table.get('columns') as Y.Map<unknown>)
      for (const row of orderedKeys(table.get('rowOrder') as Y.Array<string>, rows)) {
        const cells = rows.get(row)!.get('cells') as Y.Map<Y.Map<unknown>> | undefined
        for (const column of columns) {
          const cell = cells?.get(column)
          const fragment = cell?.get('text')
          // Merged-away cells are not shown, so they are not searched.
          if (!cell || cell.get('hMerge') === true || cell.get('vMerge') === true || !(fragment instanceof Y.XmlFragment)) continue
          yield { slide, shape: key, root, row, column, fragment }
        }
      }
    }
    for (const key of orderedKeys(map.get('shapeOrder') as Y.Array<string>, shapes)) yield* visit(key, key, 0)
    const notes = map.get('notes')
    const text = notes instanceof Y.Map ? notes.get('text') : undefined
    if (text instanceof Y.XmlFragment) yield { slide, notes: true, fragment: text }
  }
}

function paragraphs(fragment: Y.XmlFragment): (Y.XmlElement | undefined)[] {
  return fragment.toArray().map((node) => (node instanceof Y.XmlElement && node.nodeName === 'paragraph' ? node : undefined))
}

function readParagraph(paragraph: Y.XmlElement): Paragraph {
  const pieces: Paragraph['pieces'] = []
  let text = ''
  for (const node of paragraph.toArray()) {
    if (node instanceof Y.XmlText) {
      let offset = 0
      for (const op of node.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[]) {
        if (typeof op.insert !== 'string') continue
        pieces.push({ start: text.length, length: op.insert.length, node, offset, ...(op.attributes ? { attributes: op.attributes } : {}) })
        text += op.insert
        offset += op.insert.length
      }
    } else if (node instanceof Y.XmlElement) {
      // Line breaks, fields, and kept XML: one character no query matches.
      pieces.push({ start: text.length, length: 1, node, offset: 0 })
      text += ATOM
    }
  }
  return { text, pieces }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchesIn(text: string, query: string, options: FindOptions): { from: number; to: number }[] {
  const pattern = new RegExp(escapeRegExp(query), options.matchCase ? 'gu' : 'giu')
  const found: { from: number; to: number }[] = []
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const from = match.index
    const to = from + match[0].length
    if (options.wholeWord && (WORD.test(text[from - 1] ?? '') || WORD.test(text[to] ?? ''))) continue
    found.push({ from, to })
  }
  return found
}

/** Every match of `query`, in deck order. */
export function findMatches(doc: Y.Doc, query: string, options: FindOptions = {}): FindMatch[] {
  if (!query || query.includes(ATOM)) return []
  const results: FindMatch[] = []
  for (const location of locations(doc)) {
    const { fragment, ...where } = location
    paragraphs(fragment).forEach((paragraph, index) => {
      if (!paragraph) return
      const { text } = readParagraph(paragraph)
      for (const { from, to } of matchesIn(text, query, options)) results.push({ ...where, paragraph: index, from, to, text: text.slice(from, to) })
    })
  }
  return results
}

function locate(doc: Y.Doc, match: FindMatch): Y.XmlFragment | undefined {
  for (const location of locations(doc)) {
    if (location.slide !== match.slide) continue
    if (match.notes ? location.notes : location.shape === match.shape && location.row === match.row && location.column === match.column) return location.fragment
  }
  return undefined
}

/** Replaces `[from, to)` of a paragraph with text formatted like the text where the match starts. */
function replaceRange(paragraph: Paragraph, from: number, to: number, replacement: string): void {
  const touched = paragraph.pieces.filter((piece) => piece.start < to && piece.start + piece.length > from)
  const first = touched[0]
  if (!first || touched.some((piece) => !(piece.node instanceof Y.XmlText))) return
  const at = first.offset + (from - first.start)
  // Back to front, so earlier offsets in the same node stay valid.
  for (const piece of [...touched].reverse()) {
    const start = Math.max(from, piece.start)
    const end = Math.min(to, piece.start + piece.length)
    ;(piece.node as Y.XmlText).delete(piece.offset + (start - piece.start), end - start)
  }
  if (replacement) (first.node as Y.XmlText).insert(at, replacement, { ...(first.attributes ?? {}) })
}

/**
 * Replaces one match, if its text is still there (someone may have edited it since the search).
 * Returns whether it was replaced.
 */
export function replaceMatch(doc: Y.Doc, match: FindMatch, replacement: string, origin?: unknown): boolean {
  const fragment = locate(doc, match)
  const node = fragment ? paragraphs(fragment)[match.paragraph] : undefined
  if (!node) return false
  const paragraph = readParagraph(node)
  if (paragraph.text.slice(match.from, match.to) !== match.text) return false
  doc.transact(() => replaceRange(paragraph, match.from, match.to, replacement), origin)
  return true
}

/** Replaces every match in one transaction (one undo step); returns how many. */
export function replaceAll(doc: Y.Doc, query: string, replacement: string, options: FindOptions = {}, origin?: unknown): number {
  if (!query || query.includes(ATOM)) return 0
  let count = 0
  doc.transact(() => {
    for (const { fragment } of [...locations(doc)]) {
      for (const node of paragraphs(fragment)) {
        if (!node) continue
        const paragraph = readParagraph(node)
        const found = matchesIn(paragraph.text, query, options)
        // Last match first: replacing it leaves the earlier offsets as they were.
        for (const { from, to } of [...found].reverse()) replaceRange(paragraph, from, to, replacement)
        count += found.length
      }
    }
  }, origin)
  return count
}
