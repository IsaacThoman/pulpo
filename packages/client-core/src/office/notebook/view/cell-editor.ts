/// <reference lib="dom" />
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers as lineNumberGutter,
  placeholder as placeholderText,
  type DecorationSet,
  type KeyBinding,
} from '@codemirror/view'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { editorHighlight, editorTheme, gotoLineColumn, openReplacePanel, selectionColor } from '../../text/view/editor.js'
import { languageOf } from '../../text/view/languages.js'
import type { NotebookCellType } from '../layout.js'
import { markdownFormatKeymap } from './markdown-format.js'

/**
 * One notebook cell's source in CodeMirror, bound to the cell's Y.Text with other sessions'
 * cursors. Every cell of a notebook shares one undo manager (see the controller), so undo steps
 * through this session's edits across cells and structure in order.
 */

/** File names that pick each kernel language's highlighting (by the text editor's extension table). */
const LANGUAGE_FILES: Record<string, string> = {
  python: 'x.py', python3: 'x.py', ipython: 'x.py', r: 'x.r', julia: 'x.jl', javascript: 'x.js', typescript: 'x.ts',
  scala: 'x.scala', java: 'x.java', kotlin: 'x.kt', 'c++': 'x.cpp', cpp: 'x.cpp', c: 'x.c', 'c#': 'x.cs', csharp: 'x.cs',
  'f#': 'x.fs', fsharp: 'x.fs', ruby: 'x.rb', rust: 'x.rs', go: 'x.go', sql: 'x.sql', bash: 'x.sh', sh: 'x.sh', shell: 'x.sh',
  haskell: 'x.hs', lua: 'x.lua', perl: 'x.pl', php: 'x.php', swift: 'x.swift', groovy: 'x.groovy', clojure: 'x.clj', erlang: 'x.erl',
  powershell: 'x.ps1', dart: 'x.dart', elixir: 'x.ex',
}

/** The file name whose highlighting a cell of `type` uses, in a notebook of `language`. */
export function cellLanguageFile(type: NotebookCellType, language: string): string | null {
  if (type === 'markdown') return 'x.md'
  if (type === 'raw') return null
  return LANGUAGE_FILES[language.toLowerCase()] ?? null
}

export interface CellEditorKeys {
  /** Shift+Enter: Jupyter's run and advance, which here moves to the next cell. */
  onShiftEnter?: () => void
  /** Ctrl/Cmd+Enter: run in place (leaves edit mode). */
  onModEnter?: () => void
  /** Alt+Enter: insert a cell below. */
  onAltEnter?: () => void
  /** Escape: command mode. */
  onEscape?: () => void
  /** Ctrl/Cmd+Shift+Minus: split the cell at the cursor. */
  onSplit?: () => void
  /** ArrowUp on the first line, or ArrowDown on the last: move to the neighbouring cell. */
  onLeave?: (direction: 'up' | 'down') => void
  /**
   * The notebook's own find: Ctrl/Cmd+F, the replace keys (Ctrl+H; Cmd+Option+F and Cmd+Shift+H
   * on a Mac), and find next or previous (F3, Ctrl/Cmd+G). Without it, the cell's search panel opens.
   */
  onFind?: (command: 'find' | 'replace' | 'next' | 'previous') => void
  /** Sees every key first (Colab's Ctrl+M chords); returning true consumes it. */
  onKeyDown?: (event: KeyboardEvent) => boolean
}

export interface CellEditorOptions extends CellEditorKeys {
  container: HTMLElement
  text: Y.Text
  awareness: Awareness
  undoManager: Y.UndoManager
  type: NotebookCellType
  /** The kernel's language (`python`). */
  language: string
  readOnly: boolean
  dark?: boolean
  /** CodeMirror phrases, translated (search panel and the like). */
  labels?: Record<string, string>
  /** The editor's accessible name. */
  label?: string
  placeholder?: string
  /** Soft-wrap lines; when unset (or null), Markdown and raw cells wrap and code cells scroll. */
  wrap?: boolean | null
  /** A line-number gutter. */
  lineNumbers?: boolean
  onFocus?: () => void
  onBlur?: () => void
  onSelection?: () => void
}

