import { Keyboard, Redo2, Replace, Search, Undo2 } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { isAppleShortcut } from '../../browser/shortcuts'
import type { MenuDefinition, MenuEntry } from './menu'
import type { ShortcutSpec } from './shortcuts'
import { FIND_SHORTCUT, replaceShortcut, SHORTCUTS_SHORTCUT } from './use-editor-shortcuts'

export const UNDO_SHORTCUT: ShortcutSpec = { key: 'z', mod: true }

/** Redo as each platform's apps show it (every editor takes both Cmd/Ctrl+Y and Cmd/Ctrl+Shift+Z). */
export function redoShortcut(): ShortcutSpec {
  return isAppleShortcut() ? { key: 'z', mod: true, shift: true } : { key: 'y', mod: true }
}

/** Edit ▸ Undo and Redo. */
export function undoRedoEntries({ undo, redo, canUndo, canRedo }: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }): MenuEntry[] {
  return [
    { type: 'item', id: 'undo', label: ui("Undo"), icon: Undo2, shortcut: UNDO_SHORTCUT, disabled: !canUndo, onSelect: undo },
    { type: 'item', id: 'redo', label: ui("Redo"), icon: Redo2, shortcut: redoShortcut(), disabled: !canRedo, onSelect: redo },
  ]
}

/** Edit ▸ Find, and Find and replace when the editor can replace. */
export function findEntries({ find, replace }: { find: () => void; replace?: () => void }): MenuEntry[] {
  return [
    { type: 'item', id: 'find', label: ui("Find"), icon: Search, shortcut: FIND_SHORTCUT, onSelect: find },
    ...(replace ? [{ type: 'item', id: 'replace', label: ui("Find and replace"), icon: Replace, shortcut: replaceShortcut(), onSelect: replace } satisfies MenuEntry] : []),
  ]
}

/**
 * Help ▸ Keyboard shortcuts (Cmd/Ctrl+/), then any of the editor's own help. Code editors, where
 * Cmd/Ctrl+/ comments lines out as in VS Code, pass `key: false`.
 */
export function helpMenu(showShortcuts: () => void, { extra, key = true }: { extra?: () => MenuEntry[]; key?: boolean } = {}): MenuDefinition {
  return {
    id: 'help',
    label: ui("Help"),
    items: () => [
      { type: 'item', id: 'keyboard-shortcuts', label: ui("Keyboard shortcuts"), icon: Keyboard, ...(key ? { shortcut: SHORTCUTS_SHORTCUT } : {}), onSelect: showShortcuts },
      ...(extra?.() ?? []),
    ],
  }
}
