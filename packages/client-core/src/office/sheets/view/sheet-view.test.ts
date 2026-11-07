// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { SheetCodec } from '../codec/codec.js'
import { MAX_ROWS, MAX_COLS, type CellRange } from '../address.js'
import * as commands from './commands.js'
import { MemoryLiveAssetStore } from '../../assets.js'
import { insertAxis, deleteAxis } from '../model/structure.js'
import { toIdForm } from '../model/formula-ids.js'
import { WorkbookModel } from '../model/workbook.js'
import { SheetView, type SheetViewOptions } from './sheet-view.js'

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

function setup(options: Partial<SheetViewOptions> = {}) {
  const doc = new Y.Doc()
  const book = WorkbookModel.initialize(doc)
  const sheet = book.addSheet('Sheet1')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const view = new SheetView({ container, doc, assets: new MemoryLiveAssetStore(), user: { name: 'Test', color: '#123456' }, ...options })
  view.root.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
  views.push(view)
  return { doc, book, sheet, view }
}

/** Delivers a separate replica's structural change while the local draft is still open. */
function remote(doc: Y.Doc, change: (book: WorkbookModel) => void) {
  const replica = new Y.Doc()
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))
  const vector = Y.encodeStateVector(replica)
  change(new WorkbookModel(replica))
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(replica, vector), 'remote')
  replica.destroy()
}

function validation(sheet: ReturnType<typeof setup>['sheet']) {
  sheet.dv.set('test', { ranges: [sheet.rangeIds({ top: 0, left: 0, bottom: 0, right: 0 })], type: 'whole', operator: 'between', formula1: '1', formula2: '10', showErrorMessage: true })
}

