/// <reference lib="dom" />
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, indentLess, indentMore, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { textOf } from '../codec.js'
import { languageOf } from './languages.js'

/**
 * The text and code editor core: CodeMirror 6 bound to a document's Y.Text, with other sessions'
 * cursors from awareness. It knows no framework; the web app wraps it in React with its own
 * toolbar, and the mobile app runs it in a web view.
 *
 * Colors come from CSS variables the host defines (`--background`, `--foreground`, `--muted`,
 * `--muted-foreground`, `--border`, `--accent`, `--ring`), so it matches the app around it.
 */

export interface TextEditorIndent {
  /** Columns a tab shows as, and the indent width with spaces. */
  size: number
  /** Indent with tabs instead of spaces. */
  tabs: boolean
}

export interface TextEditorState {
  canUndo: boolean
  canRedo: boolean
  line: number
  column: number
  /** Characters selected, 0 for a caret. */
  selected: number
  lines: number
  /** The language highlighting the file, or null for plain text. */
  language: string | null
  wrap: boolean
  indent: TextEditorIndent
  readOnly: boolean
  focused: boolean
}

export interface TextEditorOptions {
  container: HTMLElement
  doc: Y.Doc
  awareness: Awareness
  readOnly: boolean
  /** This session's name and caret color, as other sessions see them. */
  user: { name: string; color: string }
  /** The file name, which picks the highlighting. */
  name: string
  /** Visible text the editor renders (search panel, folding), by CodeMirror phrase. */
  labels?: Record<string, string>
  /** Follows the host's color scheme. */
  dark?: boolean
  wrap?: boolean
  /** Defaults to what the file already uses. */
  indent?: TextEditorIndent
  /** Called after anything `state()` reports may have changed. */
  onChange?: (state: TextEditorState) => void
}

export interface TextEditor {
  readonly view: EditorView
  state(): TextEditorState
  setReadOnly(readOnly: boolean): void
  setWrap(wrap: boolean): void
  setIndent(indent: TextEditorIndent): void
  setDark(dark: boolean): void
  /** Follows a rename: the extension decides the highlighting. */
  setName(name: string): void
  undo(): void
  redo(): void
  /** Indents or outdents the selected lines, for keyboards without a Tab key. */
  indent(direction: 'more' | 'less'): void
  openSearch(): void
  focus(): void
  destroy(): void
}

/** How the file indents already: tabs if most indented lines start with one, else the common space width. */
export function detectIndent(text: string): TextEditorIndent {
  let tabs = 0
  let spaced = 0
  const widths = new Map<number, number>()
  let previous = 0
  for (const line of text.split('\n', 2_000)) {
    if (!line.trim()) continue
    if (line.startsWith('\t')) {
      tabs += 1
      continue
    }
    const width = line.length - line.trimStart().length
    if (width) spaced += 1
    // Count the steps between neighbouring lines, which reveal the unit (2 or 4).
    const step = Math.abs(width - previous)
    if (step >= 2 && step <= 8) widths.set(step, (widths.get(step) ?? 0) + 1)
    previous = width
  }
  if (tabs > spaced) return { size: 4, tabs: true }
  let size = 2
  let best = 0
  for (const [width, count] of widths) {
    if (count > best || (count === best && width < size)) {
      size = width
      best = count
    }
  }
  return { size: spaced ? size : 2, tabs: false }
}

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.definitionKeyword, tags.modifier, tags.self], class: 'pulpo-tk-keyword' },
  { tag: [tags.string, tags.special(tags.string), tags.character, tags.attributeValue, tags.docString], class: 'pulpo-tk-string' },
  { tag: [tags.regexp, tags.escape], class: 'pulpo-tk-regexp' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], class: 'pulpo-tk-comment' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.unit, tags.constant(tags.variableName)], class: 'pulpo-tk-number' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.function(tags.variableName)), tags.macroName], class: 'pulpo-tk-function' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.standard(tags.typeName)], class: 'pulpo-tk-type' },
  { tag: [tags.propertyName, tags.attributeName, tags.labelName], class: 'pulpo-tk-property' },
  { tag: [tags.tagName, tags.angleBracket], class: 'pulpo-tk-tag' },
  { tag: [tags.definition(tags.variableName), tags.variableName], class: 'pulpo-tk-variable' },
  { tag: [tags.meta, tags.processingInstruction, tags.annotation], class: 'pulpo-tk-meta' },
  { tag: [tags.heading], class: 'pulpo-tk-heading' },
  { tag: [tags.emphasis], class: 'pulpo-tk-emphasis' },
  { tag: [tags.strong], class: 'pulpo-tk-strong' },
  { tag: [tags.link, tags.url], class: 'pulpo-tk-link' },
  { tag: [tags.inserted], class: 'pulpo-tk-inserted' },
  { tag: [tags.deleted], class: 'pulpo-tk-deleted' },
  { tag: [tags.invalid], class: 'pulpo-tk-invalid' },
])

