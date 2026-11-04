import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model'
import type * as Y from 'yjs'
import type { LiveAssetStore } from '../live-format.js'
import { jmlAttr, unpackJml, type JmlElement } from './jsonml.js'
import { importDocx } from './import.js'
import { parseJson, readDocxModel, type CommentMeta, type DocxModel } from './model.js'
import { ListCounter, Numbering, effectiveNumPr } from './numbering.js'
import { PARAGRAPH_PROPERTY_ATTRS, RUN_PROPERTY_MARKS, inlineMarks } from './schema.js'
import { StyleSheet, styleDisplayName } from './styles.js'
import { inlineText } from './text.js'

/**
 * A readable redline between two versions of a Word document, for reviewing an agent's
 * proposal: which paragraphs (and table rows) were added, removed, or changed, word by word,
 * what formatting changed where the text did not, and what changed in headers, footers, notes,
 * comments, and styles. Structured, so hosts render and translate it themselves.
 */

export type DiffOp = 'equal' | 'insert' | 'delete'

export interface DiffSegment {
  op: DiffOp
  text: string
}

/** A formatting property that changed on some text or a paragraph, by its WordprocessingML name. */
export interface FormatChange {
  /** `b`, `i`, `u`, `strike`, `color`, `sz`, `rFonts`, `highlight`, `rStyle`, … or a paragraph property (`jc`, `ind`, `spacing`, `numPr`, `pStyle`). */
  property: string
  /** The text it changed on (empty for paragraph properties). */
  text: string
  before?: string
  after?: string
}

export interface DiffBlockSummary {
  type: 'paragraph' | 'row' | 'other'
  text: string
  /** Paragraph style display name. */
  style?: string
  /** List label (`1.`, `•`). */
  label?: string
  /** Heading level 0–8 when the paragraph is a heading. */
  outline?: number
}

export type DiffBlock =
  | { kind: 'equal'; block: DiffBlockSummary }
  | { kind: 'insert'; block: DiffBlockSummary }
  | { kind: 'delete'; block: DiffBlockSummary }
  | { kind: 'modify'; before: DiffBlockSummary; after: DiffBlockSummary; segments: DiffSegment[]; formats: FormatChange[] }

export interface StoryDiff {
  /** `header`, `footer`, `footnote`, `endnote`, or `comment`. */
  kind: string
  id: string
  change: 'insert' | 'delete' | 'modify'
  segments: DiffSegment[]
  /** Comment author, for comments. */
  author?: string
}

export interface DocxDiff {
  blocks: DiffBlock[]
  stories: StoryDiff[]
  /** Style ids whose definitions differ (added, removed, or changed). */
  styles: { id: string; name: string; change: 'insert' | 'delete' | 'modify' }[]
  stats: { insertedWords: number; deletedWords: number; changedBlocks: number; insertedBlocks: number; deletedBlocks: number; formatChanges: number }
  /** True when nothing a reader would notice changed. */
  identical: boolean
}

interface Block {
  summary: DiffBlockSummary
  /** Text plus formatting signature, for exact comparison. */
  key: string
  node?: ProseMirrorNode
  /** Paragraph properties signature. */
  properties: string
}

function jml(value: unknown): JmlElement | undefined {
  return typeof value === 'string' ? unpackJml<JmlElement>(value) : undefined
}

const RUN_FORMAT_MARKS = new Set([...Object.keys(RUN_PROPERTY_MARKS), 'rPrRest', 'link'])

function runSignature(marks: readonly Mark[]): string {
  return marks.filter((mark) => RUN_FORMAT_MARKS.has(mark.type.name)).map((mark) => `${mark.type.name}=${mark.type.name === 'link' ? mark.attrs.href : mark.attrs.v}`).join('|')
}

function paragraphSignature(node: ProseMirrorNode): string {
  const parts = [`pStyle=${node.attrs.pStyle ?? ''}`]
  for (const key of Object.keys(PARAGRAPH_PROPERTY_ATTRS)) if (node.attrs[key]) parts.push(`${key}=${node.attrs[key]}`)
  return parts.join('|')
}

/** Characters of a paragraph's visible text with their run signatures. */
function styledChars(node: ProseMirrorNode): { text: string; signatures: string[] } {
  let text = ''
  const signatures: string[] = []
  node.forEach((child) => {
    const marks = inlineMarks(child)
    if (marks.some((mark) => mark.type.name === 'del')) return
    const piece = child.isText ? child.text! : child.type.name === 'tab' ? '\t' : child.type.name === 'break' ? '\n' : ''
    const signature = runSignature(marks)
    for (const char of piece) {
      text += char
      signatures.push(signature)
    }
  })
  return { text, signatures }
}