describe('pending spreadsheet edits', () => {
  it.each([false, true])('uses the canonical duplicate definition in the name box, reverse=%s', (reverse) => {
    const { sheet, book, view } = setup()
    const definitions = [
      ['a', { name: 'Area', formula: toIdForm('Sheet1!B2', undefined, book) }],
      ['z', { name: 'AREA', formula: toIdForm('Sheet1!C3', undefined, book) }],
    ] as const
    for (const [key, name] of reverse ? [...definitions].reverse() : definitions) book.names.set(key, name)
    expect(view.goTo('area')).toBe(true)
    expect(view.getState().selectionLabel).toBe('B2')
    expect(view.sheetId).toBe(sheet.id)
  })

  it.each(['row', 'col'] as const)('follows stable %s ids through remote insertions', (axis) => {
    const { doc, sheet, view } = setup()
    sheet.setCell(0, 0, { v: 'keep' })
    sheet.setCell(1, 1, { v: 'original' })
    view.select({ top: 1, left: 1, bottom: 1, right: 1 })
    view.beginEdit('edited')
    remote(doc, (book) => insertAxis(book.sheets()[0]!, axis, 0, 1))
    expect(view.commitEdit()).toBe(true)
    expect(sheet.cell(axis === 'row' ? 2 : 1, axis === 'col' ? 2 : 1)?.v).toBe('edited')
    expect(sheet.cell(axis === 'row' ? 1 : 0, axis === 'col' ? 1 : 0)?.v).toBe('keep')
  })

  it.each(['row', 'col'] as const)('cancels a draft whose %s was deleted remotely', (axis) => {
    const { doc, sheet, view } = setup()
    sheet.setCell(1, 1, { v: 'keep' })
    view.beginEdit('deleted draft')
    remote(doc, (book) => deleteAxis(book.sheets()[0]!, axis, 0, 1))
    view.commitEdit()
    expect(view.editing).toBeUndefined()
    expect(sheet.cell(axis === 'row' ? 0 : 1, axis === 'col' ? 0 : 1)?.v).toBe('keep')
  })

  it('resolves fill ranges and their formula anchor by id', () => {
    const { doc, sheet, view } = setup()
    sheet.setCell(0, 0, { v: 'keep' })
    view.select({ top: 1, left: 1, bottom: 2, right: 2 })
    view.beginEdit('=A2')
    remote(doc, (book) => {
      insertAxis(book.sheets()[0]!, 'row', 0, 1)
      insertAxis(book.sheets()[0]!, 'col', 0, 1)
    })
    view.commitEdit({ fill: true })
    expect(view.inputText(2, 2)).toBe('=A2')
    expect(view.inputText(3, 3)).toBe('=B3')
    expect(sheet.cell(1, 1)?.v).toBe('keep')
    expect(sheet.cell(1, 2)).toBeUndefined()
  })

  it('commits on the original sheet before switching tabs or deleting it', () => {
    const { sheet, book, view } = setup()
    const other = book.addSheet('Other')
    other.setCell(0, 0, { v: 'keep' })
    view.beginEdit('original sheet')
    view.setActiveSheet(other.id)
    expect(sheet.cell(0, 0)?.v).toBe('original sheet')
    expect(other.cell(0, 0)?.v).toBe('keep')
    view.setActiveSheet(sheet.id)
    view.beginEdit('before delete')
    view.deleteSheet(sheet.id)
    view.commitEdit()
    expect(other.cell(0, 0)?.v).toBe('keep')
  })

  it('cancels when the owning sheet is deleted remotely', () => {
    const { doc, sheet, book, view } = setup()
    const other = book.addSheet('Other')
    other.setCell(0, 0, { v: 'keep' })
    view.beginEdit('deleted draft')
    remote(doc, (book) => book.deleteSheet(sheet.id))
    view.commitEdit()
    expect(view.sheetId).toBe(other.id)
    expect(other.cell(0, 0)?.v).toBe('keep')
  })

  it('stays on the current sheet when validation rejects a switch or deletion', () => {
    const { sheet, book, view } = setup()
    const other = book.addSheet('Other')
    other.setCell(0, 0, { v: 'keep' })
    validation(sheet)
    view.beginEdit('invalid')
    view.setActiveSheet(other.id)
    expect(view.sheetId).toBe(sheet.id)
    view.deleteSheet(sheet.id)
    expect(book.sheet(sheet.id)).toBeDefined()
    expect(view.commitEdit()).toBe(false)
    expect(other.cell(0, 0)?.v).toBe('keep')
  })

  it('settles before teardown, cancelling rejected drafts', () => {
    const { sheet, view } = setup()
    view.beginEdit('last typed cell')
    view.destroy()
    expect(sheet.cell(0, 0)?.v).toBe('last typed cell')
    const invalid = setup()
    validation(invalid.sheet)
    invalid.view.beginEdit('invalid')
    expect(invalid.view.settleEdit()).toBe(false)
    expect(invalid.view.editing).toBeUndefined()
    expect(invalid.sheet.cell(0, 0)).toBeUndefined()
  })

  it('cancels drafts and blocks every command after becoming read only', async () => {
    const { doc, sheet, view } = setup()
    view.beginEdit('saved')
    view.commitEdit()
    view.undo()
    view.redo()
    view.beginEdit('pending')
    view.readOnly = true
    expect(view.editing).toBeUndefined()
    const before = Y.encodeStateAsUpdate(doc)
    view.commitEdit({ fill: true })
    view.undo()
    view.redo()
    view.clipboard.paste({ text: 'paste' })
    view.clipboard.fill({ top: 0, left: 0, bottom: 0, right: 0 }, { top: 0, left: 0, bottom: 1, right: 0 })
    view.clearContents()
    view.setStyle({ bold: true })
    view.insert('row', 'before')
    view.deleteLines('col')
    view.renameSheet(sheet.id, 'Changed')
    view.deleteSheet(sheet.id)
    view.addSheet()
    view.duplicateSheet(sheet.id)
    view.replace('saved', 'replacement')
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
    expect(sheet.cell(0, 0)?.v).toBe('saved')
  })

  it('rechecks read only after an image upload completes', async () => {
    const assets = new MemoryLiveAssetStore()
    let release!: () => void
    const upload = vi.spyOn(assets, 'put').mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return { hash: 'image', sizeBytes: 1, mimeType: 'image/png' }
    })
    const { sheet, view } = setup({ assets })
    const pending = view.insertImage(new Uint8Array([1]), 'image/png', { width: 10, height: 10 })
    view.readOnly = true
    release()
    await pending
    expect(upload).toHaveBeenCalledOnce()
    expect(sheet.drawings.size).toBe(0)
  })

  it('uses the current file format for formulas after renaming in either direction', () => {
    const { book, sheet, view } = setup({ fileFormat: 'xlsx' })
    book.setMeta('format', 'csv')
    expect(view.valuesOnly).toBe(false)
    view.beginEdit('=1+1')
    view.commitEdit()
    expect(sheet.cell(0, 0)?.f).toBeDefined()
    view.setFileFormat('csv')
    expect(view.getState().valuesOnly).toBe(true)
    view.beginEdit('=2+2')
    view.commitEdit()
    expect(sheet.cell(0, 0)).toEqual({ v: '=2+2' })
  })

  it.each(['Enter', 'Escape', 'Tab'])('ignores grid %s during IME composition and key code 229', (key) => {
    const { sheet, view } = setup()
    view.beginEdit('にほん')
    for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...flags })
      view.input.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(view.editing?.text).toBe('にほん')
      expect(sheet.cell(0, 0)).toBeUndefined()
    }
  })
})

