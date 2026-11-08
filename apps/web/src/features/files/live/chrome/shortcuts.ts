import { isAppleShortcut, shortcutLabel } from '../../browser/shortcuts'

/**
 * A key combination as menus, tooltips, and the shortcuts dialog show it. `mod` is Cmd on Apple
 * platforms and Ctrl elsewhere; `key` is a `KeyboardEvent.key` value ('b', 'Enter', 'ArrowUp', '/').
 */
export interface ShortcutSpec {
  key: string
  mod?: boolean
  shift?: boolean
  alt?: boolean
}

/** One line of the shortcuts dialog: what it does, and the keys that do it (alternatives). */
export interface ShortcutItem {
  label: string
  /** Each entry is one way to do it; a string is shown as written (sequences such as "D, D"). */
  keys: readonly (ShortcutSpec | string)[]
}

export interface ShortcutGroup {
  id: string
  title: string
  items: ShortcutItem[]
}

const APPLE_KEYS: Record<string, string> = {
  Enter: '↩', Backspace: '⌫', Delete: '⌦', Escape: 'Esc', Tab: '⇥', ' ': 'Space',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'Page Up', PageDown: 'Page Down',
}
const OTHER_KEYS: Record<string, string> = {
  Escape: 'Esc', ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  PageUp: 'Page Up', PageDown: 'Page Down',
}

/** A key as keyboards label it: letters upper case, arrows as arrows, Return as ↩ on Apple platforms. */
export function keyName(key: string): string {
  const named = (isAppleShortcut() ? APPLE_KEYS : OTHER_KEYS)[key]
  if (named) return named
  return key.length === 1 ? key.toUpperCase() : key
}

/** The platform's hint for a shortcut: ⌘⇧K on Apple platforms, Ctrl+Shift+K elsewhere. */
export function formatShortcut(spec: ShortcutSpec): string {
  return shortcutLabel(keyName(spec.key), spec)
}

/** The `aria-keyshortcuts` value for a shortcut, e.g. "Meta+Shift+K" or "Control+Shift+K". */
export function ariaKeyShortcuts(spec: ShortcutSpec): string {
  const key = spec.key === ' ' ? 'Space' : spec.key.length === 1 ? spec.key.toUpperCase() : spec.key
  return [spec.mod && (isAppleShortcut() ? 'Meta' : 'Control'), spec.alt && 'Alt', spec.shift && 'Shift', key].filter(Boolean).join('+')
}

/** Physical key codes for letters, digits, and the slash, which Option or a layout can change the `key` of. */
function codeFor(key: string): string | null {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  if (key === '/') return 'Slash'
  return null
}

/**
 * Whether a key event is the shortcut. Cmd and Ctrl both count as `mod`, as the editors' own
 * keymaps take them; other modifiers must match exactly.
 */
export function matchesShortcut(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>, spec: ShortcutSpec): boolean {
  if (Boolean(spec.mod) !== (event.metaKey || event.ctrlKey)) return false
  if (Boolean(spec.alt) !== event.altKey || Boolean(spec.shift) !== event.shiftKey) return false
  if (event.key.toLowerCase() === spec.key.toLowerCase()) return true
  const code = codeFor(spec.key)
  return code !== null && event.code === code
}

/** How a shortcut's keys read: the platform's style, or a sequence as written ("D, D"). */
export const shortcutKeyText = (key: ShortcutSpec | string) => typeof key === 'string' ? key : formatShortcut(key)

/** Lower case without accents, so "negrita" finds "Negrita" and "subindice" finds "Subíndice". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** The groups and lines whose label, group, or keys contain every word of `query`. */
export function filterShortcutGroups(groups: readonly ShortcutGroup[], query: string): ShortcutGroup[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return [...groups]
  return groups.flatMap((group) => {
    const items = group.items.filter((item) => {
      const text = fold(`${group.title} ${item.label} ${item.keys.map(shortcutKeyText).join(' ')}`)
      return words.every((word) => text.includes(word))
    })
    return items.length ? [{ ...group, items }] : []
  })
}
