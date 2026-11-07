/// <reference lib="dom" />
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, highlightSpecialChars, keymap, placeholder as placeholderText } from '@codemirror/view'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { editorHighlight, editorTheme, selectionColor } from '../../text/view/editor.js'
import { languageOf } from '../../text/view/languages.js'
import type { NotebookCellType } from '../layout.js'

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
  /** Soft-wrap lines; Markdown and raw cells wrap, code cells scroll. */
  wrap?: boolean
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
  destroy(): void
}

const cellTheme = EditorView.theme({
  '&': { height: 'auto', backgroundColor: 'transparent' },
  '.cm-scroller': { overflow: 'auto hidden' },
  '.cm-content': { padding: '6px 0' },
  '.cm-line': { padding: '0 10px' },
  '&.cm-focused': { outline: 'none' },
})

function readOnlyExtensions(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]
}

export function createCellEditor(options: CellEditorOptions): CellEditor {
  const language = new Compartment()
  const readOnly = new Compartment()
  const darkMode = new Compartment()
  const wrapping = new Compartment()
  let destroyed = false
  let request = 0
  let current = { readOnly: options.readOnly }

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
        // Notebook keys come first, so Shift+Enter never inserts a line.
        Prec.highest(keymap.of([
          { key: 'Shift-Enter', run: run(options.onShiftEnter) },
          { key: 'Mod-Enter', run: run(options.onModEnter) },
          { key: 'Alt-Enter', run: run(options.onAltEnter) },
          { key: 'Escape', run: run(options.onEscape) },
          { key: 'Mod-Shift--', run: run(options.onSplit) },
          { key: 'ArrowUp', run: leave('up') },
          { key: 'ArrowDown', run: leave('down') },
        ])),
        // Undo and redo go to the notebook's shared undo manager (this session's edits only).
        keymap.of([...closeBracketsKeymap, ...yUndoManagerKeymap, ...searchKeymap, indentWithTab, ...defaultKeymap]),
        yCollab(options.text, options.awareness, { undoManager: options.undoManager }),
        editorTheme,
        cellTheme,
        language.of([]),
        readOnly.of(readOnlyExtensions(options.readOnly)),
        darkMode.of(EditorView.darkTheme.of(options.dark ?? false)),
        wrapping.of(options.wrap ?? options.type !== 'code' ? EditorView.lineWrapping : []),
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
      current = { readOnly: next }
      view.dispatch({ effects: readOnly.reconfigure(readOnlyExtensions(next)) })
    },
    setDark(next) {
      view.dispatch({ effects: darkMode.reconfigure(EditorView.darkTheme.of(next)) })
    },
    setType(type, kernel) {
      view.dispatch({ effects: wrapping.reconfigure(type !== 'code' ? EditorView.lineWrapping : []) })
      loadLanguage(type, kernel)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      view.destroy()
    },
  }
}

export { selectionColor }