export interface CellEditor {
  readonly view: EditorView
  focus(at?: 'start' | 'end' | 'keep'): void
  /** The cursor's offset in the source. */
  cursor(): number
  setReadOnly(readOnly: boolean): void
  setDark(dark: boolean): void
  setType(type: NotebookCellType, language: string): void
  /** Wraps lines, or not; null goes back to wrapping by cell type. */
  setWrap(wrap: boolean | null): void
  setLineNumbers(on: boolean): void
  /** Marks find matches (offsets in the source); `current` is the index of the current one, or -1. */
  setSearchMatches(matches: readonly { from: number; to: number }[], current: number): void
  /** Selects a range and scrolls it into view, without taking focus (a find match). */
  select(from: number, to: number): void
  destroy(): void
}

const cellTheme = EditorView.theme({
  '&': { height: 'auto', backgroundColor: 'transparent' },
  '.cm-scroller': { overflow: 'auto hidden' },
  '.cm-content': { padding: '6px 0' },
  '.cm-line': { padding: '0 10px' },
  '&.cm-focused': { outline: 'none' },
  // Line numbers sit on the cell's own background, as in JupyterLab.
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--muted-foreground, #6b7280)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 2px 0 8px', minWidth: '24px', opacity: '0.7' },
})

/** The notebook-wide find's matches in this cell, as marks that follow edits until the next search. */
const setMatches = StateEffect.define<{ ranges: readonly { from: number; to: number }[]; current: number }>()
const matchMark = Decoration.mark({ class: 'cm-searchMatch' })
const currentMatchMark = Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-selected' })
const searchMatches = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    let next = marks.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (!effect.is(setMatches)) continue
      const length = transaction.state.doc.length
      next = Decoration.set(effect.value.ranges.flatMap((range, index) => (
        range.from < range.to && range.to <= length ? [(index === effect.value.current ? currentMatchMark : matchMark).range(range.from, range.to)] : []
      )), true)
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

function readOnlyExtensions(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]
}

