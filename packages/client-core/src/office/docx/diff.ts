import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model'
import type * as Y from 'yjs'
import { OoxmlPackage } from '../ooxml/package.js'
import type { LiveAssetStore } from '../live-format.js'
import { elementToJml, jmlAttr, jmlElements, unpackJml, type JmlElement } from './jsonml.js'
import { importDocx } from './import.js'
import { parseJson, readDocxModel, type CommentMeta, type DocxModel } from './model.js'
import { ListCounter, Numbering, effectiveNumPr } from './numbering.js'
import { PARAGRAPH_PROPERTY_ATTRS, RUN_PROPERTY_MARKS, inlineMarks } from './schema.js'
import { StyleSheet, styleDisplayName } from './styles.js'
import { listRevisions, revisionModel } from './revisions.js'
import { inlineText } from './text.js'
import { canonicalMarks, canonicalNode, canonicalValue, reviewAttrs } from './review-canonical.js'

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

export interface FormatLocation {
  kind: 'table' | 'row' | 'cell' | 'paragraph'
  index: number
}

/** A formatting property that changed on some text or a paragraph, by its WordprocessingML name. */
export interface FormatChange {
  /** `b`, `i`, `u`, `strike`, `color`, `sz`, `rFonts`, `highlight`, `rStyle`, … or a paragraph property (`jc`, `ind`, `spacing`, `numPr`, `pStyle`). */
  property: string
  /** Structural location within this block or story. */
  location?: FormatLocation[]
  /** An opaque package part, when no finer location is available. */
  part?: string
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
  formats?: FormatChange[]
  /** Comment author, for comments. */
  author?: string
}

export interface DocxDiff {
  blocks: DiffBlock[]
  /** Document-level layout, definitions, and preserved package changes. */
  formats?: FormatChange[]
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
  ancestors: ProseMirrorNode[]
  context: number
  location: FormatLocation[]
}

function jml(value: unknown): JmlElement | undefined {
  return typeof value === 'string' ? unpackJml<JmlElement>(value) : undefined
}

const RUN_FORMAT_MARKS = new Set([...Object.keys(RUN_PROPERTY_MARKS), 'rPrRest', 'link'])

function runSignature(marks: readonly Mark[]): string {
  return JSON.stringify(marks.filter((mark) => RUN_FORMAT_MARKS.has(mark.type.name)).map((mark) => [mark.type.name, mark.type.name === 'link' ? mark.attrs.href : canonicalValue(mark.attrs.v)]))
}

/** Characters of a paragraph's visible text with their run signatures. */
function styledChars(node: ProseMirrorNode): { text: string; signatures: string[] } {
  let text = ''
  const signatures: string[] = []
  node.descendants((child) => {
    if (!child.isInline) return true
    const marks = inlineMarks(child)
    const piece = child.isText ? child.text! : child.type.name === 'tab' ? '\t' : child.type.name === 'break' ? '\n' : child.type.name === 'drawing' ? inlineText(child.type.schema.nodes.paragraph!.create(null, child)) : ''
    const signature = runSignature(marks)
    for (const char of piece) {
      text += char
      signatures.push(signature)
    }
    return false
  })
  return { text, signatures }
}