// GitHub's palettes, which read well on both of the app's backgrounds.
const light = {
  keyword: '#cf222e', string: '#0a3069', regexp: '#116329', comment: '#6e7781', number: '#0550ae', function: '#8250df',
  type: '#953800', property: '#0550ae', tag: '#116329', variable: 'inherit', meta: '#6e7781', link: '#0969da',
  inserted: '#116329', deleted: '#82071e', invalid: '#82071e',
}
const dark = {
  keyword: '#ff7b72', string: '#a5d6ff', regexp: '#7ee787', comment: '#8b949e', number: '#79c0ff', function: '#d2a8ff',
  type: '#ffa657', property: '#79c0ff', tag: '#7ee787', variable: 'inherit', meta: '#8b949e', link: '#58a6ff',
  inserted: '#7ee787', deleted: '#ffa198', invalid: '#ffa198',
}

function palette(prefix: '&light' | '&dark', colors: typeof light): Record<string, { color?: string; fontStyle?: string; fontWeight?: string; textDecoration?: string }> {
  return Object.fromEntries(Object.entries(colors).map(([name, color]) => [`${prefix} .pulpo-tk-${name}`, { color }]))
}

const theme = EditorView.baseTheme({
  '&': {
    height: '100%',
    color: 'var(--foreground, #111)',
    backgroundColor: 'var(--background, #fff)',
    fontSize: 'var(--pulpo-code-font-size, 13px)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--pulpo-code-font, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--foreground, #111)' },
  '.cm-line': { padding: '0 16px 0 8px' },
  '.cm-gutters': {
    backgroundColor: 'var(--background, #fff)',
    color: 'var(--muted-foreground, #6b7280)',
    borderRight: '1px solid var(--border, #e5e7eb)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '32px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--accent, #f3f4f6) 60%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground, #111)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--ring, #3b82f6) 28%, transparent) !important',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground, #111)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklch, var(--ring, #3b82f6) 22%, transparent)',
    outline: '1px solid color-mix(in oklch, var(--ring, #3b82f6) 45%, transparent)',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in oklch, var(--ring, #3b82f6) 14%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklch, #eab308 30%, transparent)', outline: '1px solid color-mix(in oklch, #eab308 60%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklch, #f97316 40%, transparent)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--muted, #f3f4f6)', border: '1px solid var(--border, #e5e7eb)', color: 'var(--muted-foreground, #6b7280)' },
  '.cm-panels': { backgroundColor: 'var(--background, #fff)', color: 'var(--foreground, #111)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border, #e5e7eb)' },
  '.cm-panel.cm-search': { padding: '6px 10px', fontFamily: 'inherit', fontSize: '13px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': { fontSize: '13px', margin: '2px 4px 2px 0' },
  '.cm-textfield': {
    border: '1px solid var(--border, #e5e7eb)', borderRadius: '6px', padding: '2px 6px',
    backgroundColor: 'var(--background, #fff)', color: 'var(--foreground, #111)',
  },
  '.cm-button': {
    border: '1px solid var(--border, #e5e7eb)', borderRadius: '6px', padding: '2px 8px', backgroundImage: 'none',
    backgroundColor: 'var(--background, #fff)', color: 'var(--foreground, #111)', cursor: 'pointer',
  },
  '.cm-button:hover': { backgroundColor: 'var(--accent, #f3f4f6)' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--muted-foreground, #6b7280)', fontSize: '18px', cursor: 'pointer' },
  // Other sessions' cursors, labeled like the document editor's.
  '.cm-ySelectionInfo': {
    fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: '600', padding: '0.05rem 0.35rem', top: '-1.35em',
    borderRadius: '3px 3px 3px 0', opacity: '1', color: 'white', lineHeight: '1.4',
  },
  '.cm-ySelectionCaret': { borderLeftWidth: '1px', borderRightWidth: '1px' },
  '.pulpo-tk-comment': { fontStyle: 'italic' },
  '.pulpo-tk-heading, .pulpo-tk-strong': { fontWeight: '600' },
  '.pulpo-tk-emphasis': { fontStyle: 'italic' },
  '.pulpo-tk-link': { textDecoration: 'underline' },
  ...palette('&light', light),
  ...palette('&dark', dark),
})

function indentExtensions(indent: TextEditorIndent): Extension {
  return [EditorState.tabSize.of(indent.size), indentUnit.of(indent.tabs ? '\t' : ' '.repeat(indent.size))]
}

function readOnlyExtensions(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]
}

/** A lighter tint of a caret color, for other sessions' selections. */
function selectionColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}33` : color
}

export function createTextEditor(options: TextEditorOptions): TextEditor {
  const ytext = textOf(options.doc)
  const undoManager = new Y.UndoManager(ytext)
  const language = new Compartment()
  const readOnly = new Compartment()
  const wrap = new Compartment()
  const indent = new Compartment()
  const darkMode = new Compartment()
  const phrases = new Compartment()
  let current = {
    name: options.name,
    language: null as string | null,
    readOnly: options.readOnly,
    wrap: options.wrap ?? false,
    indent: options.indent ?? detectIndent(ytext.toString()),
    focused: false,
  }
  let destroyed = false
  let loading = 0

  options.awareness.setLocalStateField('user', { name: options.user.name, color: options.user.color, colorLight: selectionColor(options.user.color) })

  const notify = () => {
    if (!destroyed) options.onChange?.(snapshot())
  }

  const view = new EditorView({
    parent: options.container,
    state: EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        highlightSpecialChars(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(highlight),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        keymap.of([...closeBracketsKeymap, ...yUndoManagerKeymap, ...searchKeymap, ...foldKeymap, indentWithTab, ...defaultKeymap]),
        yCollab(ytext, options.awareness, { undoManager }),
        theme,
        language.of([]),
        readOnly.of(readOnlyExtensions(current.readOnly)),
        wrap.of(current.wrap ? EditorView.lineWrapping : []),
        indent.of(indentExtensions(current.indent)),
        darkMode.of(EditorView.darkTheme.of(options.dark ?? false)),
        phrases.of(EditorState.phrases.of(options.labels ?? {})),
        EditorView.contentAttributes.of({ 'aria-label': options.labels?.Editor ?? 'Editor', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
        EditorView.updateListener.of((update) => {
          const focused = update.view.hasFocus
          if (update.docChanged || update.selectionSet || focused !== current.focused) {
            current = { ...current, focused }
            notify()
          }
        }),
      ],
    }),
  })

  const onStack = () => notify()
  undoManager.on('stack-item-added', onStack)
  undoManager.on('stack-item-popped', onStack)

  const loadLanguage = (name: string) => {
    const found = languageOf(name)
    const request = ++loading
    current = { ...current, name, language: found?.name ?? null }
    if (!found) {
      view.dispatch({ effects: language.reconfigure([]) })
      notify()
      return
    }
    void found.load().then((support) => {
      if (destroyed || request !== loading) return
      view.dispatch({ effects: language.reconfigure(support) })
      notify()
    }).catch(() => {
      // Plain text is still fully editable; only the colors are missing.
    })
    notify()
  }

  function snapshot(): TextEditorState {
    const head = view.state.selection.main.head
    const line = view.state.doc.lineAt(head)
    return {
      canUndo: undoManager.undoStack.length > 0,
      canRedo: undoManager.redoStack.length > 0,
      line: line.number,
      column: head - line.from + 1,
      selected: view.state.selection.ranges.reduce((total, range) => total + range.to - range.from, 0),
      lines: view.state.doc.lines,
      language: current.language,
      wrap: current.wrap,
      indent: current.indent,
      readOnly: current.readOnly,
      focused: current.focused,
    }
  }

  loadLanguage(options.name)

  return {
    view,
    state: snapshot,
    setReadOnly(next) {
      if (next === current.readOnly) return
      current = { ...current, readOnly: next }
      view.dispatch({ effects: readOnly.reconfigure(readOnlyExtensions(next)) })
      notify()
    },
    setWrap(next) {
      current = { ...current, wrap: next }
      view.dispatch({ effects: wrap.reconfigure(next ? EditorView.lineWrapping : []) })
      notify()
    },
    setIndent(next) {
      current = { ...current, indent: next }
      view.dispatch({ effects: indent.reconfigure(indentExtensions(next)) })
      notify()
    },
    setDark(next) {
      view.dispatch({ effects: darkMode.reconfigure(EditorView.darkTheme.of(next)) })
    },
    setName(name) {
      if (name !== current.name) loadLanguage(name)
    },
    undo() {
      if (!current.readOnly) undoManager.undo()
    },
    redo() {
      if (!current.readOnly) undoManager.redo()
    },
    indent(direction) {
      if (!current.readOnly) (direction === 'more' ? indentMore : indentLess)(view)
    },
    openSearch() {
      openSearchPanel(view)
    },
    focus() {
      view.focus()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      undoManager.off('stack-item-added', onStack)
      undoManager.off('stack-item-popped', onStack)
      undoManager.destroy()
      view.destroy()
      // This session's cursor leaves with its editor.
      if (options.awareness.getLocalState()) options.awareness.setLocalStateField('cursor', null)
    },
  }
}
