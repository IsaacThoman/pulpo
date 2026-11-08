import { isAppleShortcut } from '../../browser/shortcuts'
import type { ShortcutSpec } from './shortcuts'

/** The menu bar's own "Search the menus" item (Help ▸), which the search never lists. */
export const MENU_SEARCH_ID = 'search-menus'

/** Alt+/ (Option+/ on a Mac) searches the menus, as in Google Docs, Sheets, and Slides. */
export const MENU_SEARCH_SHORTCUT: ShortcutSpec = { key: '/', alt: true }

type KeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'> & { getModifierState?: (key: string) => boolean }

/** AltGr types characters: Linux reports it on its own, Windows as Ctrl+Alt (ruled out by callers). */
const altGraph = (event: KeyEvent) => Boolean(event.getModifierState?.('AltGraph'))

/**
 * Alt+/ on Windows, Linux, and ChromeOS, matched by character, so layouts that type "/" with Shift
 * work too (Alt+Shift+7 in German): Alt types nothing there. On a Mac, Option types characters, so
 * only Option+/ of the US and UK layouts counts (the key that types "÷"), never another layout's
 * key there, such as the en dash Option types where a German Mac has "-".
 */
export function isMenuSearchKey(event: KeyEvent, apple = isAppleShortcut()): boolean {
  if (!event.altKey || event.ctrlKey || event.metaKey || altGraph(event)) return false
  return apple ? event.code === 'Slash' && event.key === '÷' : event.key === '/'
}

/** A letter of a script other than Latin (Cyrillic "а", Greek "φ"): the layout has no F to match. */
const nonLatinLetter = (key: string) => /^\p{L}$/u.test(key) && !/\p{Script=Latin}/u.test(key)

/**
 * Opens the File menu from the keyboard, as in Google Docs: Alt+Shift+F, or Ctrl+Option+F on a
 * Mac. Neither types a character: Alt does not on Windows and Linux (AltGr, which does, reports
 * Ctrl+Alt), and Control does not on a Mac. The key is the layout's F ("ƒ" under Option), or the
 * F key's position when the layout types a letter of another script there; Dvorak's U, on that
 * position, stays U.
 */
export function isMenuBarKey(event: KeyEvent, apple = isAppleShortcut()): boolean {
  if (!event.altKey || event.metaKey || altGraph(event)) return false
  if (apple ? !event.ctrlKey || event.shiftKey : event.ctrlKey || !event.shiftKey) return false
  const key = event.key.toLowerCase()
  return key === 'f' || (apple && key === 'ƒ') || (event.code === 'KeyF' && nonLatinLetter(event.key))
}

/** The File menu key as each platform's apps write it: ⌃⌥F on a Mac, Alt+Shift+F elsewhere. */
export function menuBarKeyText(apple = isAppleShortcut()): string {
  return apple ? '⌃⌥F' : 'Alt+Shift+F'
}

/** The File menu key for `aria-keyshortcuts`. */
export function menuBarAriaKeys(apple = isAppleShortcut()): string {
  return apple ? 'Control+Alt+F' : 'Alt+Shift+F'
}
