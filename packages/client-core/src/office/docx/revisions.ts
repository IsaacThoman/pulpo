import { Slice, type Attrs, type Mark, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { removeRow, TableMap } from '@tiptap/pm/tables'
import { AddMarkStep, Mapping, RemoveMarkStep, ReplaceAroundStep, ReplaceStep, StepMap, type Step } from '@tiptap/pm/transform'
import { preserveCell } from './export.js'
import { preservedBlocks } from './import.js'
import { jmlAttr, jmlChild, jmlElements, packJml, unpackJml, type JmlElement } from './jsonml.js'
import { PARAGRAPH_PROPERTY_ATTRS, RUN_MARK_BY_ELEMENT, RUN_PROPERTY_MARKS, inlineMarks } from './schema.js'
import { RPR_ORDER, PPR_ORDER, sortByOrder } from './names.js'
import type { DocxModel } from './model.js'
import { changeMarks } from './view/marks.js'

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
    const rowIndex = $pos.index()
    const sourceStep = out.steps.length
    const candidates: { node: ProseMirrorNode; from: number }[] = []
    const keptOwners: { pos: number; index: number }[] = []
    const seen = new Set<number>()
    for (let col = 0; col < map.width; col++) {
      const offset = map.map[rowIndex * map.width + col]!
      if (seen.has(offset)) continue
      seen.add(offset)
      const rect = map.findCell(offset)
      if (rect.top < rowIndex) keptOwners.push({ pos: $pos.start() + offset, index: rowIndex - rect.top - 1 })
      if (rowIndex + 1 < map.height && map.map[(rowIndex + 1) * map.width + col] === offset && map.findCell(offset).top === rowIndex) candidates.push({ node: table.nodeAt(offset)!, from: $pos.start() + offset })
    }
    removeRow(out, { table, map, tableStart: $pos.start(), left: 0, right: map.width, top: 0, bottom: map.height }, rowIndex)
    const moved: MovedContent[] = [...out.getMeta(MOVED_CONTENT) ?? []]
    for (let index = sourceStep; index < out.steps.length; index++) {
      const step = out.steps[index]
      if (!(step instanceof ReplaceStep) || step.from !== step.to) continue
      const inserted = step.slice.content.firstChild
      const candidate = candidates.findIndex(({ node }) => node.content === inserted?.content)
      if (candidate < 0 || !inserted) continue
      const source = candidates.splice(candidate, 1)[0]!
      moved.push({ sourceFrom: source.from + 1, sourceTo: source.from + source.node.nodeSize - 1, sourceStep, targetFrom: step.from + 1, targetTo: step.from + inserted.nodeSize - 1, targetStep: index + 1 })
      const at = out.mapping.slice(index + 1).map(step.from)
      const current = out.doc.nodeAt(at)
      const kept = unpackJml<JmlElement[]>(current?.attrs.vMergeCells as string | null)
      if (current && kept?.length) out.setNodeMarkup(at, undefined, { ...current.attrs, vMergeCells: kept.length > 1 ? packJml(kept.slice(1)) : null })
    }
    for (const owner of keptOwners) {
      const at = out.mapping.slice(sourceStep).map(owner.pos)
      const current = out.doc.nodeAt(at)
      const kept = unpackJml<JmlElement[]>(current?.attrs.vMergeCells as string | null)
      if (current && kept?.length) {
        const remaining = kept.filter((_cell, index) => index !== owner.index)
        out.setNodeMarkup(at, undefined, { ...current.attrs, vMergeCells: remaining.length ? packJml(remaining) : null })
      }
    }
    if (moved.length) out.setMeta(MOVED_CONTENT, moved)
  }
}

/** Removing a paragraph mark leaves the following paragraph's mark and section end. */
function joinParagraphs(out: Transaction, at: number): void {
  const { nodeBefore, nodeAfter } = out.doc.resolve(at)
  if (nodeBefore?.type.name !== 'paragraph' || nodeAfter?.type.name !== 'paragraph') return
  const pos = at - nodeBefore.nodeSize
  out.join(at)
  out.setNodeMarkup(pos, undefined, {
    ...out.doc.nodeAt(pos)!.attrs,
    markRPr: nodeAfter.attrs.markRPr,
    sectPr: nodeAfter.attrs.sectPr,
    trail: nodeAfter.attrs.trail,
  })
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
  const beforeJoins = out.steps.length
  for (const at of joins.reverse()) {
    try {
      joinParagraphs(out, at)
    } catch {
      // Paragraphs that cannot join (a table between them) keep their boundary.
    }
  }
  return { from: start, to: out.mapping.slice(beforeJoins).map(end) }
}

