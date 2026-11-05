import type { Mark, Node as ProseMirrorNode, Slice } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { removeRow, TableMap } from '@tiptap/pm/tables'
import { AddMarkStep, Mapping, RemoveMarkStep, ReplaceStep, type Step } from '@tiptap/pm/transform'
import { jmlAttr, jmlChild, jmlElements, packJml, unpackJml, type JmlElement } from '../jsonml.js'
import { PARAGRAPH_PROPERTY_ATTRS, RUN_MARK_BY_ELEMENT, RUN_PROPERTY_MARKS, inlineMarks } from '../schema.js'
import { RPR_ORDER, PPR_ORDER, sortByOrder } from '../names.js'
import { changeMarks } from './marks.js'

/**
 * Tracked changes in Word's revision markup: `w:ins`/`w:del` around runs (marks here), the
 * paragraph mark's `w:ins`/`w:del` (in `markRPr`), `w:rPrChange` (a mark holding the old run
 * properties) and `w:pPrChange` (a paragraph attribute holding the old paragraph properties).
 *
 * In Suggesting mode, `trackTransaction` rewrites what the user did into that markup: deleted
 * text stays, marked deleted; typed text is marked inserted; formatting keeps what it replaced.
 */

export interface Reviewer {
  author: string
  /** ISO date without milliseconds, as Word writes it. */
  date: string
}

