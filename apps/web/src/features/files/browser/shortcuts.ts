const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function isAppleShortcut(): boolean {
  return isApple
}

/** Platform-style hint for a menu item, e.g. ⌘⇧N on macOS and Ctrl+Shift+N elsewhere. */
export function shortcutLabel(key: string, modifiers: { mod?: boolean; alt?: boolean; shift?: boolean } = {}): string {
  if (isApple) return `${modifiers.mod ? '⌘' : ''}${modifiers.alt ? '⌥' : ''}${modifiers.shift ? '⇧' : ''}${key}`
  return [modifiers.mod && 'Ctrl', modifiers.alt && 'Alt', modifiers.shift && 'Shift', key].filter(Boolean).join('+')
}

/** Cmd on Apple platforms, Ctrl elsewhere. */
export function hasPrimaryModifier(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isApple ? event.metaKey : event.ctrlKey
}

const INTERACTIVE = [
  'a[href]', 'button', 'select', 'summary',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="checkbox"]', '[role="switch"]', '[role="radio"]',
  '[role="menuitem"]', '[role="combobox"]', '[role="slider"]', '[role="separator"][tabindex]',
].join(', ')

/**
 * Buttons, links, and other controls take Enter, Space, and arrow keys themselves, so the file
 * browser leaves those keys to them (Enter on "Grid view" switches the view; it does not open
 * the selected folder).
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(INTERACTIVE))
}

/** Keys typed into fields, menus, and dialogs belong to them, not to the file browser. */
export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]'))
}
