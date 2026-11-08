import { ui } from '@/i18n/ui'
import { isAppleShortcut } from '../../browser/shortcuts'
import { redoShortcut, UNDO_SHORTCUT } from '../chrome/standard-menus'
import type { MenuDefinition, MenuEntry } from '../chrome/menu'
import { formatShortcut, keyName, type ShortcutGroup, type ShortcutSpec } from '../chrome/shortcuts'
import { FIND_SHORTCUT, PRINT_SHORTCUT, replaceShortcut, SAVE_SHORTCUT, SHORTCUTS_SHORTCUT } from '../chrome/use-editor-shortcuts'
import { QUICK_FORMAT_DIGITS } from './sheet-menus'

const mod = (key: string, more: { shift?: boolean; alt?: boolean } = {}): ShortcutSpec => ({ key, mod: true, ...more })

/**
 * A key the grid takes with Control on every platform: Ctrl elsewhere, ⌃ on a Mac (where Cmd
 * with the same key is a screenshot, Spotlight, or a browser shortcut).
 */
const control = (key: string, more: { shift?: boolean; alt?: boolean } = {}): ShortcutSpec | string => (
  isAppleShortcut() ? `⌃${more.alt ? '⌥' : ''}${more.shift ? '⇧' : ''}${keyName(key)}` : mod(key, more)
)

/**
 * AutoSum: Alt+= on Windows and Linux. Option+= types ≠ on a Mac, so ⌃= there, and Cmd+Shift+T
 * where the browser lets it through (Chrome reopens a closed tab with it).
 */
const autoSum = (): (ShortcutSpec | string)[] => (isAppleShortcut() ? [control('='), mod('t', { shift: true })] : [{ key: '=', alt: true }])

/**
 * Hiding rows (9) or columns (0): Ctrl+9 and Google's Ctrl+Alt+9; Shift shows them again. A Mac
 * keeps Cmd+9 and Cmd+0 for the browser, so it hides with ⌃9 or Cmd+Option+9 and shows with
 * Cmd+Shift+9 (or ⌃⇧9).
 */
const hideKeys = (digit: '9' | '0', show: boolean): (ShortcutSpec | string)[] => {
  if (show) return isAppleShortcut() ? [mod(digit, { shift: true }), control(digit, { shift: true })] : [mod(digit, { shift: true })]
  return [control(digit), mod(digit, { alt: true })]
}

/**
 * The menus as the shortcuts dialog reads them: items whose keys the sheet's own list already
 * names (Format ▸ Number ▸ Currency is "Currency format" there) keep their place in the menu but
 * aren't listed twice.
 */
export function menusForShortcuts(menus: readonly MenuDefinition[], groups: readonly ShortcutGroup[]): MenuDefinition[] {
  const listed = new Set(groups.flatMap((group) => group.items.flatMap((item) => item.keys.map((key) => typeof key === 'string' ? key : formatShortcut(key)))))
  const strip = (entries: readonly MenuEntry[]): MenuEntry[] => entries.map((entry) => {
    if (entry.type === 'submenu') return { ...entry, items: strip(entry.items) }
    if (entry.type === 'item' && entry.shortcut && listed.has(formatShortcut(entry.shortcut))) {
      const { shortcut: _shortcut, ...rest } = entry
      return rest
    }
    return entry
  })
  return menus.map((menu) => ({ ...menu, items: () => strip(menu.items()) }))
}

/**
 * The spreadsheet editor's keys, as the grid binds them (`onKeyDown`, `onShortcut` and `onEditKey`
 * in client-core's sheets/view/interactions.ts) along with the clipboard, the dialogs the grid
 * asks for (`sheetrequest`), and the shared editor keys.
 */
export function sheetShortcutGroups(): ShortcutGroup[] {
  const redo = redoShortcut()
  const formats: { label: string; kind: keyof typeof QUICK_FORMAT_DIGITS }[] = [
    { label: ui("Number format"), kind: 'number' },
    { label: ui("Time format"), kind: 'time' },
    { label: ui("Date format"), kind: 'date' },
    { label: ui("Currency format"), kind: 'currency' },
    { label: ui("Percent format"), kind: 'percent' },
    { label: ui("Scientific format"), kind: 'scientific' },
    { label: ui("Automatic format"), kind: 'general' },
  ]
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
        { label: ui("Paste values only"), keys: [mod('v', { shift: true })] },
        { label: ui("Find and replace"), keys: [FIND_SHORTCUT, replaceShortcut()] },
        { label: ui("Go to a cell or range"), keys: [mod('g')] },
        { label: ui("Insert link"), keys: [mod('k')] },
        { label: ui("Insert or edit a note"), keys: [{ key: 'F2', shift: true }] },
        { label: ui("Print"), keys: [PRINT_SHORTCUT] },
        { label: ui("Show that changes are saved"), keys: [SAVE_SHORTCUT] },
        { label: ui("Keyboard shortcuts"), keys: [SHORTCUTS_SHORTCUT] },
        { label: ui("Open the cell menu"), keys: [{ key: 'F10', shift: true }] },
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
        { label: ui("Extend the selection to the first or last cell"), keys: [mod('Home', { shift: true }), mod('End', { shift: true })] },
        { label: ui("Down or up one screen"), keys: [{ key: 'PageDown' }, { key: 'PageUp' }] },
        { label: ui("Select the row"), keys: [{ key: ' ', shift: true }] },
        { label: ui("Select the column"), keys: [control(' ')] },
        { label: ui("Select the data around the cell, then everything"), keys: [mod('a')] },
        { label: ui("Open the cell's dropdown or filter menu"), keys: [{ key: 'ArrowDown', alt: true }] },
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
        { label: ui("AutoSum"), keys: autoSum() },
        { label: ui("Fill down"), keys: [mod('d')] },
        { label: ui("Fill right"), keys: [mod('r')] },
        { label: ui("Insert today's date"), keys: [mod(';')] },
      ],
    },
    {
      id: 'lines',
      title: ui("Rows and columns"),
      items: [
        { label: ui("Insert rows above (cells selected)"), keys: [mod('=', { alt: true })] },
        { label: ui("Insert the selected rows or columns"), keys: [mod('+'), mod('=', { alt: true })] },
        { label: ui("Delete the selected rows or columns"), keys: [mod('-'), mod('-', { alt: true })] },
        { label: ui("Hide rows"), keys: hideKeys('9', false) },
        { label: ui("Unhide rows"), keys: hideKeys('9', true) },
        { label: ui("Hide columns"), keys: hideKeys('0', false) },
        { label: ui("Unhide columns"), keys: hideKeys('0', true) },
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
        { label: ui("Clear formatting"), keys: [mod('\\')] },
        ...formats.map(({ label, kind }) => ({ label, keys: [control(QUICK_FORMAT_DIGITS[kind], { shift: true })] })),
        { label: ui("Show formulas"), keys: [control('`')] },
        { label: ui("Create or remove a filter"), keys: [mod('l', { shift: true })] },
      ],
    },
  ]
}