export function revisionDate(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

let revisionCounter = Math.floor(Math.random() * 100_000)

function revisionId(): string {
  return String(1_000_000 + (revisionCounter++ % 8_000_000))
}

function revisionAttrs(reviewer: Reviewer): Record<string, string> {
  return { 'w:id': revisionId(), 'w:author': reviewer.author, 'w:date': reviewer.date }
}

function jml(value: unknown): JmlElement | undefined {
  return typeof value === 'string' ? unpackJml<JmlElement>(value) : undefined
}

function authorOf(mark: Mark | undefined): string | undefined {
  return jmlAttr(jml(mark?.attrs.v), 'w:author')
}

const RUN_PROPERTY_NAMES = new Set([...Object.keys(RUN_PROPERTY_MARKS), 'rPrRest'])
const PARAGRAPH_KEYS = ['pStyle', ...Object.keys(PARAGRAPH_PROPERTY_ATTRS), 'pPrRest'] as const

/** The run properties marks describe, as `w:rPr` children in schema order. */
export function runPropertiesOf(marks: readonly Mark[]): JmlElement[] {
  const elements: JmlElement[] = []
  for (const mark of marks) {
    if (mark.type.name === 'rPrRest') elements.push(...(unpackJml<JmlElement[]>(mark.attrs.v as string) ?? []))
    else if (mark.type.name in RUN_PROPERTY_MARKS) {
      const element = jml(mark.attrs.v)
      if (element) elements.push(element)
    }
  }
  return sortByOrder(elements, RPR_ORDER)
}

/** Paragraph properties of a paragraph's attributes, as `w:pPr` children. */
export function paragraphPropertiesOf(attrs: Record<string, unknown>): JmlElement[] {
  const elements: JmlElement[] = []
  if (attrs.pStyle) elements.push(['w:pStyle', { 'w:val': String(attrs.pStyle) }])
  for (const key of Object.keys(PARAGRAPH_PROPERTY_ATTRS)) {
    const element = jml(attrs[key])
    if (element) elements.push(element)
  }
  elements.push(...(typeof attrs.pPrRest === 'string' ? unpackJml<JmlElement[]>(attrs.pPrRest) ?? [] : []))
  return sortByOrder(elements, PPR_ORDER)
}

/** The insertion mark to use at `pos`: the author's own one right before it, so typing extends one revision. */
function insertionMark(state: { doc: ProseMirrorNode }, pos: number, reviewer: Reviewer): Mark {
  const before = state.doc.resolve(pos).nodeBefore
  const existing = before ? inlineMarks(before).find((mark) => mark.type.name === 'ins') : undefined
  if (existing && authorOf(existing) === reviewer.author) return existing
  return state.doc.type.schema.marks.ins!.create({ v: packJml(['w:ins', revisionAttrs(reviewer), '\u0000']) })
}

function withMarkRPrChild(attrs: Record<string, unknown>, child: JmlElement | undefined, remove: string[]): Record<string, unknown> {
  const markRPr = jml(attrs.markRPr) ?? ['w:rPr', {}]
  const children = jmlElements(markRPr).filter((element) => !remove.includes(element[0]))
  if (child) children.unshift(child)
  return { ...attrs, markRPr: children.length || Object.keys(markRPr[1]).length ? packJml([markRPr[0], markRPr[1], ...children]) : null }
}

/** Row revisions live in trPr, separate from revisions on their cell text. */
function withRowRevision(attrs: Record<string, unknown>, child: JmlElement | undefined, remove: string[]): Record<string, unknown> {
  const trPr = jml(attrs.trPr) ?? ['w:trPr', {}]
  const children = jmlElements(trPr).filter((element) => !remove.includes(element[0]))
  if (child) children.push(child)
  return { ...attrs, trPr: children.length || Object.keys(trPr[1]).length ? packJml([trPr[0], trPr[1], ...children]) : null }
}

function deleteRow(out: Transaction, pos: number): void {
  const row = out.doc.nodeAt(pos)
  if (row?.type.name !== 'tableRow') return
  const $pos = out.doc.resolve(pos)
  if ($pos.parent.type.name === 'table' && $pos.parent.childCount === 1) {
    const tablePos = $pos.before()
    out.delete(tablePos, tablePos + $pos.parent.nodeSize)
  } else if ($pos.parent.type.name === 'table') {
    const table = $pos.parent
    const map = TableMap.get(table)
    removeRow(out, { table, map, tableStart: $pos.start(), left: 0, right: map.width, top: 0, bottom: map.height }, $pos.index())
  }
}

/** Marks [from, to) of `out` deleted, actually removing the reviewer's own insertions. */
function trackDelete(out: Transaction, from: number, to: number, reviewer: Reviewer): { from: number; to: number } {
  const before = out.steps.length
  const rows: number[] = []
  out.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'tableRow') return true
    if (pos >= from && pos + node.nodeSize <= to) rows.push(pos)
    return true
  })
  for (const pos of rows.reverse()) {
    const row = out.doc.nodeAt(pos)!
    const inserted = jmlChild(jml(row.attrs.trPr), 'w:ins')
    if (inserted && jmlAttr(inserted, 'w:author') === reviewer.author) deleteRow(out, pos)
    else if (!jmlChild(jml(row.attrs.trPr), 'w:del')) out.setNodeMarkup(pos, undefined, withRowRevision(row.attrs, ['w:del', revisionAttrs(reviewer)], []))
  }
  const rowMapping = out.mapping.slice(before)
  from = rowMapping.map(from, 1)
  to = Math.max(from, rowMapping.map(to, -1))
  // Own insertions vanish for real, as in Word.
  const own: { from: number; to: number }[] = []
  out.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return true
    const insertion = inlineMarks(node).find((mark) => mark.type.name === 'ins')
    if (insertion && authorOf(insertion) === reviewer.author && !inlineMarks(node).some((mark) => mark.type.name === 'del')) {
      own.push({ from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize) })
    }
    return false
  })
  for (const range of own.reverse()) out.delete(range.from, range.to)
  const mapping = out.mapping.slice(out.steps.length - own.length)
  const start = mapping.map(from, 1)
  const end = Math.max(start, mapping.map(to, -1))
  const deletion = out.doc.type.schema.marks.del!.create({ v: packJml(['w:del', revisionAttrs(reviewer), '\u0000']) })
  changeMarks(out, start, end, (marks) => marks.some((mark) => mark.type.name === 'del') ? marks : deletion.addToSet(marks))
  // Paragraph boundaries inside the range: the earlier paragraph's mark is deleted, unless the
  // reviewer inserted it, in which case the paragraphs join for real.
  const joins: number[] = []
  out.doc.nodesBetween(start, end, (node, pos) => {
    if (node.type.name !== 'paragraph') return true
    const endOfParagraph = pos + node.nodeSize - 1
    if (endOfParagraph >= start && endOfParagraph < end) {
      const inserted = jmlChild(jml(node.attrs.markRPr), 'w:ins')
      if (inserted && jmlAttr(inserted, 'w:author') === reviewer.author) joins.push(pos + node.nodeSize)
      else if (!jmlChild(jml(node.attrs.markRPr), 'w:del')) out.setNodeMarkup(pos, undefined, withMarkRPrChild(node.attrs, ['w:del', revisionAttrs(reviewer)], []))
    }
    return false
  })
  for (const at of joins.reverse()) {
    try {
      out.join(at)
    } catch {
      // Paragraphs that cannot join (a table between them) keep their boundary.
    }
  }
  return { from: start, to: out.mapping.slice(out.steps.length - joins.length).map(end) }
}

