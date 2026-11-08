import type { Mark } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { EditResult, MapEdit } from './commands.js'

/**
 * Word's AutoFormat As You Type: list markers typed at the start of a paragraph start lists,
 * straight quotes become curly, double hyphens become dashes, and web and email addresses become
 * links. Each change is its own undo step after the typing that triggered it, so Ctrl+Z (or
 * Backspace right after a list starts) gives the literal text back. Nothing converts while an
 * input method is composing.
 */

export interface AutoformatOptions {
  /** `1. `, `a) `, `i. `, `- `, `* ` at the start of a paragraph start a list. */
  lists?: boolean
  /** Straight quotes become curly ones. */
  quotes?: boolean
  /** `--` between words becomes an em dash, ` - ` or ` -- ` between words an en dash. */
  dashes?: boolean
  /** Web and email addresses become links when a space or Enter follows them. */
  links?: boolean
}

export function autoformatSettings(value: boolean | AutoformatOptions | undefined): Required<AutoformatOptions> {
  if (value === false) return { lists: false, quotes: false, dashes: false, links: false }
  const options = typeof value === 'object' ? value : {}
  return { lists: options.lists !== false, quotes: options.quotes !== false, dashes: options.dashes !== false, links: options.links !== false }
}

export type ListMarker =
  | { kind: 'bullet' }
  | { kind: 'decimal'; format: 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman'; start: number; suffix: '.' | ')' }

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }

function romanValue(text: string): number | undefined {
  const lower = text.toLowerCase()
  let total = 0
  for (let index = 0; index < lower.length; index++) {
    const value = ROMAN[lower[index]!]
    const next = ROMAN[lower[index + 1] ?? '']
    if (!value) return undefined
    total += next && next > value ? -value : value
  }
  // Only canonical numerals (so `ic` or `iiii` stay text).
  const canonical = (value: number) => {
    const table: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
    let out = ''
    for (const [amount, digits] of table) while (value >= amount) { out += digits; value -= amount }
    return out
  }
  return total > 0 && canonical(total) === lower ? total : undefined
}

/** The list a paragraph's text before the typed space asks for, if it is a list marker. */
export function listMarker(text: string): ListMarker | null {
  if (/^[-*•]$/.test(text)) return { kind: 'bullet' }
  const match = /^([0-9]{1,3}|[a-zA-Z]|[ivxlcdm]{1,6}|[IVXLCDM]{1,6})([.)])$/.exec(text)
  if (!match) return null
  const [, label, suffix] = match as unknown as [string, string, '.' | ')']
  if (/^\d+$/.test(label)) {
    const start = Number(label)
    return start >= 1 ? { kind: 'decimal', format: 'decimal', start, suffix } : null
  }
  // `i.` and `I.` are roman numerals, as Word reads them; other single letters are letters.
  const roman = label.length > 1 || /^[iI]$/.test(label) ? romanValue(label) : undefined
  if (roman !== undefined) return { kind: 'decimal', format: label === label.toLowerCase() ? 'lowerRoman' : 'upperRoman', start: roman, suffix }
  if (label.length === 1) {
    const lower = label === label.toLowerCase()
    return { kind: 'decimal', format: lower ? 'lowerLetter' : 'upperLetter', start: label.toLowerCase().charCodeAt(0) - 96, suffix }
  }
  return null
}