function collectBlocks(doc: ProseMirrorNode, model: DocxModel, contextOf: (ancestors: ProseMirrorNode[]) => number): Block[] {
  const styles = new StyleSheet(model.maps.styles)
  const counter = new ListCounter(new Numbering(model.maps.numbering, styles))
  const blocks: Block[] = []
  const listLabel = (node: ProseMirrorNode) => {
    const list = effectiveNumPr(jml(node.attrs.numPr), node.attrs.pStyle as string | null, styles)
    return list ? counter.next(list.numId, list.ilvl)?.text : undefined
  }
  const paragraph = (node: ProseMirrorNode, ancestors: ProseMirrorNode[], location: FormatLocation[]) => {
    const label = listLabel(node)
    const style = styles.paragraphStyle(node.attrs.pStyle as string | null)
    const direct = jmlAttr(jml(node.attrs.outlineLvl), 'w:val')
    const outline = direct !== undefined ? Number(direct) : styles.outlineLevel(node.attrs.pStyle as string | null)
    const text = inlineText(node)
    blocks.push({
      summary: { type: 'paragraph', text, ...(style ? { style: styleDisplayName(style) } : {}), ...(label ? { label } : {}), ...(outline !== undefined && outline < 9 ? { outline } : {}) },
      key: canonicalValue([canonicalNode(node), label]),
      node,
      ancestors, context: contextOf(ancestors), location,
    })
  }
  const visit = (node: ProseMirrorNode, ancestors: ProseMirrorNode[] = [], location: FormatLocation[] = []) => {
    switch (node.type.name) {
      case 'paragraph':
        paragraph(node, ancestors, location)
        break
      case 'table': {
        const parents = [...ancestors, node]
        node.forEach((row, _offset, index) => {
          const cells: string[] = []
          row.forEach((cell) => {
            if (cell.attrs.phantom) return
            const parts: string[] = []
            cell.descendants((child) => {
              if (child.type.name === 'tableCell' && child.attrs.phantom) return false
              if (child.type.name !== 'paragraph') return true
              const label = listLabel(child)
              parts.push([label, inlineText(child)].filter(Boolean).join(' '))
              return false
            })
            cells.push(parts.join(' ').trim())
          })
          if (!cells.length) return
          const text = cells.join(' | ')
          blocks.push({ summary: { type: 'row', text }, key: canonicalValue([canonicalNode(row), text]), node: row, ancestors: parents, context: contextOf(parents), location: [...location, { kind: 'row', index: index + 1 }] })
        })
        break
      }
      case 'blockWrapper': {
        const parents = [...ancestors, node]
        node.forEach((child, _offset, index) => visit(child, parents, childLocation(child, index, location)))
        break
      }
      default:
        blocks.push({ summary: { type: 'other', text: node.textContent }, key: canonicalNode(node), node, ancestors, context: contextOf(ancestors), location })
    }
  }
  const root: ProseMirrorNode[] = []
  doc.forEach((child, _offset, index) => visit(child, root, child.type.name === 'table' ? [{ kind: 'table', index: index + 1 }] : []))
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
    if (canonicalValue(before.attrs[key]) === canonicalValue(after.attrs[key])) continue
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
  const attrs = Object.entries(element[1] ?? {}).map(([key, entry]) => `${key.replace(/^w:/, '')}=${entry}`)
  const children = jmlElements(element).map((child) => `${child[0].replace(/^w:/, '')}: ${describe(child)}`)
  const value = element[1]?.['w:val']
  const summary = value !== undefined && attrs.length === 1 && !children.length ? value : [...attrs, ...children].join(', ') || 'on'
  return summary.length > 300 ? `${summary.slice(0, 299)}…` : summary
}

function parseSignature(signature: string): Map<string, string> {
  return new Map(JSON.parse(signature) as [string, string][])
}

function pushRunChanges(changes: FormatChange[], text: string, before: string, after: string): void {
  const a = parseSignature(before)
  const b = parseSignature(after)
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(key) === b.get(key)) continue
    const value = (packed: string | undefined) => (key === 'link' ? packed : packed ? (key === 'rPrRest' ? (unpackJml<JmlElement[]>(packed) ?? []).map(describe).join('; ') : describe(unpackJml<JmlElement>(packed))) : undefined)
    changes.push({ property: key, text: text.trim() || text, before: value(a.get(key)), after: value(b.get(key)) })
  }
}

type Sheets = { before: StyleSheet; after: StyleSheet }