const drawing = { anchor: 'absolute' as const, pos: { x: 0, y: 0 }, ext: { cx: 200 * 9525, cy: 100 * 9525 }, z: 0 }

it('refreshes chart output for values and themes while keeping its XML cached', async () => {
  const renderChart = vi.fn((_xml, _size, _theme, resolve) => `<svg><text>${resolve('Sheet1!A1')?.[0]?.[0]}</text></svg>`)
  const assets = new MemoryLiveAssetStore()
  const part = await assets.put(new TextEncoder().encode('<chart/>'), 'application/xml')
  const get = vi.spyOn(assets, 'get')
  const { book, sheet, view } = setup({ assets, renderChart })
  book.parts.set('chart.xml', { ...part, mimeType: 'application/xml' })
  sheet.setCell(0, 0, { v: 1 })
  sheet.drawings.set('chart', { ...drawing, kind: 'chart', chart: 'chart.xml' })
  view.resize()
  await vi.waitFor(() => expect(renderChart).toHaveBeenCalled())
  const before = renderChart.mock.calls.length
  sheet.setCell(0, 0, { v: 2 })
  view.renderNow()
  expect(renderChart.mock.calls.length).toBeGreaterThan(before)
  expect(view.overlay.textContent).toBe('2')
  const after = renderChart.mock.calls.length
  view.renderNow()
  expect(renderChart).toHaveBeenCalledTimes(after)
  view.options.appearance = 'dark'
  view.renderNow()
  expect(renderChart).toHaveBeenCalledTimes(after + 1)
  book.setMeta('themeXml', '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>')
  view.renderNow()
  expect(get).toHaveBeenCalledOnce()
})

it.each([false, true])('deduplicates image loads and cleans up when destroyed before resolution: %s', async (destroyEarly) => {
  let release!: (bytes: Uint8Array) => void
  const assets = new MemoryLiveAssetStore()
  const get = vi.spyOn(assets, 'get').mockImplementation(() => new Promise((resolve) => { release = resolve }))
  const create = vi.fn(() => 'blob:test')
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  const { sheet, view } = setup({ assets })
  for (const id of ['one', 'two']) sheet.drawings.set(id, { ...drawing, kind: 'image', image: { hash: 'same', mimeType: 'image/png' } })
  view.resize()
  expect(get).toHaveBeenCalledOnce()
  if (destroyEarly) view.destroy()
  release(new Uint8Array([1]))
  await vi.waitFor(() => {
    if (destroyEarly) expect(create).not.toHaveBeenCalled()
    else expect(view.overlay.querySelectorAll('img[src="blob:test"]')).toHaveLength(2)
  })
  // Flush every continuation before checking that late loads allocated nothing.
  await new Promise((resolve) => setTimeout(resolve, 0))
  view.destroy()
  expect(create).toHaveBeenCalledTimes(destroyEarly ? 0 : 1)
  expect(revoke).toHaveBeenCalledTimes(destroyEarly ? 0 : 1)
})

