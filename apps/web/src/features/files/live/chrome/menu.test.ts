import { describe, expect, it, vi } from 'vitest'
import { normalizeEntries, separator, shortcutGroupsFromMenus, type MenuDefinition, type MenuEntry } from './menu'
import { ariaKeyShortcuts, formatShortcut, matchesShortcut } from './shortcuts'

const item = (id: string, extra: Partial<Extract<MenuEntry, { type: 'item' }>> = {}): MenuEntry => ({ type: 'item', id, label: id, onSelect: () => {}, ...extra })
const ids = (entries: MenuEntry[]) => entries.map((entry) => entry.type === 'separator' ? '|' : entry.type === 'label' ? `#${entry.label}` : entry.id)

describe('menu entries', () => {
  it('drops separators and labels that composing optional parts leaves behind', () => {
    expect(ids(normalizeEntries([separator, item('a'), separator, separator, item('b'), separator]))).toEqual(['a', '|', 'b'])
    expect(ids(normalizeEntries([{ type: 'label', label: 'Gone' }, separator, item('a'), { type: 'label', label: 'Tail' }]))).toEqual(['a'])
    expect(ids(normalizeEntries([item('a'), { type: 'submenu', id: 'empty', label: 'Empty', items: [separator] }, separator]))).toEqual(['a'])
    const [submenu] = normalizeEntries([{ type: 'submenu', id: 'sub', label: 'Sub', items: [separator, item('x'), separator] }])
    expect(submenu?.type === 'submenu' && ids(submenu.items)).toEqual(['x'])
  })

  it('formats shortcuts and their aria-keyshortcuts', () => {
    // Node reports this platform; both styles must name every part.
    const label = formatShortcut({ key: 'k', mod: true, shift: true })
    expect(label === '⌘⇧K' || label === 'Ctrl+Shift+K').toBe(true)
    expect(ariaKeyShortcuts({ key: 'k', mod: true, shift: true })).toMatch(/^(Meta|Control)\+Shift\+K$/)
    expect(formatShortcut({ key: 'F5' })).toBe('F5')
    expect(ariaKeyShortcuts({ key: ' ', mod: true })).toMatch(/\+Space$/)
  })

  it('matches key events by key or, under Option, by physical key', () => {
    const event = (key: string, more: Partial<KeyboardEvent> = {}) => ({ key, code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...more })
    expect(matchesShortcut(event('p', { metaKey: true }), { key: 'p', mod: true })).toBe(true)
    expect(matchesShortcut(event('P', { ctrlKey: true }), { key: 'p', mod: true })).toBe(true)
    expect(matchesShortcut(event('p', { metaKey: true, shiftKey: true }), { key: 'p', mod: true })).toBe(false)
    expect(matchesShortcut(event('p'), { key: 'p', mod: true })).toBe(false)
    expect(matchesShortcut(event('ƒ', { metaKey: true, altKey: true, code: 'KeyF' }), { key: 'f', mod: true, alt: true })).toBe(true)
    // A Cyrillic layout types з on the P key; Dvorak types L there, which is another shortcut.
    expect(matchesShortcut(event('з', { ctrlKey: true, code: 'KeyP' }), { key: 'p', mod: true })).toBe(true)
    expect(matchesShortcut(event('l', { ctrlKey: true, code: 'KeyP' }), { key: 'p', mod: true })).toBe(false)
  })
})

describe('shortcut groups from menus', () => {
  it("lists an editor's groups first, then menu shortcuts they do not already list", () => {
    const items = vi.fn(() => [
      item('Undo', { shortcut: { key: 'z', mod: true } }),
      item('Redo', { shortcut: { key: 'y', mod: true } }),
      item('No keys'),
      { type: 'submenu', id: 'zoom', label: 'Zoom', items: [item('Zoom in', { shortcut: { key: '=', mod: true } })] },
    ] satisfies MenuEntry[])
    const menus: MenuDefinition[] = [{ id: 'edit', label: 'Edit', items }, { id: 'help', label: 'Help', items: () => [] }]
    const groups = shortcutGroupsFromMenus(menus, [{ id: 'common', title: 'Common', items: [{ label: 'Redo', keys: [{ key: 'y', mod: true }, { key: 'z', mod: true, shift: true }] }] }])
    expect(groups.map((group) => [group.title, group.items.map((entry) => entry.label)])).toEqual([
      ['Common', ['Redo']],
      ['Edit', ['Undo', 'Zoom in']],
      // The menu bar's own key, in every editor that has one.
      ['Menus', ['Search the menus']],
    ])
    // Menus build their items when asked, as when they open.
    expect(items).toHaveBeenCalledOnce()
  })

  it("lists the menu bar's keys: Search the menus, and the File menu where there is one", () => {
    const groups = shortcutGroupsFromMenus([{ id: 'file', label: 'File', items: () => [] }])
    expect(groups).toEqual([{
      id: 'menu-bar',
      title: 'Menus',
      items: [
        { label: 'Search the menus', keys: [{ key: '/', alt: true }] },
        { label: 'Open the File menu', keys: [expect.stringMatching(/^(⌃⌥F|Alt\+Shift\+F)$/)] },
      ],
    }])
    expect(shortcutGroupsFromMenus([])).toEqual([])
  })
})