function childLocation(node: ProseMirrorNode, index: number, parent: FormatLocation[]): FormatLocation[] {
  const kinds: Record<string, FormatLocation['kind']> = { table: 'table', tableRow: 'row', tableCell: 'cell', paragraph: 'paragraph' }
  const kind = kinds[node.type.name]
  return kind ? [...parent, { kind, index: index + 1 }] : parent
}

function generic(node: ProseMirrorNode | undefined, location: FormatLocation[]): FormatChange {
  const layout = node && ['table', 'tableRow', 'tableCell'].includes(node.type.name)
  return { property: layout ? 'layout' : 'formatting', text: '', ...(location.length ? { location } : {}) }
}

/** Every property child is compared, including ones this version cannot describe specifically. */
function tablePropertyChanges(before: unknown, after: unknown, location: FormatLocation[]): FormatChange[] {
  const a = jml(before)
  const b = jml(after)
  const changes: FormatChange[] = []
  const left = a ? jmlElements(a) : []
  const right = b ? jmlElements(b) : []
  const group = (elements: JmlElement[]) => {
    const grouped = new Map<string, JmlElement[]>()
    for (const element of elements) {
      const siblings = grouped.get(element[0]) ?? []
      siblings.push(element)
      grouped.set(element[0], siblings)
    }
    return grouped
  }
  const oldProperties = group(left)
  const newProperties = group(right)
  const descriptions = new Set(['tblW', 'tcW', 'tblBorders', 'tcBorders', 'shd', 'jc', 'vAlign', 'trHeight', 'tblLayout', 'tblStyle', 'tblCellMar', 'tcMar'])
  for (const name of new Set([...oldProperties.keys(), ...newProperties.keys()])) {
    const old = oldProperties.get(name) ?? []
    const next = newProperties.get(name) ?? []
    if (canonicalValue(old) === canonicalValue(next)) continue
    const property = name.replace(/^w:/, '')
    changes.push({ property: descriptions.has(property) ? property : 'layout', text: '', location,
      ...(descriptions.has(property) ? { before: old.map(describe).join('; ') || undefined, after: next.map(describe).join('; ') || undefined } : {}) })
  }
  // Container attributes, opaque text, and the order of existing children remain unexplained.
  const common = new Set([...oldProperties.keys()].filter((name) => newProperties.has(name)))
  const rest = (element: JmlElement | undefined) => [
    element?.[0] ?? a?.[0] ?? b?.[0], element?.[1] ?? {},
    (element?.slice(2) ?? []).filter((child) => !Array.isArray(child) || common.has(child[0])).map((child) => Array.isArray(child) ? child[0] : child),
  ]
  if (canonicalValue(rest(a)) !== canonicalValue(rest(b))) changes.push({ property: 'layout', text: '', location })
  return changes
}