describe('concurrent sheet tab changes', () => {
  for (const count of [2, 3]) for (const descending of [false, true]) for (const reverse of [false, true]) {
    const clientIds = Array.from({ length: count }, (_, index) => index + 1)
    if (descending) clientIds.reverse()
    const label = `clients ${clientIds}, ${reverse ? 'reverse' : 'forward'} delivery`
    for (const operation of ['delete', 'hide'] as const) {
      it(`keeps the active grid on the fallback visible tab after concurrent ${operation} (${label})`, () => {
        const base = new Y.Doc()
        base.clientID = 100
        const book = WorkbookModel.initialize(base)
        const ids = Array.from({ length: count }, (_, index) => {
          const sheet = book.addSheet(`Sheet${index + 1}`)
          sheet.setCell(0, 0, { v: `value${index + 1}` })
          return sheet.id
        })
        const docs = clientIds.map((clientID) => {
          const doc = new Y.Doc()
          doc.clientID = clientID
          Y.applyUpdate(doc, Y.encodeStateAsUpdate(base))
          return doc
        })
        const editors = docs.map((doc, index) => {
          const container = document.createElement('div')
          document.body.appendChild(container)
          const view = new SheetView({ container, doc, assets: new MemoryLiveAssetStore(), user: { name: 'Test', color: '#123456' } })
          views.push(view)
          view.setActiveSheet(ids[index]!)
          return view
        })
        editors.forEach((view, index) => {
          if (operation === 'delete') view.deleteSheet(ids[index]!)
          else view.setSheetHidden(ids[index]!, true)
        })
        const updates = docs.map((doc) => Y.encodeStateAsUpdate(doc))
        if (reverse) updates.reverse()
        for (const doc of docs) for (const update of updates) Y.applyUpdate(doc, update)
        for (const view of editors) {
          expect(view.getState().sheetId).toBe(ids[0])
          expect(view.getState().sheets.filter((sheet) => sheet.state === 'visible').map((sheet) => sheet.id)).toEqual([ids[0]])
          expect(view.inputText(0, 0)).toBe('value1')
          view.beginEdit('updated fallback')
          expect(view.commitEdit()).toBe(true)
          expect(view.inputText(0, 0)).toBe('updated fallback')
        }
      })
    }

    it(`shows resolved names in tabs after concurrent additions (${label})`, () => {
      const { doc, book, view } = setup()
      const replicas = clientIds.map((clientID) => {
        const replica = new Y.Doc()
        replica.clientID = clientID
        Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))
        new WorkbookModel(replica).addSheet('Sheet2')
        return replica
      })
      const updates = replicas.map((replica) => Y.encodeStateAsUpdate(replica))
      if (reverse) updates.reverse()
      for (const update of updates) Y.applyUpdate(doc, update)
      expect(view.getState().sheets.map((sheet) => sheet.name)).toEqual(['Sheet1', 'Sheet2', ...Array.from({ length: count - 1 }, (_, index) => `Sheet2 (${index + 2})`)])
      expect(view.getState().sheets.map((sheet) => sheet.name)).toEqual(book.sheets().map((sheet) => sheet.name))
      for (const replica of replicas) replica.destroy()
    })
  }
})

const wholeSelections: [string, CellRange][] = [
  ['column', { top: 0, left: 0, bottom: MAX_ROWS - 1, right: 0 }],
  ['row', { top: 0, left: 0, bottom: 0, right: MAX_COLS - 1 }],
  ['sheet', { top: 0, left: 0, bottom: MAX_ROWS - 1, right: MAX_COLS - 1 }],
]

