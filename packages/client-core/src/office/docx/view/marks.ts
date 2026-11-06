import { Mark, type MarkType, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { packJml, type JmlElement } from '../jsonml.js'
import { inlineMarks, packMarks } from '../schema.js'

/**
 * Mark helpers that also cover inline atoms, whose marks live in their `marks` attribute (Yjs
 * keeps marks only on text). Everything that formats a range goes through these.
 */

export function propertyMark(state: EditorState, name: string, element: JmlElement): Mark {
  return state.schema.marks[name]!.create({ v: packJml(element) })
}

/** Rewrites the marks of every inline node in [from, to) with `change`. */
export function changeMarks(tr: Transaction, from: number, to: number, change: (marks: readonly Mark[], node: ProseMirrorNode) => readonly Mark[]): void {
  const edits: { pos: number; node: ProseMirrorNode; marks: readonly Mark[] }[] = []
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return true
    const current = inlineMarks(node)
    const next = change(current, node)
    if (!Mark.sameSet(current, next)) edits.push({ pos, node, marks: next })
    return false
  })
  for (const { pos, node, marks } of edits) {
    if (node.isText) {
      const start = Math.max(from, pos)
      const end = Math.min(to, pos + node.nodeSize)
      for (const mark of current(node)) if (!marks.some((kept) => kept.eq(mark))) tr.removeMark(start, end, mark)
      for (const mark of marks) if (!current(node).some((had) => had.eq(mark))) tr.addMark(start, end, mark)
    } else {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, marks: packMarks(marks) }, [])
    }
  }
}

function current(node: ProseMirrorNode): readonly Mark[] {
  return node.marks
}

/** Sets `mark` (replacing others of its type) over a range, or as stored marks at a cursor. */
export function setMark(state: EditorState, tr: Transaction, mark: Mark): void {
  const { selection } = state
  if (selection.empty) {
    const marks = mark.addToSet(tr.storedMarks ?? selection.$from.marks())
    tr.setStoredMarks(marks)
    return
  }
  for (const range of selection.ranges) changeMarks(tr, range.$from.pos, range.$to.pos, (marks) => mark.addToSet(marks))
}

/** Removes marks of `type` over the selection, or from the stored marks at a cursor. */
export function clearMark(state: EditorState, tr: Transaction, type: MarkType): void {
  const { selection } = state
  if (selection.empty) {
    tr.setStoredMarks(type.removeFromSet(tr.storedMarks ?? selection.$from.marks()))
    return
  }
  for (const range of selection.ranges) changeMarks(tr, range.$from.pos, range.$to.pos, (marks) => type.removeFromSet(marks))
}

/** The marks that apply at the selection: stored marks, else those of the text before the cursor (or of the first selected text). */
export function selectionMarks(state: EditorState): readonly Mark[] {
  const { selection } = state
  if (selection.empty) return state.storedMarks ?? selection.$from.marks()
  let found: readonly Mark[] | undefined
  state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (found) return false
    if (node.isInline) {
      found = inlineMarks(node)
      return false
    }
    return true
  })
  return found ?? selection.$from.marks()
}

/**
 * Moves marks ProseMirror put on inline atoms into their `marks` attribute, so the formatting
 * survives syncing. Runs as an appendTransaction.
 */
export function normalizeAtomMarks(state: EditorState): Transaction | null {
  let tr: Transaction | null = null
  state.doc.descendants((node, pos) => {
    if (!node.isInline) return true
    if (node.isText || !node.marks.length || !('marks' in node.attrs)) return false
    tr ??= state.tr
    let marks = inlineMarks(node.type.create(node.attrs))
    for (const mark of node.marks) marks = mark.addToSet(marks)
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, marks: packMarks(marks) }, [])
    return false
  })
  return tr
}