function ownChanges(before: ProseMirrorNode | undefined, after: ProseMirrorNode | undefined, sheets: Sheets, location: FormatLocation[]): FormatChange[] {
  if (!before || !after || before.type !== after.type) return [generic(after ?? before, location)]
  const changes: FormatChange[] = []
  const handled = new Set(['marks'])
  if (before.type.name === 'paragraph') {
    changes.push(...formatChanges(before, after, sheets).map((change) => ({ ...change, ...(location.length ? { location } : {}) })))
    for (const key of ['pStyle', ...Object.keys(PARAGRAPH_PROPERTY_ATTRS)]) handled.add(key)
  }
  if (before.type.name === 'drawing') {
    if (canonicalValue(before.attrs.src) !== canonicalValue(after.attrs.src) || canonicalValue(before.attrs.v) !== canonicalValue(after.attrs.v)) changes.push({ property: 'picture', text: '[Image]', ...(location.length ? { location } : {}) })
    handled.add('src')
    handled.add('v')
  }
  for (const key of ['tblPr', 'trPr', 'tblPrEx', 'tcPr']) {
    if (!(key in before.attrs)) continue
    if (canonicalValue(before.attrs[key]) !== canonicalValue(after.attrs[key])) changes.push(...tablePropertyChanges(before.attrs[key], after.attrs[key], location))
    handled.add(key)
  }
  if ('tblGrid' in before.attrs) {
    if (canonicalValue(before.attrs.tblGrid) !== canonicalValue(after.attrs.tblGrid)) changes.push({ property: 'tblGrid', text: '', location, before: describe(jml(before.attrs.tblGrid)), after: describe(jml(after.attrs.tblGrid)) })
    handled.add('tblGrid')
  }
  const residual = (node: ProseMirrorNode) => reviewAttrs(Object.fromEntries(Object.entries(node.attrs).filter(([key]) => !handled.has(key))))
  if (canonicalValue(residual(before)) !== canonicalValue(residual(after))) changes.push({ ...generic(after, location), ...(canonicalValue(before.attrs.sectPr) !== canonicalValue(after.attrs.sectPr) ? { property: 'layout' } : {}) })
  if (before.isInline) {
    const unknown = (node: ProseMirrorNode) => unexplainedMarks(inlineMarks(node))
    if (canonicalValue(unknown(before)) !== canonicalValue(unknown(after))) changes.push(generic(after, location))
    if (!before.isText) pushRunChanges(changes, '', runSignature(inlineMarks(before)), runSignature(inlineMarks(after)))
  }
  return changes
}

function unexplainedMarks(marks: readonly Mark[]): unknown[] {
  return marks.flatMap((mark) => mark.type.name === 'link' ? [{ type: 'link', attrs: reviewAttrs({ v: mark.attrs.v }) }] : !RUN_FORMAT_MARKS.has(mark.type.name) ? canonicalMarks([mark]) : [])
}

/** Unknown wrapper marks still matter when a known run property changes in the same paragraph. */
function opaqueTextMarks(node: ProseMirrorNode): unknown[] {
  const runs: { text: string; marks: unknown[] }[] = []
  node.forEach((child) => {
    if (!child.isText) return
    const marks = unexplainedMarks(child.marks)
    if (!marks.length) return
    const last = runs[runs.length - 1]
    if (last && canonicalValue(last.marks) === canonicalValue(marks)) last.text += child.text
    else runs.push({ text: child.text!, marks })
  })
  return runs
}

/** Canonical equality decides visibility; descriptions never decide which fields matter. */
function structuralChanges(before: ProseMirrorNode | undefined, after: ProseMirrorNode | undefined, sheets: Sheets, location: FormatLocation[]): FormatChange[] {
  if (!before || !after) return [generic(after ?? before, location)]
  if (canonicalNode(before) === canonicalNode(after)) return []
  const changes = ownChanges(before, after, sheets, location)
  if (before.type.name === 'paragraph' && canonicalValue(opaqueTextMarks(before)) !== canonicalValue(opaqueTextMarks(after))) changes.push(generic(after, location))
  const a = before.content.content.filter((child) => !child.isText)
  const b = after.content.content.filter((child) => !child.isText)
  if (a.length !== b.length || a.some((child, index) => child.type !== b[index]?.type)) changes.push(generic(after, location))
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index]!.type !== b[index]!.type) continue
    changes.push(...structuralChanges(a[index], b[index], sheets, childLocation(b[index]!, index, location)))
  }
  if (!changes.length && inlineText(before) === inlineText(after)) changes.push(generic(after, location))
  return changes
}

