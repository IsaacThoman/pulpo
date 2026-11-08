import { EditorSelection, type EditorState, type StateCommand, type TransactionSpec } from '@codemirror/state'
import type { KeyBinding } from '@codemirror/view'

/**
 * Markdown formatting keys for Markdown cells, as VS Code's Markdown editing and GitHub's comment
 * box have them: Ctrl/Cmd+B wraps the selection in `**`, Ctrl/Cmd+I in `*`, and Ctrl/Cmd+K makes
 * it a link. Bold and italic toggle: pressed again on wrapped text (selected with or without its
 * markers), they take the markers off. Each press is one edit, so one undo step.
 */

export type MarkdownMarker = '**' | '*'

/** How many `*` run up to (`side` 'before') or from (`side` 'after') a position, at most 3. */
function stars(text: string, side: 'before' | 'after'): number {
  let count = 0
  while (count < 3) {
    const char = side === 'before' ? text[text.length - 1 - count] : text[count]
    if (char !== '*') break
    count += 1
  }
  return count
}

/** Whether runs of `before` and `after` stars carry this marker: `**` needs two, `*` an odd run (`*` or `***`). */
function carries(marker: MarkdownMarker, before: number, after: number): boolean {
  return marker === '**' ? before >= 2 && after >= 2 : before % 2 === 1 && after % 2 === 1
}

/** The transaction that toggles `marker` around each selected range, or null in a read-only state. */
export function toggleMarkdownMarkerSpec(state: EditorState, marker: MarkdownMarker): TransactionSpec | null {
  if (state.readOnly) return null
  const size = marker.length
  return state.changeByRange((range) => {
    const { from, to } = range
    const text = state.sliceDoc(from, to)
    // The markers just outside the selection: `**|bold|**`.
    const outside = carries(marker, stars(state.sliceDoc(Math.max(0, from - 3), from), 'before'), stars(state.sliceDoc(to, to + 3), 'after'))
    if (outside) {
      return {
        changes: [{ from: from - size, to: from }, { from: to, to: to + size }],
        range: EditorSelection.range(from - size, to - size),
      }
    }
    // The selection takes in its markers: `|**bold**|`.
    if (text.length >= size * 2 && carries(marker, stars(text.slice(0, 3), 'after'), stars(text.slice(-3), 'before'))) {
      return {
        changes: [{ from, to: from + size }, { from: to - size, to }],
        range: EditorSelection.range(from, to - size * 2),
      }
    }
    return {
      changes: [{ from, insert: marker }, { from: to, insert: marker }],
      range: EditorSelection.range(from + size, to + size),
    }
  })
}

/**
 * The transaction that makes each selected range a link: `[text](url)` with `url` selected, ready
 * to type over; with nothing selected, `[](url)` with the caret between the brackets.
 */
export function insertMarkdownLinkSpec(state: EditorState): TransactionSpec | null {
  if (state.readOnly) return null
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    const insert = `[${text}](url)`
    if (!text) return { changes: { from: range.from, insert }, range: EditorSelection.cursor(range.from + 1) }
    const url = range.from + text.length + 3
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(url, url + 3) }
  })
}

const command = (spec: (state: EditorState) => TransactionSpec | null): StateCommand => ({ state, dispatch }) => {
  const transaction = spec(state)
  if (!transaction) return false
  dispatch(state.update(transaction, { scrollIntoView: true, userEvent: 'input.format' }))
  return true
}

export const toggleMarkdownBold: StateCommand = command((state) => toggleMarkdownMarkerSpec(state, '**'))
export const toggleMarkdownItalic: StateCommand = command((state) => toggleMarkdownMarkerSpec(state, '*'))
export const insertMarkdownLink: StateCommand = command(insertMarkdownLinkSpec)

/**
 * Ctrl/Cmd+B, I, and K in a Markdown cell. A key that formats is taken (its default prevented),
 * so the app's own Ctrl/Cmd+B (the sidebar) does not also run; in a read-only cell it is left alone.
 */
export const markdownFormatKeymap: readonly KeyBinding[] = [
  { key: 'Mod-b', run: toggleMarkdownBold },
  { key: 'Mod-i', run: toggleMarkdownItalic },
  { key: 'Mod-k', run: insertMarkdownLink },
]