describe.each(wholeSelections)('whole %s commands', (_name, range) => {
  it('handles Ctrl+Enter without a partial write or lost draft', () => {
    const { sheet, view } = setup()
    view.select(range)
    view.beginEdit('bounded')
    const before = Y.encodeStateAsUpdate(view.workbook.doc)
    expect(view.commitEdit({ fill: true })).toBe(commands.canExpandRanges([range]))
    if (!commands.canExpandRanges([range])) {
      expect(Y.encodeStateAsUpdate(view.workbook.doc)).toEqual(before)
      expect(view.editing?.text).toBe('bounded')
      view.cancelEdit()
      view.select({ top: 1, left: 1, bottom: 1, right: 1 })
      view.beginEdit('responsive')
      expect(view.commitEdit()).toBe(true)
      expect(sheet.cell(1, 1)?.v).toBe('responsive')
    } else expect(sheet.cell(0, MAX_COLS - 1)?.v).toBe('bounded')
  })

  it.each(['clearContents', 'clearFormats', 'clearAll', 'numberFormat', 'decimals', 'borders', 'merge', 'unmerge', 'fill', 'copy', 'paste', 'replace', 'sort', 'filter', 'autoFit', 'hide', 'resize', 'deleteLines'] as const)('bounds %s', (command) => {
    const { sheet, view } = setup()
    sheet.setCell(0, 0, { v: 'find' })
    sheet.setCell(1, 1, { v: 2 })
    view.select(range)
    switch (command) {
      case 'clearContents': view.clearContents(); expect(sheet.cell(0, 0)).toBeUndefined(); break
      case 'clearFormats': view.clearFormats(); break
      case 'clearAll': view.clearAll(); expect(sheet.cell(0, 0)).toBeUndefined(); break
      case 'numberFormat': view.setNumberFormat('0.00'); expect(view.styleAt(0, 0).numFmt).toBe('0.00'); break
      case 'decimals': view.changeDecimals(1); expect(view.styleAt(0, 0).numFmt).toBe('0.0'); break
      case 'borders': view.setBorders('all'); expect(view.styleAt(0, 0).borderTop?.style).toBe('thin'); break
      case 'merge': view.merge(); break
      case 'unmerge': view.unmerge(); break
      case 'fill': view.clipboard.fill({ top: 0, left: 0, bottom: 0, right: 0 }, range, true); break
      case 'copy': expect(view.clipboard.copyPayload()?.internal?.cells.length).toBeLessThanOrEqual(2); break
      case 'paste': view.clipboard.paste({ text: 'paste' }); expect(sheet.cell(0, 0)?.v).toBe(_name === 'row' ? 'paste' : 'find'); break
      case 'replace': expect(view.replace('find', 'replaced')).toBe(1); break
      case 'sort': view.sort(false); break
      case 'filter': view.toggleFilter(); view.toggleFilter(); break
      case 'autoFit': view.autoFit('col'); break
      case 'hide': view.hideLines('row', true); break
      case 'resize': view.resizeLines('col', 80); break
      case 'deleteLines': view.deleteLines('row'); break
    }
    // Sparse commands do not materialize the worksheet rectangle.
    expect(sheet.cells.size).toBeLessThanOrEqual(command === 'fill' || command === 'paste' ? MAX_COLS + 2 : 2)
  })
})

it.each(['cell', 'row', 'column'] as const)('clears inherited formats at a %s intersection and preserves unselected cells', (selection) => {
  const { sheet, view } = setup()
  commands.applyStyle(sheet, [wholeSelections[0]![1]], { bold: true, numFmt: '0.00%' })
  commands.applyStyle(sheet, [wholeSelections[1]![1]], { italic: true })
  const target = selection === 'row' ? wholeSelections[1]![1] : selection === 'column' ? wholeSelections[0]![1] : { top: 0, bottom: 0, left: 0, right: 0 }
  view.select(target)
  view.clearFormats()
  expect(view.styleAt(0, 0)).toMatchObject({ bold: false, italic: false, numFmt: 'General' })
  if (selection !== 'column') expect(view.styleAt(1, 0).bold).toBe(true)
  if (selection !== 'row') expect(view.styleAt(0, 1).italic).toBe(true)
})

it('clears imported axis bases and number formats with single-cell exceptions', () => {
  const { sheet, view } = setup()
  const base = view.stylesheetFor.intern(undefined, { bold: true, numFmt: '0.00%' })
  sheet.workbook.meta.set('stylesXml', view.stylesheetFor.toXml())
  sheet.setColProp([0], 'xf', base)
  sheet.setCell(0, 0, { v: 0.5 })
  expect(view.displayText(0, 0)).toBe('50.00%')
  view.clearFormats()
  expect(view.styleAt(0, 0).bold).toBe(false)
  expect(view.displayText(0, 0)).toBe('0.5')
  expect(view.styleAt(1, 0).bold).toBe(true)
})

it.each(['clearFormats', 'clearAll'] as const)('removes conditional formats sparsely with %s', (command) => {
  const { sheet, view } = setup()
  sheet.cf.set('rule', { ranges: [sheet.rangeIds({ top: 0, left: 0, bottom: MAX_ROWS - 1, right: 1 })], rules: [{ type: 'expression', priority: 1, formulas: ['TRUE'] }] })
  view.select(wholeSelections[0]![1])
  view[command]()
  expect([...sheet.cf.values()].flatMap((raw) => (raw as { ranges: Parameters<typeof sheet.resolveRange>[0][] }).ranges.map((r) => sheet.resolveRange(r)))).toEqual([{ top: 0, left: 1, bottom: MAX_ROWS - 1, right: 1 }])
})

