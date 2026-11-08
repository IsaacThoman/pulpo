// @vitest-environment jsdom
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { MAX_COLS, MAX_ROWS, WorkbookModel } from '@pulpo/client-core/office/sheets'
import { SheetView } from '@pulpo/client-core/office/sheets/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { shortcutGroupsFromMenus, type MenuDefinition, type MenuEntry } from '../chrome/menu'
import { formatShortcut, type ShortcutSpec } from '../chrome/shortcuts'
import { cellMenuEntries } from './cell-menu'
import { addAlternatingColors, sheetMenus, type SheetMenuActions } from './sheet-menus'
import { menusForShortcuts, sheetShortcutGroups } from './sheet-shortcuts'

let views: SheetView[] = []

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const context = new Proxy({ measureText: (text: string) => ({ width: String(text).length * 7 }) }, {
    get: (target, key) => target[key as keyof typeof target] ?? (() => {}),
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
})
afterEach(() => {
  for (const view of views) view.destroy()
  views = []
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function makeView(options: { fileFormat?: 'xlsx' | 'csv'; readOnly?: boolean } = {}): SheetView {
  const doc = new Y.Doc()
  const book = WorkbookModel.initialize(doc)
  const sheet = book.addSheet('Sheet1')
  sheet.setCell(0, 0, { v: 'Region' })
  sheet.setCell(0, 1, { v: 'Q1' })
  sheet.setCell(1, 0, { v: 'North' })
  sheet.setCell(1, 1, { v: 10 })
  sheet.setCell(2, 0, { v: 'South' })
  sheet.setCell(2, 1, { v: 20 })
  const view = new SheetView({ container: document.createElement('div'), doc, assets: new MemoryLiveAssetStore(), user: { name: 'Ada', color: '#123456' }, readOnly: !!options.readOnly, fileFormat: options.fileFormat ?? 'xlsx' })
  views.push(view)
  return view
}

const actions = (): SheetMenuActions => ({
  cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), find: vi.fn(), link: vi.fn(), note: vi.fn(), image: vi.fn(), shortcuts: vi.fn(),
  customNumberFormat: vi.fn(), validation: vi.fn(), conditional: vi.fn(), sortRange: vi.fn(), resize: vi.fn(),
})

const file: MenuDefinition = { id: 'file', label: 'File', items: () => [] }

/** Every row by id, submenus included. */
function flatten(entries: readonly MenuEntry[]): Map<string, MenuEntry> {
  const found = new Map<string, MenuEntry>()
  for (const entry of entries) {
    if (entry.type === 'item' || entry.type === 'submenu' || entry.type === 'custom') found.set(entry.id, entry)
    if (entry.type === 'submenu') for (const [id, child] of flatten(entry.items)) found.set(id, child)
  }
  return found
}
const labels = (entries: readonly MenuEntry[]) => entries.flatMap((entry) => entry.type === 'item' || entry.type === 'submenu' ? [entry.label] : [])
const item = (entries: Map<string, MenuEntry>, id: string) => {
  const entry = entries.get(id)
  if (entry?.type !== 'item') throw new Error(`no item ${id}`)
  return entry
}
const menu = (view: SheetView, id: string, run = actions()) => flatten(sheetMenus(view, file, run).find((entry) => entry.id === id)!.items())

describe('sheet menus', () => {
  it('lays out the menu bar as Google Sheets does', () => {
    const view = makeView()
    expect(sheetMenus(view, file, actions()).map((entry) => entry.id)).toEqual(['file', 'edit', 'view', 'insert', 'format', 'data', 'help'])
  })

  it('counts the selected lines in Insert and Edit ▸ Delete', () => {
    const view = makeView()
    view.select({ top: 1, left: 1, bottom: 3, right: 2 })
    const insert = menu(view, 'insert')
    expect(item(insert, 'insert-rows-above').label).toBe('Insert 3 rows above')
    expect(item(insert, 'insert-columns-right').label).toBe('Insert 2 columns right')
    const edit = menu(view, 'edit')
    expect(item(edit, 'delete-rows').label).toBe('Rows 2–4')
    expect(item(edit, 'delete-columns').label).toBe('Columns B–C')
    item(insert, 'insert-rows-below').onSelect()
    expect(view.getState().selectionLabel).toBe('B5:C7')
  })

  it('offers only the axis of whole rows or whole columns', () => {
    const view = makeView()
    view.select({ top: 0, left: 1, bottom: MAX_ROWS - 1, right: 1 })
    const insert = menu(view, 'insert')
    expect(insert.get('insert-rows')).toMatchObject({ disabled: true })
    expect(insert.get('insert-columns')).toMatchObject({ disabled: false })
    expect(menu(view, 'edit').has('delete-rows')).toBe(false)
    expect(menu(view, 'data').get('sort-range')).toMatchObject({ disabled: true })
  })

  it('checks the current number format, applies the view’s quick formats, and opens the custom dialog', () => {
    const view = makeView()
    view.select({ top: 1, left: 1, bottom: 1, right: 1 })
    const run = actions()
    const format = menu(view, 'format', run)
    expect(item(format, 'number-automatic').checked).toBe(true)
    item(format, 'number-currency').onSelect()
    expect(view.styleAt(1, 1).numFmt).toBe(view.quickFormat('currency'))
    expect(item(menu(view, 'format'), 'number-currency').checked).toBe(true)
    item(format, 'number-custom').onSelect()
    expect(run.customNumberFormat).toHaveBeenCalledOnce()
  })

  it('toggles gridlines and formulas from View ▸ Show', () => {
    const view = makeView()
    item(menu(view, 'view'), 'show-gridlines').onSelect()
    expect(view.getState().showGridLines).toBe(false)
    expect(item(menu(view, 'view'), 'show-gridlines').checked).toBe(false)
    item(menu(view, 'view'), 'show-formulas').onSelect()
    expect(view.getState().showFormulas).toBe(true)
  })

  it('keeps formats, notes, links and rules out of CSV files and edits out of read-only ones', () => {
    const csv = makeView({ fileFormat: 'csv' })
    const format = menu(csv, 'format')
    expect(format.get('format-number')).toMatchObject({ disabled: true })
    expect(item(format, 'conditional-formatting').disabled).toBe(true)
    expect(item(menu(csv, 'insert'), 'insert-note').disabled).toBe(true)
    expect(item(menu(csv, 'data'), 'data-validation').disabled).toBe(true)
    expect(menu(csv, 'edit').has('paste-formats')).toBe(false)
    expect(item(menu(csv, 'view'), 'show-gridlines').disabled).toBe(true)

    const readOnly = makeView({ readOnly: true })
    expect(item(menu(readOnly, 'edit'), 'paste').disabled).toBe(true)
    expect(menu(readOnly, 'insert').get('insert-rows')).toMatchObject({ disabled: true })
    // Showing formulas only changes this viewer's view.
    expect(item(menu(readOnly, 'view'), 'show-formulas').disabled).toBeFalsy()
  })

  it('adds alternating colors over the data around a single cell', () => {
    const view = makeView()
    view.select({ top: 1, left: 0, bottom: 1, right: 0 })
    expect(addAlternatingColors(view)).toBe(true)
    expect(view.getState().selectionLabel).toBe('A1:B3')
    expect([...view.sheet.cf.values()]).toHaveLength(1)
  })
})

describe('cell menu', () => {
  it('names the counts of a cell selection and offers sorting and the rule dialogs', () => {
    const view = makeView()
    view.select({ top: 1, left: 0, bottom: 2, right: 1 })
    const run = actions()
    const entries = cellMenuEntries(view, run)
    const rows = flatten(entries)
    expect(labels(entries)).toEqual(expect.arrayContaining(['Insert 2 rows above', 'Insert 2 columns left', 'Delete rows 2–3', 'Delete columns A–B', 'Clear contents', 'Sort range', 'Create a filter', 'Insert link', 'Insert note', 'Conditional formatting…', 'Data validation…']))
    item(rows, 'sort-range-advanced').onSelect()
    item(rows, 'data-validation').onSelect()
    item(rows, 'insert-link').onSelect()
    expect(run.sortRange).toHaveBeenCalledOnce()
    expect(run.validation).toHaveBeenCalledOnce()
    expect(run.link).toHaveBeenCalledOnce()
  })

  it('keeps singular labels for one line, as the existing menu named them', () => {
    const view = makeView()
    view.select({ top: 4, left: 2, bottom: 4, right: 2 })
    expect(labels(cellMenuEntries(view, actions()))).toEqual(expect.arrayContaining(['Insert row above', 'Insert row below', 'Insert column left', 'Insert column right', 'Delete row', 'Delete column']))
    expect(labels(cellMenuEntries(view, actions()))).not.toContain('Sort range')
  })

  it('gives whole rows only row commands, with Hide, Unhide and Resize', () => {
    const view = makeView()
    view.select({ top: 1, left: 0, bottom: 3, right: MAX_COLS - 1 })
    const run = actions()
    const entries = cellMenuEntries(view, run)
    const rows = flatten(entries)
    const shown = labels(entries)
    expect(shown).toEqual(expect.arrayContaining(['Insert 3 rows above', 'Delete rows 2–4', 'Hide rows 2–4', 'Unhide rows', 'Resize rows 2–4…', 'Fit to data']))
    expect(shown.some((label) => /column/i.test(label))).toBe(false)
    expect(shown).not.toContain('Insert link')
    expect(item(rows, 'unhide-rows').disabled).toBe(true)
    item(rows, 'hide-rows').onSelect()
    expect(view.rows.isHidden(2)).toBe(true)
    expect(item(flatten(cellMenuEntries(view, run)), 'unhide-rows').disabled).toBe(false)
    item(rows, 'resize-rows').onSelect()
    expect(run.resize).toHaveBeenCalledWith('row')
  })

  it('gives whole columns only column commands', () => {
    const view = makeView()
    view.select({ top: 0, left: 1, bottom: MAX_ROWS - 1, right: 3 })
    const shown = labels(cellMenuEntries(view, actions()))
    expect(shown).toEqual(expect.arrayContaining(['Insert 3 columns left', 'Delete columns B–D', 'Hide columns B–D', 'Unhide columns', 'Resize columns B–D…']))
    expect(shown.some((label) => /\brows?\b/i.test(label))).toBe(false)
  })

  it('offers no formats, notes, links or sizes in CSV files', () => {
    const view = makeView({ fileFormat: 'csv' })
    view.select({ top: 1, left: 0, bottom: MAX_ROWS - 1, right: 0 })
    view.select({ top: 1, left: 0, bottom: 2, right: 1 })
    const rows = flatten(cellMenuEntries(view, actions()))
    for (const id of ['paste-formats', 'insert-link', 'insert-note', 'conditional-formatting', 'data-validation', 'hide-rows', 'resize-rows']) expect(rows.has(id)).toBe(false)
    expect(rows.has('insert-rows-above')).toBe(true)
  })

  it('lists each key the shortcuts dialog shows once per platform style', () => {
    const groups = sheetShortcutGroups()
    expect(groups.map((group) => group.id)).toEqual(['common', 'navigation', 'editing', 'lines', 'formatting'])
    const all = groups.flatMap((group) => group.items.map((entry) => entry.label))
    expect(all).toEqual(expect.arrayContaining(['Paste values only', 'Go to a cell or range', 'Insert link', 'AutoSum', 'Hide rows', 'Currency format', 'Show formulas', 'Create or remove a filter']))
    expect(new Set(all).size).toBe(all.length)
  })

  it('leaves out menu keys the sheet’s own list already names, and keeps the menus’ hints', () => {
    const view = makeView()
    const groups = sheetShortcutGroups()
    const menus = sheetMenus(view, file, actions())
    const composed = shortcutGroupsFromMenus(menusForShortcuts(menus, groups), groups)
    const keyText = (key: ShortcutSpec | string) => typeof key === 'string' ? key : formatShortcut(key)
    const own = new Set(groups.flatMap((group) => group.items.flatMap((entry) => entry.keys.map(keyText))))
    const fromMenus = composed.filter((group) => !groups.some((mine) => mine.id === group.id)).flatMap((group) => group.items)
    for (const entry of fromMenus) for (const key of entry.keys) expect(own.has(keyText(key)), `${entry.label} ${keyText(key)}`).toBe(false)
    expect(item(flatten(menus.find((entry) => entry.id === 'insert')!.items()), 'insert-link').shortcut).toEqual({ key: 'k', mod: true })
  })
})