function collectBlocks(doc: ProseMirrorNode, model: DocxModel): Block[] {
  const styles = new StyleSheet(model.maps.styles)
  const counter = new ListCounter(new Numbering(model.maps.numbering, styles))
  const blocks: Block[] = []
  const paragraph = (node: ProseMirrorNode) => {
    const list = effectiveNumPr(jml(node.attrs.numPr), node.attrs.pStyle as string | null, styles)
    const label = list ? counter.next(list.numId, list.ilvl)?.text : undefined
    const style = styles.paragraphStyle(node.attrs.pStyle as string | null)
    const direct = jmlAttr(jml(node.attrs.outlineLvl), 'w:val')
    const outline = direct !== undefined ? Number(direct) : styles.outlineLevel(node.attrs.pStyle as string | null)
    const { signatures } = styledChars(node)
    const text = inlineText(node)
    blocks.push({
      summary: { type: 'paragraph', text, ...(style ? { style: styleDisplayName(style) } : {}), ...(label ? { label } : {}), ...(outline !== undefined && outline < 9 ? { outline } : {}) },
      key: `p:${text}\u0001${signatures.join('\u0002')}\u0001${paragraphSignature(node)}`,
      node,
      properties: paragraphSignature(node),
    })
  }
  const visit = (node: ProseMirrorNode) => {
    switch (node.type.name) {
      case 'paragraph':
        paragraph(node)
        break
      case 'table':
        node.forEach((row) => {
          const cells: string[] = []
          row.forEach((cell) => {
            if (cell.attrs.phantom) return
            const parts: string[] = []
            cell.forEach((child) => {
              if (child.type.name === 'paragraph') parts.push(inlineText(child))
              else parts.push(child.textContent)
            })
            cells.push(parts.join(' ').trim())
          })
          const text = cells.join(' | ')
          blocks.push({ summary: { type: 'row', text }, key: `r:${text}`, properties: '' })
        })
        break
      case 'blockWrapper':
        node.forEach(visit)
        break
      default:
        blocks.push({ summary: { type: 'other', text: node.textContent }, key: `o:${node.type.name}:${node.attrs.v ?? ''}`, properties: '' })
    }
  }
  doc.forEach(visit)
  return blocks
}

/**
 * Longest common subsequence alignment as a list of operations. Quadratic in the worst case,
 * with common prefixes and suffixes trimmed first; inputs past `limit` fall back to replacing
 * the whole middle, which keeps huge rewrites fast.
 */
export function alignSequences<T>(a: T[], b: T[], equal: (x: T, y: T) => boolean, limit = 4_000_000): DiffOp[] {
  let start = 0
  while (start < a.length && start < b.length && equal(a[start]!, b[start]!)) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && equal(a[endA - 1]!, b[endB - 1]!)) {
    endA--
    endB--
  }
  const ops: DiffOp[] = Array.from({ length: start }, () => 'equal' as const)
  const n = endA - start
  const m = endB - start
  if (n * m > limit) {
    for (let index = 0; index < n; index++) ops.push('delete')
    for (let index = 0; index < m; index++) ops.push('insert')
  } else if (n || m) {
    const width = m + 1
    const table = new Uint32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] = equal(a[start + i]!, b[start + j]!) ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && equal(a[start + i]!, b[start + j]!)) {
        ops.push('equal')
        i++
        j++
      } else if (i < n && (j === m || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) {
        // Deletions first, as redlines read.
        ops.push('delete')
        i++
      } else {
        ops.push('insert')
        j++
      }
    }
  }
  for (let index = endA; index < a.length; index++) ops.push('equal')
  return ops
}

