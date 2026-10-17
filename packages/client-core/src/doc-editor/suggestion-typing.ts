import { Extension } from '@tiptap/core'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { parseBlockSuggestion, SUGGESTION_BLOCK_ATTR, SUGGESTION_DELETE_MARK } from '../doc-schema/suggestions.js'

/** Set on transactions that accept or reject suggestions, which this plugin leaves alone. */
export const SUGGESTION_REVIEW_META = 'pulpoSuggestionReview'

/**
 * What the local user types or pastes is their own, never part of a suggested deletion that
 * accepting would delete:
 * - inserted text loses the deletion mark it would inherit from the text around it;
 * - a block suggested for deletion that the user writes in (or any block holding it) is kept:
 *   its deletion suggestion is dropped.
 * Remote and undo changes arrive through the sync plugin and, like reviews, are left alone.
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
          if (!tr.docChanged || isChangeOrigin(tr) || tr.getMeta(SUGGESTION_REVIEW_META)) continue
          tr.mapping.maps.forEach((map, index) => {
            const after = tr.mapping.slice(index + 1)
            map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
              if (newEnd > newStart) inserted.push([after.map(newStart, -1), after.map(newEnd, 1)])
            })
          })
        }
        const fix = state.tr
        const kept = new Set<number>()
        for (const [from, to] of inserted) {
          if (to <= from) continue
          if (state.doc.rangeHasMark(from, to, mark)) fix.removeMark(from, to, mark)
          const $from = state.doc.resolve(from)
          for (let depth = 1; depth <= $from.depth; depth += 1) {
            if (parseBlockSuggestion($from.node(depth).attrs[SUGGESTION_BLOCK_ATTR])?.kind === 'delete') kept.add($from.before(depth))
          }
        }
        // Neither step moves positions, so they can all use positions in `state`.
        for (const pos of kept) fix.setNodeAttribute(pos, SUGGESTION_BLOCK_ATTR, null)
        return fix.docChanged ? fix : null
      },
    })]
  },
})
