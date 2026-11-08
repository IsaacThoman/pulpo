import { ui } from '@/i18n/ui'
import { redoShortcut, UNDO_SHORTCUT } from '../chrome/standard-menus'
import type { ShortcutGroup } from '../chrome/shortcuts'
import { FIND_SHORTCUT, PRINT_SHORTCUT, SAVE_SHORTCUT, SHORTCUTS_SHORTCUT } from '../chrome/use-editor-shortcuts'

const mod = (key: string, more: { shift?: boolean; alt?: boolean } = {}) => ({ key, mod: true, ...more })

/**
 * The spreadsheet editor's keys, as the grid binds them (`onKeyDown` and `onEditKey` in client-core's
 * sheets/view/interactions.ts) along with the clipboard, the find dialog, and the shared editor keys.
 */
export function sheetShortcutGroups(): ShortcutGroup[] {
  const redo = redoShortcut()
  return [
    {
      id: 'common',
      title: ui("Common actions"),
      items: [
        { label: ui("Undo"), keys: [UNDO_SHORTCUT] },
        { label: ui("Redo"), keys: [redo, redo.shift ? mod('y') : mod('z', { shift: true })] },
        { label: ui("Cut"), keys: [mod('x')] },
        { label: ui("Copy"), keys: [mod('c')] },
        { label: ui("Paste"), keys: [mod('v')] },
        { label: ui("Find and replace"), keys: [FIND_SHORTCUT] },
        { label: ui("Print"), keys: [PRINT_SHORTCUT] },
        { label: ui("Show that changes are saved"), keys: [SAVE_SHORTCUT] },
        { label: ui("Keyboard shortcuts"), keys: [SHORTCUTS_SHORTCUT] },
        { label: ui("Zoom"), keys: [ui("Ctrl+scroll")] },
      ],
    },
    {
      id: 'navigation',
      title: ui("Moving and selecting"),
      items: [
        { label: ui("Move to the next cell"), keys: [{ key: 'ArrowUp' }, { key: 'ArrowDown' }, { key: 'ArrowLeft' }, { key: 'ArrowRight' }] },
        { label: ui("Move to the edge of the data"), keys: [mod('ArrowUp'), mod('ArrowDown'), mod('ArrowLeft'), mod('ArrowRight')] },
        { label: ui("Extend the selection"), keys: [{ key: 'ArrowDown', shift: true }, mod('ArrowDown', { shift: true })] },
        { label: ui("Move right or left"), keys: [{ key: 'Tab' }, { key: 'Tab', shift: true }] },
        { label: ui("Move down or up"), keys: [{ key: 'Enter' }, { key: 'Enter', shift: true }] },
        { label: ui("Start of the row"), keys: [{ key: 'Home' }] },
        { label: ui("First cell"), keys: [mod('Home')] },
        { label: ui("Last cell with data"), keys: [mod('End')] },
        { label: ui("Down or up one screen"), keys: [{ key: 'PageDown' }, { key: 'PageUp' }] },
        { label: ui("Select the row"), keys: [{ key: ' ', shift: true }] },
        { label: ui("Select the column"), keys: [mod(' ')] },
        { label: ui("Select the data around the cell, then everything"), keys: [mod('a')] },
      ],
    },
    {
      id: 'editing',
      title: ui("Editing cells"),
      items: [
        { label: ui("Edit the cell"), keys: [{ key: 'F2' }] },
        { label: ui("Clear the cells"), keys: [{ key: 'Delete' }] },
        { label: ui("Clear the cell and start typing"), keys: [{ key: 'Backspace' }] },
        { label: ui("New line in the cell"), keys: [{ key: 'Enter', alt: true }] },
        { label: ui("Fill the selection with the entry"), keys: [mod('Enter')] },
        { label: ui("Cancel editing"), keys: [{ key: 'Escape' }] },
        { label: ui("Switch between editing and pointing at cells"), keys: [{ key: 'F2' }] },
        { label: ui("Cycle absolute and relative references"), keys: [{ key: 'F4' }] },
        { label: ui("Fill down"), keys: [mod('d')] },
        { label: ui("Fill right"), keys: [mod('r')] },
        { label: ui("Insert today's date"), keys: [mod(';')] },
      ],
    },
    {
      id: 'formatting',
      title: ui("Formatting"),
      items: [
        { label: ui("Bold"), keys: [mod('b')] },
        { label: ui("Italic"), keys: [mod('i')] },
        { label: ui("Underline"), keys: [mod('u')] },
        { label: ui("Strikethrough"), keys: [mod('5')] },
      ],
    },
  ]
}
