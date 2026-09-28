const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Platform-style hint for a menu item, e.g. ⌘⇧N on macOS and Ctrl+Shift+N elsewhere. */
export function shortcutLabel(key: string, modifiers: { mod?: boolean; shift?: boolean } = {}): string {
  if (isApple) return `${modifiers.mod ? '⌘' : ''}${modifiers.shift ? '⇧' : ''}${key}`
  return [modifiers.mod && 'Ctrl', modifiers.shift && 'Shift', key].filter(Boolean).join('+')
}

/** Cmd on Apple platforms, Ctrl elsewhere. */
export function hasPrimaryModifier(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isApple ? event.metaKey : event.ctrlKey
}

/** Keys typed into fields, menus, and dialogs belong to them, not to the file browser. */
export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]'))
}
