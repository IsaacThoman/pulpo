import { ui } from '@/i18n/ui'
import { isAppleShortcut } from '../../browser/shortcuts'
import { redoShortcut, UNDO_SHORTCUT } from '../chrome/standard-menus'
import type { ShortcutGroup, ShortcutSpec } from '../chrome/shortcuts'
import { FIND_SHORTCUT, PRINT_SHORTCUT, replaceShortcut, SAVE_SHORTCUT, SHORTCUTS_SHORTCUT } from '../chrome/use-editor-shortcuts'

const mod = (key: string, more: { shift?: boolean; alt?: boolean } = {}): ShortcutSpec => ({ key, mod: true, ...more })

/** PowerPoint's zoom menu, in a status bar's size (1 is 100%). */
export const PRESENTATION_ZOOM_PRESETS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

/** The slide canvas's zoom keys (Option/Alt with Cmd/Ctrl, so the browser keeps its own page zoom). */
export const ZOOM_IN_SHORTCUT: ShortcutSpec = mod('=', { alt: true })
export const ZOOM_OUT_SHORTCUT: ShortcutSpec = mod('-', { alt: true })
export const ZOOM_FIT_SHORTCUT: ShortcutSpec = mod('0', { alt: true })

/** Ctrl+M on every platform: Cmd+M minimizes the window on macOS, so Slides takes Ctrl+M there too. */
export function newSlideKey(): ShortcutSpec | string {
  return isAppleShortcut() ? '⌃M' : mod('m')
}

/**
 * The presentation editor's keys, as client-core's view binds them: the slide canvas
 * (presentation/view/canvas.ts), the slide strip (thumbnails.ts), slide text (text-editor.ts and
 * shortcuts.ts), and the show (present.ts), with PresentationEditor's present keys and the shared
 * editor keys. Keep it in step with those files when a key changes.
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
        { label: ui("Find"), keys: [FIND_SHORTCUT] },
        { label: ui("Find and replace"), keys: [replaceShortcut()] },
        { label: ui("Print"), keys: [PRINT_SHORTCUT] },
        { label: ui("Show that changes are saved"), keys: [SAVE_SHORTCUT] },
        { label: ui("Keyboard shortcuts"), keys: [SHORTCUTS_SHORTCUT] },
      ],
    },
    {
      id: 'view',
      title: ui("View"),
      items: [
        { label: ui("Zoom in"), keys: [ZOOM_IN_SHORTCUT] },
        { label: ui("Zoom out"), keys: [ZOOM_OUT_SHORTCUT] },
        { label: ui("Fit"), keys: [ZOOM_FIT_SHORTCUT] },
        { label: ui("Zoom"), keys: [ui("Ctrl+scroll")] },
      ],
    },
    {
      id: 'present',
      title: ui("Presenting"),
      items: [
        { label: ui("Present from the beginning"), keys: [{ key: 'F5' }, mod('Enter', { shift: true })] },
        { label: ui("Present from the current slide"), keys: [{ key: 'F5', shift: true }, mod('Enter')] },
        { label: ui("Next slide"), keys: [{ key: 'ArrowRight' }, { key: ' ' }, { key: 'PageDown' }, 'N'] },
        { label: ui("Previous slide"), keys: [{ key: 'ArrowLeft' }, { key: 'Backspace' }, { key: 'PageUp' }, 'P'] },
        { label: ui("First or last slide"), keys: [{ key: 'Home' }, { key: 'End' }] },
        { label: ui("Go to a slide"), keys: [ui("Number, then Enter")] },
        { label: ui("End the show"), keys: [{ key: 'Escape' }] },
      ],
    },
    {
      id: 'slides',
      title: ui("Slides"),
      items: [
        { label: ui("New slide"), keys: [newSlideKey()] },
        { label: ui("Previous or next slide"), keys: [{ key: 'PageUp' }, { key: 'PageDown' }] },
        { label: ui("First or last slide"), keys: [{ key: 'Home' }, { key: 'End' }] },
        { label: ui("Duplicate the slide (nothing selected)"), keys: [mod('d')] },
      ],
    },
    {
      id: 'slide-list',
      title: ui("Slides (in the slide list)"),
      items: [
        { label: ui("Previous or next slide"), keys: [{ key: 'ArrowUp' }, { key: 'ArrowDown' }] },
        { label: ui("Select more slides"), keys: [{ key: 'ArrowUp', shift: true }, { key: 'ArrowDown', shift: true }] },
        { label: ui("Select every slide"), keys: [mod('a')] },
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
        { label: ui("Align left"), keys: [mod('l', { shift: true })] },
        { label: ui("Center"), keys: [mod('e', { shift: true })] },
        { label: ui("Align right"), keys: [mod('r', { shift: true })] },
        { label: ui("Justify"), keys: [mod('j', { shift: true })] },
        { label: ui("Increase font size"), keys: [mod('>', { shift: true })] },
        { label: ui("Decrease font size"), keys: [mod('<', { shift: true })] },
        { label: ui("Numbered list"), keys: [mod('7', { shift: true })] },
        { label: ui("Bulleted list"), keys: [mod('8', { shift: true })] },
        { label: ui("Clear formatting"), keys: [mod('\\')] },
        { label: ui("Insert link"), keys: [mod('k')] },
        { label: ui("Line break"), keys: [{ key: 'Enter', shift: true }] },
        { label: ui("Increase or decrease list level"), keys: [{ key: 'Tab' }, { key: 'Tab', shift: true }] },
        { label: ui("Next or previous table cell"), keys: [{ key: 'Tab' }, { key: 'Tab', shift: true }] },
        { label: ui("Stop editing the text"), keys: [{ key: 'Escape' }] },
      ],
    },
  ]
}
