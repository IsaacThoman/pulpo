import type { PresentationController, PresentationRequest } from './controller.js'

/**
 * Keyboard shortcuts the presentation views share. Letters match `event.key`, so they follow the
 * keyboard layout; punctuation and digits match `event.code`, because Shift and Option change
 * their key. Browser and system shortcuts stay theirs: alignment is Mod+Shift+L/E/R/J as in
 * Google Slides (Ctrl+L/E/R/J would take the address bar, search, reload, and downloads), and a
 * new slide is Ctrl+M only (Cmd+M minimizes the window on macOS).
 */

export type TextShortcut =
  | { kind: 'mark'; mark: 'b' | 'i' | 'u' }
  | { kind: 'align'; value: 'l' | 'ctr' | 'r' | 'just' }
  | { kind: 'fontSize'; delta: 1 | -1 }
  | { kind: 'list'; value: 'char' | 'number' }
  | { kind: 'clear' }

const ALIGN_KEYS: Record<string, 'l' | 'ctr' | 'r' | 'just'> = { l: 'l', e: 'ctr', r: 'r', j: 'just' }

/** Text formatting: Mod+B/I/U, Mod+Shift+L/E/R/J, Mod+Shift+> and <, Mod+Shift+7 and 8, Mod+\. */
export function textShortcut(event: KeyboardEvent): TextShortcut | undefined {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return undefined
  const key = event.key.toLowerCase()
  if (event.shiftKey) {
    if (ALIGN_KEYS[key]) return { kind: 'align', value: ALIGN_KEYS[key] }
    if (event.code === 'Period') return { kind: 'fontSize', delta: 1 }
    if (event.code === 'Comma') return { kind: 'fontSize', delta: -1 }
    if (event.code === 'Digit7') return { kind: 'list', value: 'number' }
    if (event.code === 'Digit8') return { kind: 'list', value: 'char' }
    return undefined
  }
  if (key === 'b' || key === 'i' || key === 'u') return { kind: 'mark', mark: key }
  if (event.code === 'Backslash') return { kind: 'clear' }
  return undefined
}

export function applyTextShortcut(controller: PresentationController, shortcut: TextShortcut): void {
  if (shortcut.kind === 'mark') controller.toggleMark(shortcut.mark)
  else if (shortcut.kind === 'align') controller.setAlign(shortcut.value)
  else if (shortcut.kind === 'fontSize') controller.stepFontSize(shortcut.delta)
  else if (shortcut.kind === 'list') controller.setBullets(shortcut.value)
  else controller.clearFormatting()
}

/** Mod+F finds, Ctrl+H (Cmd+Shift+H on a Mac, where Cmd+H hides the app) replaces, Mod+K links. */
export function requestShortcut(event: KeyboardEvent): PresentationRequest | undefined {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return undefined
  const key = event.key.toLowerCase()
  if (key === 'f' && !event.shiftKey) return 'find'
  if (key === 'k' && !event.shiftKey) return 'link'
  if (key === 'h' && ((event.ctrlKey && !event.metaKey && !event.shiftKey) || (event.metaKey && event.shiftKey))) return 'replace'
  return undefined
}

/** Ctrl+M: a new slide, as in PowerPoint and Google Slides. */
export function isNewSlideShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'm'
}

/** Sends a request for a shortcut to the host; true when one listens (the key is then taken). */
export function sendRequest(controller: PresentationController, request: PresentationRequest): boolean {
  if (request !== 'find' && controller.readOnly) return false
  if (request === 'link' && !controller.formatState().canFormatText) return false
  return controller.request(request)
}

/**
 * Shortcuts inside a text editor, on the slide or in the notes. Bold, italic, and underline
 * stay with the editor's own keymap. Returns true when the key was handled.
 */
export function editorShortcut(controller: PresentationController, event: KeyboardEvent): boolean {
  const request = requestShortcut(event)
  if (request) return sendRequest(controller, request)
  if (controller.readOnly) return false
  if (isNewSlideShortcut(event)) {
    controller.addSlide()
    return true
  }
  const shortcut = textShortcut(event)
  if (!shortcut || shortcut.kind === 'mark') return false
  applyTextShortcut(controller, shortcut)
  return true
}