/** Inserts `slice` at `pos` marked as the reviewer's insertion. */
function trackInsert(out: Transaction, pos: number, slice: Slice, reviewer: Reviewer): number | undefined {
  if (!slice.size) return undefined
  const before = out.steps.length
  out.replace(pos, pos, slice)
  const map = out.mapping.slice(before)
  const end = map.map(pos, 1)
  const start = map.map(pos, -1)
  out.doc.nodesBetween(start, end, (node, nodePos) => {
    if (node.type.name === 'tableRow' && nodePos >= start && nodePos + node.nodeSize <= end) {
      out.setNodeMarkup(nodePos, undefined, withRowRevision(node.attrs, ['w:ins', revisionAttrs(reviewer)], ['w:ins', 'w:del']))
    }
    return true
  })
  const mark = insertionMark(out, start, reviewer)
  changeMarks(out, start, end, (marks) => mark.addToSet(marks.filter((existing) => existing.type.name !== 'del')))
  // Paragraph marks the insertion created (Enter, pasted paragraphs) are inserted too.
  out.doc.nodesBetween(start, end, (node, nodePos) => {
    if (node.type.name !== 'paragraph') return true
    const endOfParagraph = nodePos + node.nodeSize - 1
    if (endOfParagraph >= start && endOfParagraph < end && !jmlChild(jml(node.attrs.markRPr), 'w:ins')) {
      out.setNodeMarkup(nodePos, undefined, withMarkRPrChild(node.attrs, ['w:ins', revisionAttrs(reviewer)], ['w:del']))
    }
    return false
  })
  return end
}

/** Records the run properties a formatting change replaces, once per text range. */
function trackFormat(out: Transaction, from: number, to: number, reviewer: Reviewer): void {
  const schema = out.doc.type.schema
  out.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return node.isBlock
    if (node.marks.some((mark) => mark.type.name === 'rPrChange' || mark.type.name === 'ins')) return false
    const change = schema.marks.rPrChange!.create({ v: packJml(['w:rPrChange', revisionAttrs(reviewer), ['w:rPr', {}, ...runPropertiesOf(node.marks)]]) })
    out.addMark(Math.max(from, pos), Math.min(to, pos + node.nodeSize), change)
    return false
  })
}

/** Row deletion commands adjust merges first; pending deletions must retain the old grid. */
function restoreDeletedRows(state: EditorState, tr: Transaction, out: Transaction, reviewer: Reviewer): void {
  const deleted = new Set<number>()
  tr.steps.forEach((step, index) => {
    if (!(step instanceof ReplaceStep) || step.from === step.to) return
    const inverse = new Mapping(tr.mapping.maps.slice(0, index)).invert()
    tr.docs[index]!.nodesBetween(step.from, step.to, (node, pos) => {
      if (node.type.name === 'tableRow' && pos >= step.from && pos + node.nodeSize <= step.to) deleted.add(inverse.map(pos, 1))
      return true
    })
  })
  if (!deleted.size) return
  const tables: { pos: number; table: ProseMirrorNode; rows: number[] }[] = []
  state.doc.descendants((table, pos) => {
    if (table.type.name !== 'table') return true
    const next = tr.doc.nodeAt(tr.mapping.map(pos, 1))
    if (next?.type.name !== 'table' || next.childCount >= table.childCount) return true
    const rows: number[] = []
    table.forEach((_row, offset) => {
      if (deleted.has(pos + 1 + offset)) rows.push(offset)
    })
    if (rows.length) tables.push({ pos, table, rows })
    return !rows.length
  })
  for (const { pos, table, rows } of tables.reverse()) {
    const at = out.mapping.map(pos, 1)
    const current = out.doc.nodeAt(at)
    if (current?.type.name !== 'table') continue
    out.replaceWith(at, at + current.nodeSize, table)
    for (const offset of rows.reverse()) {
      const from = at + 1 + offset
      trackDelete(out, from, from + table.nodeAt(offset)!.nodeSize, reviewer)
    }
  }
}

/**
 * Rewrites a user transaction into tracked changes. Returns null when it has nothing to track
 * (selection only, or from collaboration/undo, which callers filter before).
 */
