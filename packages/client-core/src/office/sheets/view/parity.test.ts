// @vitest-environment jsdom
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../../assets.js'
import { MAX_COLS, MAX_ROWS, type CellRange } from '../address.js'
import { SheetCodec } from '../codec/codec.js'
import { toIdForm } from '../model/formula-ids.js'
import type { ConditionalFormat, DataValidation } from '../model/schema.js'
import { WorkbookModel } from '../model/workbook.js'
import { CONDITIONAL_STYLES, Stylesheet } from '../styles/stylesheet.js'
import { toHtml } from './clipboard.js'
import * as commands from './commands.js'
import { alternatingRowsRule, colorScaleRule, dataBarRule, highlightRule, iconSetRule } from './conditional-presets.js'
import { SheetView, type SheetRequest, type SheetViewOptions } from './sheet-view.js'

const views: SheetView[] = []
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const context = new Proxy({ fillText: vi.fn(), measureText: (text: string) => ({ width: String(text).length * 7 }), getLineDash: () => [] }, {
    get: (target, key) => target[key as keyof typeof target] ?? (() => {}),
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
})
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mount(doc: Y.Doc, options: Partial<SheetViewOptions> = {}): SheetView {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const view = new SheetView({ container, doc, assets: new MemoryLiveAssetStore(), user: { name: 'Test', color: '#123456' }, ...options })
  view.root.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
  // jsdom has no layout: the scroller's client area is the whole view (no scrollbars).
  Object.defineProperty(view.scroller, 'clientWidth', { value: 800, configurable: true })
  Object.defineProperty(view.scroller, 'clientHeight', { value: 600, configurable: true })
  view.resize()
  views.push(view)
  return view
}

function setup(options: Partial<SheetViewOptions> = {}) {
  const doc = new Y.Doc()
  const book = WorkbookModel.initialize(doc)
  const sheet = book.addSheet('Sheet1')
  const view = mount(doc, options)
  return { doc, book, sheet, view }
}

/** Delivers a separate replica's change, as a collaborator's edit arrives. */
function remote(doc: Y.Doc, change: (book: WorkbookModel) => void) {
  const replica = new Y.Doc()
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))
  const vector = Y.encodeStateVector(replica)
  change(new WorkbookModel(replica))
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(replica, vector), 'remote')
  replica.destroy()
}

const cell = (row: number, col: number): CellRange => ({ top: row, left: col, bottom: row, right: col })

function key(view: SheetView, name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init })
  view.input.dispatchEvent(event)
  return event
}

function pointer(view: SheetView, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...init })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  ;(type === 'pointerdown' ? view.scroller : window).dispatchEvent(event)
  return event
}

