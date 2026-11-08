import type { TextEditor, TextEditorIndent } from '@pulpo/client-core/office/text/view'
import { ClipboardPaste, Copy, Hash, IndentDecrease, IndentIncrease, MessageSquareCode, Scissors, TextSelect } from 'lucide-react'
import { isAppleShortcut } from '../../browser/shortcuts'
import { ui, uit } from '@/i18n/ui'
import { separator, type MenuDefinition, type MenuEntry } from '../chrome/menu'
import type { ShortcutSpec } from '../chrome/shortcuts'
import { findEntries, undoRedoEntries } from '../chrome/standard-menus'
import { zoomMenu } from '../chrome/zoom'

/**
 * The text and code editor's menus, as VS Code and Docs lay theirs out (Edit, View, Tools), data
 * for the shared menu bar between the host's File and Help. Each reads the editor when it opens.
 */

/** Editor font size choices (1 is the editor's 13px), as VS Code's and Notepad's zoom steps. */
export const TEXT_ZOOM_PRESETS: readonly number[] = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
export const MIN_TEXT_ZOOM = 0.8
export const MAX_TEXT_ZOOM = 2

export const CUT_SHORTCUT: ShortcutSpec = { key: 'x', mod: true }
export const COPY_SHORTCUT: ShortcutSpec = { key: 'c', mod: true }
export const PASTE_SHORTCUT: ShortcutSpec = { key: 'v', mod: true }
/** VS Code's Toggle Word Wrap. */
export const WRAP_SHORTCUT: ShortcutSpec = { key: 'z', alt: true }

/** Go to line: Ctrl+G as in VS Code and Word, which on a Mac is the literal Control key; menus there show ⌘⌥G, which does the same. */
export function gotoLineShortcut(): ShortcutSpec {
  return isAppleShortcut() ? { key: 'g', mod: true, alt: true } : { key: 'g', mod: true }
}

export interface TextMenuContext {
  editor: TextEditor
  /** Whether this person may change the file. */
  editable: boolean
  cut: () => void
  copy: () => void
  paste: () => void
  find: () => void
  replace: () => void
  toggleWrap: () => void
  lineNumbers: boolean
  setLineNumbers: (on: boolean) => void
  spellcheck: boolean
  setSpellcheck: (on: boolean) => void
  zoom: number
  setZoom: (zoom: number) => void
  /** The HTML preview, for web pages; omitted for other files. */
  preview?: { on: boolean; toggle: () => void }
  wordCount: () => void
}

const INDENT_SIZES = [2, 4, 8]

/** Edit ▸ Indentation: spaces or tabs, and how wide (the toolbar's Spaces/Tabs list). */
function indentationEntry(editor: TextEditor, editable: boolean): MenuEntry {
  const { indent } = editor.state()
  const choice = (next: TextEditorIndent, id: string, label: string): MenuEntry => ({
    type: 'item',
    id,
    label,
    radio: true,
    checked: next.tabs === indent.tabs && next.size === indent.size,
    onSelect: () => editor.setIndent(next),
  })
  return {
    type: 'submenu',
    id: 'indentation',
    label: ui("Indentation"),
    disabled: !editable,
    items: [
      { type: 'label', label: ui("Indent with spaces") },
      ...INDENT_SIZES.map((size) => choice({ size, tabs: false }, `indent-spaces-${size}`, uit`${size} spaces`)),
      separator,
      { type: 'label', label: ui("Indent with tabs") },
      ...INDENT_SIZES.map((size) => choice({ size, tabs: true }, `indent-tabs-${size}`, uit`Tab width ${size}`)),
    ],
  }
}

export function textMenus(context: TextMenuContext): MenuDefinition[] {
  const { editor } = context
  return [
    {
      id: 'edit',
      label: ui("Edit"),
      items: () => {
        const state = editor.state()
        const can = context.editable && !state.readOnly
        const selected = state.selected > 0
        return [
          ...undoRedoEntries({ undo: () => editor.undo(), redo: () => editor.redo(), canUndo: can && state.canUndo, canRedo: can && state.canRedo }),
          separator,
          { type: 'item', id: 'cut', label: ui("Cut"), icon: Scissors, shortcut: CUT_SHORTCUT, disabled: !can || !selected, onSelect: context.cut },
          { type: 'item', id: 'copy', label: ui("Copy"), icon: Copy, shortcut: COPY_SHORTCUT, disabled: !selected, onSelect: context.copy },
          { type: 'item', id: 'paste', label: ui("Paste"), icon: ClipboardPaste, shortcut: PASTE_SHORTCUT, disabled: !can, onSelect: context.paste },
          { type: 'item', id: 'select-all', label: ui("Select all"), icon: TextSelect, shortcut: { key: 'a', mod: true }, onSelect: () => editor.selectAll() },
          separator,
          ...findEntries({ find: context.find, replace: context.replace }),
          { type: 'item', id: 'go-to-line', label: ui("Go to line…"), icon: Hash, shortcut: gotoLineShortcut(), onSelect: () => editor.openGotoLine() },
          separator,
          // Only where the language has comments: plain text has none.
          ...editor.canToggleComment() ? [{ type: 'item', id: 'toggle-comment', label: ui("Toggle line comment"), icon: MessageSquareCode, shortcut: { key: '/', mod: true }, disabled: !can, onSelect: () => { editor.toggleComment() } } satisfies MenuEntry] : [],
          { type: 'item', id: 'indent', label: ui("Indent"), icon: IndentIncrease, shortcut: { key: ']', mod: true }, disabled: !can, onSelect: () => editor.indent('more') },
          { type: 'item', id: 'outdent', label: ui("Outdent"), icon: IndentDecrease, shortcut: { key: '[', mod: true }, disabled: !can, onSelect: () => editor.indent('less') },
          indentationEntry(editor, can),
        ]
      },
    },
    {
      id: 'view',
      label: ui("View"),
      // Toggles show a check, as in Docs; an icon beside it would push their labels out of line.
      items: () => [
        { type: 'item', id: 'wrap', label: ui("Wrap lines"), shortcut: WRAP_SHORTCUT, checked: editor.state().wrap, onSelect: context.toggleWrap },
        { type: 'item', id: 'line-numbers', label: ui("Line numbers"), checked: context.lineNumbers, onSelect: () => context.setLineNumbers(!context.lineNumbers) },
        { type: 'item', id: 'spellcheck', label: ui("Spell check"), checked: context.spellcheck, onSelect: () => context.setSpellcheck(!context.spellcheck) },
        ...context.preview ? [{ type: 'item', id: 'preview', label: ui("Preview"), checked: context.preview.on, onSelect: context.preview.toggle } satisfies MenuEntry] : [],
        separator,
        zoomMenu({ zoom: context.zoom, onZoom: context.setZoom, presets: TEXT_ZOOM_PRESETS }),
      ],
    },
    {
      id: 'tools',
      label: ui("Tools"),
      items: () => [
        { type: 'item', id: 'word-count', label: ui("Word count…"), onSelect: context.wordCount },
      ],
    },
  ]
}
