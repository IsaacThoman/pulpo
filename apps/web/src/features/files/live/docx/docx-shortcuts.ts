import { ui } from '@/i18n/ui'
import { isAppleShortcut } from '../../browser/shortcuts'
import { redoShortcut, UNDO_SHORTCUT } from '../chrome/standard-menus'
import type { ShortcutGroup } from '../chrome/shortcuts'
import { FIND_SHORTCUT, PRINT_SHORTCUT, replaceShortcut, SAVE_SHORTCUT, SHORTCUTS_SHORTCUT } from '../chrome/use-editor-shortcuts'

const mod = (key: string, more: { shift?: boolean; alt?: boolean } = {}) => ({ key, mod: true, ...more })

/**
 * The Word editor's keys, as its keymap (DocxEditor's `shortcuts()` in client-core) and the shared
 * editor keys bind them. docx-shortcuts.test.ts checks every binding of the keymap is listed.
 */
export function docxShortcutGroups(): ShortcutGroup[] {
  const redo = redoShortcut()
  return [
    {
      id: 'common',
      title: ui("Common actions"),
      items: [
        { label: ui("Undo"), keys: [UNDO_SHORTCUT] },
        { label: ui("Redo"), keys: [redo, redo.shift ? mod('y') : mod('z', { shift: true })] },
        { label: ui("Find"), keys: [FIND_SHORTCUT] },
        { label: ui("Find and replace"), keys: [replaceShortcut()] },
        { label: ui("Print"), keys: [PRINT_SHORTCUT] },
        { label: ui("Show that changes are saved"), keys: [SAVE_SHORTCUT] },
        { label: ui("Keyboard shortcuts"), keys: [SHORTCUTS_SHORTCUT] },
      ],
    },
    {
      id: 'text',
      title: ui("Text formatting"),
      items: [
        { label: ui("Bold"), keys: [mod('b')] },
        { label: ui("Italic"), keys: [mod('i')] },
        { label: ui("Underline"), keys: [mod('u')] },
        { label: ui("Strikethrough"), keys: [{ key: '5', alt: true, shift: true }, mod('x', { shift: true })] },
        { label: ui("Superscript"), keys: [mod('.'), mod('=', { shift: true })] },
        { label: ui("Subscript"), keys: [mod(','), mod('=')] },
        { label: ui("Increase font size"), keys: [mod(']'), mod('.', { shift: true })] },
        { label: ui("Decrease font size"), keys: [mod('['), mod(',', { shift: true })] },
        { label: ui("Clear formatting"), keys: [mod('\\'), mod(' ')] },
      ],
    },
    {
      id: 'paragraph',
      title: ui("Paragraph formatting"),
      items: [
        { label: ui("Align left"), keys: [mod('l')] },
        { label: ui("Center"), keys: [mod('e')] },
        { label: ui("Align right"), keys: [mod('r')] },
        { label: ui("Justify"), keys: [mod('j')] },
        { label: ui("Numbered list"), keys: [mod('7', { shift: true })] },
        { label: ui("Bulleted list"), keys: [mod('8', { shift: true }), mod('l', { shift: true })] },
        { label: ui("Increase list level"), keys: [{ key: 'Tab' }] },
        { label: ui("Decrease list level"), keys: [{ key: 'Tab', shift: true }] },
        { label: ui("Heading 1"), keys: [mod('1', { alt: true })] },
        { label: ui("Heading 2"), keys: [mod('2', { alt: true })] },
        { label: ui("Heading 3"), keys: [mod('3', { alt: true })] },
        { label: ui("Normal text"), keys: [mod('0', { alt: true }), mod('n', { shift: true })] },
      ],
    },
    {
      id: 'insert',
      title: ui("Insert"),
      items: [
        { label: ui("Link"), keys: [mod('k')] },
        { label: ui("Comment"), keys: [mod('m', { alt: true })] },
        { label: ui("Footnote"), keys: [mod('f', { alt: true })] },
        { label: ui("Endnote"), keys: [mod('d', { alt: true })] },
        { label: ui("Page break"), keys: [mod('Enter')] },
      ],
    },
    {
      id: 'tables',
      title: ui("Tables"),
      items: [
        { label: ui("Next cell"), keys: [{ key: 'Tab' }] },
        { label: ui("Previous cell"), keys: [{ key: 'Tab', shift: true }] },
      ],
    },
    {
      id: 'navigation',
      title: ui("Headers, footers, and notes"),
      items: [
        { label: ui("Back to the body"), keys: [{ key: 'Escape' }] },
        { label: ui("Open a link"), keys: [isAppleShortcut() ? ui("⌘-click") : ui("Ctrl+click")] },
      ],
    },
  ]
}