export function trackTransaction(state: EditorState, tr: Transaction, reviewer: Reviewer): Transaction | null {
  if (!tr.docChanged) return null
  const out = state.tr
  let toOut = new Mapping()
  // Where the last insertion ended, so the caret follows typed text.
  let insertEnd: { pos: number; step: number } | undefined
  for (const step of tr.steps) {
    const before = out.steps.length
    if (step instanceof ReplaceStep) {
      const from = toOut.map(step.from, 1)
      const to = Math.max(from, toOut.map(step.to, -1))
      const deleted = from < to ? trackDelete(out, from, to, reviewer) : { from, to }
      const end = trackInsert(out, deleted.to, step.slice, reviewer)
      if (end !== undefined) insertEnd = { pos: end, step: out.steps.length }
    } else if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      const from = toOut.map(step.from, 1)
      const to = toOut.map(step.to, -1)
      if (RUN_PROPERTY_NAMES.has(step.mark.type.name)) {
        trackFormat(out, from, to, reviewer)
      }
      const mapped = step.map(toOut)
      if (mapped) out.step(mapped)
    } else {
      const mapped = (step as Step).map(toOut)
      if (mapped) {
        if (out.maybeStep(mapped).failed) continue
      }
    }
    const next = new Mapping()
    next.appendMap(step.getMap().invert())
    next.appendMapping(toOut)
    for (let index = before; index < out.steps.length; index++) next.appendMap(out.steps[index]!.getMap())
    toOut = next
  }
  restoreDeletedRows(state, tr, out, reviewer)
  // Paragraph property changes (setNodeMarkup) get a record of what they replaced.
  recordParagraphChanges(state, out, reviewer)
  const typed = insertEnd && tr.selection.empty ? out.mapping.slice(insertEnd.step).map(insertEnd.pos, 1) : undefined
  const head = typed ?? toOut.map(tr.selection.head, -1)
  const anchor = tr.selection.empty ? head : toOut.map(tr.selection.anchor, -1)
  try {
    out.setSelection(TextSelection.create(out.doc, Math.min(anchor, out.doc.content.size), Math.min(head, out.doc.content.size)))
  } catch {
    // Keep ProseMirror's mapped selection.
  }
  if (tr.storedMarksSet) out.setStoredMarks(tr.storedMarks)
  out.setMeta('docx-tracked', true)
  return out
}

/** Gives paragraphs whose properties changed a `w:pPrChange` with what they were. */
function recordParagraphChanges(state: EditorState, out: Transaction, reviewer: Reviewer): void {
  const original = new Map<number, ProseMirrorNode>()
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph') original.set(pos, node)
    return node.type.name !== 'paragraph'
  })
  const changes: { pos: number; node: ProseMirrorNode; old: ProseMirrorNode }[] = []
  const invert = out.mapping.invert()
  out.doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true
    const oldPos = invert.map(pos, 1)
    const old = original.get(oldPos)
    if (old && !node.attrs.pPrChange && PARAGRAPH_KEYS.some((key) => old.attrs[key] !== node.attrs[key])) changes.push({ pos, node, old })
    return false
  })
  for (const { pos, node, old } of changes) {
    out.setNodeMarkup(pos, undefined, { ...node.attrs, pPrChange: packJml(['w:pPrChange', revisionAttrs(reviewer), ['w:pPr', {}, ...paragraphPropertiesOf(old.attrs)]]) })
  }
}

export type RevisionKind = 'insert' | 'delete' | 'moveFrom' | 'moveTo' | 'format' | 'paragraphInsert' | 'paragraphDelete' | 'paragraphFormat' | 'rowInsert' | 'rowDelete'

export interface Revision {
  /** Stable within a document version: kind plus Word's revision id (or position for marks without). */
  key: string
  /** Undefined for the body; otherwise the Y story fragment id. */
  storyId?: string
  kind: RevisionKind
  author?: string
  date?: string
  from: number
  to: number
  text: string
}

const MARK_KINDS: Record<string, RevisionKind> = { ins: 'insert', del: 'delete', moveFrom: 'moveFrom', moveTo: 'moveTo', rPrChange: 'format' }