/** Inserts `slice` at `pos` marked as the reviewer's insertion. */
function trackInsert(out: Transaction, pos: number, slice: Slice, reviewer: Reviewer, pasteEnds?: (Attrs | null)[]): { end: number; step: number } | undefined {
  if (!slice.size) return undefined
  const split = !pasteEnds && slice.openStart === 1 && slice.openEnd === 1 && slice.content.childCount === 2
    && slice.content.firstChild?.type.name === 'paragraph' && !slice.content.firstChild.content.size
    && slice.content.lastChild?.type.name === 'paragraph' && !slice.content.lastChild.content.size
  const before = out.steps.length
  const $pos = out.doc.resolve(pos)
  const original = $pos.parent.type.name === 'paragraph' ? { end: $pos.end(), attrs: $pos.parent.attrs } : undefined
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
  // The old mark follows the original content's end, even when Enter replaces a tracked join.
  if (original) {
    const $end = out.doc.resolve(map.map(original.end, 1))
    if ($end.parent.type.name === 'paragraph' && $end.parentOffset === $end.parent.content.size) {
      out.setNodeMarkup($end.before(), undefined, {
        ...$end.parent.attrs, markRPr: original.attrs.markRPr, sectPr: original.attrs.sectPr, trail: original.attrs.trail,
      })
    }
  }
  // Splits create a fresh mark; pasted paragraph ends retain their own properties.
  let endIndex = 0
  out.doc.nodesBetween(start, end, (node, nodePos) => {
    if (node.type.name !== 'paragraph') return true
    const endOfParagraph = nodePos + node.nodeSize - 1
    if (endOfParagraph >= start && endOfParagraph < end) {
      const pasted = pasteEnds?.[endIndex++]
      const attrs = pasteEnds ? { ...node.attrs, markRPr: pasted?.markRPr ?? null, sectPr: pasted?.sectPr ?? null, trail: pasted?.trail ?? null }
        : split ? { ...node.attrs, markRPr: null, sectPr: null, trail: null } : node.attrs
      if (split || !jmlChild(jml(attrs.markRPr), 'w:ins')) {
        out.setNodeMarkup(nodePos, undefined, withMarkRPrChild(attrs, ['w:ins', revisionAttrs(reviewer)], ['w:del']))
      } else if (pasteEnds) out.setNodeMarkup(nodePos, undefined, attrs)
    }
    return false
  })
  return { end, step: before }
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

/** setNodeMarkup replaces only the node's shell; it does not move its content. */
function isNodeMarkup(step: Step): step is ReplaceAroundStep {
  return step instanceof ReplaceAroundStep && step.gapFrom === step.from + 1 && step.gapTo === step.to - 1
    && step.insert === 1 && step.slice.size === 2 && step.slice.content.childCount === 1
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
  for (const [index, step] of tr.steps.entries()) {
    let insertionStep: number | undefined
    const before = out.steps.length
    if (step instanceof ReplaceStep) {
      let from = toOut.map(step.from, 1)
      let to = Math.max(from, toOut.map(step.to, -1))
      let slice = step.slice
      let pasteEnds = tr.getMeta('docx-paste-ends') as (Attrs | null)[] | undefined
      // Fitting can consume an original edge token outside the selection. Keep that mark
      // original and insert the closed blocks beside it, deleting only selected content.
      let insertAt: number | undefined
      if (index === 0) {
        const { $from, $to } = state.selection
        if ($to.parent.type.name === 'paragraph' && step.from === $from.pos && step.to === $to.pos + 1 && $to.parentOffset === $to.parent.content.size
          && slice.openStart === 1 && slice.content.firstChild?.type.name === 'paragraph' && !slice.content.firstChild.content.size) {
          insertAt = to
          to = toOut.map($to.pos, -1)
          slice = new Slice(slice.content.cut(slice.content.firstChild.nodeSize), 0, slice.openEnd)
          pasteEnds = pasteEnds?.slice(1)
        } else if ($from.parent.type.name === 'paragraph' && step.to === $to.pos && step.from === $from.pos - 1 && !$from.parentOffset
          && slice.openEnd === 1 && slice.content.lastChild?.type.name === 'paragraph' && !slice.content.lastChild.content.size) {
          insertAt = from
          from = toOut.map($from.pos, 1)
          slice = new Slice(slice.content.cut(0, slice.content.size - slice.content.lastChild.nodeSize), slice.openStart, 0)
        }
      }
      // Replacing an empty paragraph's whole shell also deletes no user content.
      if (index === 0 && state.selection.empty && state.selection.$from.parent.type.name === 'paragraph'
        && !state.selection.$from.parent.content.size && step.from === state.selection.from - 1 && step.to === state.selection.from + 1
        && !slice.openStart && !slice.openEnd && slice.content.firstChild?.type.name === 'paragraph' && slice.content.lastChild?.type.name === 'paragraph') {
        from = to = toOut.map(state.selection.from, 1)
        slice = new Slice(slice.content, 1, 1)
      }
      const beforeDelete = out.steps.length
      const deleted = from < to ? trackDelete(out, from, to, reviewer) : { from, to }
      // deleteSelection may fit an empty, open paragraph shell at the left edge. It is
      // structure for the surviving text, not a paragraph mark the reviewer inserted.
      const fittingShell = step.from < step.to && slice.openStart === 0 && slice.openEnd === 1
        && slice.content.childCount === 1 && slice.content.firstChild?.type.name === 'paragraph'
        && !slice.content.firstChild.content.size
      const inserted = trackInsert(out, insertAt === undefined ? deleted.to : out.mapping.slice(beforeDelete).map(insertAt, 1), fittingShell ? Slice.empty : slice, reviewer, pasteEnds)
      if (inserted) {
        insertEnd = { pos: inserted.end, step: out.steps.length }
        insertionStep = inserted.step
      }
    } else if (isNodeMarkup(step)) {
      const pos = toOut.map(step.from, 1)
      const node = out.doc.nodeAt(pos)
      const old = tr.docs[index]!.nodeAt(step.from)
      const replacement = step.slice.content.firstChild!
      if (node && old && node.type === replacement.type) {
        // Apply only changed attributes so Enter's cleanup keeps the tracked paragraph mark.
        const attrs = { ...node.attrs }
        for (const key of Object.keys(replacement.attrs)) {
          // Split tracking already assigned each mark to its surviving end; command positions may differ.
          if ((tr.getMeta('docx-paragraph-split') || tr.getMeta('docx-paragraph-split-cleanup')?.includes(index)) && ['markRPr', 'sectPr', 'trail'].includes(key)) continue
          if (replacement.attrs[key] !== old.attrs[key]) attrs[key] = replacement.attrs[key]
        }
        out.setNodeMarkup(pos, undefined, attrs, replacement.marks)
      }
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
    next.appendMap(isNodeMarkup(step) ? StepMap.empty : step.getMap().invert())
    next.appendMapping(toOut)
    for (let index = before; index < out.steps.length; index++) {
      const mapped = out.steps[index]!
      // Recover positions inside the inserted slice, including the new paragraph's opening token.
      next.appendMap(isNodeMarkup(mapped) ? StepMap.empty : mapped.getMap(), index === insertionStep ? 0 : undefined)
    }
    toOut = next
  }
  restoreDeletedRows(state, tr, out, reviewer)
  // Paragraph property changes (setNodeMarkup) get a record of what they replaced.
  recordParagraphChanges(state, out, reviewer)
  const typed = insertEnd && tr.selection.empty ? out.mapping.slice(insertEnd.step).map(insertEnd.pos, 1) : undefined
  const head = typed ?? toOut.map(tr.selection.head, -1)
  const anchor = tr.selection.empty ? head : toOut.map(tr.selection.anchor, -1)
  try {
    const end = Math.min(head, out.doc.content.size)
    out.setSelection(tr.selection.empty && !out.doc.resolve(end).parent.inlineContent
      ? TextSelection.near(out.doc.resolve(end), -1)
      : TextSelection.create(out.doc, Math.min(anchor, out.doc.content.size), end))
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

export type RevisionKind = 'insert' | 'delete' | 'moveFrom' | 'moveTo' | 'format' | 'paragraphInsert' | 'paragraphDelete' | 'paragraphFormat' | 'rowInsert' | 'rowDelete' | 'cellInsert' | 'cellDelete' | 'cellMerge'

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
    if (node.type.name === 'tableCell') {
      const pr = jml(node.attrs.tcPr)
      for (const [name, kind] of [['w:cellIns', 'cellInsert'], ['w:cellDel', 'cellDelete'], ['w:del', 'cellDelete'], ['w:cellMerge', 'cellMerge']] as const) {
        const element = jmlChild(pr, name)
        if (element) revisions.push({ key: `${kind}:${jmlAttr(element, 'w:id') ?? pos}:${pos}`, kind, author: jmlAttr(element, 'w:author'), date: jmlAttr(element, 'w:date'), from: pos, to: pos + node.nodeSize, text: node.textContent })
      }
      const continuations = (unpackJml<JmlElement[]>(node.attrs.vMergeCells as string | null) ?? []).slice(0, Math.max(0, Number(node.attrs.rowspan) - 1))
      if (continuations.some((cell) => jmlChild(jmlChild(cell, 'w:tcPr'), 'w:cellMerge'))) revisions.push({ key: `cellMerge:continuations:${pos}`, kind: 'cellMerge', from: pos, to: pos + node.nodeSize, text: node.textContent })
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

function mergeProperties(cell: ProseMirrorNode, value: string | undefined): Record<string, unknown> {
  const pr = jml(cell.attrs.tcPr) ?? ['w:tcPr', {}]
  const children = jmlElements(pr).filter((element) => element[0] !== 'w:cellMerge' && element[0] !== 'w:vMerge')
  if (value === 'cont' || value === 'continue') children.push(['w:vMerge', {}])
  else if (value === 'rest' || value === 'restart') children.push(['w:vMerge', { 'w:val': 'restart' }])
  return { ...cell.attrs, tcPr: children.length || Object.keys(pr[1]).length ? packJml([pr[0], pr[1], ...children]) : null }
}

function splitVertical(out: Transaction, pos: number): number[] {
  const cell = out.doc.nodeAt(pos)!
  const span = Number(cell.attrs.rowspan) || 1
  if (span <= 1) return [pos]
  const $pos = out.doc.resolve(pos)
  const table = $pos.node($pos.depth - 1)
  const tableStart = $pos.start($pos.depth - 1)
  const map = TableMap.get(table)
  const rect = map.findCell(pos - tableStart)
  const kept = unpackJml<JmlElement[]>(cell.attrs.vMergeCells as string | null) ?? []
  const step = out.steps.length
  const properties = jml(cell.attrs.tcPr) ?? ['w:tcPr', {}]
  const children = jmlElements(properties).filter((element) => element[0] !== 'w:vMerge')
  children.push(['w:vMerge', { 'w:val': 'restart' }])
  out.setNodeMarkup(pos, undefined, { ...cell.attrs, tcPr: packJml([properties[0], properties[1], ...children]), rowspan: 1, vMergeCells: null })
  const added: { pos: number; step: number }[] = []
  for (let row = rect.bottom - 1; row > rect.top; row--) {
    const raw = kept[row - rect.top - 1]
    const attrs = raw ? { tcPr: packJml(jmlChild(raw, 'w:tcPr') ?? ['w:tcPr', {}]), xmlAttrs: JSON.stringify(raw[1]) } : { tcPr: packJml(['w:tcPr', {}, ['w:vMerge', {}]]) }
    const content = raw ? preservedBlocks(jmlElements(raw).filter((child) => child[0] !== 'w:tcPr')) : []
    const continuation = cell.type.create({ ...attrs, colspan: cell.attrs.colspan, rowspan: 1 }, content.length ? content : cell.type.schema.nodes.paragraph!.create())
    const at = out.mapping.slice(step).map(tableStart + map.positionAt(row, rect.left, table))
    out.insert(at, continuation)
    added.push({ pos: at, step: out.steps.length })
  }
  return [out.mapping.slice(step).map(pos), ...added.reverse().map((entry) => out.mapping.slice(entry.step).map(entry.pos))]
}

/** Normalize current vMerge geometry through model edits; preserved XML makes rejection lossless. */
function normalizeVertical(out: Transaction): void {
  const tables: number[] = []
  out.doc.descendants((node, pos) => { if (node.type.name === 'table') tables.push(pos); return true })
  for (const tablePos of tables.reverse()) {
    const table = out.doc.nodeAt(tablePos)
    if (table?.type.name !== 'table') continue
    const map = TableMap.get(table)
    interface Owner { node: ProseMirrorNode; pos: number; end: number; span: number; kept: JmlElement[]; merged: number }
    let open = new Map<number, Owner>()
    const owners = new Set<Owner>()
    const removed: number[] = []
    table.forEach((row, rowOffset, rowIndex) => {
      const next = new Map([...open].filter(([, owner]) => owner.end >= rowIndex))
      row.forEach((cell, cellOffset) => {
        const relative = rowOffset + 1 + cellOffset
        const col = map.colCount(relative)
        const value = jmlChild(jml(cell.attrs.tcPr), 'w:vMerge')
        const continuing = value && jmlAttr(value, 'w:val') !== 'restart'
        const above = open.get(col)
        const pos = tablePos + 1 + relative
        if (continuing && above && above.span === cell.attrs.colspan && above.end === rowIndex - 1) {
          above.end = rowIndex + Number(cell.attrs.rowspan) - 1
          above.merged += Number(cell.attrs.rowspan)
          above.kept.push(preserveCell(cell), ...unpackJml<JmlElement[]>(cell.attrs.vMergeCells as string | null) ?? [])
          owners.add(above)
          next.set(col, above)
          removed.push(pos)
        } else next.set(col, { node: cell, pos, end: rowIndex + Number(cell.attrs.rowspan) - 1, span: Number(cell.attrs.colspan), kept: (unpackJml<JmlElement[]>(cell.attrs.vMergeCells as string | null) ?? []).slice(0, Math.max(0, Number(cell.attrs.rowspan) - 1)), merged: 0 })
      })
      open = next
    })
    const step = out.steps.length
    for (const owner of owners) out.setNodeMarkup(out.mapping.slice(step).map(owner.pos), undefined, { ...owner.node.attrs, rowspan: Number(owner.node.attrs.rowspan) + owner.merged, vMergeCells: packJml(owner.kept) })
    for (const pos of removed.reverse()) {
      const at = out.mapping.slice(step).map(pos)
      const cell = out.doc.nodeAt(at)
      if (cell?.type.name === 'tableCell') out.delete(at, at + cell.nodeSize)
    }
  }
}

function padMissingCells(out: Transaction): void {
  const missing: { pos: number; count: number }[] = []
  out.doc.descendants((table, pos) => {
    if (table.type.name !== 'table') return true
    const map = TableMap.get(table)
    for (const issue of map.problems ?? []) if (issue.type === 'missing') {
      let offset = 0
      for (let row = 0; row < issue.row; row++) offset += table.child(row).nodeSize
      missing.push({ pos: pos + 1 + offset + table.child(issue.row).nodeSize - 1, count: issue.n })
    }
    return true
  })
  for (const entry of missing.reverse()) out.insert(entry.pos, out.doc.type.schema.nodes.tableCell!.create({ phantom: 'after', colspan: entry.count }, out.doc.type.schema.nodes.paragraph!.create()))
}

/** Accepts or rejects revisions; returns the transaction, or null if none applied. */
function resolveBatch(state: EditorState, revisions: Revision[], action: 'accept' | 'reject'): Transaction | null {
  if (!revisions.length) return null
  const out = state.tr
  const positions = new Mapping()
  let mappedSteps = 0
  const sourcePosition = (pos: number, assoc: number) => {
    // Mark steps have empty maps. Do not revisit thousands of them for each revision.
    while (mappedSteps < out.mapping.maps.length) {
      const map = out.mapping.maps[mappedSteps++]!
      if (map.ranges.length) positions.appendMap(map)
    }
    return positions.map(pos, assoc)
  }
  const trailing: number[] = []
  const rowRevisions = revisions.filter(({ kind }) => kind === 'rowInsert' || kind === 'rowDelete')
  const removedRows = rowRevisions.filter(({ kind }) => (kind === 'rowInsert') === (action === 'reject'))
  const cells = revisions.filter(({ kind }) => kind === 'cellInsert' || kind === 'cellDelete' || kind === 'cellMerge')
  const removedCells = cells.filter(({ kind }) => (kind === 'cellInsert' && action === 'reject') || (kind === 'cellDelete' && action === 'accept'))
  const contentRevisions = revisions.filter((revision) => !rowRevisions.includes(revision) && !cells.includes(revision) && ![...removedRows, ...removedCells].some((parent) => revision.from >= parent.from && revision.to <= parent.to))
  // Resolve rows first so cells continuing below a removed row retain their content.
  // Overlapping marks can delete the same range; map every later resolution through those edits.
  for (const revision of [...rowRevisions.sort((a, b) => b.from - a.from), ...cells.sort((a, b) => b.from - a.from), ...contentRevisions.sort((a, b) => b.from - a.from)]) {
    const { kind } = revision
    const from = sourcePosition(revision.from, 1)
    const to = Math.max(from, sourcePosition(revision.to, -1))
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
      case 'cellInsert':
      case 'cellDelete':
      case 'cellMerge': {
        const cell = out.doc.nodeAt(from)
        if (cell?.type.name !== 'tableCell') break
        const pr = jml(cell.attrs.tcPr) ?? ['w:tcPr', {}]
        const remove = (kind === 'cellInsert' && action === 'reject') || (kind === 'cellDelete' && action === 'accept')
        if (remove) {
          const $cell = out.doc.resolve(from)
          const table = $cell.node($cell.depth - 1)
          const tableStart = $cell.start($cell.depth - 1)
          const map = TableMap.get(table)
          const rect = map.findCell(from - tableStart)
          const covered = map.map.slice(rect.top * map.width, (rect.top + 1) * map.width).some((offset) => map.findCell(offset).top < rect.top)
          if ($cell.parent.childCount === 1 && !covered) deleteRow(out, $cell.before())
          else out.delete(from, from + cell.nodeSize)
        } else {
          const names = kind === 'cellInsert' ? ['w:cellIns'] : kind === 'cellDelete' ? ['w:cellDel', 'w:del'] : ['w:cellMerge']
          const children = jmlElements(pr).filter((element) => !names.includes(element[0]))
          if (kind === 'cellMerge') {
            // Expand imported rowspans first: merge revisions can live only in preserved XML.
            const positions = splitVertical(out, from)
            for (const pos of positions) {
              const current = out.doc.nodeAt(pos)!
              const merge = jmlChild(jml(current.attrs.tcPr), 'w:cellMerge')
              if (merge) out.setNodeMarkup(pos, undefined, mergeProperties(current, jmlAttr(merge, action === 'accept' ? 'w:vMerge' : 'w:vMergeOrig')))
            }
          } else out.setNodeMarkup(from, undefined, { ...cell.attrs, tcPr: children.length || Object.keys(pr[1]).length ? packJml([pr[0], pr[1], ...children]) : null })
        }
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
              joinParagraphs(out, at)
            } catch {
              // A boundary that cannot join stays.
            }
          } else if (!after || !paragraph.content.size) {
            // Resolve text first so deleting it in this pass can remove the shell outright.
            trailing.push(revision.from)
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
  for (const pos of trailing) {
    const $end = out.doc.resolve(Math.min(out.doc.content.size, sourcePosition(pos, -1)))
    const node = $end.parent
    if (node.type.name !== 'paragraph') continue
    if (!node.content.size && out.doc.content.size > node.nodeSize) out.delete($end.before(), $end.after())
    else if (out.doc.resolve($end.before()).nodeBefore?.type.name === 'paragraph') {
      // A terminal end has no successor; keep the preceding end so later text rejection leaves no shell.
      out.join($end.before())
    }
  }
  if (cells.some(({ kind }) => kind === 'cellMerge')) normalizeVertical(out)
  if (cells.length) padMissingCells(out)
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

export type RevisionAction = 'accept' | 'reject'

export interface RevisionProjection {
  doc: ProseMirrorNode
  mapping: Mapping
  /** Translate a projected text boundary back into the editable source. */
  sourcePosition(position: number, assoc?: number): number
}

interface MovedContent { sourceFrom: number; sourceTo: number; sourceStep: number; targetFrom: number; targetTo: number; targetStep: number }
const MOVED_CONTENT = 'docx-resolved-moves'
const projections = new WeakMap<ProseMirrorNode, Partial<Record<RevisionAction, RevisionProjection>>>()

/** Selected review actions and full-document actions use the same structural ordering. */
export function resolveRevisions(state: EditorState, revisions: Revision[], action: RevisionAction): Transaction | null {
  const all = listRevisions(state.doc)
  const keys = new Set(revisions.map((revision) => revision.key))
  return all.length === keys.size && all.every((revision) => keys.has(revision.key)) ? resolveAllRevisions(state, action) : resolveBatch(state, revisions, action)
}

/** The one accept/reject-all path for the editor and read-only document views. */
export function resolveAllRevisions(state: EditorState, action: RevisionAction): Transaction | null {
  const out = state.tr
  const apply = (revisions: Revision[]) => {
    const offset = out.steps.length
    const tr = resolveBatch(EditorState.create({ doc: out.doc, schema: state.schema }), revisions, action)
    if (!tr) return
    for (const step of tr.steps) out.step(step)
    const moves = tr.getMeta(MOVED_CONTENT) as MovedContent[] | undefined
    if (moves?.length) out.setMeta(MOVED_CONTENT, [...out.getMeta(MOVED_CONTENT) ?? [], ...moves.map((move) => ({ ...move, sourceStep: move.sourceStep + offset, targetStep: move.targetStep + offset }))])
  }
  for (let pass = 0; pass < 100; pass++) {
    const revisions = listRevisions(out.doc)
    const rows = revisions.filter(({ kind }) => kind === 'rowInsert' || kind === 'rowDelete')
    const cells = revisions.filter(({ kind }) => kind === 'cellInsert' || kind === 'cellDelete' || kind === 'cellMerge')
    if (!rows.length && !cells.length) break
    if (cells.length) apply(cells)
    else apply(rows)
    if (pass === 99) throw new Error('Too many nested structural revisions')
  }
  apply(listRevisions(out.doc))
  return out.docChanged ? out : null
}

/** Immutable semantic view, with original positions retained for Find/Replace. */
export function revisionProjection(doc: ProseMirrorNode, action: RevisionAction = 'accept'): RevisionProjection {
  const cached = projections.get(doc) ?? {}
  if (cached[action]) return cached[action]!
  const revisions = listRevisions(doc)
  const tr = revisions.length ? resolveAllRevisions(EditorState.create({ doc, schema: doc.type.schema }), action) : null
  const mapping = tr?.mapping ?? new Mapping()
  const moved = tr?.getMeta(MOVED_CONTENT) as MovedContent[] | undefined
  const inverse = new Mapping(mapping.maps.filter((map) => map.ranges.length)).invert()
  const inverseSteps = moved?.length ? mapping.maps.map((step) => step.invert()) : []
  const movesAt = new Map<number, MovedContent[]>()
  for (const move of moved ?? []) movesAt.set(move.targetStep, [...movesAt.get(move.targetStep) ?? [], move])
  const value: RevisionProjection = {
    doc: tr?.doc ?? doc,
    mapping,
    sourcePosition(position, assoc = 1) {
      if (!moved?.length) return inverse.map(position, assoc)
      let at = position
      for (let index = inverseSteps.length - 1; index >= 0; index--) {
        const move = movesAt.get(index + 1)?.find((move) => at > move.targetFrom && at < move.targetTo || (at === move.targetFrom && assoc > 0) || (at === move.targetTo && assoc < 0))
        if (move) {
          at = move.sourceFrom + at - move.targetFrom
          index = move.sourceStep
        } else at = inverseSteps[index]!.map(at, assoc)
      }
      return at
    },
  }
  cached[action] = value
  projections.set(doc, cached)
  return value
}

/** Project a story or a container's blocks without mutating their shared nodes. */
export function revisionContent(node: ProseMirrorNode, action: RevisionAction = 'accept'): ProseMirrorNode {
  if (node.type.name === 'doc') return revisionProjection(node, action).doc
  const schema = node.type.schema
  const content = node.isTextblock || node.type.isInGroup('block') ? [node] : node.content
  return revisionProjection(schema.node('doc', null, content), action).doc
}

export function revisionModel(model: DocxModel, action: RevisionAction = 'accept'): DocxModel {
  const body = revisionProjection(model.body, action).doc
  let changed = body !== model.body
  const stories = new Map([...model.stories].map(([id, story]) => {
    const doc = revisionProjection(story.doc, action).doc
    changed ||= doc !== story.doc
    return [id, doc === story.doc ? story : { ...story, doc }] as const
  }))
  return changed ? { ...model, body, stories } : model
}

/** Marks pasted or typed content as inserted by the reviewer (for content added outside steps). */
export function markInserted(out: Transaction, from: number, to: number, reviewer: Reviewer): void {
  const mark = insertionMark(out, from, reviewer)
  changeMarks(out, from, to, (marks) => mark.addToSet(marks))
}