export function createCellEditor(options: CellEditorOptions): CellEditor {
  const language = new Compartment()
  const readOnly = new Compartment()
  const darkMode = new Compartment()
  const wrapping = new Compartment()
  const gutter = new Compartment()
  const formatting = new Compartment()
  let destroyed = false
  let request = 0
  let current = { readOnly: options.readOnly, type: options.type, wrap: options.wrap ?? null }
  const wraps = () => (current.wrap ?? current.type !== 'code') ? EditorView.lineWrapping : []
  // Ctrl/Cmd+B, I, and K format Markdown cells (before CodeMirror's own Mod+I, select the syntax node).
  const formatKeys = () => current.type === 'markdown' ? Prec.highest(keymap.of(markdownFormatKeymap)) : []

  const atEdge = (view: EditorView, direction: 'up' | 'down') => {
    const { main } = view.state.selection
    if (!main.empty) return false
    const line = view.state.doc.lineAt(main.head)
    return direction === 'up' ? line.number === 1 : line.number === view.state.doc.lines
  }
  const leave = (direction: 'up' | 'down') => (view: EditorView) => {
    if (!options.onLeave || !atEdge(view, direction)) return false
    // Visually wrapped lines move within the line first.
    const moved = view.moveVertically(view.state.selection.main, direction === 'down')
    if (moved.head !== view.state.selection.main.head && view.state.doc.lineAt(moved.head).number === view.state.doc.lineAt(view.state.selection.main.head).number) return false
    options.onLeave(direction)
    return true
  }
  const run = (callback: (() => void) | undefined) => () => {
    if (!callback) return false
    callback()
    return true
  }
  const find = (command: 'find' | 'replace' | 'next' | 'previous') => () => {
    options.onFind!(command)
    return true
  }
  // The host's notebook-wide find replaces the cell's own panel (which only searches this cell).
  const findKeys: KeyBinding[] = options.onFind
    ? [
      { key: 'Mod-f', run: find('find'), preventDefault: true },
      { key: 'Mod-h', mac: 'Mod-Alt-f', run: find('replace'), preventDefault: true },
      { mac: 'Mod-Shift-h', run: find('replace'), preventDefault: true },
      { key: 'F3', run: find('next'), shift: find('previous'), preventDefault: true },
      { key: 'Mod-g', run: find('next'), shift: find('previous'), preventDefault: true },
    ]
    : [
      { key: 'Mod-h', mac: 'Mod-Alt-f', run: openReplacePanel, preventDefault: true },
      { mac: 'Mod-Shift-h', run: openReplacePanel, preventDefault: true },
    ]

  const view = new EditorView({
    parent: options.container,
    state: EditorState.create({
      doc: options.text.toString(),
      extensions: [
        // yCollab uses LF-based offsets and serialization. Split only on LF so a stored
        // CR stays a literal character instead of being silently dropped or rewritten.
        EditorState.lineSeparator.of('\n'),
        highlightSpecialChars(),
        drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(editorHighlight),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        indentUnit.of('    '),
        EditorState.tabSize.of(4),
        // Keys the host wants before anything else (Ctrl+M starts a chord instead of CodeMirror's tab focus mode).
        Prec.highest(EditorView.domEventHandlers({
          keydown(event) {
            if (event.isComposing || !options.onKeyDown?.(event)) return false
            event.preventDefault()
            return true
          },
        })),
        // Notebook keys come first, so Shift+Enter never inserts a line.
        Prec.highest(keymap.of([
          ...findKeys,
          { key: 'Shift-Enter', run: run(options.onShiftEnter) },
          { key: 'Mod-Enter', run: run(options.onModEnter) },
          { key: 'Alt-Enter', run: run(options.onAltEnter) },
          { key: 'Escape', run: run(options.onEscape) },
          { key: 'Mod-Shift--', run: run(options.onSplit) },
          { key: 'ArrowUp', run: leave('up') },
          { key: 'ArrowDown', run: leave('down') },
        ])),
        // Undo and redo go to the notebook's shared undo manager (this session's edits only).
        keymap.of([...closeBracketsKeymap, ...yUndoManagerKeymap, { key: 'Mod-Alt-g', run: gotoLineColumn, preventDefault: true }, ...searchKeymap, indentWithTab, ...defaultKeymap]),
        yCollab(options.text, options.awareness, { undoManager: options.undoManager }),
        editorTheme,
        cellTheme,
        language.of([]),
        readOnly.of(readOnlyExtensions(options.readOnly)),
        darkMode.of(EditorView.darkTheme.of(options.dark ?? false)),
        wrapping.of(wraps()),
        gutter.of(options.lineNumbers ? lineNumberGutter() : []),
        formatting.of(formatKeys()),
        searchMatches,
        EditorState.phrases.of(options.labels ?? {}),
        ...options.placeholder ? [placeholderText(options.placeholder)] : [],
        EditorView.contentAttributes.of({ 'aria-label': options.label ?? 'Cell', spellcheck: options.type === 'code' ? 'false' : 'true', autocapitalize: 'off', autocorrect: 'off' }),
        EditorView.domEventHandlers({
          focus: () => { options.onFocus?.() },
          blur: () => { options.onBlur?.() },
        }),
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) options.onSelection?.()
        }),
      ],
    }),
  })

  const loadLanguage = (type: NotebookCellType, kernel: string) => {
    const file = cellLanguageFile(type, kernel)
    const found = file ? languageOf(file) : null
    const ticket = ++request
    if (!found) {
      view.dispatch({ effects: language.reconfigure([]) })
      return
    }
    void found.load().then((support) => {
      if (!destroyed && ticket === request) view.dispatch({ effects: language.reconfigure(support) })
    }).catch(() => {
      // Plain text is still fully editable.
    })
  }
  loadLanguage(options.type, options.language)

  return {
    view,
    focus(at = 'keep') {
      if (at !== 'keep') {
        const position = at === 'start' ? 0 : view.state.doc.length
        view.dispatch({ selection: { anchor: position }, scrollIntoView: true })
      }
      view.focus()
    },
    cursor: () => view.state.selection.main.head,
    setReadOnly(next) {
      if (next === current.readOnly) return
      current = { ...current, readOnly: next }
      view.dispatch({ effects: readOnly.reconfigure(readOnlyExtensions(next)) })
    },
    setDark(next) {
      view.dispatch({ effects: darkMode.reconfigure(EditorView.darkTheme.of(next)) })
    },
    setType(type, kernel) {
      current = { ...current, type }
      view.dispatch({ effects: [wrapping.reconfigure(wraps()), formatting.reconfigure(formatKeys())] })
      loadLanguage(type, kernel)
    },
    setWrap(wrap) {
      if (wrap === current.wrap) return
      current = { ...current, wrap }
      view.dispatch({ effects: wrapping.reconfigure(wraps()) })
    },
    setLineNumbers(on) {
      view.dispatch({ effects: gutter.reconfigure(on ? lineNumberGutter() : []) })
    },
    setSearchMatches(matches, currentMatch) {
      view.dispatch({ effects: setMatches.of({ ranges: matches, current: currentMatch }) })
    },
    select(from, to) {
      const length = view.state.doc.length
      const range = EditorSelection.range(Math.min(from, length), Math.min(to, length))
      view.dispatch({ selection: range, effects: EditorView.scrollIntoView(range, { y: 'center' }) })
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      view.destroy()
    },
  }
}

export { selectionColor }
