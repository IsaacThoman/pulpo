import { ui } from '@/i18n/ui'
import { isAppleShortcut } from '../../browser/shortcuts'
import { redoShortcut, UNDO_SHORTCUT } from '../chrome/standard-menus'
import type { ShortcutGroup } from '../chrome/shortcuts'
import { FIND_SHORTCUT, PRINT_SHORTCUT, replaceShortcut, SAVE_SHORTCUT } from '../chrome/use-editor-shortcuts'
import { WRAP_SHORTCUT } from './text-menus'

const mod = (key: string, more: { shift?: boolean; alt?: boolean } = {}) => ({ key, mod: true, ...more })

/**
 * The text and code editor's keys: CodeMirror's default, search, and fold keymaps, the find and
 * go-to-line keys, and the shared undo keys (client-core's text/view/editor.ts), with the editor's
 * own Alt+Z and the shared editor keys. Labels match the menus' items, which then aren't listed twice.
 */
export function textShortcutGroups(): ShortcutGroup[] {
  const apple = isAppleShortcut()
  return [
    {
      id: 'common',
      title: ui("Common actions"),
      items: [
        { label: ui("Undo"), keys: [UNDO_SHORTCUT] },
        { label: ui("Redo"), keys: apple ? [redoShortcut()] : [redoShortcut(), mod('z', { shift: true })] },
        { label: ui("Find"), keys: [FIND_SHORTCUT] },
        // Cmd+H hides the app on a Mac: VS Code's Cmd+Option+F and Docs' Cmd+Shift+H instead.
        { label: ui("Find and replace"), keys: apple ? [replaceShortcut(), mod('f', { alt: true })] : [replaceShortcut()] },
        // Ctrl+G goes to a line on Windows and Linux, so there Shift+Ctrl+G and F3 step through matches.
        { label: ui("Next or previous match"), keys: apple ? [mod('g'), mod('g', { shift: true }), { key: 'F3' }] : [{ key: 'F3' }, { key: 'F3', shift: true }, mod('g', { shift: true })] },
        // Literal Control, so Cmd+G stays Find next on a Mac.
        { label: ui("Go to line…"), keys: apple ? ['⌃G', mod('g', { alt: true })] : [mod('g'), mod('g', { alt: true })] },
        { label: ui("Wrap lines"), keys: [WRAP_SHORTCUT] },
        { label: ui("Print"), keys: [PRINT_SHORTCUT] },
        { label: ui("Show that changes are saved"), keys: [SAVE_SHORTCUT] },
      ],
    },
    {
      id: 'lines',
      title: ui("Lines"),
      items: [
        { label: ui("Toggle line comment"), keys: [mod('/')] },
        { label: ui("Indent or outdent"), keys: [{ key: 'Tab' }, { key: 'Tab', shift: true }, mod(']'), mod('[')] },
        { label: ui("Move the line up or down"), keys: [{ key: 'ArrowUp', alt: true }, { key: 'ArrowDown', alt: true }] },
        { label: ui("Copy the line up or down"), keys: [{ key: 'ArrowUp', alt: true, shift: true }, { key: 'ArrowDown', alt: true, shift: true }] },
        { label: ui("Delete the line"), keys: [mod('k', { shift: true })] },
        { label: ui("Insert a line below"), keys: [mod('Enter')] },
        { label: ui("Fold or unfold the block"), keys: apple ? [mod('[', { alt: true }), mod(']', { alt: true })] : [mod('[', { shift: true }), mod(']', { shift: true })] },
      ],
    },
    {
      id: 'selection',
      title: ui("Selection"),
      items: [
        { label: ui("Select all"), keys: [mod('a')] },
        { label: ui("Select the next occurrence"), keys: [mod('d')] },
        { label: ui("Select every occurrence"), keys: [mod('l', { shift: true })] },
        { label: ui("Add a cursor above or below"), keys: [mod('ArrowUp', { alt: true }), mod('ArrowDown', { alt: true })] },
      ],
    },
  ]
}
