import { useEffect, useRef, type RefObject } from 'react'
import { isAppleShortcut } from '../../browser/shortcuts'
import { isKeyFromEditorRoot } from './editor-root'
import { matchesShortcut, typesAscii, type ShortcutSpec } from './shortcuts'

/** What an editor does for the shortcuts every Office and Google editor shares. */
export interface EditorShortcutHandlers {
  /** Cmd/Ctrl+P: prints the document (never the app page around it). */
  print?: () => void
  /**
   * Cmd/Ctrl+S: Pulpo saves as people type, so this only confirms it (the host's save indicator).
   * The browser's Save Page dialog never opens, with or without a handler.
   */
  save?: () => void
  /** Cmd/Ctrl+/: the keyboard shortcuts dialog. */
  shortcuts?: () => void
  /** Cmd/Ctrl+F and the replace keys, for focus outside the part of the editor that binds them. */
  find?: () => void
  replace?: () => void
  /** Puts focus back in the document; hosts call it through `focusFileEditorIn`. */
  focus?: () => void
}

export const PRINT_SHORTCUT: ShortcutSpec = { key: 'p', mod: true }
export const SAVE_SHORTCUT: ShortcutSpec = { key: 's', mod: true }
export const SHORTCUTS_SHORTCUT: ShortcutSpec = { key: '/', mod: true }
export const FIND_SHORTCUT: ShortcutSpec = { key: 'f', mod: true }
/** Cmd+H hides the app on macOS, so Docs uses Cmd+Shift+H there; Ctrl+H elsewhere. */
export function replaceShortcut(): ShortcutSpec {
  return isAppleShortcut() ? { key: 'h', mod: true, shift: true } : { key: 'h', mod: true }
}

interface Registration {
  root: RefObject<HTMLElement | null>
  handlers: RefObject<EditorShortcutHandlers>
}

const registered = new Set<Registration>()

/**
 * Editors showing in the main view: the side panel's never take keys pressed on the page itself,
 * nor a main view hidden behind a full-width panel.
 */
function mainViewEditors(): Registration[] {
  return [...registered].filter(({ root }) => {
    const element = root.current
    return element?.isConnected && !element.closest('[data-side-panel]') && element.checkVisibility?.() !== false
  })
}

/** Focus on no element in particular, as after clicking a page's background. */
function onPage(target: EventTarget | null): boolean {
  return target === null || target === window || target === document.body || target === document.documentElement
}

/**
 * Cmd/Ctrl+/ whether the layout types "/" with Shift (German, Spanish) or not (US). The US slash
 * key counts only where it types no ASCII character: on German and Spanish keyboards it is "-",
 * the browser's Zoom out.
 */
function isShortcutsKey(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && (event.key === '/' || (event.code === 'Slash' && !typesAscii(event.key)))
}

/**
 * The shared editor keys: print, save, shortcuts, and find and replace where the editor's own
 * keymap did not take them already (keys an editor handled are left alone). They work while
 * focus is in `root`; print and save also from the editor's own menus and dialogs (portals in
 * its React tree, noted by `fileEditorRoot` on `root`), and while focus is on the page itself and
 * this is the only editor in the main view, but never from the chat composer or another field.
 * On Apple platforms only Cmd counts: Ctrl+P, Ctrl+F, and the like move the caret there.
 */
export function useEditorShortcuts(root: RefObject<HTMLElement | null>, handlers: EditorShortcutHandlers): void {
  const latest = useRef(handlers)
  latest.current = handlers
  useEffect(() => {
    const registration: Registration = { root, handlers: latest }
    registered.add(registration)
    const onKeyDown = (event: KeyboardEvent) => {
      const element = root.current
      if (event.defaultPrevented || !element) return
      // Ctrl on a Mac is the text field's (Ctrl+P line up, Ctrl+F forward, Ctrl+Cmd+F full screen), as in the editors' own keymaps.
      if (isAppleShortcut() && event.ctrlKey) return
      const inside = event.target instanceof Node && element.contains(event.target)
      const ownPortal = !inside && isKeyFromEditorRoot(event, element)
      if (!inside && !ownPortal && !(onPage(event.target) && mainViewEditors().length === 1 && mainViewEditors()[0] === registration)) return
      const { print, save, shortcuts, find, replace } = latest.current
      const run = (action?: () => void) => {
        event.preventDefault()
        if (!event.repeat) action?.()
      }
      if (matchesShortcut(event, PRINT_SHORTCUT)) {
        if (print) run(print)
      } else if (matchesShortcut(event, SAVE_SHORTCUT)) {
        run(save)
      } else if (!inside) {
        return
      } else if (shortcuts && isShortcutsKey(event)) {
        run(shortcuts)
      } else if (find && matchesShortcut(event, FIND_SHORTCUT)) {
        run(find)
      } else if (replace && matchesShortcut(event, replaceShortcut())) {
        run(replace)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      registered.delete(registration)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [root])
}

/**
 * Puts focus back into the editor shown inside `container` (after renaming in the title, say).
 * Returns false when there is none.
 */
export function focusFileEditorIn(container: Element | null): boolean {
  if (!container) return false
  for (const { root, handlers } of registered) {
    const element = root.current
    if (!element || !container.contains(element)) continue
    const focus = handlers.current.focus
    if (focus) focus()
    else element.focus()
    return true
  }
  return false
}