/** Every revision in a story, merged across adjacent nodes with the same mark. */
export function listRevisions(doc: ProseMirrorNode, storyId?: string): Revision[] {
  const revisions: Revision[] = []
  const open = new Map<string, Revision>()
  doc.descendants((node, pos) => {
    if (node.type.name === 'tableRow') {
      for (const [name, kind] of [['w:ins', 'rowInsert'], ['w:del', 'rowDelete']] as const) {
        const element = jmlChild(jml(node.attrs.trPr), name)
        if (element) revisions.push({ key: `${kind}:${jmlAttr(element, 'w:id') ?? pos}:${pos}`, kind, author: jmlAttr(element, 'w:author'), date: jmlAttr(element, 'w:date'), from: pos, to: pos + node.nodeSize, text: node.textContent })
      }
    }
    if (node.type.name === 'paragraph') {
      const markRPr = jml(node.attrs.markRPr)
      const end = pos + node.nodeSize - 1
      for (const [name, kind] of [['w:ins', 'paragraphInsert'], ['w:del', 'paragraphDelete']] as const) {
        const element = jmlChild(markRPr, name)
        if (element) revisions.push({ key: `${kind}:${jmlAttr(element, 'w:id') ?? pos}:${pos}`, kind, author: jmlAttr(element, 'w:author'), date: jmlAttr(element, 'w:date'), from: end, to: end + 1, text: '¶' })
      }
      const change = jml(node.attrs.pPrChange)
      if (change) revisions.push({ key: `paragraphFormat:${jmlAttr(change, 'w:id') ?? pos}:${pos}`, kind: 'paragraphFormat', author: jmlAttr(change, 'w:author'), date: jmlAttr(change, 'w:date'), from: pos + 1, to: end, text: '' })
      return true
    }
    if (!node.isInline) return true
    for (const mark of inlineMarks(node)) {
      const kind = MARK_KINDS[mark.type.name]
      if (!kind) continue
      const element = jml(mark.attrs.v)
      const id = jmlAttr(element, 'w:id') ?? ''
      const key = `${kind}:${id}:${jmlAttr(element, 'w:author') ?? ''}`
      const current = open.get(key)
      const text = node.isText ? node.text! : node.type.name === 'tab' ? '\t' : ''
      if (current && current.to >= pos - 2) {
        current.to = pos + node.nodeSize
        current.text += text
      } else {
        const revision: Revision = { key: `${key}:${pos}`, kind, author: jmlAttr(element, 'w:author'), date: jmlAttr(element, 'w:date'), from: pos, to: pos + node.nodeSize, text }
        open.set(key, revision)
        revisions.push(revision)
      }
    }
    return false
  })
  if (storyId) for (const revision of revisions) {
    revision.storyId = storyId
    revision.key = `${storyId}:${revision.key}`
  }
  return revisions.sort((a, b) => a.from - b.from)
}

function removeMarkType(out: Transaction, from: number, to: number, name: string): void {
  changeMarks(out, from, to, (marks) => marks.filter((mark) => mark.type.name !== name))
}

/** Restores the run properties an `rPrChange` recorded. */
function restoreFormat(out: Transaction, from: number, to: number): void {
  const schema = out.doc.type.schema
  changeMarks(out, from, to, (marks) => {
    const change = marks.find((mark) => mark.type.name === 'rPrChange')
    if (!change) return marks
    const old = jmlChild(jml(change.attrs.v), 'w:rPr')
    let next: readonly Mark[] = marks.filter((mark) => !RUN_PROPERTY_NAMES.has(mark.type.name) && mark.type.name !== 'rPrChange')
    const rest: JmlElement[] = []
    for (const element of old ? jmlElements(old) : []) {
      const name = RUN_MARK_BY_ELEMENT[element[0]]
      if (name) next = schema.marks[name]!.create({ v: packJml(element) }).addToSet(next)
      else rest.push(element)
    }
    if (rest.length) next = schema.marks.rPrRest!.create({ v: packJml(rest) }).addToSet(next)
    return next
  })
}

