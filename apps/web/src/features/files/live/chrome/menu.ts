import type { ComponentType, ReactNode } from 'react'
import { ui } from '@/i18n/ui'
import { MENU_SEARCH_SHORTCUT, menuBarKeyText } from './menu-keys'
import type { ShortcutGroup, ShortcutItem, ShortcutSpec } from './shortcuts'
import { formatShortcut } from './shortcuts'

export type MenuIcon = ComponentType<{ className?: string }>

/**
 * One row of an editor menu. Menus are data so editors, the host's File menu, and the shortcuts
 * dialog share them; labels are built when a menu opens (with `ui()`), never cached.
 */
export type MenuEntry =
  | {
    type: 'item'
    id: string
    label: string
    icon?: MenuIcon
    /** Shown right-aligned in the platform's style, and announced with aria-keyshortcuts. */
    shortcut?: ShortcutSpec
    disabled?: boolean
    /** A toggle (checkbox) or, with `radio`, one choice of several. */
    checked?: boolean
    radio?: boolean
    destructive?: boolean
    onSelect: () => void
  }
  | { type: 'submenu'; id: string; label: string; icon?: MenuIcon; disabled?: boolean; items: MenuEntry[] }
  | { type: 'separator' }
  | { type: 'label'; label: string }
  /** Anything else (a table-size grid); `close` closes the menu bar, e.g. after a pick. */
  | { type: 'custom'; id: string; render: (close: () => void) => ReactNode }

export type MenuItemEntry = Extract<MenuEntry, { type: 'item' }>

/** A menu of the menu bar ("File", "Edit", …). `items` runs when the menu opens, so state is fresh. */
export interface MenuDefinition {
  id: string
  label: string
  items: () => MenuEntry[]
}

export const separator: MenuEntry = { type: 'separator' }

/**
 * Drops what composing menus from optional parts leaves behind: separators at either end or next
 * to each other, labels with nothing under them, and empty submenus.
 */
export function normalizeEntries(entries: readonly MenuEntry[]): MenuEntry[] {
  const kept: MenuEntry[] = []
  const last = () => kept[kept.length - 1]
  for (const entry of entries) {
    if (entry.type === 'submenu') {
      const items = normalizeEntries(entry.items)
      if (items.length) kept.push({ ...entry, items })
      continue
    }
    if (entry.type === 'separator') {
      while (last()?.type === 'label') kept.pop()
      if (!kept.length || last()!.type === 'separator') continue
    }
    kept.push(entry)
  }
  while (kept.length && (kept[kept.length - 1]!.type === 'separator' || kept[kept.length - 1]!.type === 'label')) kept.pop()
  return kept
}

/** Items with shortcuts, submenus included, in menu order. */
function shortcutItems(entries: readonly MenuEntry[]): ShortcutItem[] {
  return entries.flatMap((entry): ShortcutItem[] => {
    if (entry.type === 'submenu') return shortcutItems(entry.items)
    return entry.type === 'item' && entry.shortcut ? [{ label: entry.label, keys: [entry.shortcut] }] : []
  })
}

const keyText = (key: ShortcutSpec | string) => typeof key === 'string' ? key : formatShortcut(key)

/**
 * The shortcuts dialog's groups: an editor's own `groups` first, then menu items with shortcuts
 * they do not already list, under the menu's name (or in a group with the menu's id), and last
 * the menu bar's own keys (Search the menus, the File menu). A line (same label and keys) is
 * listed once. Calls every menu's `items()`, so call it when the dialog opens.
 */
export function shortcutGroupsFromMenus(menus: readonly MenuDefinition[], groups: readonly ShortcutGroup[] = []): ShortcutGroup[] {
  const result = new Map<string, ShortcutGroup>()
  // Each label's keys listed so far: a menu's Redo (⌘Y) is already in a line "Redo: ⌘Y / ⌘⇧Z".
  const listed = new Map<string, Set<string>>()
  const add = (id: string, title: string, items: readonly ShortcutItem[]) => {
    for (const item of items) {
      const keys = item.keys.map(keyText)
      const known = listed.get(item.label) ?? new Set<string>()
      if (keys.every((key) => known.has(key))) continue
      for (const key of keys) known.add(key)
      listed.set(item.label, known)
      let group = result.get(id)
      if (!group) result.set(id, group = { id, title, items: [] })
      group.items.push(item)
    }
  }
  for (const group of groups) add(group.id, group.title, group.items)
  for (const menu of menus) add(menu.id, menu.label, shortcutItems(menu.items()))
  // EditorMenuBar takes these keys in every editor it is the menu bar of.
  if (menus.length) {
    add('menu-bar', ui("Menus"), [
      { label: ui("Search the menus"), keys: [MENU_SEARCH_SHORTCUT] },
      ...(menus.some((menu) => menu.id === 'file') ? [{ label: ui("Open the File menu"), keys: [menuBarKeyText()] }] : []),
    ])
  }
  return [...result.values()]
}