function documentChanges(before: DocxModel, after: DocxModel): FormatChange[] {
  const changes: FormatChange[] = []
  for (const name of ['docx', 'settings', 'numbering', 'styles', 'comments', 'rels'] as const) {
    for (const key of new Set([...before.maps[name].keys(), ...after.maps[name].keys()])) {
      if (name === 'docx' && (key.startsWith('fingerprint:') || key === 'schemaVersion')) continue
      if (name === 'styles' && key.startsWith('style:')) continue
      if (key === 'w:rsids') continue
      const a = before.maps[name].get(key)
      const b = after.maps[name].get(key)
      const value = key.endsWith('Attrs') ? (value: unknown) => canonicalValue(reviewAttrs({ xmlAttrs: value })) : canonicalValue
      if (value(a) === value(b)) continue
      changes.push({ property: name === 'docx' || name === 'settings' || name === 'rels' ? 'layout' : 'formatting', text: '' })
    }
  }
  // Raw references to regenerated XML are storage bookkeeping; their modeled trees are above.
  for (const path of new Set([...before.maps.parts.keys(), ...after.maps.parts.keys()])) {
    if (before.maps.docx.has(`fingerprint:${path}`) || after.maps.docx.has(`fingerprint:${path}`)) continue
    if (parseJson<{ hash: string }>(before.maps.parts.get(path))?.hash !== parseJson<{ hash: string }>(after.maps.parts.get(path))?.hash) changes.push({ property: 'layout', text: '', part: path })
  }
  return changes
}

function storyText(doc: ProseMirrorNode, model: DocxModel): string {
  const styles = new StyleSheet(model.maps.styles)
  const counter = new ListCounter(new Numbering(model.maps.numbering, styles))
  const lines: string[] = []
  doc.descendants((node) => {
    if (node.type.name === 'tableCell' && node.attrs.phantom) return false
    if (node.type.name === 'paragraph') {
      const list = effectiveNumPr(jml(node.attrs.numPr), node.attrs.pStyle as string | null, styles)
      const label = list ? counter.next(list.numId, list.ilvl)?.text : undefined
      lines.push([label, inlineText(node)].filter(Boolean).join(' '))
      return false
    }
    return true
  })
  return lines.join('\n').trim()
}

/** The redline from `before` to `after`. */
function diffBody(before: DocxModel, after: DocxModel): Pick<DocxDiff, 'blocks' | 'stats' | 'formats'> {
  // Many paragraphs can share one content control or table. Intern its canonical metadata
  // once, rather than copying (and parsing) a potentially large XML payload into every key.
  const contexts = new Map<string, number>()
  const cached = new WeakMap<ProseMirrorNode[], number>()
  const attrs = new WeakMap<ProseMirrorNode, string>()
  const contextOf = (ancestors: ProseMirrorNode[]): number => {
    const known = cached.get(ancestors)
    if (known !== undefined) return known
    const key = JSON.stringify(ancestors.map((node) => {
      let key = attrs.get(node)
      if (key === undefined) {
        key = canonicalValue([node.type.name, reviewAttrs(node.attrs)])
        attrs.set(node, key)
      }
      return key
    }))
    let id = contexts.get(key)
    if (id === undefined) { id = contexts.size; contexts.set(key, id) }
    cached.set(ancestors, id)
    return id
  }
  const a = collectBlocks(before.body, before, contextOf)
  const b = collectBlocks(after.body, after, contextOf)
  const sheets = { before: new StyleSheet(before.maps.styles), after: new StyleSheet(after.maps.styles) }
  const ops = alignSequences(a, b, (x, y) => x.context === y.context && x.key === y.key)
  const blocks: DiffBlock[] = []
  const stats = { insertedWords: 0, deletedWords: 0, changedBlocks: 0, insertedBlocks: 0, deletedBlocks: 0, formatChanges: 0 }
  let i = 0
  let j = 0
  const ancestorChanges = new Map<ProseMirrorNode | undefined, Map<ProseMirrorNode | undefined, FormatChange[]>>()
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
      const formats = structuralChanges(removed.node, added.node, sheets, added.location)
      if (removed.context !== added.context) {
        for (let index = 0; index < Math.max(removed.ancestors.length, added.ancestors.length); index++) {
          const left = removed.ancestors[index]
          const right = added.ancestors[index]
          const byRight = ancestorChanges.get(left) ?? new Map<ProseMirrorNode | undefined, FormatChange[]>()
          let changes = byRight.get(right)
          if (!changes) {
            changes = ownChanges(left, right, sheets, [])
            byRight.set(right, changes)
            ancestorChanges.set(left, byRight)
          }
          const location = added.location.slice(0, index + 1)
          formats.push(...changes.map((change) => location.length ? { ...change, location } : change))
        }
      }
      if (removed.summary.label !== added.summary.label) {
        formats.push({ property: 'numPr', text: '', before: removed.summary.label, after: added.summary.label })
      }
      if (!formats.length && !segments.some((segment) => segment.op !== 'equal')) formats.push({ property: 'formatting', text: '', ...(added.location.length ? { location: added.location } : {}) })
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

  return { blocks, stats }
}

