import { ui } from '@/i18n/ui'
import { redoShortcut, UNDO_SHORTCUT } from '../chrome/standard-menus'
import type { ShortcutGroup } from '../chrome/shortcuts'
import { PRINT_SHORTCUT, SAVE_SHORTCUT, SHORTCUTS_SHORTCUT } from '../chrome/use-editor-shortcuts'

const mod = (key: string, more: { shift?: boolean; alt?: boolean } = {}) => ({ key, mod: true, ...more })

/**
 * The presentation editor's keys, as client-core's view binds them: the slide canvas
 * (presentation/view/canvas.ts), the slide strip (thumbnails.ts), slide text (text-editor.ts), and
 * the show (present.ts), with PresentationEditor's present keys and the shared editor keys.
 */
export function presentationShortcutGroups(): ShortcutGroup[] {
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
        { label: ui("Print"), keys: [PRINT_SHORTCUT] },
        { label: ui("Show that changes are saved"), keys: [SAVE_SHORTCUT] },
        { label: ui("Keyboard shortcuts"), keys: [SHORTCUTS_SHORTCUT] },
        { label: ui("Zoom"), keys: [ui("Ctrl+scroll")] },
      ],
    },
    {
      id: 'present',
      title: ui("Presenting"),
      items: [
        { label: ui("Present from the beginning"), keys: [{ key: 'F5' }, mod('Enter')] },
        { label: ui("Present from the current slide"), keys: [{ key: 'F5', shift: true }, mod('Enter', { shift: true })] },
        { label: ui("Next slide"), keys: [{ key: 'ArrowRight' }, { key: ' ' }, { key: 'PageDown' }, 'N'] },
        { label: ui("Previous slide"), keys: [{ key: 'ArrowLeft' }, { key: 'Backspace' }, { key: 'PageUp' }, 'P'] },
        { label: ui("First or last slide"), keys: [{ key: 'Home' }, { key: 'End' }] },
        { label: ui("Go to a slide"), keys: [ui("Number, then Enter")] },
        { label: ui("End the show"), keys: [{ key: 'Escape' }] },
      ],
    },
    {
      id: 'slides',
      title: ui("Slides (in the slide list)"),
      items: [
        { label: ui("Previous or next slide"), keys: [{ key: 'ArrowUp' }, { key: 'ArrowDown' }] },
        { label: ui("Select more slides"), keys: [{ key: 'ArrowUp', shift: true }, { key: 'ArrowDown', shift: true }] },
        { label: ui("Move the slides up or down"), keys: [mod('ArrowUp', { shift: true }), mod('ArrowDown', { shift: true })] },
        { label: ui("New slide"), keys: [{ key: 'Enter' }] },
        { label: ui("Duplicate the slides"), keys: [mod('d')] },
        { label: ui("Delete the slides"), keys: [{ key: 'Delete' }, { key: 'Backspace' }] },
      ],
    },
    {
      id: 'objects',
      title: ui("Objects (on the slide)"),
      items: [
        { label: ui("Select every object"), keys: [mod('a')] },
        { label: ui("Next or previous object"), keys: [{ key: 'Tab' }, { key: 'Tab', shift: true }] },
        { label: ui("Nudge"), keys: [{ key: 'ArrowUp' }, { key: 'ArrowDown' }, { key: 'ArrowLeft' }, { key: 'ArrowRight' }] },
        { label: ui("Nudge by less"), keys: [{ key: 'ArrowRight', alt: true }] },
        { label: ui("Nudge by more"), keys: [{ key: 'ArrowRight', shift: true }] },
        { label: ui("Duplicate"), keys: [mod('d')] },
        { label: ui("Group"), keys: [mod('g')] },
        { label: ui("Ungroup"), keys: [mod('g', { shift: true })] },
        { label: ui("Delete"), keys: [{ key: 'Delete' }, { key: 'Backspace' }] },
        { label: ui("Edit the text"), keys: [{ key: 'Enter' }, { key: 'F2' }] },
        { label: ui("Replace the text"), keys: [ui("Start typing")] },
        { label: ui("Clear the selection"), keys: [{ key: 'Escape' }] },
      ],
    },
    {
      id: 'text',
      title: ui("Text"),
      items: [
        { label: ui("Bold"), keys: [mod('b')] },
        { label: ui("Italic"), keys: [mod('i')] },
        { label: ui("Underline"), keys: [mod('u')] },
        { label: ui("Line break"), keys: [{ key: 'Enter', shift: true }] },
        { label: ui("Increase or decrease list level"), keys: [{ key: 'Tab' }, { key: 'Tab', shift: true }] },
        { label: ui("Stop editing the text"), keys: [{ key: 'Escape' }] },
      ],
    },
  ]
}
