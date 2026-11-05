import { Plugin } from '@tiptap/pm/state'
import { Mapping } from '@tiptap/pm/transform'
import { ySyncPluginKey } from '@tiptap/y-tiptap'

/** A join keeps the section end belonging to the paragraph mark that survives. */
export function sectionEndsPlugin(): Plugin {
  return new Plugin({
    appendTransaction: (transactions, oldState, state) => {
      if (!transactions.some((tr) => tr.docChanged) || transactions.some((tr) => tr.getMeta(ySyncPluginKey))) return null
      const mapping = new Mapping()
      for (const tr of transactions) mapping.appendMapping(tr.mapping)
      const out = state.tr
      oldState.doc.descendants((node, pos) => {
        if (node.type.name !== 'paragraph') return true
        const end = mapping.mapResult(pos + node.nodeSize - 1)
        if (end.deleted) return false
        const $end = out.doc.resolve(end.pos)
        if ($end.parent.type.name === 'paragraph' && $end.parentOffset === $end.parent.content.size && $end.parent.attrs.sectPr !== node.attrs.sectPr) {
          out.setNodeMarkup($end.before(), undefined, { ...$end.parent.attrs, sectPr: node.attrs.sectPr })
        }
        return false
      })
      return out.docChanged ? out : null
    },
  })
}