/** The redline from `before` to `after`, with canonical equality independent of descriptions. */
export function diffDocxModels(before: DocxModel, after: DocxModel): DocxDiff {
  const originalBefore = before
  const originalAfter = after
  before = revisionModel(before)
  after = revisionModel(after)
  const { blocks, stats } = diffBody(before, after)
  const revisionChanges = (a: ProseMirrorNode, b: ProseMirrorNode, resolvedA: ProseMirrorNode, resolvedB: ProseMirrorNode): FormatChange[] => {
    if (a === resolvedA && b === resolvedB) return []
    if (canonicalNode(a) === canonicalNode(b)) return []
    const changes: FormatChange[] = []
    for (let index = 0; index < Math.max(a.childCount, b.childCount); index++) {
      const left = index < a.childCount ? a.child(index) : undefined
      const right = index < b.childCount ? b.child(index) : undefined
      if (left && right && canonicalNode(left) === canonicalNode(right)) continue
      const revised = [left, right].some((node) => node && listRevisions(node.type.schema.node('doc', null, [node])).length)
      if (revised) changes.push({ property: 'layout', text: '', location: childLocation((right ?? left)!, index, []) })
    }
    return changes.length ? changes : [{ property: 'layout', text: '' }]
  }
  const sheets = { before: new StyleSheet(before.maps.styles), after: new StyleSheet(after.maps.styles) }
  const stories: StoryDiff[] = []
  const ids = new Set([...before.stories.keys(), ...after.stories.keys()])
  for (const id of [...ids].sort()) {
    const left = before.stories.get(id)
    const right = after.stories.get(id)
    const kind = id.slice(0, id.indexOf(':'))
    const textA = left ? storyText(left.doc, before) : ''
    const textB = right ? storyText(right.doc, after) : ''
    const author = kind === 'comment' ? parseJson<CommentMeta>((right ? after : before).maps.comments.get(id.slice(8)))?.author : undefined
    if (left && !right) stories.push({ kind, id, change: 'delete', segments: [{ op: 'delete', text: textA }], ...(author ? { author } : {}) })
    else if (!left && right) stories.push({ kind, id, change: 'insert', segments: [{ op: 'insert', text: textB }], ...(author ? { author } : {}) })
    else if (left && right) {
      const compared = diffBody({ ...before, body: left.doc }, { ...after, body: right.doc })
      const formats = [...revisionChanges(originalBefore.stories.get(id)!.doc, originalAfter.stories.get(id)!.doc, left.doc, right.doc), ...compared.blocks.flatMap((block, index) => block.kind === 'modify' ? block.formats.map((format) => format.location?.length || block.after.type !== 'paragraph' ? format : { ...format, location: [{ kind: 'paragraph' as const, index: index + 1 }] }) : [])]
      const metaChanged = canonicalValue(left.meta) !== canonicalValue(right.meta) || (kind === 'comment' && canonicalValue(before.maps.comments.get(id.slice(8))) !== canonicalValue(after.maps.comments.get(id.slice(8))))
      if (metaChanged) formats.push({ property: 'formatting', text: '' })
      if (textA !== textB || compared.blocks.some((block) => block.kind !== 'equal') || metaChanged || formats.length) {
        if (textA === textB && !formats.length) formats.push({ property: 'formatting', text: '' })
        stories.push({ kind, id, change: 'modify', segments: diffWords(textA, textB), ...(formats.length ? { formats } : {}), ...(author ? { author } : {}) })
        stats.formatChanges += formats.length
      }
    }
  }

  const styles: DocxDiff['styles'] = []
  for (const key of new Set([...before.maps.styles.keys(), ...after.maps.styles.keys()])) {
    if (!key.startsWith('style:')) continue
    const left = before.maps.styles.get(key)
    const right = after.maps.styles.get(key)
    if (canonicalValue(left) === canonicalValue(right)) continue
    const id = key.slice(6)
    const style = sheets.after.get(id) ?? sheets.before.get(id)
    styles.push({ id, name: style ? styleDisplayName(style) : id, change: !left ? 'insert' : !right ? 'delete' : 'modify' })
  }
  styles.sort((x, y) => x.name.localeCompare(y.name))

  const formats = [...documentChanges(before, after), ...revisionChanges(originalBefore.body, originalAfter.body, before.body, after.body)]
  stats.formatChanges += formats.length
  const identical = blocks.every((block) => block.kind === 'equal') && !stories.length && !styles.length && !formats.length
  return { blocks, stories, styles, stats, identical, ...(formats.length ? { formats } : {}) }
}