it('rejects Clear All before removing contents when inherited reset expansion is too large', () => {
  const { sheet, view } = setup()
  commands.applyStyle(sheet, [wholeSelections[0]![1]], { bold: true })
  sheet.setCell(0, 0, { v: 'keep' })
  view.select({ top: 0, left: 0, bottom: MAX_ROWS - 2, right: 1 })
  const before = Y.encodeStateAsUpdate(view.workbook.doc)
  view.clearAll()
  expect(Y.encodeStateAsUpdate(view.workbook.doc)).toEqual(before)
  expect(sheet.cell(0, 0)?.v).toBe('keep')
})

it('rejects deleting all physical rows before allocating them', () => {
  const { sheet, view } = setup()
  sheet.cells.set(sheet.keyAt(MAX_ROWS - 1, 0), { v: 'last' })
  view.goTo('A1048576')
  view.select(wholeSelections[2]![1])
  const before = Y.encodeStateAsUpdate(view.workbook.doc)
  view.deleteLines('row')
  expect(Y.encodeStateAsUpdate(view.workbook.doc)).toEqual(before)
})

it('applies Select All formatting over blank row-style exceptions', () => {
  const { sheet, view } = setup()
  sheet.setAxisStyle('row', [3], { bold: false })
  view.select(wholeSelections[2]![1])
  view.setStyle({ bold: true })
  expect(view.styleAt(3, 10).bold).toBe(true)
  expect(view.styleAt(5, MAX_COLS - 1).bold).toBe(true)
})

it('applies whole-column formatting over imported and override row styles at blank intersections', () => {
  const { sheet, view } = setup()
  sheet.setAxisStyle('row', [3], { bold: false })
  view.select(wholeSelections[0]![1])
  view.setStyle({ bold: true })
  expect(view.styleAt(3, 0).bold).toBe(true)
  expect(view.styleAt(3, 1).bold).toBe(false)
})

it.each(['row', 'col'] as const)('retains each target inherited number format in fill and replace: %s', (axis) => {
  const { sheet, view } = setup()
  sheet.setAxisStyle(axis, [1], { numFmt: '0.000' })
  view.select({ top: 0, left: 0, bottom: 1, right: 1 })
  view.beginEdit('50%')
  expect(view.commitEdit({ fill: true })).toBe(true)
  expect(view.styleAt(1, 1).numFmt).toBe('0.000')
  expect(view.styleAt(0, 0).numFmt).toBe('0%')
  sheet.setCell(1, 1, { v: 'find' })
  expect(view.replace('find', '50%')).toBe(1)
  expect(view.styleAt(1, 1).numFmt).toBe('0.000')
})

it.each(['row', 'col'] as const)('round-trips a cleared blank cell under an imported %s base', async (axis) => {
  const { doc, sheet, view } = setup()
  const base = view.stylesheetFor.intern(undefined, { bold: true, numFmt: '0.000%' })
  sheet.workbook.meta.set('stylesXml', view.stylesheetFor.toXml())
  if (axis === 'row') sheet.setRowProp([0], 'xf', base)
  else sheet.setColProp([0], 'xf', base)
  view.clearFormats()
  expect(view.styleAt(0, 0).bold).toBe(false)
  const codec = new SheetCodec()
  const imported = new Y.Doc()
  const context = { name: 'cleared.xlsx', assets: view.options.assets }
  await codec.importFile(imported, await codec.exportFile(doc, context), context)
  const container = document.createElement('div')
  const loaded = new SheetView({ container, doc: imported, assets: context.assets, user: { name: 'Test', color: '#123456' } })
  views.push(loaded)
  expect(loaded.styleAt(0, 0)).toMatchObject({ bold: false, numFmt: 'General' })
  expect(loaded.styleAt(axis === 'row' ? 0 : 1, axis === 'row' ? 1 : 0).bold).toBe(true)
})

it.each(['row', 'col'] as const)('bounds copied cell-format amplification when inserting a %s', (axis) => {
  const { sheet, view } = setup()
  for (let i = 0; i < 101; i++) sheet.setStyle(axis === 'row' ? { top: 0, bottom: 0, left: i, right: i } : { top: i, bottom: i, left: 0, right: 0 }, { bold: true })
  const before = Y.encodeStateAsUpdate(view.workbook.doc)
  expect(() => commands.insertLines(sheet, axis, 1, 10000)).toThrow(commands.DataOperationError)
  expect(Y.encodeStateAsUpdate(view.workbook.doc)).toEqual(before)
})