/** Accepts or rejects revisions; returns the transaction, or null if none applied. */
export function resolveRevisions(state: EditorState, revisions: Revision[], action: 'accept' | 'reject'): Transaction | null {
  if (!revisions.length) return null
  const out = state.tr
  const rowRevisions = revisions.filter(({ kind }) => kind === 'rowInsert' || kind === 'rowDelete')
  const removedRows = rowRevisions.filter(({ kind }) => (kind === 'rowInsert') === (action === 'reject'))
  const contentRevisions = revisions.filter((revision) => !rowRevisions.includes(revision) && !removedRows.some((row) => revision.from >= row.from && revision.to <= row.to))
  // Resolve rows first so cells continuing below a removed row retain their content.
  // Overlapping marks can delete the same range; map every later resolution through those edits.
  for (const revision of [...rowRevisions.sort((a, b) => b.from - a.from), ...contentRevisions.sort((a, b) => b.from - a.from)]) {
    const { kind } = revision
    const from = out.mapping.map(revision.from, 1)
    const to = Math.max(from, out.mapping.map(revision.to, -1))
    if (from === to && revision.from !== revision.to) continue
    const remove = (kind === 'insert' || kind === 'moveTo') ? action === 'reject' : (kind === 'delete' || kind === 'moveFrom') ? action === 'accept' : false
    switch (kind) {
      case 'rowInsert':
      case 'rowDelete': {
        const row = out.doc.nodeAt(from)
        if (row?.type.name !== 'tableRow') break
        if ((kind === 'rowInsert') === (action === 'reject')) {
          const markName = kind === 'rowInsert' ? 'ins' : 'del'
          removeMarkType(out, from, to, markName)
          out.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === 'paragraph') out.setNodeMarkup(pos, undefined, withMarkRPrChild(node.attrs, undefined, [`w:${markName}`]))
            return true
          })
          deleteRow(out, from)
        } else out.setNodeMarkup(from, undefined, withRowRevision(row.attrs, undefined, [kind === 'rowInsert' ? 'w:ins' : 'w:del']))
        break
      }
      case 'insert':
      case 'delete':
      case 'moveFrom':
      case 'moveTo': {
        const markName = kind === 'insert' ? 'ins' : kind === 'delete' ? 'del' : kind
        if (remove) deleteMarked(out, from, to, markName)
        else removeMarkType(out, from, to, markName)
        break
      }
      case 'format':
        if (action === 'accept') removeMarkType(out, from, to, 'rPrChange')
        else restoreFormat(out, from, to)
        break
      case 'paragraphInsert':
      case 'paragraphDelete': {
        const $pos = out.doc.resolve(Math.min(from, out.doc.content.size))
        const paragraphPos = $pos.before($pos.depth)
        const paragraph = out.doc.nodeAt(paragraphPos)
        if (!paragraph || paragraph.type.name !== 'paragraph') break
        const name = kind === 'paragraphInsert' ? 'w:ins' : 'w:del'
        out.setNodeMarkup(paragraphPos, undefined, withMarkRPrChild(paragraph.attrs, undefined, [name]))
        const joins = (kind === 'paragraphInsert') === (action === 'reject')
        if (joins) {
          const at = paragraphPos + paragraph.nodeSize
          const after = out.doc.nodeAt(at)
          if (after?.type.name === 'paragraph') {
            try {
              out.join(at)
            } catch {
              // A boundary that cannot join stays.
            }
          }
        }
        break
      }
      case 'paragraphFormat': {
        const $pos = out.doc.resolve(from)
        const paragraphPos = $pos.before($pos.depth)
        const paragraph = out.doc.nodeAt(paragraphPos)
        if (!paragraph) break
        if (action === 'accept') out.setNodeMarkup(paragraphPos, undefined, { ...paragraph.attrs, pPrChange: null })
        else {
          const old = jmlChild(jml(paragraph.attrs.pPrChange), 'w:pPr')
          const attrs: Record<string, unknown> = { ...paragraph.attrs, pPrChange: null, pStyle: null, pPrRest: null }
          for (const key of Object.keys(PARAGRAPH_PROPERTY_ATTRS)) attrs[key] = null
          const rest: JmlElement[] = []
          for (const element of old ? jmlElements(old) : []) {
            if (element[0] === 'w:pStyle') attrs.pStyle = jmlAttr(element, 'w:val') ?? null
            else {
              const key = Object.entries(PARAGRAPH_PROPERTY_ATTRS).find(([, name]) => name === element[0])?.[0]
              if (key) attrs[key] = packJml(element)
              else rest.push(element)
            }
          }
          if (rest.length) attrs.pPrRest = packJml(rest)
          out.setNodeMarkup(paragraphPos, undefined, attrs)
        }
        break
      }
    }
  }
  return out.docChanged ? out : null
}

function deleteMarked(out: Transaction, from: number, to: number, markName: string): void {
  const ranges: { from: number; to: number }[] = []
  out.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return true
    if (inlineMarks(node).some((mark) => mark.type.name === markName)) ranges.push({ from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize) })
    return false
  })
  for (const range of ranges.reverse()) out.delete(range.from, range.to)
}

/** Marks pasted or typed content as inserted by the reviewer (for content added outside steps). */
export function markInserted(out: Transaction, from: number, to: number, reviewer: Reviewer): void {
  const mark = insertionMark(out, from, reviewer)
  changeMarks(out, from, to, (marks) => mark.addToSet(marks))
}

