import { ui } from '@/i18n/ui'
import { isAppleShortcut } from '../../browser/shortcuts'
import { redoShortcut, UNDO_SHORTCUT } from '../chrome/standard-menus'
import type { ShortcutGroup } from '../chrome/shortcuts'
import { FIND_SHORTCUT, PRINT_SHORTCUT, SAVE_SHORTCUT } from '../chrome/use-editor-shortcuts'

const mod = (key: string, more: { shift?: boolean; alt?: boolean } = {}) => ({ key, mod: true, ...more })

/**
 * The text and code editor's keys: CodeMirror's default, search, and fold keymaps and the shared
 * undo keys (client-core's text/view/editor.ts), with the shared editor keys.
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
        { label: ui("Find and replace"), keys: [FIND_SHORTCUT] },
        { label: ui("Next or previous match"), keys: [mod('g'), mod('g', { shift: true }), { key: 'F3' }] },
        { label: ui("Go to line"), keys: [mod('g', { alt: true })] },
        { label: ui("Print"), keys: [PRINT_SHORTCUT] },
        { label: ui("Show that changes are saved"), keys: [SAVE_SHORTCUT] },
      ],
    },
    {
      id: 'lines',
      title: ui("Lines"),
      items: [
        { label: ui("Comment or uncomment lines"), keys: [mod('/')] },
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