function center(view: SheetView, row: number, col: number): { x: number; y: number } {
  const rect = view.cellRect(row, col)
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function click(view: SheetView, row: number, col: number, init: MouseEventInit = {}): void {
  const { x, y } = center(view, row, col)
  pointer(view, 'pointerdown', x, y, init)
  pointer(view, 'pointerup', x, y, init)
}

function requests(view: SheetView, claim = true): SheetRequest[] {
  const seen: SheetRequest[] = []
  view.root.addEventListener('sheetrequest', (event) => {
    seen.push((event as CustomEvent<SheetRequest>).detail)
    if (claim) event.preventDefault()
  })
  return seen
}

const alertText = (view: SheetView) => view.root.querySelector('[role="alert"]')?.textContent

describe('header right-click', () => {
  it('selects the clicked column, row, or everything unless it is already selected', () => {
    const { view } = setup()
    view.select(cell(0, 0))
    const column = center(view, 0, 4)
    pointer(view, 'pointerdown', column.x, view.headerHeight / 2, { button: 2 })
    expect(view.getState().selectionLabel).toBe('E:E')
    expect(view.getState().selectionShape).toBe('columns')
    // Inside a selected E:G, the selection stays.
    view.select({ top: 0, left: 4, bottom: MAX_ROWS - 1, right: 6 })
    const g = center(view, 0, 6)
    pointer(view, 'pointerdown', g.x, view.headerHeight / 2, { button: 2 })
    expect(view.getState().selectionLabel).toBe('E:G')
    const row = center(view, 5, 0)
    pointer(view, 'pointerdown', view.headerWidth / 2, row.y, { button: 2 })
    expect(view.getState().selectionLabel).toBe('6:6')
    expect(view.getState().selectionShape).toBe('rows')
    // A cell inside whole selected rows keeps them.
    const inside = center(view, 5, 3)
    pointer(view, 'pointerdown', inside.x, inside.y, { button: 2 })
    expect(view.getState().selectionShape).toBe('rows')
    pointer(view, 'pointerdown', 2, 2, { button: 2 })
    expect(view.getState().selectionShape).toBe('all')
    expect(view.selection.ranges).toEqual([{ top: 0, left: 0, bottom: MAX_ROWS - 1, right: MAX_COLS - 1 }])
  })

  it('makes the menu delete the column that was right-clicked', () => {
    const { sheet, view } = setup()
    sheet.setCell(0, 0, { v: 'A' })
    sheet.setCell(0, 4, { v: 'E' })
    view.select(cell(0, 0))
    const column = center(view, 0, 4)
    pointer(view, 'pointerdown', column.x, view.headerHeight / 2, { button: 2 })
    view.deleteLines('col')
    expect(view.inputText(0, 0)).toBe('A')
    expect(view.inputText(0, 4)).toBe('')
  })
})

describe('per-viewer zoom', () => {
  it('never writes the document or the undo history', () => {
    const { sheet, view } = setup()
    view.setZoom(1.5)
    expect(view.zoom).toBe(1.5)
    expect(view.undoManager.canUndo()).toBe(false)
    expect(sheet.viewProp('zoom')).toBeUndefined()
  })

  it('starts from the file zoom, keeps it for export, and ignores remote zoom changes', async () => {
    const doc = new Y.Doc()
    const book = WorkbookModel.initialize(doc)
    const sheet = book.addSheet('Sheet1')
    sheet.setViewProp('zoom', 150)
    const view = mount(doc)
    expect(view.zoom).toBe(1.5)
    view.setZoom(2)
    expect(sheet.viewProp('zoom')).toBe(150)
    remote(doc, (other) => other.sheets()[0]!.setViewProp('zoom', 50))
    expect(view.zoom).toBe(2)
    // Undo rebuilds the sheet; the viewer's zoom survives it.
    view.beginEdit('x')
    view.commitEdit()
    view.undo()
    expect(view.zoom).toBe(2)
    const files = unzipSync(await new SheetCodec().exportFile(doc, { name: 'zoom.xlsx', assets: view.options.assets }))
    expect(strFromU8(files['xl/worksheets/sheet1.xml']!)).toContain('zoomScale="50"')
  })

  it('keeps a zoom per sheet', () => {
    const { book, view } = setup()
    const other = book.addSheet('Other')
    const first = view.sheetId
    view.setZoom(1.25)
    view.setActiveSheet(other.id)
    expect(view.zoom).toBe(1)
    view.setZoom(0.75)
    view.setActiveSheet(first)
    expect(view.zoom).toBe(1.25)
  })
})

describe('Tab and Enter data entry', () => {
  it('returns Enter to the column the run of Tabs started from', () => {
    const { view } = setup()
    view.select(cell(1, 0))
    for (const text of ['a', 'b']) {
      view.beginEdit(text, true)
      key(view, 'Tab')
    }
    view.beginEdit('c', true)
    key(view, 'Enter')
    expect(view.getState().selectionLabel).toBe('A3')
    expect([view.inputText(1, 0), view.inputText(1, 1), view.inputText(1, 2)]).toEqual(['a', 'b', 'c'])
    // Without editing, and Shift+Enter goes up in the origin column.
    key(view, 'Tab')
    key(view, 'Tab')
    key(view, 'Enter', { shiftKey: true })
    expect(view.getState().selectionLabel).toBe('A2')
  })

  it('starts a new run after a click and keeps wrapping inside a selection', () => {
    const { view } = setup()
    view.select(cell(4, 1))
    key(view, 'Tab')
    view.select(cell(4, 3))
    key(view, 'Enter')
    expect(view.getState().selectionLabel).toBe('D6')
    view.select({ top: 0, left: 0, bottom: 1, right: 1 })
    key(view, 'Tab')
    key(view, 'Tab')
    expect(view.selection.active).toEqual({ row: 1, col: 0 })
    key(view, 'Enter')
    expect(view.selection.active).toEqual({ row: 0, col: 1 })
  })
})

describe('hidden row and column markers', () => {
  it('marks hidden columns and unhides them with one click and one undo step', () => {
    const { view } = setup()
    view.select({ top: 0, left: 2, bottom: MAX_ROWS - 1, right: 3 })
    view.hideLines('col', true)
    expect(view.hiddenMarks().cols).toEqual([4])
    expect(view.scene().hiddenMarks?.cols).toEqual([4])
    const edge = view.cellRect(0, 4).x
    // Within 4px of the boundary it is still the resize handle.
    pointer(view, 'pointerdown', edge + 2, view.headerHeight / 2)
    pointer(view, 'pointerup', edge + 2, view.headerHeight / 2)
    expect(view.cols.isHidden(2)).toBe(true)
    const steps = view.undoManager.undoStack.length
    pointer(view, 'pointerdown', edge + 8, view.headerHeight / 2)
    pointer(view, 'pointerup', edge + 8, view.headerHeight / 2)
    expect([view.cols.isHidden(2), view.cols.isHidden(3)]).toEqual([false, false])
    expect(view.undoManager.undoStack.length).toBe(steps + 1)
    view.undo()
    expect([view.cols.isHidden(2), view.cols.isHidden(3)]).toEqual([true, true])
  })

  it('marks manually hidden rows but not rows a filter hides', () => {
    const { sheet, view } = setup()
    commands.setHidden(sheet, 'row', [6], true)
    sheet.filter.set('value', { range: sheet.rangeIds({ top: 0, left: 0, bottom: 4, right: 0 }), columns: [], hiddenRows: [sheet.rows.idAt(2)] })
    sheet.setRowProp([2], 'hidden', true)
    expect(view.hiddenMarks().rows).toEqual([7])
    const edge = view.cellRect(7, 0).y
    pointer(view, 'pointerdown', view.headerWidth / 2, edge - 7)
    expect(view.rows.isHidden(6)).toBe(false)
    expect(view.rows.isHidden(2)).toBe(true)
  })

  it('offers no marker that is scrolled under frozen columns', () => {
    const { sheet, view } = setup()
    commands.setFrozen(sheet, 0, 2)
    commands.setHidden(sheet, 'col', [5], true)
    expect(view.hiddenMarks().cols).toEqual([6])
    // Column G's left edge slides 10px under the frozen A:B.
    const cols = view.scene().cols
    view.scroller.scrollLeft = (cols.offset(6) - cols.offset(2)) * view.zoom + 10
    expect(view.hiddenMarks().cols).toEqual([])
    const frozenEdge = view.cellRect(0, 2).x
    pointer(view, 'pointerdown', frozenEdge - 4, view.headerHeight / 2)
    pointer(view, 'pointerup', frozenEdge - 4, view.headerHeight / 2)
    expect(view.cols.isHidden(5)).toBe(true)
  })

  it('brings back lines dragged to zero size', () => {
    const { view } = setup()
    view.resizeLines('row', 0, [2])
    view.resizeLines('col', 0, [3])
    expect([view.rows.isHidden(2), view.cols.isHidden(3)]).toEqual([true, true])
    view.unhideBefore('row', 3)
    view.unhideBefore('col', 4)
    expect([view.rows.isHidden(2), view.cols.isHidden(3)]).toEqual([false, false])
    expect([view.rows.size(2), view.cols.size(3)]).toEqual([view.rows.defaultSize, view.cols.defaultSize])
  })
})

describe('paint format', () => {
  it('paints formats once onto the next clicked cell, keeping its value', () => {
    const { sheet, view } = setup()
    sheet.setCell(2, 2, { v: 'keep' })
    view.select(cell(0, 0))
    view.setStyle({ bold: true, fill: { rgb: 'FFFF00' } })
    const steps = view.undoManager.undoStack.length
    expect(view.startFormatPainter()).toBe(true)
    expect(view.getState().formatPainter).toEqual({ sticky: false })
    click(view, 2, 2)
    expect(view.styleAt(2, 2)).toMatchObject({ bold: true, fill: { rgb: 'FFFF00' } })
    expect(view.inputText(2, 2)).toBe('keep')
    expect(view.undoManager.undoStack.length).toBe(steps + 1)
    expect(view.getState().formatPainter).toBeUndefined()
    click(view, 3, 3)
    expect(view.styleAt(3, 3).bold).toBe(false)
  })

  it('stays on when sticky until Escape', () => {
    const { view } = setup()
    view.setStyle({ italic: true })
    view.startFormatPainter(true)
    click(view, 2, 2)
    click(view, 4, 4)
    expect([view.styleAt(2, 2).italic, view.styleAt(4, 4).italic]).toEqual([true, true])
    expect(view.getState().formatPainter).toEqual({ sticky: true })
    key(view, 'Escape')
    expect(view.getState().formatPainter).toBeUndefined()
    click(view, 6, 6)
    expect(view.styleAt(6, 6).italic).toBe(false)
  })

  it('paints the source shape at the top-left of a destination that is not a multiple of it', () => {
    const { view } = setup()
    view.select(cell(0, 0))
    view.setStyle({ bold: true })
    view.select(cell(0, 1))
    view.setStyle({ italic: true })
    view.select({ top: 0, left: 0, bottom: 0, right: 1 })
    view.startFormatPainter()
    const from = center(view, 4, 4)
    const to = center(view, 6, 6)
    pointer(view, 'pointerdown', from.x, from.y)
    pointer(view, 'pointermove', to.x, to.y)
    pointer(view, 'pointerup', to.x, to.y)
    expect([view.styleAt(4, 4).bold, view.styleAt(4, 5).italic, view.styleAt(5, 4).bold, view.styleAt(4, 6).bold]).toEqual([true, true, false, false])
    expect(view.getState().selectionLabel).toBe('E5:F5')
  })

  it('is refused for multiple selections, read-only and CSV views', () => {
    const { view } = setup()
    view.select(cell(0, 0))
    view.select(cell(2, 2), { add: true })
    expect(view.startFormatPainter()).toBe(false)
    expect(alertText(view)).toBe(view.labels.multipleSelections)
    view.select(cell(0, 0))
    view.readOnly = true
    expect(view.startFormatPainter()).toBe(false)
    view.readOnly = false
    view.setFileFormat('csv')
    expect(view.startFormatPainter()).toBe(false)
  })
})

describe('AutoSum', () => {
  const numbers = (sheet: ReturnType<typeof setup>['sheet']) => {
    sheet.setCell(0, 1, { v: 'Total' })
    for (const [row, value] of [[1, 1], [2, 2], [3, 3], [4, 4]] as const) sheet.setCell(row, 1, { v: value })
  }

  it('proposes the numbers above, pointed so Shift+arrows adjust them', () => {
    const { sheet, view } = setup()
    numbers(sheet)
    view.select(cell(5, 1))
    expect(view.autoSum()).toBe(true)
    expect(view.editing?.text).toBe('=SUM(B2:B5)')
    key(view, 'ArrowUp', { shiftKey: true })
    expect(view.editing?.text).toBe('=SUM(B2:B4)')
    key(view, 'Enter')
    expect(view.inputText(5, 1)).toBe('=SUM(B2:B4)')
    expect(view.valueAt(5, 1)).toBe(6)
  })

  it('looks left when nothing is above, and starts an empty call otherwise', () => {
    const { sheet, view } = setup()
    sheet.setCell(3, 0, { v: 2 })
    sheet.setCell(3, 1, { v: 5 })
    view.select(cell(3, 2))
    view.autoSum('average')
    expect(view.editing?.text).toBe('=AVERAGE(A4:B4)')
    view.cancelEdit()
    view.select(cell(10, 10))
    view.autoSum()
    expect(view.editing?.text).toBe('=SUM()')
    expect(view.editing?.caret).toBe(5)
  })

  it('starts from Alt+= on Windows and Linux', () => {
    const { sheet, view } = setup()
    numbers(sheet)
    view.select(cell(5, 1))
    const event = key(view, '=', { code: 'Equal', altKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(view.editing?.text).toBe('=SUM(B2:B5)')
  })

  it('writes totals below each selected column in one undo step', () => {
    const { sheet, view } = setup()
    numbers(sheet)
    for (const row of [1, 2, 3, 4]) sheet.setCell(row, 2, { v: row * 10 })
    view.select({ top: 1, left: 1, bottom: 4, right: 2 })
    const steps = view.undoManager.undoStack.length
    expect(view.autoSum()).toBe(true)
    expect([view.inputText(5, 1), view.inputText(5, 2)]).toEqual(['=SUM(B2:B5)', '=SUM(C2:C5)'])
    expect([view.valueAt(5, 1), view.valueAt(5, 2)]).toEqual([10, 100])
    expect(view.undoManager.undoStack.length).toBe(steps + 1)
    expect(view.getState().selectionLabel).toBe('B2:C6')
    view.undo()
    expect([view.inputText(5, 1), view.inputText(5, 2)]).toEqual(['', ''])
  })

  it('totals into an empty last row of the selection, or right of a single row', () => {
    const { sheet, view } = setup()
    numbers(sheet)
    view.select({ top: 1, left: 1, bottom: 5, right: 1 })
    view.autoSum()
    expect(view.inputText(5, 1)).toBe('=SUM(B2:B5)')
    for (const col of [4, 5, 6]) sheet.setCell(9, col, { v: col })
    view.select({ top: 9, left: 4, bottom: 9, right: 6 })
    view.autoSum('MAX')
    expect(view.inputText(9, 7)).toBe('=MAX(E10:G10)')
  })

  it('writes nothing without numbers, and refuses several ranges, merged targets, CSV and read-only views', () => {
    const { doc, sheet, view } = setup()
    numbers(sheet)
    const before = Y.encodeStateAsUpdate(doc)
    view.select({ top: 0, left: 1, bottom: 0, right: 3 })
    expect(view.autoSum()).toBe(false)
    view.select({ top: 1, left: 1, bottom: 2, right: 1 })
    view.select({ top: 3, left: 1, bottom: 4, right: 1 }, { add: true })
    expect(view.autoSum()).toBe(false)
    expect(alertText(view)).toBe(view.labels.multipleSelections)
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
    // A total landing inside a merged cell is refused before writing.
    view.select({ top: 5, left: 0, bottom: 5, right: 1 })
    view.merge()
    view.select({ top: 1, left: 1, bottom: 4, right: 1 })
    expect(view.autoSum()).toBe(false)
    expect(alertText(view)).toBe(view.labels.dataErrors.merges)
    view.setFileFormat('csv')
    expect(view.autoSum()).toBe(false)
    view.setFileFormat('xlsx')
    view.readOnly = true
    view.select(cell(5, 3))
    expect(view.autoSum()).toBe(false)
    expect(view.editing).toBeUndefined()
  })
})

describe('format shortcuts', () => {
  it.each([
    ['Digit1', '!', '#,##0.00'],
    ['Digit2', '@', 'h:mm:ss AM/PM'],
    ['Digit3', '#', 'm/d/yyyy'],
    ['Digit4', '$', '"$"#,##0.00'],
    ['Digit5', '%', '0.00%'],
    ['Digit6', '^', '0.00E+00'],
  ])('Ctrl+Shift+%s applies %s in one undo step', (code, typed, format) => {
    const { view } = setup()
    const event = key(view, typed, { code, ctrlKey: true, shiftKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(view.styleAt(0, 0).numFmt).toBe(format)
    expect(view.undoManager.undoStack.length).toBe(1)
    view.undo()
    expect(view.styleAt(0, 0).numFmt).toBe('General')
  })

  it('uses the host currency, General for Ctrl+Shift+`, and leaves Ctrl+5 as strikethrough', () => {
    const { view } = setup({ quickFormats: { currency: '#,##0.00 "€"' } })
    key(view, '$', { code: 'Digit4', ctrlKey: true, shiftKey: true })
    expect(view.styleAt(0, 0).numFmt).toBe('#,##0.00 "€"')
    expect(view.quickFormat('currency')).toBe('#,##0.00 "€"')
    key(view, '~', { code: 'Backquote', ctrlKey: true, shiftKey: true })
    expect(view.styleAt(0, 0).numFmt).toBe('General')
    key(view, '5', { code: 'Digit5', ctrlKey: true })
    expect(view.styleAt(0, 0).strike).toBe(true)
  })

  it('does nothing in CSV', () => {
    const { view } = setup({ fileFormat: 'csv' })
    key(view, '%', { code: 'Digit5', ctrlKey: true, shiftKey: true })
    expect(view.styleAt(0, 0).numFmt).toBe('General')
  })
})

describe('keyboard shortcuts', () => {
  it('asks the host for the link and note dialogs, leaving unclaimed keys to the browser', () => {
    const { view } = setup()
    const unclaimed = key(view, 'k', { ctrlKey: true })
    expect(unclaimed.defaultPrevented).toBe(false)
    const seen = requests(view)
    expect(key(view, 'k', { ctrlKey: true }).defaultPrevented).toBe(true)
    expect(key(view, 'F2', { shiftKey: true }).defaultPrevented).toBe(true)
    expect(key(view, 'p', { ctrlKey: true }).defaultPrevented).toBe(true)
    expect(seen.map((entry) => entry.request)).toEqual(['link', 'note', 'print'])
    expect(view.editing).toBeUndefined()
  })

  it('inserts and deletes whole selected columns and rows, leaving the zoom keys to cells', () => {
    const { sheet, view } = setup()
    sheet.setCell(0, 1, { v: 'B' })
    sheet.setCell(3, 0, { v: 'row 4' })
    view.select({ top: 0, left: 1, bottom: MAX_ROWS - 1, right: 1 })
    expect(key(view, '+', { code: 'Equal', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true)
    expect(view.inputText(0, 2)).toBe('B')
    expect(key(view, '-', { code: 'Minus', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(view.inputText(0, 1)).toBe('B')
    view.select({ top: 3, left: 0, bottom: 4, right: MAX_COLS - 1 })
    key(view, '=', { code: 'Equal', ctrlKey: true, altKey: true })
    expect(view.inputText(5, 0)).toBe('row 4')
    key(view, '-', { code: 'Minus', ctrlKey: true, altKey: true })
    expect(view.inputText(3, 0)).toBe('row 4')
    // On a German keyboard `-` sits where US keyboards have `/`.
    view.select({ top: 0, left: 1, bottom: MAX_ROWS - 1, right: 1 })
    const seenBefore = requests(view, false)
    expect(key(view, '-', { code: 'Slash', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(view.inputText(0, 1)).toBe('')
    expect(seenBefore).toEqual([])
    view.undo()
    expect(view.inputText(0, 1)).toBe('B')
    view.select(cell(0, 1))
    expect(key(view, '-', { code: 'Minus', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(key(view, '+', { code: 'Equal', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false)
    // Ctrl+Alt+= on cells inserts rows above, as Google does.
    key(view, '=', { code: 'Equal', ctrlKey: true, altKey: true })
    expect(view.inputText(1, 1)).toBe('B')
    const seen = requests(view)
    key(view, '-', { code: 'Minus', ctrlKey: true, altKey: true })
    expect(seen).toEqual([{ request: 'deleteLines' }])
  })

  it('hides and unhides rows and columns with Ctrl+9 and Ctrl+0', () => {
    const { view } = setup()
    view.select({ top: 2, left: 2, bottom: 3, right: 2 })
    key(view, '9', { code: 'Digit9', ctrlKey: true })
    expect([view.rows.isHidden(2), view.rows.isHidden(3)]).toEqual([true, true])
    key(view, '0', { code: 'Digit0', ctrlKey: true })
    expect(view.cols.isHidden(2)).toBe(true)
    view.select({ top: 1, left: 1, bottom: 4, right: 3 })
    key(view, '(', { code: 'Digit9', ctrlKey: true, shiftKey: true })
    key(view, ')', { code: 'Digit0', ctrlKey: true, shiftKey: true })
    expect([view.rows.isHidden(2), view.cols.isHidden(2)]).toEqual([false, false])
    // Google's Ctrl+Alt+9 too; whole columns never hide every row.
    view.select({ top: 0, left: 5, bottom: MAX_ROWS - 1, right: 5 })
    key(view, '9', { code: 'Digit9', ctrlKey: true, altKey: true })
    expect(view.rows.isHidden(0)).toBe(false)
    view.select(cell(6, 0))
    key(view, '9', { code: 'Digit9', ctrlKey: true, altKey: true })
    expect(view.rows.isHidden(6)).toBe(true)
  })

  it('follows Excel for Mac and Google on a Mac, leaving Cmd+9, Cmd+0 and Cmd+H to the browser', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    const { sheet, view } = setup()
    sheet.setCell(0, 0, { v: 1 })
    sheet.setCell(1, 0, { v: 2 })
    view.select(cell(2, 2))
    // Cmd+9 is the last tab and Cmd+0 the actual size: neither hides anything.
    expect(key(view, '9', { code: 'Digit9', metaKey: true }).defaultPrevented).toBe(false)
    expect(key(view, '0', { code: 'Digit0', metaKey: true }).defaultPrevented).toBe(false)
    expect([view.rows.isHidden(2), view.cols.isHidden(2)]).toEqual([false, false])
    expect(view.undoManager.canUndo()).toBe(false)
    // Excel for Mac hides with Control; Google unhides with Cmd+Shift and hides with Cmd+Option.
    key(view, '0', { code: 'Digit0', ctrlKey: true })
    expect(view.cols.isHidden(2)).toBe(true)
    view.select({ top: 0, left: 1, bottom: 4, right: 3 })
    key(view, ')', { code: 'Digit0', metaKey: true, shiftKey: true })
    expect(view.cols.isHidden(2)).toBe(false)
    view.select(cell(2, 2))
    key(view, 'ª', { code: 'Digit9', metaKey: true, altKey: true })
    expect(view.rows.isHidden(2)).toBe(true)
    // Cmd+H hides the browser; Cmd+Shift+H asks for find and replace.
    const seen = requests(view)
    expect(key(view, 'h', { code: 'KeyH', metaKey: true }).defaultPrevented).toBe(false)
    expect(key(view, 'H', { code: 'KeyH', metaKey: true, shiftKey: true }).defaultPrevented).toBe(true)
    expect(seen).toEqual([{ request: 'replace' }])
    // AutoSum is Cmd+Shift+T; Option+= types ≠.
    view.select(cell(2, 0))
    expect(key(view, '≠', { code: 'Equal', altKey: true }).defaultPrevented).toBe(false)
    expect(view.editing).toBeUndefined()
    key(view, 'T', { code: 'KeyT', metaKey: true, shiftKey: true })
    expect(view.editing?.text).toBe('=SUM(A1:A2)')
  })

  it('keeps AltGr characters typeable', () => {
    const { sheet, view } = setup()
    sheet.setCell(4, 4, { v: 'stay' })
    view.select(cell(4, 4))
    for (const [typed, code] of [['@', 'Digit2'], [']', 'Digit9'], ['}', 'Digit0'], ['\\', 'Minus']] as const) {
      const event = key(view, typed, { code, ctrlKey: true, altKey: true })
      expect(event.defaultPrevented).toBe(false)
    }
    const altGraph = new KeyboardEvent('keydown', { key: '=', code: 'Equal', ctrlKey: true, altKey: true, bubbles: true, cancelable: true, modifierAltGraph: true } as KeyboardEventInit)
    view.input.dispatchEvent(altGraph)
    expect(altGraph.defaultPrevented).toBe(false)
    expect([view.rows.isHidden(4), view.cols.isHidden(4)]).toEqual([false, false])
    expect(view.inputText(4, 4)).toBe('stay')
    expect(view.undoManager.canUndo()).toBe(false)
  })

  it('pastes values only after Ctrl+Shift+V', () => {
    const { sheet, view } = setup()
    sheet.setCell(0, 0, { v: 2 })
    sheet.setCell(0, 1, { f: 'A1*2' })
    view.select(cell(0, 1))
    view.setStyle({ bold: true })
    const html = toHtml(view.clipboard.copyPayload()!)
    const paste = () => {
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => type === 'text/html' ? html : '4' } })
      view.input.dispatchEvent(event)
    }
    view.select(cell(3, 3))
    expect(key(view, 'V', { code: 'KeyV', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false)
    paste()
    expect(view.inputText(3, 3)).toBe('4')
    expect(view.styleAt(3, 3).bold).toBe(false)
    // The next paste is a normal one again (formulas move with it).
    view.select(cell(5, 3))
    paste()
    expect(view.inputText(5, 3)).toBe('=C6*2')
  })

  it('extends with Shift+Home and Ctrl+Shift+Home/End, and toggles formulas with Ctrl+`', () => {
    const { sheet, view } = setup()
    sheet.setCell(9, 5, { v: 1 })
    sheet.setCell(1, 1, { f: '1+1' })
    view.select(cell(3, 3))
    key(view, 'Home', { shiftKey: true })
    expect(view.getState().selectionLabel).toBe('A4:D4')
    key(view, 'End', { ctrlKey: true, shiftKey: true })
    expect(view.getState().selectionLabel).toBe('D4:F10')
    view.select(cell(3, 3))
    key(view, 'Home', { ctrlKey: true, shiftKey: true })
    expect(view.getState().selectionLabel).toBe('A1:D4')
    key(view, '`', { code: 'Backquote', ctrlKey: true })
    expect(view.getState().showFormulas).toBe(true)
    expect(view.scene().cell(1, 1).text).toBe('=1+1')
  })

  it('selects the column with Ctrl+Space and the row with Shift+Space', () => {
    const { view } = setup()
    view.select(cell(3, 2))
    key(view, ' ', { code: 'Space', ctrlKey: true })
    expect(view.getState().selectionLabel).toBe('C:C')
    view.select(cell(3, 2))
    key(view, ' ', { code: 'Space', shiftKey: true })
    expect(view.getState().selectionLabel).toBe('4:4')
  })

  it('leaves read-only views alone', () => {
    const { view } = setup({ readOnly: true })
    const seen = requests(view)
    key(view, '9', { code: 'Digit9', ctrlKey: true })
    key(view, 'k', { ctrlKey: true })
    key(view, '$', { code: 'Digit4', ctrlKey: true, shiftKey: true })
    expect(view.rows.isHidden(0)).toBe(false)
    expect(seen).toEqual([])
    expect(view.styleAt(0, 0).numFmt).toBe('General')
  })
})

describe('data validation', () => {
  it('applies a list rule to the selection and reports it for the active cell', () => {
    const { view } = setup()
    view.select({ top: 0, left: 0, bottom: 2, right: 0 })
    const formula1 = commands.listValidationFormula(['Yes', 'No'])!
    expect(view.setValidation({ type: 'list', formula1, showErrorMessage: true })).toBe(true)
    view.select(cell(1, 0))
    const active = view.getState().activeValidation!
    expect(active.rule).toMatchObject({ type: 'list', formula1: '"Yes,No"' })
    expect(active.ranges).toEqual([{ top: 0, left: 0, bottom: 2, right: 0 }])
    const steps = view.undoManager.undoStack.length
    view.beginEdit('Maybe', true)
    key(view, 'Enter')
    expect(view.editing?.text).toBe('Maybe')
    expect(alertText(view)).toBe(view.labels.invalidValue)
    expect(view.undoManager.undoStack.length).toBe(steps)
    view.cancelEdit()
    view.beginEdit('no', true)
    key(view, 'Enter')
    expect(view.inputText(1, 0)).toBe('no')
  })

  it('checks numbers and relative formulas at each cell, and undoes in one step', () => {
    const { sheet, view } = setup()
    view.select({ top: 0, left: 0, bottom: 2, right: 0 })
    view.setValidation({ type: 'whole', operator: 'between', formula1: '1', formula2: '=10' })
    view.select(cell(2, 0))
    view.beginEdit('11', true)
    expect(view.commitEdit()).toBe(false)
    view.cancelEdit()
    view.select({ top: 0, left: 2, bottom: 2, right: 2 })
    view.setValidation({ type: 'custom', formula1: '=B1>0' })
    sheet.setCell(1, 1, { v: 1 })
    view.select(cell(1, 2))
    expect(view.getState().activeValidation?.rule.formula1).toBe('B1>0')
    view.beginEdit('ok', true)
    expect(view.commitEdit()).toBe(true)
    view.select(cell(2, 2))
    view.beginEdit('no', true)
    expect(view.commitEdit()).toBe(false)
    view.cancelEdit()
    // One step for the typed value, one for the rule.
    view.undo()
    expect(commands.validationAt(sheet, 1, 2)).toBeDefined()
    view.undo()
    expect(commands.validationAt(sheet, 1, 2)).toBeUndefined()
    expect(commands.validationAt(sheet, 1, 0)).toBeDefined()
  })

  it('edits an existing multi-range rule in place', () => {
    const { sheet, view } = setup()
    view.select({ top: 0, left: 0, bottom: 2, right: 0 })
    view.select({ top: 0, left: 2, bottom: 2, right: 2 }, { add: true })
    view.setValidation({ type: 'list', formula1: '"a,b"' })
    expect(sheet.dv.size).toBe(1)
    view.select(cell(1, 2))
    const { id } = view.getState().activeValidation!
    expect(view.setValidation({ type: 'whole', operator: 'greaterThan', formula1: '0', error: 'Positive only' }, { ruleId: id })).toBe(true)
    expect(sheet.dv.size).toBe(1)
    const rule = sheet.dv.get(id) as DataValidation
    expect(rule.type).toBe('whole')
    expect(rule.ranges.map((ids) => sheet.resolveRange(ids))).toEqual([{ top: 0, left: 0, bottom: 2, right: 0 }, { top: 0, left: 2, bottom: 2, right: 2 }])
    view.undo()
    expect((sheet.dv.get(id) as DataValidation).type).toBe('list')
    // Without the id the selection gets a rule of its own.
    view.setValidation({ type: 'whole', operator: 'greaterThan', formula1: '0' })
    expect(sheet.dv.size).toBe(2)
    view.select(cell(0, 0))
    view.setValidation(undefined, { ruleId: view.getState().activeValidation!.id })
    expect(commands.validationAt(sheet, 0, 0)).toBeUndefined()
    expect(view.setValidation(undefined, { ruleId: 'missing' })).toBe(false)
  })

  it('asks before accepting a value that breaks a warning rule', () => {
    const { sheet, view } = setup()
    view.select(cell(0, 0))
    view.setValidation({ type: 'whole', operator: 'lessThan', formula1: '10', errorStyle: 'warning', errorTitle: 'Large', error: 'Are you sure?' })
    // Unclaimed (no host dialog), the value is accepted as before.
    view.beginEdit('50', true)
    key(view, 'Enter')
    expect(view.inputText(0, 0)).toBe('50')
    const seen = requests(view)
    view.select(cell(0, 0))
    view.beginEdit('60', true)
    key(view, 'Enter')
    expect(view.editing?.text).toBe('60')
    const asked = seen[0] as Extract<SheetRequest, { request: 'validation' }>
    expect(asked).toMatchObject({ request: 'validation', style: 'warning', title: 'Large', message: 'Are you sure?', row: 0, col: 0 })
    asked.respond('retry')
    expect(view.editing?.text).toBe('60')
    key(view, 'Enter')
    ;(seen[1] as Extract<SheetRequest, { request: 'validation' }>).respond('accept')
    expect(view.inputText(0, 0)).toBe('60')
    // The Enter move continues after accepting.
    expect(view.getState().selectionLabel).toBe('A2')
    // A late second answer does nothing.
    asked.respond('cancel')
    view.select(cell(0, 0))
    view.beginEdit('70', true)
    key(view, 'Tab')
    ;(seen[2] as Extract<SheetRequest, { request: 'validation' }>).respond('cancel')
    expect(view.editing).toBeUndefined()
    expect(view.inputText(0, 0)).toBe('60')
    // Valid values, and unchanged text, are not asked about.
    view.beginEdit('5', true)
    key(view, 'Enter')
    expect(seen.length).toBe(3)
    void sheet
  })

  it('settles the edit once when the host answers while the request is dispatched', () => {
    const { view } = setup()
    view.select(cell(0, 0))
    view.setValidation({ type: 'whole', operator: 'lessThan', formula1: '10', errorStyle: 'information', error: 'Big' })
    let answer: 'accept' | 'retry' = 'accept'
    // This host answers at once and forgets to claim the request.
    view.root.addEventListener('sheetrequest', (event) => {
      const detail = (event as CustomEvent<SheetRequest>).detail
      if (detail.request === 'validation') detail.respond(answer)
    })
    const steps = view.undoManager.undoStack.length
    view.beginEdit('50', true)
    key(view, 'Enter')
    expect([view.inputText(0, 0), view.getState().selectionLabel]).toEqual(['50', 'A2'])
    expect(view.undoManager.undoStack.length).toBe(steps + 1)
    answer = 'retry'
    view.select(cell(0, 0))
    view.beginEdit('60', true)
    key(view, 'Enter')
    expect([view.editing?.text, view.inputText(0, 0), view.getState().selectionLabel]).toEqual(['60', '50', 'A1'])
  })

  it('opens the list with Alt+Down and picks with the keyboard', () => {
    const { view } = setup()
    view.select(cell(0, 0))
    view.setValidation({ type: 'list', formula1: '"one,two,three"' })
    key(view, 'ArrowDown', { altKey: true })
    const popup = view.root.querySelector('.pulpo-sheet-popup')!
    expect([...popup.querySelectorAll('[role="option"]')].map((option) => option.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    key(view, 'ArrowDown')
    key(view, 'ArrowDown')
    key(view, 'ArrowUp')
    expect(view.input.getAttribute('aria-activedescendant')).toBe(popup.querySelectorAll('[role="option"]')[1]!.id)
    expect(view.input.getAttribute('aria-controls')).toBe(popup.id)
    key(view, 'Enter')
    expect(view.inputText(0, 0)).toBe('two')
    expect(view.root.querySelector('.pulpo-sheet-popup')).toBeNull()
    expect([view.input.getAttribute('aria-activedescendant'), view.input.getAttribute('aria-controls')]).toEqual([null, null])
    key(view, 'ArrowDown', { altKey: true })
    expect(view.root.querySelector('[aria-selected="true"]')?.textContent).toBe('two')
    key(view, 'Escape')
    expect(view.root.querySelector('.pulpo-sheet-popup')).toBeNull()
    expect(view.inputText(0, 0)).toBe('two')
    // Without a list, Alt+Down still moves down.
    view.select(cell(3, 3))
    key(view, 'ArrowDown', { altKey: true })
    expect(view.getState().selectionLabel).toBe('D5')
  })

  it('builds literal list formulas', () => {
    expect(commands.listValidationFormula([' a ', 'b"c', ''])).toBe('"a,b""c"')
    expect(commands.listValidationFormula(['a,b'])).toBeUndefined()
    expect(commands.listValidationFormula([])).toBeUndefined()
  })

  it('round-trips rules set from the editor through xlsx', async () => {
    const { doc, view } = setup()
    view.select({ top: 0, left: 0, bottom: 3, right: 0 })
    view.setValidation({ type: 'decimal', operator: 'between', formula1: '0', formula2: '=B1', allowBlank: true, showDropDown: false, showErrorMessage: true, showInputMessage: true, errorStyle: 'information', prompt: 'A share', promptTitle: 'Share' })
    const codec = new SheetCodec()
    const imported = new Y.Doc()
    const context = { name: 'dv.xlsx', assets: view.options.assets }
    await codec.importFile(imported, await codec.exportFile(doc, context), context)
    const loaded = mount(imported)
    loaded.select(cell(2, 0))
    expect(loaded.getState().activeValidation?.rule).toMatchObject({ type: 'decimal', operator: 'between', formula1: '0', formula2: 'B1', errorStyle: 'information', prompt: 'A share', promptTitle: 'Share', showInputMessage: true })
  })

  it('is refused in CSV', () => {
    const { view } = setup({ fileFormat: 'csv' })
    expect(view.setValidation({ type: 'list', formula1: '"a"' })).toBe(false)
  })
})

describe('conditional formatting', () => {
  const values = (sheet: ReturnType<typeof setup>['sheet']) => {
    for (let row = 0; row < 10; row++) sheet.setCell(row, 0, { v: row + 1 })
  }

  it('highlights matching cells with a preset style and undoes in one step', () => {
    const { sheet, view } = setup()
    values(sheet)
    view.select({ top: 0, left: 0, bottom: 9, right: 0 })
    const steps = view.undoManager.undoStack.length
    expect(view.addConditionalRule(highlightRule('greaterThan', ['5']))).toBe(true)
    expect(view.cellRender(6, 0).overlay?.style?.fill).toEqual({ rgb: 'FFFFC7CE' })
    expect(view.cellRender(6, 0).overlay?.style?.font?.fontColor).toEqual({ rgb: 'FF9C0006' })
    expect(view.cellRender(2, 0).overlay).toBeUndefined()
    expect(view.undoManager.undoStack.length).toBe(steps + 1)
    const stylesXml = view.workbook.metaValue('stylesXml')
    view.undo()
    expect(sheet.cf.size).toBe(0)
    // The preset styles stay: other users' rules may use them.
    expect(view.workbook.metaValue('stylesXml')).toBe(stylesXml)
  })

  it('puts new rules on top with unique priorities', () => {
    const { sheet, view } = setup()
    values(sheet)
    view.select({ top: 0, left: 0, bottom: 9, right: 0 })
    view.addConditionalRule(highlightRule('greaterThan', ['5'], 'redText'))
    view.addConditionalRule(highlightRule('greaterThan', ['8'], 'greenFillDarkGreenText'))
    const priorities = [...sheet.cf.values()].flatMap((format) => (format as ConditionalFormat).rules.map((rule) => rule.priority)).sort()
    expect(priorities).toEqual([1, 2])
    // The newer rule wins its font color; the older one still applies where only it matches.
    expect(view.cellRender(9, 0).overlay?.style?.font?.fontColor).toEqual({ rgb: 'FF006100' })
    expect(view.cellRender(6, 0).overlay?.style?.font?.fontColor).toEqual({ rgb: 'FF9C0006' })
  })

  it('adds color scales, data bars and icon sets without touching the stylesheet', () => {
    const { sheet, view } = setup()
    values(sheet)
    view.select({ top: 0, left: 0, bottom: 9, right: 0 })
    view.addConditionalRule(colorScaleRule('greenYellowRed'))
    expect(view.workbook.metaValue('stylesXml')).toBeUndefined()
    expect(view.cellRender(9, 0).overlay?.scaleColor).toBe('#63BE7B')
    expect(view.cellRender(0, 0).overlay?.scaleColor).toBe('#F8696B')
    view.clearConditionalFormats('sheet')
    view.addConditionalRule(dataBarRule('blue'))
    expect(view.cellRender(9, 0).overlay?.dataBar).toBeDefined()
    view.addConditionalRule(iconSetRule('3TrafficLights1'))
    expect(view.cellRender(9, 0).overlay?.icon).toEqual({ set: '3TrafficLights1', index: 2, showValue: true })
    expect(view.workbook.metaValue('stylesXml')).toBeUndefined()
  })

  it('writes the formulas Excel uses for text rules and round-trips them', async () => {
    const { doc, sheet, view } = setup()
    sheet.setCell(1, 1, { v: 'say "hi" there' })
    sheet.setCell(2, 1, { v: 'nothing' })
    view.select({ top: 1, left: 1, bottom: 4, right: 1 })
    view.addConditionalRule(highlightRule('textContains', ['"hi"'], 'yellowFillDarkYellowText'))
    expect(view.cellRender(1, 1).overlay?.style?.fill).toEqual({ rgb: 'FFFFEB9C' })
    expect(view.cellRender(2, 1).overlay).toBeUndefined()
    const context = { name: 'cf.xlsx', assets: view.options.assets }
    const files = unzipSync(await new SheetCodec().exportFile(doc, context))
    expect(strFromU8(files['xl/worksheets/sheet1.xml']!)).toContain('<formula>NOT(ISERROR(SEARCH("""hi""",B2)))</formula>')
    expect(strFromU8(files['xl/styles.xml']!)).toContain(`<dxfs count="${CONDITIONAL_STYLES.length}">`)
    const imported = new Y.Doc()
    await new SheetCodec().importFile(imported, await new SheetCodec().exportFile(doc, context), context)
    const loaded = mount(imported)
    expect(loaded.cellRender(1, 1).overlay?.style?.fill).toEqual({ rgb: 'FFFFEB9C' })
  })

  it('offers the other highlight presets and banded rows', () => {
    const { sheet, view } = setup()
    for (const [row, value] of [[0, 3], [1, 3], [2, 7], [3, 1]] as const) sheet.setCell(row, 0, { v: value })
    view.select({ top: 0, left: 0, bottom: 3, right: 0 })
    view.addConditionalRule(highlightRule('duplicateValues', []))
    expect([0, 1, 2].map((row) => !!view.cellRender(row, 0).overlay)).toEqual([true, true, false])
    view.clearConditionalFormats()
    view.addConditionalRule(highlightRule('top', ['1'], 'greenFillDarkGreenText'))
    expect([2, 3].map((row) => !!view.cellRender(row, 0).overlay)).toEqual([true, false])
    view.clearConditionalFormats()
    view.addConditionalRule(highlightRule('aboveAverage', []))
    expect([2, 3].map((row) => !!view.cellRender(row, 0).overlay)).toEqual([true, false])
    view.clearConditionalFormats()
    view.addConditionalRule(highlightRule('between', ['2', '4']))
    expect([0, 2, 3].map((row) => !!view.cellRender(row, 0).overlay)).toEqual([true, false, false])
    view.clearConditionalFormats()
    view.select({ top: 0, left: 0, bottom: 5, right: 2 })
    view.addConditionalRule(alternatingRowsRule())
    expect([0, 1].map((row) => view.cellRender(row, 2).overlay?.style?.fill)).toEqual([undefined, { rgb: 'FFF3F3F3' }])
  })

  it('clears rules from the selection or the whole sheet', () => {
    const { sheet, view } = setup()
    values(sheet)
    view.select({ top: 0, left: 0, bottom: 9, right: 0 })
    view.addConditionalRule(highlightRule('greaterThan', ['0']))
    view.select({ top: 0, left: 0, bottom: 4, right: 0 })
    view.clearConditionalFormats('selection')
    expect([!!view.cellRender(2, 0).overlay, !!view.cellRender(7, 0).overlay]).toEqual([false, true])
    view.clearConditionalFormats('sheet')
    expect(sheet.cf.size).toBe(0)
  })

  it('reuses equal styles a file already has and appends the rest once', () => {
    const excel = new Stylesheet()
    excel.merge(new Stylesheet('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dxfs count="1"><dxf><font><color rgb="FF006100"/></font><fill><patternFill><bgColor rgb="FFC6EFCE"/></patternFill></fill></dxf></dxfs></styleSheet>'))
    const ids = excel.ensurePresetDxfs()
    expect(ids.greenFillDarkGreenText).toBe(0)
    expect(new Set(Object.values(ids)).size).toBe(CONDITIONAL_STYLES.length)
    const again = new Stylesheet(excel.toXml())
    expect(again.ensurePresetDxfs()).toEqual(ids)
    expect(again.changed).toBe(false)
    expect(again.dxfCount).toBe(CONDITIONAL_STYLES.length)
  })

  it('converges when two users add highlight rules at the same time', () => {
    const docA = new Y.Doc()
    const book = WorkbookModel.initialize(docA)
    const sheet = book.addSheet('Sheet1')
    for (let row = 0; row < 6; row++) {
      sheet.setCell(row, 0, { v: row })
      sheet.setCell(row, 1, { v: row })
    }
    const docB = new Y.Doc()
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))
    const a = mount(docA)
    const b = mount(docB)
    a.select({ top: 0, left: 0, bottom: 5, right: 0 })
    b.select({ top: 0, left: 1, bottom: 5, right: 1 })
    a.addConditionalRule(highlightRule('greaterThan', ['2'], 'lightRedFill'))
    b.addConditionalRule(highlightRule('lessThan', ['2'], 'greenFillDarkGreenText'))
    // Both edits happened before either saw the other.
    const vectorA = Y.encodeStateVector(docA)
    const vectorB = Y.encodeStateVector(docB)
    const fromA = Y.encodeStateAsUpdate(docA, vectorB)
    const fromB = Y.encodeStateAsUpdate(docB, vectorA)
    Y.applyUpdate(docB, fromA, 'remote')
    Y.applyUpdate(docA, fromB, 'remote')
    expect(a.workbook.metaValue('stylesXml')).toBe(b.workbook.metaValue('stylesXml'))
    for (const view of [a, b]) {
      expect(view.cellRender(4, 0).overlay?.style?.fill).toEqual({ rgb: 'FFFFC7CE' })
      expect(view.cellRender(0, 1).overlay?.style?.fill).toEqual({ rgb: 'FFC6EFCE' })
      expect(view.cellRender(0, 0).overlay).toBeUndefined()
      expect(view.cellRender(4, 1).overlay).toBeUndefined()
    }
    // Equal priorities from the race resolve the same way on both replicas.
    a.select({ top: 0, left: 0, bottom: 5, right: 1 })
    expect(JSON.stringify([...Array(6).keys()].map((row) => [a.cellRender(row, 0).overlay, a.cellRender(row, 1).overlay]))).toBe(JSON.stringify([...Array(6).keys()].map((row) => [b.cellRender(row, 0).overlay, b.cellRender(row, 1).overlay])))
  })

  it('picks the same winner on every replica when concurrent rules cover the same cells', async () => {
    const docA = new Y.Doc()
    const sheet = WorkbookModel.initialize(docA).addSheet('Sheet1')
    for (let row = 0; row < 4; row++) sheet.setCell(row, 0, { v: row })
    const docB = new Y.Doc()
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))
    const a = mount(docA)
    const b = mount(docB)
    for (const view of [a, b]) view.select({ top: 0, left: 0, bottom: 3, right: 0 })
    a.addConditionalRule(highlightRule('greaterThan', ['0'], 'lightRedFill'))
    b.addConditionalRule(highlightRule('greaterThan', ['1'], 'greenFillDarkGreenText'))
    const vectorA = Y.encodeStateVector(docA)
    const fromA = Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB))
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB, vectorA), 'remote')
    Y.applyUpdate(docB, fromA, 'remote')
    // Both rules have priority 1 and both match row 4: each replica applies them in one order.
    const fills = (view: SheetView) => [0, 1, 2, 3].map((row) => view.cellRender(row, 0).overlay?.style?.fill?.rgb ?? null)
    expect(fills(a)).toEqual(fills(b))
    expect(fills(a)[1]).toBe('FFFFC7CE')
    // The saved file lists them in that order too.
    const sheetXml = async (doc: Y.Doc, view: SheetView) => strFromU8(unzipSync(await new SheetCodec().exportFile(doc, { name: 'race.xlsx', assets: view.options.assets }))['xl/worksheets/sheet1.xml']!)
    expect(await sheetXml(docA, a)).toBe(await sheetXml(docB, b))
  })

  // The fidelity venv from scripts/sheets/setup-fidelity-env.sh (testing/fidelity.ts is Node-only).
  const python = join(process.env.PULPO_SHEETS_VENV ?? join(homedir(), '.cache', 'pulpo-sheets-venv'), 'bin', 'python')
  it.skipIf(process.env.PULPO_SHEETS_FIDELITY !== '1' || !existsSync(python))('writes rules and preset styles that openpyxl and LibreOffice read', async () => {
    const { doc, sheet, view } = setup()
    values(sheet)
    view.select({ top: 0, left: 0, bottom: 9, right: 0 })
    view.addConditionalRule(highlightRule('greaterThan', ['5']))
    view.select({ top: 0, left: 1, bottom: 9, right: 1 })
    view.addConditionalRule(highlightRule('textContains', ['x'], 'yellowFillDarkYellowText'))
    view.select({ top: 0, left: 2, bottom: 9, right: 2 })
    view.addConditionalRule(colorScaleRule('greenWhiteRed'))
    view.select({ top: 0, left: 3, bottom: 3, right: 3 })
    view.setValidation({ type: 'list', formula1: '"Low,High"', errorStyle: 'warning', error: 'Pick one' })
    const work = mkdtempSync(join(tmpdir(), 'pulpo-sheet-parity-'))
    try {
      const file = join(work, 'parity.xlsx')
      writeFileSync(file, await new SheetCodec().exportFile(doc, { name: 'parity.xlsx', assets: view.options.assets }))
      const inspect = (path: string) => {
        const run = spawnSync(python, ['-I', '-c', `import json,sys,openpyxl
s=openpyxl.load_workbook(sys.argv[1]).active
def color(c): return c.rgb if c is not None and isinstance(c.rgb, str) else None
rules=[]
for k in s.conditional_formatting:
  for r in k.rules:
    d=r.dxf
    rules.append([str(k.sqref),r.type,r.operator,list(r.formula or []),color(d.fill.bgColor) if d and d.fill else None,color(d.font.color) if d and d.font else None])
print(json.dumps({'cf':sorted(rules),'dv':[[str(v.sqref),v.type,v.formula1,v.errorStyle] for v in s.data_validations.dataValidation]}))`, path], { encoding: 'utf8' })
        expect(run.status, run.stderr).toBe(0)
        return JSON.parse(run.stdout) as { cf: unknown[][]; dv: unknown[][] }
      }
      const read = inspect(file)
      expect(read.cf).toEqual([
        ['A1:A10', 'cellIs', 'greaterThan', ['5'], 'FFFFC7CE', 'FF9C0006'],
        ['B1:B10', 'containsText', 'containsText', ['NOT(ISERROR(SEARCH("x",B1)))'], 'FFFFEB9C', 'FF9C5700'],
        ['C1:C10', 'colorScale', null, [], null, null],
      ])
      expect(read.dv).toEqual([['D1:D4', 'list', '"Low,High"', 'warning']])
      if (process.env.PULPO_OFFICE_FIDELITY === '1') {
        // Run the Node-only LibreOffice tooling outside jsdom (whose import.meta URLs are HTTP).
        const converted = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
          import { libreOfficeAvailable, libreOfficeConvert } from './dist/office/sheets/testing/fidelity.js'
          console.log(JSON.stringify(libreOfficeAvailable() ? libreOfficeConvert(process.argv[1], 'xlsx', process.argv[2]) : { ok: false, error: 'no LibreOffice' }))
        `, file, join(work, 'lo')], { encoding: 'utf8' })) as { ok: boolean; error?: string; outputs?: string[] }
        expect(converted.ok, converted.error).toBe(true)
        const calc = inspect(converted.outputs![0]!)
        expect(calc.cf.map((rule) => [rule[0], rule[4]])).toEqual(expect.arrayContaining([['A1:A10', 'FFFFC7CE'], ['B1:B10', 'FFFFEB9C']]))
        expect(calc.dv.map((rule) => rule[2])).toEqual(['"Low,High"'])
      }
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })

  it('is refused in read-only and CSV views', () => {
    const readOnly = setup({ readOnly: true })
    expect(readOnly.view.addConditionalRule(highlightRule('equal', ['1']))).toBe(false)
    expect(readOnly.view.workbook.metaValue('stylesXml')).toBeUndefined()
    const csv = setup({ fileFormat: 'csv' })
    expect(csv.view.addConditionalRule(highlightRule('equal', ['1']))).toBe(false)
  })
})

describe('view options', () => {
  it('hides gridlines and headings for the sheet, saved and undoable', async () => {
    const { doc, view } = setup()
    view.setViewOption('showGridLines', false)
    expect(view.scene().showGridLines).toBe(false)
    expect(view.getState().showGridLines).toBe(false)
    const files = unzipSync(await new SheetCodec().exportFile(doc, { name: 'grid.xlsx', assets: view.options.assets }))
    expect(strFromU8(files['xl/worksheets/sheet1.xml']!)).toContain('showGridLines="0"')
    view.undo()
    expect(view.scene().showGridLines).toBe(true)
    view.setViewOption('showHeadings', false)
    expect([view.headerHeight, view.headerWidth, view.getState().showHeadings]).toEqual([0, 0, false])
  })

  it('shows formulas for this viewer only', () => {
    const { doc, sheet, view } = setup()
    sheet.setCell(0, 0, { f: 'A2+1' })
    sheet.setCell(1, 0, { v: 1 })
    const before = Y.encodeStateAsUpdate(doc)
    view.setShowFormulas(true)
    expect(view.scene().cell(0, 0)).toMatchObject({ text: '=A2+1', hAlign: 'left', numeric: false })
    expect(view.scene().cell(1, 0).text).toBe('1')
    // Copying and other readers still see values.
    expect(view.cellRender(0, 0).text).toBe('2')
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
    expect(view.undoManager.canUndo()).toBe(false)
  })
})

describe('refusal feedback', () => {
  it('explains a refused multi-range copy and never copies the input placeholder', () => {
    const { view } = setup()
    view.select(cell(0, 0))
    view.select(cell(2, 2), { add: true })
    const setData = vi.fn()
    const event = new Event('copy', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { setData } })
    view.input.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(setData).not.toHaveBeenCalled()
    expect(alertText(view)).toBe(view.labels.multipleSelections)
  })

  it('lets the host show messages itself', () => {
    const { view } = setup()
    const notices: string[] = []
    view.root.addEventListener('sheetnotice', (event) => {
      notices.push((event as CustomEvent<{ message: string }>).detail.message)
      event.preventDefault()
    })
    view.select({ top: 0, left: 0, bottom: 1, right: 1 })
    const payload = view.clipboard.copyPayload()!
    view.select({ top: 4, left: 4, bottom: 6, right: 6 })
    const steps = view.undoManager.undoStack.length
    view.clipboard.paste({ html: toHtml(payload) })
    expect(notices).toEqual([view.labels.pasteShape])
    expect(alertText(view)).toBeUndefined()
    expect(view.undoManager.undoStack.length).toBe(steps)
  })

  it('explains fills over merged cells', () => {
    const { sheet, view } = setup()
    sheet.setCell(0, 0, { v: 1 })
    view.select({ top: 2, left: 0, bottom: 3, right: 0 })
    view.merge()
    view.clipboard.fill(cell(0, 0), { top: 0, left: 0, bottom: 4, right: 0 })
    expect(alertText(view)).toBe(view.labels.dataErrors.merges)
  })
})

describe('dragging the selection border', () => {
  /** Just below the selection's bottom border, over its first column. */
  const grab = (view: SheetView) => {
    const range = view.selection.ranges[0]!
    const cell = view.cellRect(range.bottom, range.left)
    return { x: cell.x + cell.width / 2, y: cell.y + cell.height + 2 }
  }
  const drag = (view: SheetView, row: number, col: number, init: MouseEventInit = {}) => {
    const from = grab(view)
    const to = center(view, row, col)
    pointer(view, 'pointerdown', from.x, from.y, init)
    pointer(view, 'pointermove', to.x, to.y, init)
    pointer(view, 'pointerup', to.x, to.y, init)
  }
  const block = (sheet: ReturnType<typeof setup>['sheet']) => {
    sheet.setCell(0, 0, { v: 1 })
    sheet.setCell(1, 1, { v: 2 })
    sheet.setCell(7, 7, { f: toIdForm('A1+B2', sheet) })
  }

  it('moves cells as cut and paste does, references following, in one undo step', () => {
    const { sheet, view } = setup()
    block(sheet)
    view.select({ top: 0, left: 0, bottom: 1, right: 1 })
    const from = grab(view)
    pointer(view, 'pointermove', from.x, from.y)
    expect(view.scroller.style.cursor).toBe('move')
    const steps = view.undoManager.undoStack.length
    // Grabbed below row 2 (in row 3): dropping on D6 puts the block at D4:E5.
    drag(view, 5, 3)
    expect([view.inputText(3, 3), view.inputText(4, 4), view.inputText(0, 0), view.inputText(1, 1)]).toEqual(['1', '2', '', ''])
    expect(view.inputText(7, 7)).toBe('=D4+E5')
    expect(view.getState().selectionLabel).toBe('D4:E5')
    expect(view.undoManager.undoStack.length).toBe(steps + 1)
    view.undo()
    expect([view.inputText(0, 0), view.inputText(1, 1), view.inputText(7, 7)]).toEqual(['1', '2', '=A1+B2'])
  })

  it('copies with Ctrl held, moving relative references like a paste', () => {
    const { sheet, view } = setup()
    block(sheet)
    sheet.setCell(1, 0, { f: toIdForm('A1*2', sheet) })
    view.select({ top: 0, left: 0, bottom: 1, right: 1 })
    drag(view, 5, 3, { ctrlKey: true })
    expect([view.inputText(0, 0), view.inputText(3, 3), view.inputText(4, 3)]).toEqual(['1', '1', '=D4*2'])
    expect(view.inputText(7, 7)).toBe('=A1+B2')
  })

  it('refuses moves that would split a merge or cross a filter, keeping the selection', () => {
    const { doc, sheet, view } = setup()
    block(sheet)
    view.select({ top: 4, left: 4, bottom: 4, right: 5 })
    view.merge()
    view.select({ top: 0, left: 0, bottom: 1, right: 1 })
    const before = Y.encodeStateAsUpdate(doc)
    drag(view, 5, 3)
    expect(alertText(view)).toBe(view.labels.partialMove)
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
    expect(view.getState().selectionLabel).toBe('A1:B2')
    // A later paste is a copy, not a leftover move.
    view.select(cell(9, 9))
    view.clipboard.paste({ payload: view.clipboard.copyPayload()! })
    sheet.filter.set('value', { range: sheet.rangeIds({ top: 0, left: 0, bottom: 9, right: 1 }), columns: [{ col: 0, values: ['1', '2'] }] })
    view.select({ top: 0, left: 0, bottom: 1, right: 1 })
    drag(view, 8, 0)
    expect(alertText(view)).toBe(view.labels.moveFiltered)
    expect(view.inputText(0, 0)).toBe('1')
  })

  it('treats a press on the border that never drags as a click on the cell under it', () => {
    const { sheet, view } = setup()
    block(sheet)
    const press = (init: MouseEventInit = {}) => {
      const at = grab(view)
      pointer(view, 'pointerdown', at.x, at.y, init)
      pointer(view, 'pointerup', at.x, at.y, init)
    }
    view.select(cell(0, 0))
    press()
    expect(view.getState().selectionLabel).toBe('A2')
    press({ shiftKey: true })
    expect(view.getState().selectionLabel).toBe('A2:A3')
    view.select(cell(0, 0))
    press({ ctrlKey: true })
    expect(view.selection.ranges).toEqual([cell(0, 0), cell(1, 0)])
    // Dragging out and back again leaves everything as it was.
    view.select(cell(0, 0))
    const at = grab(view)
    const away = center(view, 4, 2)
    pointer(view, 'pointerdown', at.x, at.y)
    pointer(view, 'pointermove', away.x, away.y)
    pointer(view, 'pointermove', at.x, at.y)
    pointer(view, 'pointerup', at.x, at.y)
    expect(view.getState().selectionLabel).toBe('A1')
    expect([view.inputText(0, 0), view.undoManager.canUndo()]).toEqual(['1', false])
  })

  it('still drag-selects from inside the active cell', () => {
    const { view } = setup()
    view.select(cell(0, 0))
    const from = center(view, 0, 0)
    const to = center(view, 2, 1)
    pointer(view, 'pointerdown', from.x, from.y)
    pointer(view, 'pointermove', to.x, to.y)
    pointer(view, 'pointerup', to.x, to.y)
    expect(view.getState().selectionLabel).toBe('A1:B3')
  })
})

it('summarizes the selection for the status bar', () => {
  const { sheet, view } = setup()
  sheet.setCell(0, 0, { v: 1 })
  sheet.setCell(1, 0, { v: 5 })
  sheet.setCell(2, 0, { v: 'x' })
  view.select({ top: 0, left: 0, bottom: 3, right: 0 })
  expect(view.getState().summary).toEqual({ count: 3, numbers: 2, sum: 6, average: 3, min: 1, max: 5 })
})
