import { ui } from '@/i18n/ui'
import { redoShortcut } from '../chrome/standard-menus'
import type { ShortcutGroup } from '../chrome/shortcuts'
import { FAMILIAR_SHORTCUTS } from './shortcuts'
import { PRINT_SHORTCUT, SAVE_SHORTCUT, SHORTCUTS_SHORTCUT } from '../chrome/use-editor-shortcuts'

const mod = (key: string, more: { shift?: boolean; alt?: boolean } = {}) => ({ key, mod: true, ...more })

/**
 * The notebook editor's keys: Jupyter's command mode (`handleCommandKey` in client-core's
 * notebook/view/controller.ts, plus the editor's own C and X) and edit mode (cell-editor.ts and
 * CodeMirror's keys), with the shared editor keys.
 */
export function notebookShortcutGroups(): ShortcutGroup[] {
  return [
    {
      id: 'command',
      title: ui("Command mode (press Esc)"),
      items: [
        { label: ui("Edit the cell"), keys: [{ key: 'Enter' }] },
        { label: ui("Go to the next cell"), keys: [{ key: 'Enter', shift: true }] },
        { label: ui("Select the cell above or below"), keys: [{ key: 'ArrowUp' }, { key: 'ArrowDown' }, 'K', 'J'] },
        { label: ui("Extend the selection"), keys: [{ key: 'ArrowUp', shift: true }, { key: 'ArrowDown', shift: true }] },
        { label: ui("Select the first or last cell"), keys: [{ key: 'Home' }, { key: 'End' }] },
        { label: ui("Select every cell"), keys: [mod('a')] },
        { label: ui("Insert a cell above or below"), keys: ['A', 'B'] },
        { label: ui("Insert a code cell below"), keys: [{ key: 'Enter', alt: true }] },
        { label: ui("Delete the selected cells"), keys: ['D, D'] },
        { label: ui("Cut, copy, or paste cells"), keys: ['X', 'C', 'V'] },
        { label: ui("Paste cells above"), keys: [{ key: 'v', shift: true }] },
        { label: ui("Undo"), keys: ['Z', mod('z')] },
        { label: ui("Redo"), keys: [redoShortcut()] },
        { label: ui("Make code, Markdown, or raw"), keys: ['Y', 'M', 'R'] },
        { label: ui("Merge the selected cells, or with the cell below"), keys: [{ key: 'm', shift: true }] },
        { label: ui("Hide or show outputs"), keys: ['O'] },
      ],
    },
    {
      id: 'edit',
      title: ui("Edit mode"),
      items: [
        { label: ui("Stop editing (command mode)"), keys: [{ key: 'Escape' }, mod('Enter')] },
        { label: ui("Go to the next cell"), keys: [{ key: 'Enter', shift: true }] },
        { label: ui("Insert a code cell below"), keys: [{ key: 'Enter', alt: true }] },
        { label: ui("Split the cell at the cursor"), keys: [mod('-', { shift: true })] },
        { label: ui("Go to the cell above or below"), keys: [ui("↑ on the first line"), ui("↓ on the last line")] },
        { label: ui("Comment or uncomment lines"), keys: [mod('/')] },
      ],
    },
    {
      id: 'familiar',
      title: ui("JupyterLab, VS Code, and Colab"),
      items: FAMILIAR_SHORTCUTS.map(([keys, label]) => ({ label: label(), keys: [keys] })),
    },
    {
      id: 'common',
      title: ui("Common actions"),
      items: [
        { label: ui("Print"), keys: [PRINT_SHORTCUT] },
        { label: ui("Show that changes are saved"), keys: [SAVE_SHORTCUT] },
        { label: ui("Keyboard shortcuts (command mode)"), keys: [SHORTCUTS_SHORTCUT] },
      ],
    },
  ]
}
