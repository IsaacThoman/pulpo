import { SUGGESTION_DELETE_MARK } from '@pulpo/client-core/doc-schema'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Extension } from '@tiptap/react'

/**
 * Text typed or pasted inside a suggested deletion would inherit its mark and read as deleted
 * (accepting would then delete it). This drops the mark from content the local user inserts;
 * remote and undo changes arrive through the sync plugin and are left alone.
 */
export const SuggestionTyping = Extension.create({
  name: 'suggestionTyping',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('suggestionTyping'),
      appendTransaction(transactions, _oldState, state) {
        const mark = state.schema.marks[SUGGESTION_DELETE_MARK]
        if (!mark) return null
        let inserted: Array<[number, number]> = []
        for (const tr of transactions) {
          inserted = inserted.map(([from, to]) => [tr.mapping.map(from, -1), tr.mapping.map(to, 1)])
          if (!tr.docChanged || isChangeOrigin(tr)) continue
          tr.mapping.maps.forEach((map, index) => {
            const after = tr.mapping.slice(index + 1)
            map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
              if (newEnd > newStart) inserted.push([after.map(newStart, -1), after.map(newEnd, 1)])
            })
          })
        }
        const fix = state.tr
        for (const [from, to] of inserted) {
          if (to > from && state.doc.rangeHasMark(from, to, mark)) fix.removeMark(from, to, mark)
        }
        return fix.docChanged ? fix : null
      },
    })]
  },
})