export function diffDocxDocs(before: Y.Doc, after: Y.Doc): DocxDiff {
  return diffDocxModels(readDocxModel(before), readDocxModel(after))
}

/** The redline between two files (an agent's proposal against the current version, say). */
export async function diffDocxFiles(before: Uint8Array, after: Uint8Array, assets: LiveAssetStore): Promise<DocxDiff> {
  const left = await importDocx(before, assets)
  const right = await importDocx(after, assets)
  // File reviews can inspect the bytes behind opaque part references. Canonical XML avoids
  // false changes from zip metadata, attribute order, and editing-session identifiers.
  const result = diffDocxModels({ ...left, maps: { ...left.maps, parts: new Map() } }, { ...right, maps: { ...right.maps, parts: new Map() } })
  const a = OoxmlPackage.read(before)
  const b = OoxmlPackage.read(after)
  const signature = (pkg: OoxmlPackage, path: string, model: DocxModel) => {
    if (!pkg.has(path)) return undefined
    if (path.endsWith('.xml') || path.endsWith('.rels')) {
      const root = pkg.xml(path)?.documentElement
      if (!root) return canonicalValue(pkg.text(path))
      const xml = elementToJml(root)
      const benign = path === 'docProps/core.xml' ? new Set(['dcterms:created', 'dcterms:modified', 'cp:lastModifiedBy', 'cp:revision']) : path === 'docProps/app.xml' ? new Set(['TotalTime', 'Application', 'AppVersion', 'Pages', 'Words', 'Characters', 'CharactersWithSpaces', 'Lines', 'Paragraphs']) : new Set<string>()
      const children = xml.slice(2).filter((child) => !Array.isArray(child) || !benign.has(child[0]))
      // Relationships and content-type declarations are keyed sets, not ordered content.
      if (path.endsWith('.rels') || path === '[Content_Types].xml') children.sort((a, b) => canonicalValue(a).localeCompare(canonicalValue(b)))
      return canonicalValue([xml[0], xml[1], ...children])
    }
    return parseJson<{ hash: string }>(model.maps.parts.get(path))?.hash
  }
  for (const path of new Set([...a.paths(), ...b.paths()])) {
    if (signature(a, path, left) === signature(b, path, right)) continue
    ;(result.formats ??= []).push({ property: 'layout', text: '', part: path })
    result.stats.formatChanges++
    result.identical = false
  }
  return result
}
