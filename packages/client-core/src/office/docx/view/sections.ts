import type { Attrs, Node as ProseMirrorNode, Slice } from '@tiptap/pm/model'
import { Plugin, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Mapping, ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform'
import { ySyncPluginKey } from '@tiptap/y-tiptap'

/** Only closed paragraph ends belong to the clipboard; an open tail has no mark. */
function paragraphEnds(slice: Slice): { pos: number; attrs: Attrs }[] {
  const ends: { pos: number; attrs: Attrs }[] = []
  slice.content.descendants((node, pos) => {
    const end = pos + node.nodeSize - 1
    if (node.type.name === 'paragraph' && end < slice.content.size - slice.openEnd) ends.push({ pos: end - slice.openStart, attrs: node.attrs })
  })
  return ends
}

/** Fitting a paste inherits the left paragraph's attrs; its new mark belongs to the slice instead. */
export function pasteSelection(state: EditorState, slice: Slice): Transaction {
  const tr = state.tr.replaceSelection(slice)
  const step = tr.steps[0]
  if (!(step instanceof ReplaceStep)) return tr
  const source = paragraphEnds(slice)
  const fitted = paragraphEnds(step.slice)
  // A closed slice can also split off a prefix paragraph. That extra end has no clipboard mark.
  const extra = fitted.length - source.length
  const attrs = fitted.map((_, index) => source[index - extra]?.attrs ?? null)
  tr.setMeta('docx-paste-ends', attrs)
  const cleanup: number[] = []
  for (const [index, end] of fitted.entries()) {
    const $end = tr.doc.resolve(step.from + end.pos)
    if ($end.parent.type.name !== 'paragraph' || $end.parentOffset !== $end.parent.content.size) continue
    tr.setNodeMarkup($end.before(), undefined, {
      ...$end.parent.attrs, sectPr: attrs[index]?.sectPr ?? null, markRPr: attrs[index]?.markRPr ?? null, trail: attrs[index]?.trail ?? null,
    })
    cleanup.push(tr.steps.length - 1)
  }
  tr.setMeta('docx-paragraph-split-cleanup', cleanup)
  return tr
}

/** Inline typing cannot change which paragraph mark owns an end. */
function isInlineEdit(step: ReplaceStep, doc: ProseMirrorNode): boolean {
  const $from = doc.resolve(step.from)
  const $to = doc.resolve(step.to)
  if (!$from.parent.isTextblock || !$from.sameParent($to) || step.slice.openStart || step.slice.openEnd) return false
  let inline = true
  step.slice.content.forEach((node) => { if (!node.isInline) inline = false })
  return inline
}

/** A join keeps all properties belonging to the paragraph mark that survives. */
export function sectionEndsPlugin(): Plugin {
  return new Plugin({
    appendTransaction: (transactions, oldState, state) => {
      if (!transactions.some((tr) => tr.docChanged) || transactions.some((tr) => tr.getMeta(ySyncPluginKey))) return null
      const mapping = new Mapping()
      for (const tr of transactions) mapping.appendMapping(tr.mapping)
      const ends = new Map<number, ProseMirrorNode['attrs']>()
      const explicit = new Map<number, Set<string>>()
      let index = 0
      for (const tr of transactions) {
        for (const [stepIndex, step] of tr.steps.entries()) {
          const doc = tr.docs[stepIndex]!
          const before = index++
          // Explicit mark edits (including empty paragraphs) take precedence over ownership repair.
          if (step instanceof ReplaceAroundStep && step.gapFrom === step.from + 1 && step.gapTo === step.to - 1
            && step.insert === 1 && step.slice.size === 2) {
            const old = doc.nodeAt(step.from)
            const next = step.slice.content.firstChild
            if (old?.type.name === 'paragraph' && next?.type === old.type) {
              const pos = mapping.slice(before).map(step.to - 1)
              for (const key of ['sectPr', 'markRPr']) if (old.attrs[key] !== next.attrs[key]) {
                if (!explicit.has(pos)) explicit.set(pos, new Set())
                explicit.get(pos)!.add(key)
              }
            }
            continue
          }
          if (step instanceof ReplaceStep && isInlineEdit(step, doc)) continue
          const original = new Mapping(mapping.maps.slice(0, before)).invert()
          step.getMap().forEach((oldStart, oldEnd) => {
            // Include the paragraphs at both edges: a join can transfer an end beyond the deleted range.
            doc.nodesBetween(Math.max(0, oldStart - 1), Math.min(doc.content.size, oldEnd + 1), (node, pos) => {
              if (node.type.name !== 'paragraph') return true
              const oldEnd = original.mapResult(pos + node.nodeSize - 1)
              if (oldEnd.deleted) return false
              const $oldEnd = oldState.doc.resolve(oldEnd.pos)
              if ($oldEnd.parent.type.name !== 'paragraph' || $oldEnd.parentOffset !== $oldEnd.parent.content.size) return false
              const end = mapping.mapResult(oldEnd.pos)
              if (!end.deleted && !ends.has(end.pos)) ends.set(end.pos, $oldEnd.parent.attrs)
              return false
            })
          })
        }
      }
      if (!ends.size) return null
      const out = state.tr
      for (const [pos, attrs] of ends) {
        const $end = out.doc.resolve(pos)
        if ($end.parent.type.name !== 'paragraph' || $end.parentOffset !== $end.parent.content.size) continue
        const sectPr = explicit.get(pos)?.has('sectPr') ? $end.parent.attrs.sectPr : attrs.sectPr
        const markRPr = explicit.get(pos)?.has('markRPr') ? $end.parent.attrs.markRPr : attrs.markRPr
        if ($end.parent.attrs.sectPr !== sectPr || $end.parent.attrs.markRPr !== markRPr) {
          out.setNodeMarkup($end.before(), undefined, { ...$end.parent.attrs, sectPr, markRPr })
        }
      }
      return out.docChanged ? out : null
    },
  })
}