/** Words, spaces, and punctuation, so a diff marks whole words. */
export function tokenize(text: string): string[] {
  return text.match(/[\p{L}\p{N}_'’-]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? []
}

/** Word-level diff of two strings, adjacent pieces of one kind merged. */
export function diffWords(before: string, after: string): DiffSegment[] {
  const a = tokenize(before)
  const b = tokenize(after)
  const ops = alignSequences(a, b, (x, y) => x === y)
  const segments: DiffSegment[] = []
  let i = 0
  let j = 0
  const push = (op: DiffOp, text: string) => {
    const last = segments[segments.length - 1]
    if (last?.op === op) last.text += text
    else segments.push({ op, text })
  }
  for (const op of ops) {
    if (op === 'equal') {
      push('equal', a[i++]!)
      j++
    } else if (op === 'delete') push('delete', a[i++]!)
    else push('insert', b[j++]!)
  }
  // Whitespace alone between a deletion and an insertion reads better inside both.
  return segments
}

function words(text: string): number {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).length
}

function similarity(a: string, b: string): number {
  const left = new Set(a.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  const right = new Set(b.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  if (!left.size && !right.size) return 1
  let shared = 0
  for (const word of left) if (right.has(word)) shared++
  return shared / Math.max(left.size, right.size)
}

/** Formatting differences of two paragraphs whose text is the same (or of the shared text). */
function formatChanges(before: ProseMirrorNode | undefined, after: ProseMirrorNode | undefined, styles: { before: StyleSheet; after: StyleSheet }): FormatChange[] {
  if (!before || !after) return []
  const changes: FormatChange[] = []
  if ((before.attrs.pStyle ?? null) !== (after.attrs.pStyle ?? null)) {
    const name = (sheet: StyleSheet, id: unknown) => {
      const style = sheet.paragraphStyle(id as string | null)
      return style ? styleDisplayName(style) : String(id ?? '')
    }
    changes.push({ property: 'pStyle', text: '', before: name(styles.before, before.attrs.pStyle), after: name(styles.after, after.attrs.pStyle) })
  }
  for (const key of Object.keys(PARAGRAPH_PROPERTY_ATTRS)) {
    if (before.attrs[key] === after.attrs[key]) continue
    changes.push({ property: key, text: '', before: describe(jml(before.attrs[key])), after: describe(jml(after.attrs[key])) })
  }
  const a = styledChars(before)
  const b = styledChars(after)
  if (a.text !== b.text) {
    // Compare formatting over the words both versions share.
    const ops = alignSequences([...a.text], [...b.text], (x, y) => x === y, 1_000_000)
    let i = 0
    let j = 0
    let run: { from: number; text: string; before: string; after: string } | undefined
    const flush = () => {
      if (run) pushRunChanges(changes, run.text, run.before, run.after)
      run = undefined
    }
    for (const op of ops) {
      if (op === 'equal') {
        const sa = a.signatures[i]!
        const sb = b.signatures[j]!
        if (sa !== sb) {
          if (run && run.before === sa && run.after === sb) run.text += a.text[i]
          else {
            flush()
            run = { from: i, text: a.text[i]!, before: sa, after: sb }
          }
        } else flush()
        i++
        j++
      } else {
        flush()
        if (op === 'delete') i++
        else j++
      }
    }
    flush()
    return changes
  }
  let start = 0
  for (let index = 0; index <= a.text.length; index++) {
    if (index < a.text.length && a.signatures[index] === a.signatures[start] && b.signatures[index] === b.signatures[start]) continue
    if (start < index && a.signatures[start] !== b.signatures[start]) pushRunChanges(changes, a.text.slice(start, index), a.signatures[start]!, b.signatures[start]!)
    start = index
  }
  return changes
}

function describe(element: JmlElement | undefined): string | undefined {
  if (!element) return undefined
  const value = element[1]['w:val']
  if (value !== undefined) return value
  const entries = Object.entries(element[1]).map(([key, entry]) => `${key.replace(/^w:/, '')}=${entry}`)
  return entries.length ? entries.join(', ') : 'on'
}

function parseSignature(signature: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!signature) return map
  for (const part of signature.split('|')) {
    const index = part.indexOf('=')
    map.set(part.slice(0, index), part.slice(index + 1))
  }
  return map
}

function pushRunChanges(changes: FormatChange[], text: string, before: string, after: string): void {
  const a = parseSignature(before)
  const b = parseSignature(after)
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(key) === b.get(key)) continue
    const value = (packed: string | undefined) => (key === 'link' ? packed : packed ? describe(unpackJml<JmlElement>(packed)) : undefined)
    changes.push({ property: key, text: text.trim() || text, before: value(a.get(key)), after: value(b.get(key)) })
  }
}

function storyText(doc: ProseMirrorNode): string {
  const lines: string[] = []
  doc.descendants((node) => {
    if (node.type.name === 'paragraph') {
      lines.push(inlineText(node))
      return false
    }
    return true
  })
  return lines.join('\n').trim()
}

