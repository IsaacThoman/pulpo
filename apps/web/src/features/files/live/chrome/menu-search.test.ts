import { describe, expect, it, vi } from 'vitest'
import type { MenuDefinition, MenuEntry } from './menu'
import { isMenuBarKey, isMenuSearchKey, MENU_SEARCH_ID } from './menu-keys'
import { flattenMenus, searchMenuCommands, type MenuCommand } from './menu-search'

const item = (id: string, label = id, extra: Partial<Extract<MenuEntry, { type: 'item' }>> = {}): MenuEntry => ({ type: 'item', id, label, onSelect: () => {}, ...extra })

const menus = (): MenuDefinition[] => [
  { id: 'file', label: 'File', items: () => [item('print', 'Print', { shortcut: { key: 'p', mod: true } }), item('rename', 'Rename')] },
  {
    id: 'format',
    label: 'Format',
    items: () => [
      {
        type: 'submenu',
        id: 'text',
        label: 'Text',
        items: [item('bold', 'Bold', { checked: true }), item('underline', 'Underline'), item('subscript', 'Subíndice')],
      },
      { type: 'submenu', id: 'table', label: 'Table', disabled: true, items: [item('delete-table', 'Delete table')] },
      { type: 'label', label: 'Spacing' },
      item('line-spacing', 'Line spacing'),
      { type: 'custom', id: 'grid', render: () => null },
      { type: 'separator' },
      item('clear', 'Clear formatting', { disabled: true }),
    ],
  },
  { id: 'insert', label: 'Insert', items: () => [item('line', 'Horizontal line'), item('borders', 'Borders and shading'), item('table', 'Table')] },
  { id: 'help', label: 'Help', items: () => [item(MENU_SEARCH_ID, 'Search the menus'), item('keyboard-shortcuts', 'Keyboard shortcuts')] },
]

const labels = (commands: MenuCommand[]) => commands.map((command) => command.label)

describe('flattenMenus', () => {
  it('lists every command with the path of menus it is in, submenus included', () => {
    const commands = flattenMenus(menus())
    expect(commands.map((command) => [command.path.join(' ▸ '), command.label])).toEqual([
      ['File', 'Print'],
      ['File', 'Rename'],
      ['Format ▸ Text', 'Bold'],
      ['Format ▸ Text', 'Underline'],
      ['Format ▸ Text', 'Subíndice'],
      ['Format ▸ Table', 'Delete table'],
      ['Format', 'Line spacing'],
      ['Format', 'Clear formatting'],
      ['Insert', 'Horizontal line'],
      ['Insert', 'Borders and shading'],
      ['Insert', 'Table'],
      ['Help', 'Keyboard shortcuts'],
    ])
    expect(commands[0]).toMatchObject({ key: 'file/print', shortcut: { key: 'p', mod: true }, disabled: false })
    expect(commands[2]).toMatchObject({ key: 'format/text/bold', checked: true })
  })

  it('greys commands that are greyed or sit in a greyed submenu', () => {
    const commands = flattenMenus(menus())
    const disabled = commands.filter((command) => command.disabled).map((command) => command.key)
    expect(disabled).toEqual(['format/table/delete-table', 'format/clear'])
  })

  it('reads each menu when called, so state and labels are current', () => {
    let bold = false
    const items = vi.fn(() => [item('bold', bold ? 'Bold (on)' : 'Bold', { checked: bold })])
    const definitions: MenuDefinition[] = [{ id: 'format', label: 'Format', items }]
    expect(flattenMenus(definitions)[0]).toMatchObject({ label: 'Bold', checked: false })
    bold = true
    expect(flattenMenus(definitions)[0]).toMatchObject({ label: 'Bold (on)', checked: true })
    expect(items).toHaveBeenCalledTimes(2)
  })

  it('keeps keys unique when two rows share an id', () => {
    const commands = flattenMenus([{ id: 'view', label: 'View', items: () => [item('zoom', 'Zoom in'), item('zoom', 'Zoom out')] }])
    expect(commands.map((command) => command.key)).toEqual(['view/zoom', 'view/zoom~2'])
  })
})

describe('searchMenuCommands', () => {
  const commands = flattenMenus(menus())
  const search = (query: string) => labels(searchMenuCommands(commands, query))

  it('lists everything in menu order with no query', () => {
    expect(search('')).toEqual(labels(commands))
    expect(search('   ')).toEqual(labels(commands))
  })

  it('ranks the label itself, then labels starting with the query, then words starting with it', () => {
    expect(search('table')[0]).toBe('Table')
    expect(search('table')).toEqual(['Table', 'Delete table'])
    expect(search('line')).toEqual(['Line spacing', 'Horizontal line', 'Underline'])
    expect(search('LINE SP')).toEqual(['Line spacing'])
  })

  it('matches menu names with the label ("format bold") but ranks label matches first', () => {
    expect(search('format bold')).toEqual(['Bold'])
    expect(search('text')).toEqual(['Bold', 'Underline', 'Subíndice'])
    // "Clear formatting" names it; the rest only sit in Format.
    expect(search('format')[0]).toBe('Clear formatting')
  })

  it('ignores accents and case', () => {
    expect(search('subindice')).toEqual(['Subíndice'])
    expect(search('SUBÍN')).toEqual(['Subíndice'])
  })

  it('finds words inside words and, last, letters in order', () => {
    expect(search('ading')).toEqual(['Borders and shading'])
    expect(search('brdrs')).toEqual(['Borders and shading'])
    // Two letters are too few to match out of order, and one only starts words (the Insert menu's here).
    expect(search('bs')).toEqual([])
    expect(search('i')).toEqual(['Horizontal line', 'Borders and shading', 'Table'])
    expect(search('zzz')).toEqual([])
  })

  it('puts greyed commands after the ones that can run, among equals', () => {
    const tied = flattenMenus([{ id: 'edit', label: 'Edit', items: () => [item('a', 'Paste', { disabled: true }), item('b', 'Paste special')] }])
    expect(labels(searchMenuCommands(tied, 'paste'))).toEqual(['Paste', 'Paste special'])
    const equal = flattenMenus([{ id: 'edit', label: 'Edit', items: () => [item('a', 'Cut', { disabled: true }), item('b', 'Cut')] }])
    expect(searchMenuCommands(equal, 'cut').map((command) => command.key)).toEqual(['edit/b', 'edit/a'])
  })

  it('looks for punctuation as written', () => {
    const zoom = flattenMenus([{ id: 'view', label: 'View', items: () => [{ type: 'submenu', id: 'zoom', label: 'Zoom', items: [item('50', '50%'), item('100', '100%')] }] }])
    expect(labels(searchMenuCommands(zoom, '%'))).toEqual(['50%', '100%'])
    expect(labels(searchMenuCommands(zoom, 'zoom 100'))).toEqual(['100%'])
  })
})