it.each(['Sheet1!A1:XFD10000', 'Sheet1!A0:B2', 'Sheet1!A1:XFE2', 'Sheet1!A1:A1048577'])('bounds chart range expansion for %s', (formula) => {
  const { view } = setup()
  const read = vi.spyOn(view.values, 'get')
  const result = (view.clipboard as unknown as { resolveChartRange(formula: string): unknown }).resolveChartRange(formula)
  expect(result).toBeUndefined()
  expect(read).not.toHaveBeenCalled()
})

describe('validation formula anchors', () => {
  it.each(['between', 'notBetween', 'greaterThan', 'lessThan'] as const)('rebases both numeric bounds for %s', (operator) => {
    const { sheet, view } = setup()
    sheet.setCell(0, 1, { v: 1 }); sheet.setCell(0, 2, { v: 10 })
    sheet.setCell(4, 1, { v: 100 }); sheet.setCell(4, 2, { v: 200 })
    commands.setValidation(sheet, [{ top: 0, left: 0, bottom: 9, right: 0 }], { type: 'whole', operator, formula1: 'B1', formula2: 'C1' })
    view.goTo('A5')
    const rejected = operator === 'between' || operator === 'greaterThan' ? '50' : '150'
    const accepted = operator === 'between' || operator === 'greaterThan' ? '150' : '50'
    view.beginEdit(rejected)
    expect(view.commitEdit()).toBe(false)
    view.setEditText(accepted)
    expect(view.commitEdit()).toBe(true)
  })

  it('evaluates custom validation against the draft without publishing speculative edits', () => {
    const { doc, sheet, view } = setup()
    sheet.setCell(4, 0, { v: 150 })
    sheet.setCell(4, 1, { v: 100 })
    // Includes an indirect dependency on the proposed cell.
    sheet.setCell(4, 2, { f: toIdForm('A5*2', sheet), dynamic: true })
    commands.setValidation(sheet, [{ top: 0, left: 0, bottom: 9, right: 0 }], { type: 'custom', formula1: 'AND(A1>B1,C1>200)' })
    view.goTo('A5')
    view.beginEdit('50')
    const before = Y.encodeStateAsUpdate(doc)
    expect(view.commitEdit()).toBe(false)
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
    view.setEditText('120')
    expect(view.commitEdit()).toBe(true)
    expect(sheet.cell(4, 0)?.v).toBe(120)
  })

  it.each(['B1:B2', 'OFFSET(B1,0,0,2,1)'])('rebases list source %s from the first sqref rectangle', (formula1) => {
    const { sheet, view } = setup()
    sheet.setCell(0, 1, { v: 'old' }); sheet.setCell(4, 1, { v: 'new' }); sheet.setCell(5, 1, { v: 'next' })
    commands.setValidation(sheet, [{ top: 0, left: 0, bottom: 1, right: 0 }, { top: 4, left: 0, bottom: 5, right: 0 }], { type: 'list', formula1 })
    view.goTo('A5')
    expect(view.listItems(commands.validationAt(sheet, 4, 0)!)).toEqual(['new', 'next'])
    view.beginEdit('old'); expect(view.commitEdit()).toBe(false)
    view.setEditText('new'); expect(view.commitEdit()).toBe(true)
  })

  it('reads a complete sparse list without the old 1,001-row cutoff, including with cached values', () => {
    const { sheet, view } = setup({ values: 'cached' })
    sheet.setCell(100_002, 1, { v: 'distant' })
    commands.setValidation(sheet, [{ top: 0, left: 0, bottom: 1, right: 0 }], { type: 'list', formula1: '$B:$B' })
    expect(view.listItems(commands.validationAt(sheet, 0, 0)!)).toEqual(['distant'])
  })

  it('keeps OOXML validation messages literal, including leading equals signs', () => {
    const { sheet, view } = setup()
    commands.setValidation(sheet, [{ top: 0, left: 0, bottom: 9, right: 0 }], { type: 'whole', formula1: '1', formula2: '10', error: '=B1', prompt: '=C1' })
    view.goTo('A5'); view.beginEdit('50')
    expect(view.commitEdit()).toBe(false)
    expect(view.root.textContent).toContain('=B1')
  })
})