/** The curly quote for a straight one typed after `before` (the previous character, or '' at a paragraph start). */
export function curlyQuote(quote: '"' | "'", before: string): string {
  const opening = before === '' || /[\s([{<—–“‘«￼-]/u.test(before)
  if (quote === '"') return opening ? '“' : '”'
  return opening ? '‘' : '’'
}

/** A dash to put in for hyphens the text before a typed space ends with, by offset. */
export function dashBefore(text: string): { from: number; to: number; dash: string } | null {
  const em = /[^\s-](--)[\p{L}\p{N}]+$/u.exec(text)
  if (em) return { from: em.index + 1, to: em.index + 3, dash: '—' }
  const en = /[^\s-] (--?) [\p{L}\p{N}]+$/u.exec(text)
  if (en) return { from: en.index + 2, to: en.index + 2 + en[1]!.length, dash: '–' }
  return null
}

/** A web or email address the text before a typed space or Enter ends with, by offset. */
export function addressBefore(text: string): { from: number; to: number; href: string } | null {
  const match = /(?:^|[\s([{<"'“‘])((?:https?:\/\/|www\.|mailto:)[^\s￼<>"“”]+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)$/u.exec(text)
  if (!match) return null
  let address = match[1]!
  // Trailing punctuation ends the sentence, not the address (a closing parenthesis only when unmatched).
  for (;;) {
    const last = address.at(-1) ?? ''
    if (/[.,;:!?'"”’\]}]/.test(last) || (last === ')' && (address.match(/\(/g)?.length ?? 0) < (address.match(/\)/g)?.length ?? 0))) address = address.slice(0, -1)
    else break
  }
  let href: string
  if (/^https?:\/\//i.test(address)) {
    if (!/^https?:\/\/[^\s/?#]+/i.test(address) || /^https?:\/\/$/i.test(address)) return null
    href = address
  } else if (/^www\./i.test(address)) {
    if (!/^www\.[^.\s]+\.[^.\s]/i.test(address)) return null
    href = `https://${address}`
  } else if (/^mailto:/i.test(address)) {
    if (!/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+/i.test(address)) return null
    href = address
  } else {
    href = `mailto:${address}`
  }
  const from = text.length - match[1]!.length
  return { from, to: from + address.length, href }
}

export interface AutoformatHost {
  options(): Required<AutoformatOptions>
  suggesting(): boolean
  /** The list conversion of the paragraph at the cursor, deleting the marker in [from, to). */
  list(state: EditorState, marker: ListMarker, from: number, to: number): EditResult | null
  /** Link marks for an address (the link and the Hyperlink style). */
  linkMarks(state: EditorState, href: string): Mark[]
  /** Dispatches an autoformat change (with its map edits) as an undo step of its own. */
  apply(view: EditorView, tr: Transaction, maps?: MapEdit[]): void
  undo(): boolean
}

const key = new PluginKey<Undoable | null>('docx-autoformat')

/** Text of the paragraph before a position, atoms as U+FFFC, so offsets are positions. */
function textBefore(state: EditorState, pos: number): { text: string; start: number } | null {
  const $pos = state.doc.resolve(pos)
  if ($pos.parent.type.name !== 'paragraph') return null
  return { text: $pos.parent.textBetween(0, $pos.parentOffset, undefined, '￼'), start: $pos.start() }
}

function linkable(state: EditorState, from: number, to: number): boolean {
  let ok = true
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isInline && node.marks.some((mark) => ['link', 'fldSimple', 'del', 'moveFrom'].includes(mark.type.name))) ok = false
    return ok
  })
  return ok
}

/** Links the address before `pos`, if any; true when it did. */
function linkAddress(view: EditorView, host: AutoformatHost, pos: number): boolean {
  if (!host.options().links || host.suggesting()) return false
  const state = view.state
  const before = textBefore(state, pos)
  const address = before && addressBefore(before.text)
  if (!before || !address) return false
  const from = before.start + address.from
  const to = before.start + address.to
  if (!linkable(state, from, to)) return false
  const tr = state.tr
  for (const mark of host.linkMarks(state, address.href)) tr.addMark(from, to, mark)
  // Text typed after the address (the paragraph Enter makes next) keeps the formatting it had,
  // without the Hyperlink style, as in Word: the style mark is inclusive, the link mark is not.
  if (state.selection.empty && state.selection.from === to) tr.setStoredMarks(state.storedMarks ?? state.selection.$from.marks())
  host.apply(view, tr.setMeta(key, { caret: state.selection.from, list: false }))
  return true
}

/** The last change was an autoformat: where the cursor goes when it is undone, and whether Backspace undoes it. */
interface Undoable { caret: number; list: boolean }

/** Undoes the autoformat just made, with the cursor after the text it gives back (as the typing left it). */
function revert(view: EditorView, undo: () => boolean, undoable: Undoable): boolean {
  if (!undo()) return false
  const { doc } = view.state
  view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(Math.min(undoable.caret, doc.content.size)))))
  return true
}

/** Keeps an autoformat's undo record on the transaction that tracks it as a suggestion. */
export function carryAutoformat(from: Transaction, to: Transaction): void {
  const made = from.getMeta(key) as Undoable | undefined
  if (made) to.setMeta(key, made)
}

/**
 * Undo right after an autoformat (Ctrl+Z, a toolbar's Undo): `undo` takes the change back, and the
 * cursor goes after the literal text. False when the last change was not an autoformat.
 */
export function undoAutoformat(view: EditorView, undo: () => boolean): boolean {
  const undoable = key.getState(view.state)
  return undoable ? revert(view, undo, undoable) : false
}

export function autoformatPlugin(host: AutoformatHost): Plugin {
  return new Plugin<Undoable | null>({
    key,
    state: {
      init: () => null,
      // Only right after an autoformat: any other change or move ends it. (Sync redraws the
      // same content and selection after map edits; those keep it.)
      apply: (tr, undoable, before, after) => {
        const made = tr.getMeta(key) as Undoable | undefined
        if (made) return made
        return undoable && (!tr.docChanged || after.doc.eq(before.doc)) && after.selection.eq(before.selection) ? undoable : null
      },
    },
    props: {
      handleTextInput(view, from, to, text, deflt) {
        if (view.composing || !view.editable) return false
        // A space over a selection replaces it; a quote typed over one is still curled.
        if (text === ' ' ? from !== to : text !== '"' && text !== "'") return false
        const options = host.options()
        const state = view.state
        const before = textBefore(state, from)
        if (!before) return false
        const typed = () => (deflt ? deflt() : state.tr.insertText(text, from, to))
        if (text === ' ') {
          const marker = options.lists && !host.suggesting() ? listMarker(before.text) : null
          const list = marker ? host.list(state, marker, before.start, from) : null
          if (list || (options.links && !host.suggesting() && addressBefore(before.text)) || (options.dashes && dashBefore(before.text))) {
            view.dispatch(typed())
            if (list) {
              const converted = host.list(view.state, marker!, before.start, from + 1)
              if (converted) {
                host.apply(view, converted.tr.setMeta(key, { caret: from + 1, list: true }), converted.maps)
                return true
              }
            }
            if (linkAddress(view, host, from)) return true
            const dash = options.dashes ? dashBefore(before.text) : null
            if (dash) {
              const current = view.state
              const start = before.start + dash.from
              const tr = current.tr.replaceWith(start, before.start + dash.to, current.schema.text(dash.dash, current.doc.nodeAt(start)?.marks))
              host.apply(view, tr.setMeta(key, { caret: from + 1, list: false }))
            }
            return true
          }
          return false
        }
        if (!options.quotes) return false
        const curly = curlyQuote(text as '"' | "'", before.text.at(-1) ?? '')
        view.dispatch(typed())
        // The quote is just before the cursor: a suggestion keeps the text it replaces in front of it.
        const current = view.state
        const at = current.selection.from - 1
        if (!current.selection.empty || at < 0 || current.doc.textBetween(at, at + 1) !== text) return true
        const tr = current.tr.replaceWith(at, at + 1, current.schema.text(curly, current.doc.nodeAt(at)?.marks))
        host.apply(view, tr.setMeta(key, { caret: at + 1, list: false }))
        return true
      },
      handleKeyDown(view, event) {
        if (view.composing || !view.editable || event.ctrlKey || event.metaKey || event.altKey) return false
        const undoable = key.getState(view.state)
        // Backspace right after a list starts gives the typed marker back, as in Word.
        if (undoable?.list && event.key === 'Backspace' && !event.shiftKey && view.state.selection.empty) return revert(view, host.undo, undoable)
        // An address typed last becomes a link before Enter splits the paragraph; Enter still runs.
        if (event.key === 'Enter' && view.state.selection.empty) linkAddress(view, host, view.state.selection.from)
        return false
      },
    },
  })
}