/** The redline from `before` to `after`. */
export function diffDocxModels(before: DocxModel, after: DocxModel): DocxDiff {
  const a = collectBlocks(before.body, before)
  const b = collectBlocks(after.body, after)
  const sheets = { before: new StyleSheet(before.maps.styles), after: new StyleSheet(after.maps.styles) }
  const ops = alignSequences(a, b, (x, y) => x.key === y.key)
  const blocks: DiffBlock[] = []
  const stats = { insertedWords: 0, deletedWords: 0, changedBlocks: 0, insertedBlocks: 0, deletedBlocks: 0, formatChanges: 0 }
  let i = 0
  let j = 0
  let pendingDeletes: Block[] = []
  let pendingInserts: Block[] = []
  const flush = () => {
    // Pair removed and added blocks that are mostly the same text into modifications.
    const used = new Set<number>()
    const output: DiffBlock[] = []
    let insertCursor = 0
    for (const removed of pendingDeletes) {
      let match = -1
      for (let index = insertCursor; index < pendingInserts.length; index++) {
        const candidate = pendingInserts[index]!
        if (candidate.summary.type === removed.summary.type && (similarity(removed.summary.text, candidate.summary.text) >= 0.4 || removed.summary.text === candidate.summary.text)) {
          match = index
          break
        }
      }
      if (match < 0) {
        output.push({ kind: 'delete', block: removed.summary })
        stats.deletedBlocks++
        stats.deletedWords += words(removed.summary.text)
        continue
      }
      for (let index = insertCursor; index < match; index++) {
        output.push({ kind: 'insert', block: pendingInserts[index]!.summary })
        stats.insertedBlocks++
        stats.insertedWords += words(pendingInserts[index]!.summary.text)
        used.add(index)
      }
      const added = pendingInserts[match]!
      used.add(match)
      insertCursor = match + 1
      const segments = diffWords(removed.summary.text, added.summary.text)
      const formats = formatChanges(removed.node, added.node, sheets)
      for (const segment of segments) {
        if (segment.op === 'insert') stats.insertedWords += words(segment.text)
        else if (segment.op === 'delete') stats.deletedWords += words(segment.text)
      }
      stats.formatChanges += formats.length
      stats.changedBlocks++
      output.push({ kind: 'modify', before: removed.summary, after: added.summary, segments, formats })
    }
    pendingInserts.forEach((added, index) => {
      if (used.has(index)) return
      output.push({ kind: 'insert', block: added.summary })
      stats.insertedBlocks++
      stats.insertedWords += words(added.summary.text)
    })
    blocks.push(...output)
    pendingDeletes = []
    pendingInserts = []
  }
  for (const op of ops) {
    if (op === 'equal') {
      flush()
      blocks.push({ kind: 'equal', block: b[j]!.summary })
      i++
      j++
    } else if (op === 'delete') pendingDeletes.push(a[i++]!)
    else pendingInserts.push(b[j++]!)
  }
  flush()

  const stories: StoryDiff[] = []
  const ids = new Set([...before.stories.keys(), ...after.stories.keys()])
  for (const id of [...ids].sort()) {
    const left = before.stories.get(id)
    const right = after.stories.get(id)
    const kind = id.slice(0, id.indexOf(':'))
    const textA = left ? storyText(left.doc) : ''
    const textB = right ? storyText(right.doc) : ''
    const author = kind === 'comment' ? parseJson<CommentMeta>((right ? after : before).maps.comments.get(id.slice(8)))?.author : undefined
    if (left && !right) stories.push({ kind, id, change: 'delete', segments: [{ op: 'delete', text: textA }], ...(author ? { author } : {}) })
    else if (!left && right) stories.push({ kind, id, change: 'insert', segments: [{ op: 'insert', text: textB }], ...(author ? { author } : {}) })
    else if (textA !== textB) stories.push({ kind, id, change: 'modify', segments: diffWords(textA, textB), ...(author ? { author } : {}) })
  }

  const styles: DocxDiff['styles'] = []
  for (const key of new Set([...before.maps.styles.keys(), ...after.maps.styles.keys()])) {
    if (!key.startsWith('style:')) continue
    const left = before.maps.styles.get(key)
    const right = after.maps.styles.get(key)
    if (left === right) continue
    const id = key.slice(6)
    const style = sheets.after.get(id) ?? sheets.before.get(id)
    styles.push({ id, name: style ? styleDisplayName(style) : id, change: !left ? 'insert' : !right ? 'delete' : 'modify' })
  }
  styles.sort((x, y) => x.name.localeCompare(y.name))

  const identical = blocks.every((block) => block.kind === 'equal') && !stories.length
  return { blocks, stories, styles, stats, identical }
}

export function diffDocxDocs(before: Y.Doc, after: Y.Doc): DocxDiff {
  return diffDocxModels(readDocxModel(before), readDocxModel(after))
}

/** The redline between two files (an agent's proposal against the current version, say). */
export async function diffDocxFiles(before: Uint8Array, after: Uint8Array, assets: LiveAssetStore): Promise<DocxDiff> {
  return diffDocxModels(await importDocx(before, assets), await importDocx(after, assets))
}