describe('menu bar keys', () => {
  const key = (init: Partial<KeyboardEvent> & { altGraph?: boolean }) => ({
    key: '', code: '', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...init,
    getModifierState: (name: string) => name === 'AltGraph' && Boolean(init.altGraph),
  })

  it('searches the menus with Alt+/ by character elsewhere, and Option+/ on a Mac', () => {
    expect(isMenuSearchKey(key({ key: '/', code: 'Slash', altKey: true }), false)).toBe(true)
    // German: "/" is Shift+7.
    expect(isMenuSearchKey(key({ key: '/', code: 'Digit7', altKey: true, shiftKey: true }), false)).toBe(true)
    // The German "-" key sits where US keyboards have "/".
    expect(isMenuSearchKey(key({ key: '-', code: 'Slash', altKey: true }), false)).toBe(false)
    expect(isMenuSearchKey(key({ key: '/', code: 'Slash' }), false)).toBe(false)
    // AltGr types characters: Ctrl+Alt on Windows, AltGraph on Linux.
    expect(isMenuSearchKey(key({ key: '/', altKey: true, ctrlKey: true }), false)).toBe(false)
    expect(isMenuSearchKey(key({ key: '/', altKey: true, altGraph: true }), false)).toBe(false)
    expect(isMenuSearchKey(key({ key: '/', altKey: true, metaKey: true }), false)).toBe(false)

    expect(isMenuSearchKey(key({ key: '÷', code: 'Slash', altKey: true }), true)).toBe(true)
    // Option types an en dash on that key of a German Mac: typing it stays typing.
    expect(isMenuSearchKey(key({ key: '–', code: 'Slash', altKey: true }), true)).toBe(false)
    expect(isMenuSearchKey(key({ key: '/', code: 'Digit7', altKey: true, shiftKey: true }), true)).toBe(false)
  })

  it('opens the File menu with Alt+Shift+F, or Ctrl+Option+F on a Mac', () => {
    expect(isMenuBarKey(key({ key: 'F', code: 'KeyF', altKey: true, shiftKey: true }), false)).toBe(true)
    // A Cyrillic layout types "А" on the F key.
    expect(isMenuBarKey(key({ key: 'А', code: 'KeyF', altKey: true, shiftKey: true }), false)).toBe(true)
    // Dvorak types U on that key: another letter.
    expect(isMenuBarKey(key({ key: 'U', code: 'KeyF', altKey: true, shiftKey: true }), false)).toBe(false)
    expect(isMenuBarKey(key({ key: 'f', code: 'KeyF', altKey: true }), false)).toBe(false)
    expect(isMenuBarKey(key({ key: 'F', code: 'KeyF', altKey: true, shiftKey: true, ctrlKey: true }), false)).toBe(false)
    expect(isMenuBarKey(key({ key: 'F', code: 'KeyF', altKey: true, shiftKey: true, altGraph: true }), false)).toBe(false)

    expect(isMenuBarKey(key({ key: 'ƒ', code: 'KeyF', altKey: true, ctrlKey: true }), true)).toBe(true)
    expect(isMenuBarKey(key({ key: 'f', code: 'KeyF', altKey: true, ctrlKey: true }), true)).toBe(true)
    // Dvorak's F sits on the Y key; Option makes it "ƒ" there too. Its U key, where QWERTY has F, is
    // a dead key under Option.
    expect(isMenuBarKey(key({ key: 'ƒ', code: 'KeyY', altKey: true, ctrlKey: true }), true)).toBe(true)
    expect(isMenuBarKey(key({ key: 'Dead', code: 'KeyF', altKey: true, ctrlKey: true }), true)).toBe(false)
    expect(isMenuBarKey(key({ key: 'ƒ', code: 'KeyF', altKey: true, shiftKey: true }), false)).toBe(false)
    // Option+Shift+F types "Ï"; Cmd+Option+F is the editors' Find and replace.
    expect(isMenuBarKey(key({ key: 'Ï', code: 'KeyF', altKey: true, shiftKey: true }), true)).toBe(false)
    expect(isMenuBarKey(key({ key: 'ƒ', code: 'KeyF', altKey: true, metaKey: true }), true)).toBe(false)
  })
})