describe('complete view domains', () => {
  it('refreshes distant CF cells and selection summaries after edits and remote changes', () => {
    const { doc, sheet, view } = setup()
    sheet.setCell(0, 0, { v: 10 }); sheet.setCell(200_002, 0, { v: 10 })
    commands.setConditionalFormat(sheet, [{ top: 0, left: 0, bottom: MAX_ROWS - 1, right: 0 }], { rules: [{ type: 'colorScale', priority: 1, colorScale: { values: [{ type: 'min' }, { type: 'max' }], colors: [{ rgb: 'FFFFFFFF' }, { rgb: 'FF000000' }] } }] })
    view.goTo('A:A')
    expect(view.getState().summary).toMatchObject({ count: 2, sum: 20, average: 10 })
    expect(view.scene().cell(0, 0).overlay?.scaleColor).toBe('#FFFFFF')
    remote(doc, (book) => book.sheets()[0]!.setCell(200_002, 0, { v: 1 }))
    expect(view.getState().summary).toMatchObject({ count: 2, sum: 11, average: 5.5 })
    expect(view.scene().cell(0, 0).overlay?.scaleColor).toBe('#000000')
    sheet.setCell(200_002, 0, undefined)
    expect(view.getState().summary).toMatchObject({ count: 1, sum: 10 })
  })

  it('exposes every filter choice using show-more and full-domain search', () => {
    const { book, sheet, view } = setup()
    book.transact(() => { for (let row = 0; row <= 1005; row++) sheet.setCell(row, 0, { v: `item-${String(row).padStart(4, '0')}` }) })
    commands.setAutoFilter(sheet, { top: 0, left: 0, bottom: 1005, right: 0 })
    const interactions = view.clipboard as unknown as { openFilterMenu(col: number, rect: { x: number; y: number; width: number; height: number }): void }
    interactions.openFilterMenu(0, { x: 0, y: 0, width: 64, height: 20 })
    const button = [...view.root.querySelectorAll('button')].find((button) => button.textContent === 'Show more values')!
    expect(button).toBeDefined()
    expect(view.root.textContent).not.toContain('item-1005')
    button.click()
    expect(view.root.textContent).toContain('item-1005')
    const search = view.root.querySelector<HTMLInputElement>('input[type="search"]')!
    search.value = 'item-1005'; search.dispatchEvent(new Event('input'))
    expect(view.root.textContent).toContain('item-1005')
  })

  it('keeps chart rows beyond 10,000 and refuses oversize printing visibly', () => {
    const { sheet, view } = setup()
    sheet.setCell(10_010, 0, { v: 'last' })
    const rows = (view.clipboard as unknown as { resolveChartRange(formula: string): unknown[][] }).resolveChartRange('Sheet1!A1:A10011')
    expect(rows).toHaveLength(10_011)
    expect(rows[10_010]).toEqual(['last'])
    expect(view.printHtml()).toContain('last')
    sheet.setCell(MAX_ROWS - 1, MAX_COLS - 1, { v: 'cannot silently omit' })
    expect(view.printHtml()).toContain(view.labels.dataErrors.size)
    expect(view.printHtml()).not.toContain('<table>')
  })

  it('draws overflowing text whose source is more than 30 columns outside the viewport', () => {
    const { sheet, view } = setup()
    sheet.setCell(0, 0, { v: 'long text '.repeat(1000) })
    view.goTo('AZ1')
    view.scroller.scrollLeft = view.scene().cols.offset(45)
    view.resize()
    view.scroller.scrollTop = 0
    const fill = vi.spyOn(view.canvas.getContext('2d')!, 'fillText')
    view.renderNow()
    expect(fill.mock.calls.some(([text]) => String(text).startsWith('long text'))).toBe(true)
  })
})

it('reports the chart range budget instead of silently falling back to cached values', () => {
  const { view } = setup()
  const limited = vi.fn()
  const result = (view.clipboard as unknown as { resolveChartRange(formula: string, onLimit: () => void): unknown }).resolveChartRange('Sheet1!A1:XFD10000', limited)
  expect(result).toBeUndefined()
  expect(limited).toHaveBeenCalledOnce()
})
